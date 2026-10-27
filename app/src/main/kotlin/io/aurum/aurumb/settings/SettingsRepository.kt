package io.aurum.aurumb.settings

import android.content.Context
import io.aurum.aurumb.pipeline.PipelineSettings
import io.aurum.common.settings.SettingsSchema
import java.math.BigDecimal

class SettingsRepository(context:Context) {
    private val prefs=context.applicationContext.getSharedPreferences("aurumb.settings.v1",Context.MODE_PRIVATE)

    fun load():Pair<Map<String,String>,List<String>> {
        migrateIfNeeded()
        val raw=SettingsSchema.specs.associate { spec -> spec.key to (prefs.getString(spec.key,null)?:"") }
            .filterValues{it.isNotEmpty()}
        val resolution=SettingsSchema.resolve(raw)
        if(resolution.repairedKeys.isNotEmpty()) {
            val edit=prefs.edit()
            resolution.repairedKeys.forEach { key -> edit.putString(key,resolution.values.getValue(key)) }
            edit.apply()
        }
        return resolution.values to resolution.repairedKeys
    }

    fun put(key:String,value:String):Boolean {
        if(!SettingsSchema.spec(key).userEditable) return false
        val current=load().first.toMutableMap()
        current[key]=value
        val resolved=SettingsSchema.resolve(current)
        if(key in resolved.repairedKeys || !policyValid(resolved.values)) return false
        prefs.edit().putString(key,resolved.values.getValue(key)).apply()
        return true
    }

    /** Checks schema and cross-setting policy without publishing preferences. */
    fun validate(values:Map<String,String>):Boolean {
        if(values.keys.any { key -> runCatching{SettingsSchema.spec(key)}.isFailure }) return false
        val resolved=SettingsSchema.resolve(values)
        return resolved.repairedKeys.isEmpty() && policyValid(resolved.values)
    }

    fun replaceValidated(values:Map<String,String>):Boolean {
        if(!validate(values)) return false
        val resolved=SettingsSchema.resolve(values)
        val edit=prefs.edit()
        resolved.values.forEach { (k,v) -> edit.putString(k,v) }
        edit.putInt("_schemaVersion",SettingsSchema.VERSION)
        return edit.commit()
    }

    fun pipelineSettings():PipelineSettings = pipelineSettings(load().first)

