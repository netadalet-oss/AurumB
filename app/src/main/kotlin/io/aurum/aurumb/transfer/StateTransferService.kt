package io.aurum.aurumb.transfer

import io.aurum.aurumb.persistence.*
import io.aurum.aurumb.provider.Fingerprint
import io.aurum.aurumb.settings.SettingsRepository
import io.aurum.common.model.AurumVersions
import io.aurum.common.settings.SettingsSchema
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

data class ImportValidation(
    val valid:Boolean,
    val errors:List<String>,
    val schemaVersion:Int?
)

class StateTransferService(
    private val dao:AurumDao,
    private val settings:SettingsRepository
) {
    companion object {
        const val EXPORT_SCHEMA=1
        private val forbiddenKeys=listOf("apiKey","secret","password","authorization","keystore")
    }

    suspend fun exportJson():String {
        val payload=JSONObject().apply {
            put("settings",JSONObject(settings.load().first.toSortedMap()))
            put("portfolioState",dao.portfolioState()?.let(::portfolioStateJson) ?: JSONObject.NULL)
            put("positions",JSONArray().apply {
                dao.portfolioPositions().sortedBy{it.symbol}.forEach{put(positionJson(it))}
            })
            put("transactions",JSONArray().apply {
                dao.portfolioTransactions()
                    .sortedWith(compareBy<PortfolioTransactionEntity>{it.atUtc}.thenBy{it.id})
                    .forEach{put(transactionJson(it))}
            })
        }
        val checksum="sha256:"+Fingerprint.sha256(canonical(payload).toByteArray(Charsets.UTF_8))
        return JSONObject().apply {
            put("schemaVersion",EXPORT_SCHEMA)
            put("appVersion",AurumVersions.APP)
            put("dataSchemaVersion",AurumVersions.DATA_SCHEMA)
            put("exportedAt",Instant.now().toString())
            put("checksum",checksum)
            put("payload",payload)
        }.toString(2)
    }

    fun dryValidate(raw:String):ImportValidation {
        val errors=mutableListOf<String>()
        val root=try { JSONObject(raw) } catch (_:Throwable) {
            return ImportValidation(false,listOf("INVALID_JSON"),null)
        }
        val schema=root.optInt("schemaVersion",-1)
        if(schema!=EXPORT_SCHEMA) errors+="UNSUPPORTED_SCHEMA"
        val payload=root.optJSONObject("payload")
        if(payload==null) {
            errors+="MISSING_PAYLOAD"
        } else {
            val expected="sha256:"+Fingerprint.sha256(canonical(payload).toByteArray(Charsets.UTF_8))
            if(root.optString("checksum")!=expected) errors+="CHECKSUM_MISMATCH"
            val lower=canonical(payload).lowercase()
            if(forbiddenKeys.any{lower.contains(it.lowercase())}) errors+="FORBIDDEN_SECRET_FIELD"
            validatePayload(payload,errors)
        }
        return ImportValidation(errors.isEmpty(),errors.distinct(),schema.takeIf{it>=0})
    }

    suspend fun importValidated(raw:String):ImportValidation {
        val validation=dryValidate(raw)
        if(!validation.valid) return validation

        val root=JSONObject(raw)
        val payload=root.getJSONObject("payload")
        val settingsObject=payload.getJSONObject("settings")
        val settingsMap=settingsObject.keys().asSequence().associateWith{settingsObject.getString(it)}
        val state=parsePortfolioState(payload.optJSONObject("portfolioState"))
        val positions=parsePositions(payload.getJSONArray("positions"))
        val transactions=parseTransactions(payload.getJSONArray("transactions"))
        if(state==null && (positions.isNotEmpty() || transactions.isNotEmpty())) {
            return ImportValidation(false,listOf("PORTFOLIO_STATE_REQUIRED"),validation.schemaVersion)
        }

        val previousSettings=settings.load().first
        val preparedAt=Instant.now()
        val journalId=UUID.randomUUID().toString()
        dao.insertImportJournal(
            ImportJournalEntity(
                id=journalId,
                state="PREPARED",
                previousSettingsJson=JSONObject(previousSettings.toSortedMap()).toString(),
                incomingSettingsJson=JSONObject(settingsMap.toSortedMap()).toString(),
                payloadChecksum=root.getString("checksum"),
                createdAtUtc=preparedAt.toString(),
                updatedAtUtc=preparedAt.toString()
            )
        )

        if(!settings.replaceValidated(settingsMap)) {
            dao.deleteImportJournal(journalId)
            return ImportValidation(false,listOf("SETTINGS_COMMIT_FAILED"),validation.schemaVersion)
        }

        return try {
            val committedAt=Instant.now().toString()
            if(state!=null) {
                dao.replacePortfolioImportWithJournal(state,positions,transactions,journalId,committedAt)
            } else {
                require(dao.updateImportJournalState(journalId,"DB_COMMITTED",committedAt)==1)
            }
            dao.deleteImportJournal(journalId)
            validation
        } catch (t:Throwable) {
            val journal=dao.pendingImportJournals().firstOrNull{it.id==journalId}
            if(journal?.state=="DB_COMMITTED") {
                ImportValidation(false,listOf("IMPORT_FINALIZATION_PENDING"),validation.schemaVersion)
            } else {
                val restored=settings.replaceValidated(previousSettings)
                if(restored) dao.deleteImportJournal(journalId)
                ImportValidation(
                    false,
                    listOf(if(restored) "PORTFOLIO_IMPORT_FAILED:"+t::class.java.simpleName else "IMPORT_RECOVERY_REQUIRED"),
                    validation.schemaVersion
                )
            }
        }
    }

    suspend fun recoverPendingImports():List<String> {
        val actions=mutableListOf<String>()
        val journals=try {
            dao.pendingImportJournals()
        } catch (e:Exception) {
            return listOf("JOURNAL_READ_FAILED:"+e::class.java.simpleName)
        }
        for(journal in journals) {
            try {
                when(journal.state) {
                    "PREPARED" -> {
                        val previous=parseSettingsMap(journal.previousSettingsJson)
                        if(settings.replaceValidated(previous)) {
                            dao.deleteImportJournal(journal.id)
                            actions += "ROLLED_BACK:"+journal.id
                        } else {
                            actions += "ROLLBACK_FAILED:"+journal.id
                        }
                    }
                    "DB_COMMITTED" -> {
                        val incoming=parseSettingsMap(journal.incomingSettingsJson)
                        if(settings.replaceValidated(incoming)) {
                            dao.deleteImportJournal(journal.id)
                            actions += "FINALIZED:"+journal.id
                        } else {
                            actions += "FINALIZE_FAILED:"+journal.id
                        }
                    }
                    else -> actions += "UNKNOWN_STATE:"+journal.id
                }
            } catch (e:Exception) {
                actions += "RECOVERY_ERROR:"+journal.id+":"+e::class.java.simpleName
            }
        }
        return actions
    }

    private fun parseSettingsMap(raw:String):Map<String,String> {
        val o=JSONObject(raw)
        return o.keys().asSequence().associateWith { key -> o.getString(key) }
    }

    private fun validatePayload(p:JSONObject,errors:MutableList<String>) {
        val settingsObject=p.optJSONObject("settings")
        if(settingsObject==null) {
            errors+="MISSING_SETTINGS"
        } else {
            val raw=settingsObject.keys().asSequence().associateWith { key ->
                val known=runCatching{SettingsSchema.spec(key)}.isSuccess
                if(!known) errors+="UNKNOWN_SETTING"
                settingsObject.optString(key)
            }
            val resolved=SettingsSchema.resolve(raw)
            if(resolved.repairedKeys.isNotEmpty()) errors+="INVALID_SETTINGS"
        }

        val positions=p.optJSONArray("positions")
        if(positions==null) errors+="MISSING_POSITIONS"
        else validatePositions(positions,errors)

        val transactions=p.optJSONArray("transactions")
        if(transactions==null) errors+="MISSING_TRANSACTIONS"
        else validateTransactions(transactions,errors)

        val state=p.optJSONObject("portfolioState")
        if(state!=null) {
            positive(state,"startingCapital",errors)
            nonNegative(state,"cash",errors)
            signedDecimal(state,"realizedPnl",errors)
            positive(state,"defaultPosition",errors)
            timestamp(state,"createdAt",errors)
            timestamp(state,"resetAt",errors)
            timestamp(state,"lastUpdatedAt",errors)
        }
    }

    private fun validatePositions(a:JSONArray,errors:MutableList<String>) {
        val symbols=mutableSetOf<String>()
        for(i in 0 until a.length()) {
            val x=a.optJSONObject(i)
            if(x==null) {
                errors+="INVALID_POSITION"
                continue
            }
            val symbol=x.optString("symbol")
            if(symbol.isBlank() || !symbols.add(symbol)) errors+="DUPLICATE_OR_INVALID_POSITION"
            positive(x,"quantity",errors)
            positive(x,"entryPrice",errors)
            nonNegative(x,"cost",errors)
            positive(x,"lastPrice",errors)
            nonNegative(x,"targetCost",errors)
            timestamp(x,"entryAt",errors)
            timestamp(x,"lastMarkedAt",errors)
            if(x.optString("sourceSignalId").isBlank()) errors+="MISSING_SOURCE_SIGNAL"
        }
    }

    private fun validateTransactions(a:JSONArray,errors:MutableList<String>) {
        val ids=mutableSetOf<String>()
        val keys=mutableSetOf<String>()
        for(i in 0 until a.length()) {
            val x=a.optJSONObject(i)
            if(x==null) {
                errors+="INVALID_TRANSACTION"
                continue
            }
            val id=x.optString("id")
            val key=x.optString("idempotencyKey")
            if(id.isBlank() || !ids.add(id)) errors+="DUPLICATE_TRANSACTION_ID"
            if(key.isBlank() || !keys.add(key)) errors+="DUPLICATE_IDEMPOTENCY_KEY"
            if(x.optString("symbol").isBlank()) errors+="INVALID_TRANSACTION_SYMBOL"
            positive(x,"quantity",errors)
            positive(x,"price",errors)
            nonNegative(x,"grossAmount",errors)
            nonNegative(x,"fee",errors)
            signedDecimal(x,"cashDelta",errors)
            if(!x.isNull("realizedPnl")) signedDecimal(x,"realizedPnl",errors)
            if(x.optString("type") !in setOf("BUY","SELL")) errors+="INVALID_TRANSACTION_TYPE"
            timestamp(x,"at",errors)
        }
    }

    private fun positive(o:JSONObject,key:String,errors:MutableList<String>) {
        val n=o.optString(key).toBigDecimalOrNull()
        if(n==null || n<=BigDecimal.ZERO) errors+="INVALID_"+key.uppercase()
    }
    private fun nonNegative(o:JSONObject,key:String,errors:MutableList<String>) {
        val n=o.optString(key).toBigDecimalOrNull()
        if(n==null || n<BigDecimal.ZERO) errors+="INVALID_"+key.uppercase()
    }
    private fun signedDecimal(o:JSONObject,key:String,errors:MutableList<String>) {
        if(o.optString(key).toBigDecimalOrNull()==null) errors+="INVALID_"+key.uppercase()
    }
    private fun timestamp(o:JSONObject,key:String,errors:MutableList<String>) {
        if(runCatching{Instant.parse(o.optString(key))}.isFailure) errors+="INVALID_"+key.uppercase()
    }

    private fun canonical(value:Any?):String = when(value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(
            prefix="{",postfix="}",separator=","
        ) { key -> JSONObject.quote(key)+":"+canonical(value.opt(key)) }
        is JSONArray -> (0 until value.length()).joinToString(
            prefix="[",postfix="]",separator=","
        ) { i -> canonical(value.opt(i)) }
        is String -> JSONObject.quote(value)
        is Number, is Boolean -> value.toString()
        else -> JSONObject.quote(value.toString())
    }

    private fun portfolioStateJson(x:PortfolioStateEntity)=JSONObject().apply {
        put("startingCapital",x.startingCapitalDecimal);put("cash",x.cashDecimal)
        put("realizedPnl",x.realizedPnlDecimal);put("defaultPosition",x.defaultPositionDecimal)
        put("createdAt",x.createdAtUtc);put("resetAt",x.resetAtUtc);put("lastUpdatedAt",x.lastUpdatedAtUtc)
    }
    private fun positionJson(x:PortfolioPositionEntity)=JSONObject().apply {
        put("symbol",x.symbol);put("quantity",x.quantityDecimal);put("cost",x.costDecimal)
        put("entryPrice",x.entryPriceDecimal);put("entryAt",x.entryAtUtc);put("lastPrice",x.lastPriceDecimal)
        put("lastMarkedAt",x.lastMarkedAtUtc);put("targetCost",x.targetCostDecimal);put("sourceSignalId",x.sourceSignalId)
    }
    private fun transactionJson(x:PortfolioTransactionEntity)=JSONObject().apply {
        put("id",x.id);put("idempotencyKey",x.idempotencyKey);put("at",x.atUtc);put("type",x.type);put("symbol",x.symbol)
        put("quantity",x.quantityDecimal);put("price",x.priceDecimal);put("grossAmount",x.grossAmountDecimal)
        put("fee",x.feeDecimal);put("cashDelta",x.cashDeltaDecimal);put("realizedPnl",x.realizedPnlDecimal)
        put("reason",x.reason);put("sourceSignalId",x.sourceSignalId)
    }

    private fun parsePortfolioState(x:JSONObject?):PortfolioStateEntity? {
        if(x==null)return null
        return PortfolioStateEntity(
            startingCapitalDecimal=x.getString("startingCapital"),
            cashDecimal=x.getString("cash"),
            realizedPnlDecimal=x.getString("realizedPnl"),
            defaultPositionDecimal=x.getString("defaultPosition"),
            createdAtUtc=x.getString("createdAt"),
            resetAtUtc=x.getString("resetAt"),
            lastUpdatedAtUtc=x.getString("lastUpdatedAt")
        )
    }
    private fun parsePositions(a:JSONArray)=buildList {
        for(i in 0 until a.length()) {
            val x=a.getJSONObject(i)
            add(PortfolioPositionEntity(
                x.getString("symbol"),x.getString("quantity"),x.getString("cost"),x.getString("entryPrice"),
                x.getString("entryAt"),x.getString("lastPrice"),x.getString("lastMarkedAt"),
                x.getString("targetCost"),x.getString("sourceSignalId")
            ))
        }
    }
    private fun parseTransactions(a:JSONArray)=buildList {
        for(i in 0 until a.length()) {
            val x=a.getJSONObject(i)
            add(PortfolioTransactionEntity(
                x.getString("id"),x.getString("idempotencyKey"),x.getString("at"),x.getString("type"),x.getString("symbol"),
                x.getString("quantity"),x.getString("price"),x.getString("grossAmount"),x.getString("fee"),
                x.getString("cashDelta"),x.optString("realizedPnl").takeIf{it.isNotBlank() && it!="null"},
                x.getString("reason"),x.optString("sourceSignalId").takeIf{it.isNotBlank() && it!="null"}
            ))
        }
    }
}
