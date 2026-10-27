package io.aurum.aurumb.ai

import android.content.Context
import io.aurum.aurumb.calendar.BistCalendarFactory
import io.aurum.aurumb.network.HttpClientFactory
import io.aurum.aurumb.persistence.AiAuditEntity
import io.aurum.aurumb.persistence.AuditEventEntity
import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.security.SecureSecretStore
import io.aurum.aurumb.settings.SettingsRepository
import io.aurum.common.ai.AiBudget
import io.aurum.common.model.AurumVersions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID

data class OpenAiHealth(
    val ok:Boolean,
    val model:String,
    val modelMigrated:Boolean,
    val checkedAt:Instant
)

data class NativeAiRunResult(
    val purpose:String,
    val auditId:String,
    val parsed:JSONObject,
    val model:String,
    val responseId:String?
)

class OpenAiAutomationService(
    context:Context,
    private val dao:AurumDao
) {
    private val app=context.applicationContext
    private val settings=SettingsRepository(app)
    private val secrets=SecureSecretStore(app)
    private val client=HttpClientFactory.aiGateway("api.openai.com")
    private val base="https://api.openai.com".toHttpUrl()
    private val jsonType="application/json; charset=utf-8".toMediaType()
    private val zone=ZoneId.of("Europe/Istanbul")

    fun configured():Boolean {
        val enabled=settings.load().first["aiEnabled"]=="true"
        if(!enabled) return false
        val key=runCatching{secrets.get(KEY_NAME)}.getOrNull()
        return try { key!=null && key.isNotEmpty() } finally { key?.fill('\u0000') }
    }

    fun saveKey(raw:CharArray) {
        val text=raw.concatToString().trim()
        try {
            require(KEY_PATTERN.matches(text)){"Geçerli OpenAI API anahtarı gerekli"}
            secrets.put(KEY_NAME,text.toCharArray())
            require(settings.put("aiEnabled","true")){"AI ayarı kaydedilemedi"}
        } finally {
            raw.fill('\u0000')
        }
    }

    fun removeKey() {
        secrets.remove(KEY_NAME)
        settings.put("aiEnabled","false")
    }

    suspend fun healthCheck():OpenAiHealth=gate.withLock {
        require(configured()){"OpenAI güvenli bağlantısı yapılandırılmadı"}
        val raw=settings.load().first
        val requested=normalizedModel(raw.getValue("openaiModel"))
        val response=request("/v1/models","GET",null)
        val body=JSONObject(response.body)
        val ids=body.optJSONArray("data")?.let { a ->
            (0 until a.length()).mapNotNull{i->a.optJSONObject(i)?.optString("id")?.takeIf(String::isNotBlank)}
        }.orEmpty()
        var selected=requested
        var migrated=false
        if(selected !in ids) {
            selected=PREFERRED_MODELS.firstOrNull{it in ids}
                ?: ids.firstOrNull{it.startsWith("gpt-5")}
                ?: ids.firstOrNull{it.startsWith("gpt-4.1")}
                ?: ids.firstOrNull{it.startsWith("gpt-4o")}
                ?: throw IllegalStateException("Bu OpenAI API projesinde uyumlu GPT modeli görünmüyor")
            migrated=selected!=requested
            if(migrated) require(settings.put("openaiModel",selected)){"OpenAI model ayarı güncellenemedi"}
        }
        OpenAiHealth(true,selected,migrated,Instant.now())
    }

    suspend fun maybeRunDailyAudit(now:Instant=Instant.now()):NativeAiRunResult? {
        val raw=settings.load().first
        if(raw["aiAutoDaily"]!="true" || !configured()) return null
        val local=now.atZone(zone)
        if(local.year!=2026 || !BistCalendarFactory.create2026().isOpen(local.toLocalDate())) return null
        if(local.hour<raw.getValue("aiDailyHour").toInt()) return null
        val last=dao.latestSuccessfulAiAudit(PURPOSE_DAILY)
        val lastDate=last?.requestedAtUtc?.let {
            runCatching{Instant.parse(it).atZone(zone).toLocalDate()}.getOrNull()
        }
        if(lastDate==local.toLocalDate()) {
            val parsed=last.responseJson?.let{runCatching{JSONObject(it)}.getOrNull()} ?: return null
            return NativeAiRunResult(PURPOSE_DAILY,last.id,parsed,last.model?:raw.getValue("openaiModel"),null)
        }
        return runDailyAudit(manual=false,now=now)
    }

    suspend fun runDailyAudit(manual:Boolean,now:Instant=Instant.now()):NativeAiRunResult =
        paidGate.withLock {
            val reservation=reservePaidEvidence(PURPOSE_DAILY,manual,now)
            val requestFingerprint=sha256((reservation.operationId+"|"+PURPOSE_DAILY).toByteArray())
            try {
                val health=healthCheck()
                val snapshot=buildSnapshot(now)
                val parsed=responsesCall(
                    purpose=PURPOSE_DAILY,
                    model=health.model,
                    schemaName="aurum_daily_audit",
                    schema=DAILY_SCHEMA,
                    instructions="Aurum BIST karar destek sistemini denetle. Yalnız verilen kanıtı kullan. Finansal kesinlik iddiasında bulunma. Riskleri açıkça ayır. Çıktıyı Türkçe üret.",
                    input=JSONObject().put("snapshot",snapshot),
                    reservation=reservation
                )
                recordEvidenceResult(reservation,"COMPLETED",parsed.responseId)
                parsed
            } catch(t:Throwable) {
                appendFailure(PURPOSE_DAILY,reservation,requestFingerprint,t)
                recordEvidenceResult(reservation,"FAILED",null,t.message)
                throw t
            }
        }

    suspend fun generateCandidate(manual:Boolean=true,now:Instant=Instant.now()):NativeAiRunResult =
        paidGate.withLock {
            val raw=settings.load().first
            require(raw["aiAllowCandidates"]=="true"){"AI aday modeli ayarlardan kapalı"}
            val previous=dao.latestSuccessfulAiAudit(PURPOSE_DAILY)
                ?: throw IllegalStateException("Önce günlük AI denetimi çalıştırılmalı")
            val audit=previous.responseJson?.let(::JSONObject)
                ?: throw IllegalStateException("Günlük AI denetim içeriği bulunamadı")
            val confidence=audit.optDouble("confidence",Double.NaN)
            val minConfidence=raw.getValue("aiMinAuditConfidenceForCandidate").toDouble()
            require(confidence.isFinite() && confidence>=minConfidence) {
                "Aday üretimi engellendi: denetim güveni yetersiz"
            }
            val diagnosis=audit.optJSONArray("diagnosis") ?: JSONArray()
            val highRisk=(0 until diagnosis.length()).any { i ->
                diagnosis.optJSONObject(i)?.optString("severity").orEmpty() in setOf("HIGH","CRITICAL")
            }
            require(!highRisk){"Aday üretimi engellendi: HIGH/CRITICAL denetim bulgusu var"}
            val evidenceRuns=dao.eligibleLearningRunCount()
            val minRuns=raw.getValue("aiMinValidationPeriods").toInt()
            require(evidenceRuns>=minRuns){"Aday üretimi engellendi: bağımsız ileri dönem $evidenceRuns/$minRuns"}

            val reservation=reservePaidEvidence(PURPOSE_CANDIDATE,manual,now)
            val requestFingerprint=sha256((reservation.operationId+"|"+PURPOSE_CANDIDATE).toByteArray())
            try {
                val health=healthCheck()
                val parsed=responsesCall(
                    purpose=PURPOSE_CANDIDATE,
                    model=health.model,
                    schemaName="aurum_candidate_model",
                    schema=CANDIDATE_SCHEMA,
                    instructions="Verilen Aurum denetim ve performans kanıtından yalnız kontrollü bir aday ağırlık önerisi üret. K10-K12 bağımsız karar ağırlığı değildir. K1-K7 ağırlıklarını 0 ile 1 arasında ver ve toplamını 1 yap. Canlı modeli etkinleştirme kararı verme.",
                    input=JSONObject().put("snapshot",buildSnapshot(now)).put("audit",audit),
                    reservation=reservation
                )
                recordEvidenceResult(reservation,"COMPLETED",parsed.responseId)
                parsed
            } catch(t:Throwable) {
                appendFailure(PURPOSE_CANDIDATE,reservation,requestFingerprint,t)
                recordEvidenceResult(reservation,"FAILED",null,t.message)
                throw t
            }
        }

    private data class Reservation(
        val operationId:String,
        val marketFingerprint:String,
        val bucketKey:String,
        val at:Instant
    )

    private data class HttpResult(val status:Int,val body:String,val requestId:String?)
    private data class ResponseResult(
        val purpose:String,
        val auditId:String,
        val parsed:JSONObject,
        val model:String,
        val responseId:String?
    )

    private suspend fun reservePaidEvidence(kind:String,manual:Boolean,now:Instant):Reservation {
        require(configured()){"OpenAI güvenli bağlantısı yapılandırılmadı"}
        val raw=settings.load().first
        val latest=dao.latestValidRun() ?: throw IllegalStateException("Doğrulanmış analiz run'ı yok")
        require(dao.selectionsForRun(latest.id).isNotEmpty()){"AI için doğrulanmış seçim kanıtı yok"}

        val bucket=bucketKey(now,raw.getValue("aiMarketTimeBuckets"))
        if(raw["aiRequireNewMarketBucket"]!="false") {
            dao.latestAiPaidEvidence()?.let { prior ->
                val meta=runCatching{JSONObject(prior.metadataJson)}.getOrNull()
                if(meta!=null) {
                    require(meta.optString("marketFingerprint")!=latest.dataFingerprint) {
                        "Yeni piyasa verisi yok; ücretli AI çağrısı engellendi"
                    }
                    require(meta.optString("bucketKey")!=bucket) {
                        "Yeni piyasa zaman kovası yok; ücretli AI çağrısı engellendi ($bucket)"
                    }
                }
            }
        }

        val used=dao.paidAiCallCountSince(AiBudget.utcDayStart(now).toString())
        val limit=raw.getValue("aiDailyPaidCallLimit").toInt()
        require(AiBudget.allowsPaidCall(used,limit)){"Günlük AI çağrı sınırı doldu ($limit)"}

        val id=UUID.randomUUID().toString()
        dao.appendAudit(AuditEventEntity(
            id=id,
            timestampUtc=now.toString(),
            level="INFO",
            subsystem="ai",
            operationId=id,
            code="AI_PAID_EVIDENCE",
            message="Ücretli AI çağrısı için yeni veri ve piyasa kovası ayrıldı",
            metadataJson=JSONObject()
                .put("kind",kind)
                .put("manual",manual)
                .put("marketFingerprint",latest.dataFingerprint)
                .put("bucketKey",bucket)
                .toString(),
            appVersion=AurumVersions.APP,
            modelVersion=AurumVersions.MODEL,
            formulaVersion=AurumVersions.FORMULA,
            dataSchemaVersion=AurumVersions.DATA_SCHEMA,
            provenanceJson=JSONObject().put("analysisRunId",latest.id).toString()
        ))
        return Reservation(id,latest.dataFingerprint,bucket,now)
    }

    private suspend fun recordEvidenceResult(
        r:Reservation,status:String,responseId:String?,error:String?=null
    ) {
        val at=Instant.now()
        dao.appendAudit(AuditEventEntity(
            id=UUID.randomUUID().toString(),
            timestampUtc=at.toString(),
            level=if(status=="COMPLETED")"INFO" else "WARN",
            subsystem="ai",
            operationId=r.operationId,
            code="AI_PAID_EVIDENCE_RESULT",
            message="Ücretli AI kanıt rezervasyonu $status",
            metadataJson=JSONObject()
                .put("status",status)
                .put("bucketKey",r.bucketKey)
                .put("marketFingerprint",r.marketFingerprint)
                .put("responseId",responseId?:JSONObject.NULL)
                .put("error",error?:JSONObject.NULL)
                .toString(),
            appVersion=AurumVersions.APP,
            modelVersion=AurumVersions.MODEL,
            formulaVersion=AurumVersions.FORMULA,
            dataSchemaVersion=AurumVersions.DATA_SCHEMA,
            provenanceJson=JSONObject().toString()
        ))
    }

    private suspend fun responsesCall(
        purpose:String,
        model:String,
        schemaName:String,
        schema:JSONObject,
        instructions:String,
        input:JSONObject,
        reservation:Reservation
    ):NativeAiRunResult {
        val raw=settings.load().first
        val body=JSONObject()
            .put("model",model)
            .put("input",JSONArray()
                .put(JSONObject()
                    .put("role","system")
                    .put("content",JSONArray().put(JSONObject().put("type","input_text").put("text",instructions))))
                .put(JSONObject()
                    .put("role","user")
                    .put("content",JSONArray().put(JSONObject().put("type","input_text").put("text",input.toString())))))
            .put("max_output_tokens",raw.getValue("openaiMaxOutputTokens").toInt())
            .put("text",JSONObject().put("format",JSONObject()
                .put("type","json_schema")
                .put("name",schemaName)
                .put("strict",true)
                .put("schema",schema)))
            .put("store",false)
        raw["openaiReasoningEffort"]?.trim()?.takeIf{it in setOf("low","medium")}?.let {
            body.put("reasoning",JSONObject().put("effort",it))
        }

        val requestBytes=body.toString().toByteArray(Charsets.UTF_8)
        val requestFingerprint=sha256(requestBytes)
        val started=Instant.now()
        val http=request("/v1/responses","POST",body)
        val completed=Instant.now()
        val response=JSONObject(http.body)
        val parsed=extractStructuredOutput(response)
        if(purpose==PURPOSE_DAILY) {
            validateDaily(parsed)
        } else {
            validateCandidate(parsed)
            parsed.put("status","PENDING_FORWARD")
                .put("liveApplied",false)
                .put("requiresForwardValidation",true)
                .put("nativePolicyReasons",JSONArray(listOf(
                    "Aday yalnız öneridir",
                    "Canlı modele geçiş için adaydan sonra oluşan bağımsız ileri dönem doğrulaması ve kullanıcı onayı gerekir"
                )))
        }
        val responseFingerprint=sha256(http.body.toByteArray(Charsets.UTF_8))
        val id=UUID.randomUUID().toString()
        dao.appendAiAudit(AiAuditEntity(
            id=id,
            marketFingerprint=reservation.marketFingerprint,
            purpose=purpose,
            schemaVersion=if(purpose==PURPOSE_DAILY)DAILY_SCHEMA_VERSION else CANDIDATE_SCHEMA_VERSION,
            provider="OPENAI",
            model=response.optString("model",model),
            requestedAtUtc=started.toString(),
            completedAtUtc=completed.toString(),
            status="SUCCESS",
            requestFingerprint=requestFingerprint,
            responseFingerprint=responseFingerprint,
            responseJson=parsed.toString(),
            errorCode=null,
            retryable=false,
            paidCall=true
        ))
        return NativeAiRunResult(purpose,id,parsed,response.optString("model",model),response.optString("id").takeIf(String::isNotBlank))
    }

    private suspend fun appendFailure(
        purpose:String,
        r:Reservation,
        requestFingerprint:String,
        t:Throwable
    ) {
        val now=Instant.now()
        dao.appendAiAudit(AiAuditEntity(
            id=UUID.randomUUID().toString(),
            marketFingerprint=r.marketFingerprint,
            purpose=purpose,
            schemaVersion=if(purpose==PURPOSE_DAILY)DAILY_SCHEMA_VERSION else CANDIDATE_SCHEMA_VERSION,
            provider="OPENAI",
            model=settings.load().first["openaiModel"],
            requestedAtUtc=r.at.toString(),
            completedAtUtc=now.toString(),
            status="FAILED",
            requestFingerprint=requestFingerprint,
            responseFingerprint=null,
            responseJson=null,
            errorCode=(t.message?:t::class.java.simpleName).take(160),
            retryable=false,
            paidCall=true
        ))
    }

    private suspend fun buildSnapshot(now:Instant):JSONObject {
        val raw=settings.load().first
        val latest=dao.latestValidRun() ?: throw IllegalStateException("Doğrulanmış analiz run'ı yok")
        val rows=dao.selectionsForRun(latest.id)
        val selected=rows.filter{it.rank>0}.sortedBy{it.rank}.take(20)
        val recent=dao.recentRuns(raw.getValue("aiMaxRecentRuns").toInt())
        val champion=dao.champion()
        return JSONObject()
            .put("generated_at",now.toString())
            .put("app_version",AurumVersions.APP)
            .put("model_version",latest.modelVersion)
            .put("formula_version",latest.formulaVersion)
            .put("target_definition","Reel TopN + ileri ekonomik hedef; AI yalnız denetim/advisory")
            .put("target_return_pct",raw["targetReturnPct"]?.toDoubleOrNull()?:5.0)
            .put("market_context",JSONObject()
                .put("run_id",latest.id)
                .put("as_of",latest.asOfUtc)
                .put("regime",latest.marketRegime)
                .put("data_fingerprint",latest.dataFingerprint))
            .put("data_quality",JSONObject()
                .put("market_bar_count",dao.marketBarCount())
                .put("universe_snapshot_count",dao.universeSnapshotCount())
                .put("selection_rows",rows.size))
            .put("learning",JSONObject()
                .put("eligible_forward_runs",dao.eligibleLearningRunCount())
                .put("champion_version",champion?.version?:JSONObject.NULL)
                .put("champion_reason",champion?.reason?:JSONObject.NULL))
            .put("current_weights",champion?.weightsJson?.let{runCatching{JSONObject(it)}.getOrNull()}?:JSONObject())
            .put("selection",JSONArray().apply {
                selected.forEach { row ->
                    put(JSONObject()
                        .put("rank",row.rank)
                        .put("symbol",row.symbol)
                        .put("score",row.scoreDecimal)
                        .put("consensus",row.alphaScoreDecimal)
                        .put("data_quality",row.dataQualityDecimal)
                        .put("confidence",row.confidenceDecimal)
                        .put("target_probability",row.targetProbabilityDecimal)
                        .put("contributions",runCatching{JSONArray(row.contributionsJson)}.getOrElse{JSONArray()}))
                }
            })
            .put("recent_runs",JSONArray().apply {
                recent.forEach { run ->
                    put(JSONObject()
                        .put("id",run.id)
                        .put("as_of",run.asOfUtc)
                        .put("regime",run.marketRegime)
                        .put("status",run.status)
                        .put("integrity_passed",run.integrityPassed)
                        .put("model_version",run.modelVersion)
                        .put("formula_version",run.formulaVersion))
                }
            })
    }

    private suspend fun request(path:String,method:String,body:JSONObject?):HttpResult =
        withContext(Dispatchers.IO) {
            val chars=secrets.get(KEY_NAME) ?: throw IllegalStateException("OpenAI API anahtarı kayıtlı değil")
            try {
                val url=base.newBuilder().addPathSegments(path.removePrefix("/")).build()
                val builder=Request.Builder()
                    .url(url)
                    .header("Accept","application/json")
                    .header("Authorization","Bearer "+chars.concatToString())
                if(method=="POST") {
                    builder.post(requireNotNull(body).toString().toRequestBody(jsonType))
                } else builder.get()
                client.newCall(builder.build()).execute().use { response ->
                    val text=response.body?.string().orEmpty()
                    val requestId=response.header("x-request-id")
                    if(!response.isSuccessful) {
                        val message=runCatching {
                            JSONObject(text).optJSONObject("error")?.optString("message")
                        }.getOrNull().takeUnless{it.isNullOrBlank()}
                        throw IllegalStateException((message?:"OpenAI HTTP "+response.code)+(requestId?.let{" · İstek "+it}?:""))
                    }
                    HttpResult(response.code,text,requestId)
                }
            } finally {
                chars.fill('\u0000')
            }
        }

    private fun extractStructuredOutput(response:JSONObject):JSONObject {
        if(response.optString("status")=="incomplete") {
            throw IllegalStateException("OpenAI yanıtı tamamlanmadı: "+response.optJSONObject("incomplete_details")?.optString("reason"))
        }
        val texts=mutableListOf<String>()
        response.optString("output_text").takeIf(String::isNotBlank)?.let(texts::add)
        val output=response.optJSONArray("output") ?: JSONArray()
        for(i in 0 until output.length()) {
            val content=output.optJSONObject(i)?.optJSONArray("content") ?: continue
            for(j in 0 until content.length()) {
                val item=content.optJSONObject(j) ?: continue
                if(item.optString("type")=="refusal" || item.has("refusal")) {
                    throw IllegalStateException("OpenAI refusal: "+item.optString("refusal",item.optString("text")))
                }
                if(item.optString("type") in setOf("output_text","text")) {
                    item.optString("text").takeIf(String::isNotBlank)?.let(texts::add)
                }
            }
        }
        val raw=texts.firstOrNull() ?: throw IllegalStateException("OpenAI yapılandırılmış çıktısı bulunamadı")
        return runCatching{JSONObject(raw)}
            .getOrElse{throw IllegalStateException("OpenAI yapılandırılmış çıktısı ayrıştırılamadı")}
    }

    private fun validateDaily(o:JSONObject) {
        require(o.optString("executive_summary").isNotBlank()){"AI_AUDIT_SUMMARY_MISSING"}
        val confidence=o.optDouble("confidence",Double.NaN)
        require(confidence.isFinite() && confidence in 0.0..1.0){"AI_AUDIT_CONFIDENCE_INVALID"}
        require(o.optJSONArray("diagnosis")!=null){"AI_AUDIT_DIAGNOSIS_MISSING"}
        require(o.optJSONArray("missed_patterns")!=null){"AI_AUDIT_MISSED_MISSING"}
        require(o.optJSONArray("false_positive_patterns")!=null){"AI_AUDIT_FALSE_POSITIVE_MISSING"}
    }

    private fun validateCandidate(o:JSONObject) {
        require(o.optString("hypothesis").isNotBlank()){"AI_CANDIDATE_HYPOTHESIS_MISSING"}
        require(o.optString("rationale").isNotBlank()){"AI_CANDIDATE_RATIONALE_MISSING"}
        val w=o.optJSONObject("proposed_weights") ?: throw IllegalArgumentException("AI_CANDIDATE_WEIGHTS_MISSING")
        require(w.keys().asSequence().toSet()==(1..7).map{"K$it"}.toSet()){"AI_CANDIDATE_WEIGHT_KEYS"}
        val sum=(1..7).sumOf { k ->
            w.optDouble("K$k",Double.NaN).also { require(it.isFinite() && it in 0.0..1.0) }
        }
        require(kotlin.math.abs(sum-1.0)<=0.00001){"AI_CANDIDATE_WEIGHT_SUM"}
        val confidence=o.optDouble("confidence",Double.NaN)
        require(confidence.isFinite() && confidence in 0.0..1.0){"AI_CANDIDATE_CONFIDENCE_INVALID"}
    }

    private fun bucketKey(now:Instant,raw:String):String {
        val slots=raw.split(',', ';', ' ', '\n', '\t')
            .mapNotNull{runCatching{LocalTime.parse(it.trim())}.getOrNull()}
            .distinct().sorted()
        require(slots.isNotEmpty()){"AI piyasa zaman kovaları geçersiz"}
        val local=now.atZone(zone)
        val minute=local.hour*60+local.minute
        val current=slots.lastOrNull{it.hour*60+it.minute<=minute}
        return if(current!=null) local.toLocalDate().toString()+"|"+current
        else local.toLocalDate().minusDays(1).toString()+"|"+slots.last()
    }

    private fun normalizedModel(raw:String):String =
        raw.trim().takeIf(String::isNotBlank)?.let{if(it=="gpt-5-mini")DEFAULT_MODEL else it} ?: DEFAULT_MODEL

    private fun jsonStrings(a:JSONArray?):List<String> =
        if(a==null) emptyList() else (0 until a.length()).mapNotNull{i->a.optString(i).takeIf(String::isNotBlank)}

    private fun sha256(bytes:ByteArray):String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}

    companion object {
        private const val KEY_NAME="openai-api-key"
        private const val DEFAULT_MODEL="gpt-5.6-luna"
        private const val PURPOSE_DAILY="DAILY_AUDIT"
        private const val PURPOSE_CANDIDATE="CANDIDATE_GENERATE"
        private const val DAILY_SCHEMA_VERSION="aurum-daily-audit/v1"
        private const val CANDIDATE_SCHEMA_VERSION="aurum-candidate/v1"
        private val KEY_PATTERN=Regex("^sk-[A-Za-z0-9_-]{20,}$")
        private val PREFERRED_MODELS=listOf(
            "gpt-5.6-luna","gpt-5.6-terra","gpt-5.6","gpt-5.6-sol",
            "gpt-5-mini","gpt-5","gpt-4.1-mini","gpt-4.1","gpt-4o-mini","gpt-4o"
        )
        private val gate=Mutex()
        private val paidGate=Mutex()

        private val DAILY_SCHEMA=JSONObject(
            """{"type":"object","additionalProperties":false,"required":["executive_summary","confidence","diagnosis","missed_patterns","false_positive_patterns"],"properties":{"executive_summary":{"type":"string"},"confidence":{"type":"number","minimum":0,"maximum":1},"diagnosis":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["title","evidence","severity"],"properties":{"title":{"type":"string"},"evidence":{"type":"string"},"severity":{"type":"string","enum":["LOW","MEDIUM","HIGH","CRITICAL"]}}}},"missed_patterns":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["pattern","evidence","affected_symbols"],"properties":{"pattern":{"type":"string"},"evidence":{"type":"string"},"affected_symbols":{"type":"array","items":{"type":"string"}}}}},"false_positive_patterns":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["pattern","evidence"],"properties":{"pattern":{"type":"string"},"evidence":{"type":"string"}}}}}}"""
        )
        private val CANDIDATE_SCHEMA=JSONObject(
            """{"type":"object","additionalProperties":false,"required":["hypothesis","rationale","proposed_weights","risks","confidence"],"properties":{"hypothesis":{"type":"string"},"rationale":{"type":"string"},"proposed_weights":{"type":"object","additionalProperties":false,"required":["K1","K2","K3","K4","K5","K6","K7"],"properties":{"K1":{"type":"number","minimum":0,"maximum":1},"K2":{"type":"number","minimum":0,"maximum":1},"K3":{"type":"number","minimum":0,"maximum":1},"K4":{"type":"number","minimum":0,"maximum":1},"K5":{"type":"number","minimum":0,"maximum":1},"K6":{"type":"number","minimum":0,"maximum":1},"K7":{"type":"number","minimum":0,"maximum":1}}},"risks":{"type":"array","items":{"type":"string"}},"confidence":{"type":"number","minimum":0,"maximum":1}}}"""
        )
    }
}
