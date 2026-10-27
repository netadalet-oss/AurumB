package io.aurum.aurumb
import io.aurum.common.logging.operationalEventPolicyChecks
import io.aurum.aurumb.criteria.*
import io.aurum.aurumb.learning.*
import io.aurum.aurumb.selection.*
import io.aurum.aurumb.market.*
import io.aurum.aurumb.backtest.*
import io.aurum.aurumb.signal.*
import io.aurum.aurumb.portfolio.*
import io.aurum.common.model.VersionStamp
import java.math.BigDecimal
import java.time.Instant
private fun candidate(symbol:String,score:String)=CandidateEvidence(symbol,AurumBCriteriaCatalog.decision.associate{s->s.id to CriterionResult(s.id,BigDecimal(score),true)})
fun main(){
 kTrendOrderingChecks()
 dataCompletenessChecks()
 dataRepairPolicyChecks()
 transferQualityLadderChecks()
 propertyInvariantChecks()
 extremeMoveEligibilityChecks()
 val sum=AurumBCriteriaCatalog.decision.fold(BigDecimal.ZERO){a,x->a+x.baseWeight};check(sum.subtract(BigDecimal.ONE).abs()<=BigDecimal("0.00001"));check(AurumBCriteriaCatalog.specs.filter{it.role!=CriterionRole.DECISION}.all{it.baseWeight==BigDecimal.ZERO})
 val rows=SelectionEngine().rank(listOf(candidate("ZZZ","80"),candidate("AAA","80"),candidate("MID","70")));check(rows.map{it.symbol}==listOf("AAA","ZZZ","MID"));IntegrityValidator.validate(rows)
 val good=candidate("GOOD","70");val bad=CandidateEvidence("BAD",good.results-"K7");check(SelectionEngine().rank(listOf(bad,good)).map{it.symbol}==listOf("GOOD"))
 val weights=(1..7).associate{"K$it" to BigDecimal("0.142857")}.toMutableMap();weights["K7"]=BigDecimal("0.142858");val m=ValidationMetrics(40,1,BigDecimal("0.1"),BigDecimal("0.1"),BigDecimal("0.6"),BigDecimal("0.7"),BigDecimal("0.1"),BigDecimal("0.8"));check(!PromotionPolicy().eligible(m,WeightProposal(weights,"insufficient evidence")))
 val asOf=Instant.parse("2026-01-01T12:00:00Z");val facts=listOf(TimedFact(Instant.parse("2026-01-01T00:00:00Z"),Instant.parse("2026-01-01T10:00:00Z"),1),TimedFact(Instant.parse("2026-01-01T11:00:00Z"),Instant.parse("2026-01-01T13:00:00Z"),2));check(PointInTime.visible(facts,asOf).map{it.value}==listOf(1))
 val cost=EquityCostModel(BigDecimal("5"),BigDecimal("10"),BigDecimal("8"),BigDecimal("2"));check(cost.netReturn(BigDecimal("0.05"))<BigDecimal("0.05"));check(cost.netReturn(BigDecimal("-2"))>=BigDecimal("-1"))
 val v=VersionStamp("1","m1","f1","d1");val ledger=InMemorySignalLedger();ledger.append(TradeSignal("s1","AAA",SignalSide.BUY,asOf,asOf,"close",v,listOf("test"),emptyList(),BigDecimal("0.7"),"TREND","LIVE","score<50","5d"));check(ledger.all().size==1);check(runCatching{ledger.append(ledger.all().first())}.isFailure)
 val p=Position("AAA",BigDecimal("10"),BigDecimal("100"),asOf);val snap=PortfolioMath.snapshot(asOf,BigDecimal("1000"),BigDecimal.ZERO,listOf(p),mapOf("AAA" to BigDecimal("110")));check(snap.unrealizedPnl==BigDecimal("100"));check(snap.equity==BigDecimal("2100"))
 formulaChecks()
 providerChecks()
 backtestChecks()
 learningUniverseChecks()
 indicatorChecks()
 featureChecks()
 selectionParityChecks()
 k10RewardMemoryChecks()
 behaviorMetaChecks()
 k12MetaChecks()
 adaptiveSelectionChecks()
 probabilityCalibrationChecks()
 calendarChecks()
 settingsChecks()
 qualifiedLifecycleChecks()
 portfolioMetricsChecks()
 brokerChecks()
 systemChecks()
 notificationContractChecks()
 schedulerChecks()
 deterministicLearningChecks()
 effectiveModelChecks()
 modelValidatorChecks()
 releaseIntegrityChecks()
 aiBudgetChecks()
 legacyTableContractChecks()
 tradingSessionCountChecks()
 manualExitPolicyChecks()
 operationalEventPolicyChecks()
 println("AurumB domain checks: PASS")
}