    fun pipelineSettings(v:Map<String,String>):PipelineSettings = PipelineSettings(
            minPrice=BigDecimal(v.getValue("minPrice")),
            minMedianTurnover21=BigDecimal(v.getValue("minTurnoverM")).multiply(BigDecimal("1000000")),
            qualityMin=v.getValue("qualityMin").toInt(),
            maxParticipationPct=BigDecimal(v.getValue("maxParticipationPct")),
            maxDailyMovePct=BigDecimal("12.5"),
            dataCellCompletenessPct=BigDecimal(v.getValue("dataCellCompletenessPct")),
            transferQualityThresholdsPct=listOf(
                v.getValue("transferQualityTier1Pct").toInt(),
                v.getValue("transferQualityTier2Pct").toInt(),
                v.getValue("transferQualityTier3Pct").toInt(),
                v.getValue("transferQualityTier4Pct").toInt(),
                v.getValue("transferQualityTier5Pct").toInt()
            ),
            providerRetryCount=v.getValue("providerRetryCount").toInt(),
            sfContinuousMinutes=240,
            sfFinalWindowMinutes=120,
            sfPostOpenMinutes=120,
            maxStopLossPct=BigDecimal(v.getValue("maxStopLossPct")),
            technicalStopAtrMultiplier=BigDecimal(v.getValue("technicalStopAtrMultiplier")),
            technicalStopFallbackPct=BigDecimal(v.getValue("technicalStopFallbackPct")),
            technicalStopSupportBufferPct=BigDecimal(v.getValue("technicalStopSupportBufferPct")),
            profitLockStartPct=BigDecimal(v.getValue("profitLockStartPct")),
            profitLockInitialPullbackPct=BigDecimal(v.getValue("profitLockInitialPullbackPct")),
            profitLockStepStartPct=BigDecimal(v.getValue("profitLockStepStartPct")),
            profitLockStepSizePct=BigDecimal(v.getValue("profitLockStepSizePct")),
            profitLockStepPullbackPct=BigDecimal(v.getValue("profitLockStepPullbackPct")),
            topN=v.getValue("topN").toInt(),
            adaptiveSelection=v.getValue("adaptiveSelection").toBooleanStrict(),
            minSelectionScore=BigDecimal(v.getValue("minSelectionScore")),
            minTargetProbability=BigDecimal(v.getValue("minTargetProbability")),
            maxExecutionRisk=BigDecimal(v.getValue("maxExecutionRisk")),
            sectorMaxPct=BigDecimal(v.getValue("sectorMaxPct")),
            pairwiseMaxCorr=BigDecimal(v.getValue("pairwiseMaxCorr")),
            targetReturnPct=BigDecimal(v.getValue("targetReturnPct")),
            crossSectionalTargetPct=BigDecimal(v.getValue("crossSectionalTargetPct")),
            learningHalfLifeDays=v.getValue("learningHalfLifeDays").toInt(),
            behaviorLookbackDays=v.getValue("behaviorLookbackDays").toInt(),
            behaviorMinSamples=v.getValue("behaviorMinSamples").toInt(),
            behaviorLifetimeWeight=BigDecimal(v.getValue("behaviorLifetimeWeight")),
            genomeLookbackDays=v.getValue("genomeLookbackDays").toInt(),
            genomeNearestNeighbors=v.getValue("genomeNearestNeighbors").toInt(),
            genomeMinAnalogs=v.getValue("genomeMinAnalogs").toInt(),
            genomePriorStrength=BigDecimal(v.getValue("genomePriorStrength")),
            genomeHistoryDays=v.getValue("genomeHistoryDays").toInt(),
            lookbackDays=v.getValue("lookbackDays").toLong(),
            commissionBps=BigDecimal(v.getValue("commissionBps")),
            slippageBps=BigDecimal(v.getValue("slippageBps")),
            assumedPositionTRY=BigDecimal(v.getValue("assumedPositionTRY"))
        )

    private fun policyValid(v:Map<String,String>):Boolean {
        val tiers=listOf(
            v.getValue("transferQualityTier1Pct").toInt(),
            v.getValue("transferQualityTier2Pct").toInt(),
            v.getValue("transferQualityTier3Pct").toInt(),
            v.getValue("transferQualityTier4Pct").toInt(),
            v.getValue("transferQualityTier5Pct").toInt()
        )
        val aiBuckets=v.getValue("aiMarketTimeBuckets")
            .split(',', ';', ' ', '\n', '\t')
            .filter{it.isNotBlank()}
        val aiBucketsValid=aiBuckets.isNotEmpty() && aiBuckets.all {
            runCatching{java.time.LocalTime.parse(it.trim())}.isSuccess
        }
        return tiers.zipWithNext().all{(a,b)->a>b} &&
            BigDecimal(v.getValue("profitLockStepStartPct"))>=BigDecimal(v.getValue("profitLockStartPct")) &&
            v.getValue("marketPortal") in setOf("TR","NL") &&
            v.getValue("openaiModel").isNotBlank() &&
            v.getValue("openaiReasoningEffort") in setOf("","low","medium") &&
            aiBucketsValid &&
            v.getValue("aiAutoPromoteValidated")=="false"
    }

    private fun migrateIfNeeded() {
        val version=prefs.getInt("_schemaVersion",0)
        if(version<SettingsSchema.VERSION) {
            val edit=prefs.edit()
            SettingsSchema.specs.forEach { spec ->
                if(!prefs.contains(spec.key)) edit.putString(spec.key,spec.defaultValue)
            }
            edit.putInt("_schemaVersion",SettingsSchema.VERSION).apply()
        }
    }
}
