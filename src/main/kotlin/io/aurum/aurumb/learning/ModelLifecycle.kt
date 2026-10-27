package io.aurum.aurumb.learning

import java.math.BigDecimal
import java.time.Instant

enum class ModelRole { CANDIDATE, CHALLENGER, CHAMPION, RETIRED }
data class ModelSnapshot(
    val version:String,
    val role:ModelRole,
    val createdAt:Instant,
    val weights:Map<String,BigDecimal>,
    val parentVersion:String?,
    val reason:String,
    val validation:ValidationMetrics?
)
data class PromotionRecord(
    val at:Instant,
    val fromVersion:String,
    val toVersion:String,
    val validation:ValidationMetrics,
    val reason:String
)

class ModelRegistry(
    initialChampion:ModelSnapshot,
    private val policy:PromotionPolicy
) {
    private val snapshots=linkedMapOf(initialChampion.version to initialChampion.copy(role=ModelRole.CHAMPION))
    private val promotions=mutableListOf<PromotionRecord>()
    private var championVersion=initialChampion.version

    fun champion():ModelSnapshot=requireNotNull(snapshots[championVersion])
    fun snapshots():List<ModelSnapshot> = snapshots.values.toList()
    fun promotionHistory():List<PromotionRecord> = promotions.toList()

    fun addCandidate(candidate:ModelSnapshot) {
        require(candidate.version !in snapshots) { "duplicate model version" }
        require(candidate.role==ModelRole.CANDIDATE || candidate.role==ModelRole.CHALLENGER)
        snapshots[candidate.version]=candidate
    }

    fun promote(version:String,proposal:WeightProposal,metrics:ValidationMetrics,at:Instant,reason:String) {
        require(policy.eligible(metrics,proposal)) { "challenger failed promotion policy" }
        val target=requireNotNull(snapshots[version]) { "unknown challenger" }
        require(target.role==ModelRole.CANDIDATE || target.role==ModelRole.CHALLENGER)
        val old=champion()
        snapshots[old.version]=old.copy(role=ModelRole.RETIRED)
        snapshots[target.version]=target.copy(role=ModelRole.CHAMPION,validation=metrics)
        championVersion=target.version
        promotions += PromotionRecord(at,old.version,target.version,metrics,reason)
    }

    fun rollback(version:String,at:Instant,reason:String) {
        val target=requireNotNull(snapshots[version]) { "unknown rollback target" }
        val old=champion()
        require(target.version!=old.version)
        snapshots[old.version]=old.copy(role=ModelRole.RETIRED)
        snapshots[target.version]=target.copy(role=ModelRole.CHAMPION)
        championVersion=target.version
        target.validation?.let { promotions += PromotionRecord(at,old.version,target.version,it,"ROLLBACK: $reason") }
    }
}
