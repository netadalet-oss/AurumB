package io.aurum.aurumb.market
import java.time.Instant
data class TimedFact<T>(val effectiveAt:Instant,val availableAt:Instant,val value:T)
object PointInTime{fun <T> visible(facts:List<TimedFact<T>>,asOf:Instant)=facts.filter{!it.availableAt.isAfter(asOf)};fun <T> latest(facts:List<TimedFact<T>>,asOf:Instant)=visible(facts,asOf).maxByOrNull{it.effectiveAt};fun assertNoLeakage(facts:List<TimedFact<*>>,asOf:Instant){require(facts.all{!it.availableAt.isAfter(asOf)}){"future timestamp used"}}}
