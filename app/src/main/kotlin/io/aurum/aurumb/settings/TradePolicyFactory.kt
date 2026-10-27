package io.aurum.aurumb.settings

import io.aurum.aurumb.pipeline.PipelineSettings
import io.aurum.aurumb.signal.QualifiedTradePolicy
import io.aurum.aurumb.portfolio.PortfolioExecutionPolicy
import java.math.BigDecimal

fun PipelineSettings.qualifiedTradePolicy()=QualifiedTradePolicy(
    sfContinuousMinutes=sfContinuousMinutes,
    sfFinalWindowMinutes=sfFinalWindowMinutes,
    sfPostOpenMinutes=sfPostOpenMinutes,
    maxStopLossPct=maxStopLossPct,
    technicalStopAtrMultiplier=technicalStopAtrMultiplier,
    technicalStopFallbackPct=technicalStopFallbackPct,
    technicalStopSupportBufferPct=technicalStopSupportBufferPct,
    profitLockStartPct=profitLockStartPct,
    profitLockInitialPullbackPct=profitLockInitialPullbackPct,
    profitLockStepStartPct=profitLockStepStartPct,
    profitLockStepSizePct=profitLockStepSizePct,
    profitLockStepPullbackPct=profitLockStepPullbackPct
)

fun PipelineSettings.portfolioExecutionPolicy(
    startingCapital:String,
    defaultPosition:String
)=PortfolioExecutionPolicy(
    startingCapital=BigDecimal(startingCapital),
    defaultPosition=BigDecimal(defaultPosition),
    commissionBps=commissionBps,
    slippageBps=slippageBps
)
