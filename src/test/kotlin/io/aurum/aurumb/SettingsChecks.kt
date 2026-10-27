package io.aurum.aurumb

import io.aurum.common.settings.SettingsSchema

fun settingsChecks() {
    val r=SettingsSchema.resolve(mapOf(
        "qualityMin" to "999",
        "topN" to "25",
        "quietHoursEnabled" to "not-bool",
        "minSelectionScore" to "101",
        "pairwiseMaxCorr" to "2",
        "aiDailyPaidCallLimit" to "99"
    ))
    check(r.values["qualityMin"]=="60")
    check(r.values["topN"]=="20")
    check(r.values["minSelectionScore"]=="58")
    check(r.values["pairwiseMaxCorr"]=="0.80")
    check(r.values["adaptiveSelection"]=="true")
    check(r.values["aiDailyPaidCallLimit"]=="2")
    check(r.values["targetReturnPct"]=="5")
    check("qualityMin" in r.repairedKeys)
    check("topN" in r.repairedKeys)
    check("quietHoursEnabled" in r.repairedKeys)
    check("minSelectionScore" in r.repairedKeys)
    check("pairwiseMaxCorr" in r.repairedKeys)
    check("aiDailyPaidCallLimit" in r.repairedKeys)
    check(SettingsSchema.spec("commissionBps").defaultValue=="8")
    check(SettingsSchema.spec("dataCellCompletenessPct").defaultValue=="70")
    check(SettingsSchema.spec("transferQualityTier1Pct").defaultValue=="100")
    check(SettingsSchema.spec("transferQualityTier5Pct").defaultValue=="70")
    check(SettingsSchema.spec("providerRetryCount").defaultValue=="5")
    check(SettingsSchema.spec("sfContinuousMinutes").defaultValue=="240")
    check(SettingsSchema.spec("sfFinalWindowMinutes").defaultValue=="120")
    check(SettingsSchema.spec("sfPostOpenMinutes").defaultValue=="120")
    check(SettingsSchema.spec("maxStopLossPct").defaultValue=="3")
    check(SettingsSchema.spec("profitLockStartPct").defaultValue=="5")
    check(SettingsSchema.spec("profitLockStepStartPct").defaultValue=="20")
    check(SettingsSchema.spec("maxDailyMovePct").defaultValue=="12.5")
    listOf(
        "qualityMin","dataCellCompletenessPct","transferQualityTier1Pct","transferQualityTier2Pct",
        "transferQualityTier3Pct","transferQualityTier4Pct","transferQualityTier5Pct",
        "maxStopLossPct","technicalStopAtrMultiplier","technicalStopFallbackPct","technicalStopSupportBufferPct","profitLockStartPct","profitLockInitialPullbackPct",
        "profitLockStepStartPct","profitLockStepSizePct","profitLockStepPullbackPct"
    ).forEach { key -> check(SettingsSchema.spec(key).userEditable) }
    check(SettingsSchema.spec("aiEnabled").defaultValue=="false")
    check(SettingsSchema.spec("openaiModel").defaultValue=="gpt-5.6-luna")
    check(SettingsSchema.spec("aiAutoDaily").defaultValue=="false")
    check(SettingsSchema.spec("aiDailyHour").defaultValue=="19")
    check(SettingsSchema.spec("aiAllowCandidates").defaultValue=="true")
    check(SettingsSchema.spec("aiAutoPromoteValidated").userEditable==false)
    check(SettingsSchema.VERSION==10)
}
