package io.aurum.aurumb.signal

import io.aurum.aurumb.persistence.*
import io.aurum.aurumb.portfolio.VirtualPortfolioService
import io.aurum.common.model.AurumVersions
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

class ManualProductCardTradeService(private val dao:AurumDao,private val portfolio:VirtualPortfolioService,private val policy:QualifiedTradePolicy,private val clock:()->Instant={Instant.now()}) {
    data class Applied(val event:QualifiedLifecycleEvent,val runId:String)
    suspend fun apply(symbolRaw:String,side:SignalSide):Applied {
        require(side==SignalSide.BUY || side==SignalSide.SELL)
        val symbol=symbolRaw.trim().uppercase(); require(symbol.isNotBlank())
        if(side==SignalSide.BUY) require(dao.blockedInstrument(symbol)==null) { symbol+" is blocked for BUY" }
        val now=clock()
        val price=resolvePersistedPrice(symbol,now) ?: throw IllegalStateException("Persisted current price evidence unavailable for "+symbol)
        val previous=dao.qualifiedTradeStates().firstOrNull{it.symbol==symbol}
        if(side==SignalSide.BUY && previous?.status=="BUY") throw IllegalStateException(symbol+" already BUY")
        if(side==SignalSide.SELL && previous?.status!="BUY") throw IllegalStateException(symbol+" is not active BUY")
        val token="manual-product-card:"+UUID.randomUUID()
        val stop=if(side==SignalSide.BUY) QualifiedTradeLifecycle.technicalStop(price,null,null,policy).first else previous?.stopLossPriceDecimal?.toBigDecimalOrNull()
        val manualExitReason=if(side==SignalSide.SELL) {
            val entry=previous!!.buyPriceDecimal?.toBigDecimalOrNull()
                ?: throw IllegalStateException("Persisted BUY entry evidence unavailable for "+symbol)
            QualifiedTradeLifecycle.manualExitReason(
                entry=entry,
                price=price,
                persistedStop=stop,
                persistedPeak=previous.maxPriceDecimal?.toBigDecimalOrNull(),
                policy=policy
            )
        } else "MANUAL_PRODUCT_CARD"
        val event=QualifiedLifecycleEvent(symbol,side,now,price,manualExitReason,stop,previous?.activeProfitLockPctDecimal?.toBigDecimalOrNull())
        val id=token+":"+symbol+":"+side.name
        dao.appendSignal(SignalEntity(id,symbol,side.name,now.toString(),now.toString(),price.toPlainString(),JSONArray(listOf("MANUAL_PRODUCT_CARD")).toString(),"[]","1","MANUAL","PERSISTED_CURRENT_PRICE",stop?.let{"price <= "+it.toPlainString()}?:"manual product card exit","SHORT_TERM",AurumVersions.APP,"MANUAL_PRODUCT_CARD","MANUAL_PRODUCT_CARD",AurumVersions.DATA_SCHEMA))
        if(!portfolio.apply(event,id,id)) { dao.deleteSignalsByIds(listOf(id)); throw IllegalStateException("Portfolio mutation rejected for "+symbol+" "+side.name) }
        val state=if(side==SignalSide.BUY) QualifiedTradeStateEntity(symbol,"BUY",now.toString(),now.toString(),token,JSONArray(listOf(token)).toString(),1,now.toString(),price.toPlainString(),stop?.toPlainString(),"MANUAL_PRODUCT_CARD",now.toString(),price.toPlainString(),now.toString(),null,null,null,null,null,false,false)
        else previous!!.copy(status="SELL",processedRunTokensJson=JSONArray(listOf(token)).toString(),sellAtUtc=now.toString(),sellPriceDecimal=price.toPlainString(),exitReason=manualExitReason)
        dao.putQualifiedTradeStates(listOf(state))
        dao.appendAudit(AuditEventEntity(UUID.randomUUID().toString(),now.toString(),"INFO","qualified-trade",token,"MANUAL_QUALIFIED_"+side.name,symbol+" · MANUAL_PRODUCT_CARD",JSONObject(mapOf("symbol" to symbol,"side" to side.name,"price" to price.toPlainString(),"reason" to manualExitReason)).toString(),AurumVersions.APP,"MANUAL_PRODUCT_CARD","MANUAL_PRODUCT_CARD",AurumVersions.DATA_SCHEMA,JSONObject(mapOf("source" to "MANUAL_PRODUCT_CARD","signalId" to id)).toString()))
        return Applied(event,token)
    }
    private suspend fun resolvePersistedPrice(symbol:String,now:Instant):BigDecimal? {
        val observation=dao.latestObservation(symbol,now.toString())
        val observed=observation?.valueDecimal?.toBigDecimalOrNull()?.takeIf{it>BigDecimal.ZERO}
        if(observed!=null) return observed
        return dao.marketBars(symbol,now.toString()).lastOrNull()?.closeDecimal?.toBigDecimalOrNull()?.takeIf{it>BigDecimal.ZERO}
    }
}
