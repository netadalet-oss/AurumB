package io.aurum.aurumb.learning

import io.aurum.aurumb.criteria.AurumBCriteriaCatalog
import io.aurum.aurumb.criteria.CriterionSpec
import java.math.BigDecimal

data class EffectiveModel(
    val version:String,
    val weights:Map<String,BigDecimal>,
    val source:String
) {
    init {
        require(version.isNotBlank())
        require(weights.keys==AurumBCriteriaCatalog.decision.map{it.id}.toSet())
        require(weights.values.all{it>=BigDecimal("0.05") && it<=BigDecimal("0.30")})
        require(weights.values.fold(BigDecimal.ZERO,BigDecimal::add)
            .subtract(BigDecimal.ONE).abs()<=BigDecimal("0.00001"))
    }

    fun criterionSpecs():List<CriterionSpec> =
        AurumBCriteriaCatalog.decision.map { spec ->
            spec.copy(baseWeight=weights.getValue(spec.id))
        }
}

object EffectiveModelResolver {
    fun base(version:String):EffectiveModel =
        EffectiveModel(
            version=version,
            weights=AurumBCriteriaCatalog.decision.associate{it.id to it.baseWeight},
            source="BASE"
        )

    fun resolve(
        baseVersion:String,
        championVersion:String?,
        championWeights:Map<String,BigDecimal>?
    ):EffectiveModel {
        if(championVersion.isNullOrBlank() || championWeights==null) return base(baseVersion)
        return runCatching {
            EffectiveModel(championVersion,championWeights.toSortedMap(),"CHAMPION")
        }.getOrElse { base(baseVersion) }
    }
}
