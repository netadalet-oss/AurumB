package io.aurum.aurumb.signal
import io.aurum.common.model.VersionStamp
import java.math.BigDecimal
import java.time.Instant
enum class SignalSide { BUY,SELL,HOLD }
data class CriterionContribution(val id:String,val score:BigDecimal,val weight:BigDecimal,val contribution:BigDecimal)
data class TradeSignal(val id:String,val instrument:String,val signal:SignalSide,val signalTime:Instant,val effectiveEntryTime:Instant?,val entryBasis:String,val versions:VersionStamp,val reasons:List<String>,val contributions:List<CriterionContribution>,val confidence:BigDecimal,val marketRegime:String,val dataFreshness:String,val invalidationCondition:String,val targetHorizon:String)
interface SignalLedger{fun append(signal:TradeSignal);fun all():List<TradeSignal>}
class InMemorySignalLedger:SignalLedger{private val rows=mutableListOf<TradeSignal>();override fun append(signal:TradeSignal){require(rows.none{it.id==signal.id}){"duplicate signal id"};rows+=signal};override fun all()=rows.toList()}
