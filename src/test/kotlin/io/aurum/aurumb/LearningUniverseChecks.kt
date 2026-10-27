package io.aurum.aurumb

import io.aurum.aurumb.universe.*
import io.aurum.aurumb.learning.*
import java.math.BigDecimal
import java.time.Instant

fun learningUniverseChecks() {
    val asOf=Instant.parse("2026-01-10T00:00:00Z")
    val policy=UniversePolicy(BigDecimal("1"),BigDecimal("1000000"),BigDecimal("10000"),70)
    val oldDelisted=UniverseInstrument("OLD",ListingInterval(Instant.parse("2020-01-01T00:00:00Z"),Instant.parse("2026-02-01T00:00:00Z")),BigDecimal("10"),BigDecimal("2000000"),BigDecimal("20000"),90,false)
    val future=UniverseInstrument("NEW",ListingInterval(Instant.parse("2026-02-01T00:00:00Z"),null),BigDecimal("10"),BigDecimal("2000000"),BigDecimal("20000"),90,false)
    val result=UniverseBuilder.build(asOf,listOf(oldDelisted,future),policy).associateBy{it.symbol}
    check(result["OLD"]!!.eligible)
    check(!result["NEW"]!!.eligible)
    val dirty=HistoricalRunEvidence("r1",asOf,asOf.plusSeconds(60),"f1","m1",BigDecimal("10"),BigDecimal(".1"),true,true)
    check(!LearningEligibility.assess(listOf(dirty),asOf.plusSeconds(120)).single().eligible)

    val baseWeights=(1..7).associate{"K$it" to BigDecimal("0.142857")}.toMutableMap().apply{this["K7"]=BigDecimal("0.142858")}
    val metrics=ValidationMetrics(200,4,BigDecimal("0.05"),BigDecimal("0.15"),BigDecimal("0.60"),BigDecimal("0.70"),BigDecimal("0.08"),BigDecimal("0.80"))
    val initial=ModelSnapshot("m1",ModelRole.CHAMPION,asOf,baseWeights,null,"base",metrics)
    val registry=ModelRegistry(initial,PromotionPolicy())
    registry.addCandidate(ModelSnapshot("m2",ModelRole.CHALLENGER,asOf.plusSeconds(1),baseWeights,"m1","validated challenger",metrics))
    registry.promote("m2",WeightProposal(baseWeights,"oos"),metrics,asOf.plusSeconds(2),"OOS validation passed")
    check(registry.champion().version=="m2")
    registry.rollback("m1",asOf.plusSeconds(3),"operator rollback")
    check(registry.champion().version=="m1")
}
