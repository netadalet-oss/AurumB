package io.aurum.aurumb.learning

import java.math.BigDecimal

data class ValidationMetrics(
    val sampleCount:Int,
    val regimeCount:Int,
    val netEconomicUtility:BigDecimal,
    val maxDrawdown:BigDecimal,
    val precisionAtN:BigDecimal,
    val ndcg:BigDecimal,
    val calibrationError:BigDecimal,
    val stability:BigDecimal
)

data class WeightProposal(val weights:Map<String,BigDecimal>,val reason:String)

data class PromotionPolicy(
    val minSamples:Int=120,
    val minRegimes:Int=3,
    val maxDrawdown:BigDecimal=BigDecimal("0.25"),
    val minPrecisionAtN:BigDecimal=BigDecimal("0.52"),
    val minNdcg:BigDecimal=BigDecimal("0.55"),
    val maxCalibrationError:BigDecimal=BigDecimal("0.15"),
    val minStability:BigDecimal=BigDecimal("0.60"),
    val weightFloor:BigDecimal=BigDecimal("0.05"),
    val weightCeiling:BigDecimal=BigDecimal("0.30")
) {
    private val expectedKeys=(1..7).map{"K$it"}.toSet()

    init {
        require(minSamples>0)
        require(minRegimes>0)
        require(maxDrawdown in BigDecimal.ZERO..BigDecimal.ONE)
        require(minPrecisionAtN in BigDecimal.ZERO..BigDecimal.ONE)
        require(minNdcg in BigDecimal.ZERO..BigDecimal.ONE)
        require(maxCalibrationError in BigDecimal.ZERO..BigDecimal.ONE)
        require(minStability in BigDecimal.ZERO..BigDecimal.ONE)
        require(weightFloor>=BigDecimal.ZERO && weightCeiling<=BigDecimal.ONE && weightFloor<weightCeiling)
    }

    fun eligible(m:ValidationMetrics,p:WeightProposal):Boolean {
        if(m.sampleCount<minSamples || m.regimeCount<minRegimes) return false
        if(m.netEconomicUtility<=BigDecimal.ZERO) return false
        if(m.maxDrawdown< BigDecimal.ZERO || m.maxDrawdown>maxDrawdown) return false
        if(m.precisionAtN<minPrecisionAtN || m.precisionAtN>BigDecimal.ONE) return false
        if(m.ndcg<minNdcg || m.ndcg>BigDecimal.ONE) return false
        if(m.calibrationError<BigDecimal.ZERO || m.calibrationError>maxCalibrationError) return false
        if(m.stability<minStability || m.stability>BigDecimal.ONE) return false
        if(p.weights.keys!=expectedKeys) return false
        if(p.weights.values.any{it<weightFloor || it>weightCeiling}) return false
        val sum=p.weights.values.fold(BigDecimal.ZERO,BigDecimal::add)
        return sum.subtract(BigDecimal.ONE).abs()<=BigDecimal("0.00001")
    }
}
