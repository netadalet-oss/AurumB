package io.aurum.aurumb.signal

import io.aurum.aurumb.persistence.*
import io.aurum.aurumb.portfolio.TradeRemovalService
import io.aurum.common.model.AurumVersions
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

class BlockedInstrumentService(
    private val dao:AurumDao,
    private val clock:()->Instant={Instant.now()}
) {
    suspend fun isBlocked(raw:String)=dao.blockedInstrument(norm(raw))!=null
    suspend fun list()=dao.blockedInstruments()

    suspend fun block(raw:String) {
        val symbol=norm(raw); val now=clock()
        dao.putBlockedInstrument(BlockedInstrumentEntity(symbol,now.toString(),"USER_BLOCK"))
        purgeTradeState(symbol)
        purgeCanonicalLocal(symbol)
        audit(symbol,"INSTRUMENT_BLOCKED","USER_BLOCK",now)
    }

    suspend fun unblock(raw:String) {
        val symbol=norm(raw); val now=clock()
        dao.unblockInstrument(symbol)
        audit(symbol,"INSTRUMENT_UNBLOCKED","USER_UNBLOCK_ONLY_NO_RESURRECTION",now)
    }

    suspend fun deleteOnly(raw:String) {
        val symbol=norm(raw); val now=clock()
        purgeTradeState(symbol)
        purgeCanonicalLocal(symbol)
        audit(symbol,"INSTRUMENT_LOCAL_DELETE","USER_DELETE_WITHOUT_BLOCK",now)
    }

    private suspend fun purgeTradeState(symbol:String) {
        val hasTradeEvidence=dao.signalsForInstrument(symbol).isNotEmpty() ||
            dao.portfolioTransactions().any{it.symbol==symbol} ||
            dao.portfolioPositions().any{it.symbol==symbol}
        if(hasTradeEvidence) TradeRemovalService(dao,clock).removeInstrument(symbol)
        else dao.deleteQualifiedTradeState(symbol)
    }

    private suspend fun purgeCanonicalLocal(symbol:String) {
        dao.deleteObservationsForSymbol(symbol)
        dao.deleteMarketBarsForSymbol(symbol)
        dao.deleteSelectionsForSymbol(symbol)
    }

    private suspend fun audit(symbol:String,code:String,reason:String,now:Instant) {
        dao.appendAudit(AuditEventEntity(
            UUID.randomUUID().toString(),now.toString(),"INFO","blocked-universe","blocked:"+symbol,
            code,symbol+" · "+reason,JSONObject(mapOf("symbol" to symbol,"reason" to reason)).toString(),
            AurumVersions.APP,"BLOCKED_UNIVERSE","BLOCKED_UNIVERSE",AurumVersions.DATA_SCHEMA,
            JSONObject(mapOf("source" to "MANUAL_PRODUCT_CARD")).toString()
        ))
    }

    private fun norm(raw:String)=raw.trim().uppercase().also{require(it.isNotBlank()){"symbol required"}}
}
