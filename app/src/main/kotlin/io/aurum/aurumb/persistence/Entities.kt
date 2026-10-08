package io.aurum.aurumb.persistence

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName="market_observations", indices=[Index(value=["symbol","marketTimestampUtc"])])
data class MarketObservationEntity(
    @PrimaryKey val id:String,
    val symbol:String,
    val provider:String,
    val requestedAtUtc:String,
    val receivedAtUtc:String,
    val marketTimestampUtc:String?,
    val valueDecimal:String?,
    val currency:String?,
    val quality:String,
    val freshness:String,
    val rawSourceFingerprint:String,
    val transformVersion:String
)

@Entity(tableName="analysis_runs")
data class AnalysisRunEntity(
    @PrimaryKey val id:String,
    val asOfUtc:String,
    val appVersion:String,
    val modelVersion:String,
    val formulaVersion:String,
    val dataSchemaVersion:String,
    val marketRegime:String,
    val dataFingerprint:String,
    val status:String,
    val integrityPassed:Boolean
)

@Entity(tableName="selection_results", primaryKeys=["runId","symbol"])
data class SelectionResultEntity(
    val runId:String,
    val symbol:String,
    val rank:Int,
    val scoreDecimal:String,
    val alphaScoreDecimal:String,
    val dataQualityDecimal:String,
    val confidenceDecimal:String,
    val applicabilityDecimal:String,
    @ColumnInfo(defaultValue="'0'") val targetProbabilityDecimal:String,
    val contributionsJson:String,
    val rejectionReason:String?
)

@Entity(tableName="signals", indices=[Index(value=["instrument","signalTimeUtc"])])
data class SignalEntity(
    @PrimaryKey val id:String,
    val instrument:String,
    val signal:String,
    val signalTimeUtc:String,
    val effectiveEntryTimeUtc:String?,
    val entryBasis:String,
    val reasonsJson:String,
    val contributionsJson:String,
    val confidenceDecimal:String,
    val marketRegime:String,
    val dataFreshness:String,
    val invalidationCondition:String,
    val targetHorizon:String,
    val appVersion:String,
    val modelVersion:String,
    val formulaVersion:String,
    val dataSchemaVersion:String
)

@Entity(tableName="portfolio_snapshots")
data class PortfolioSnapshotEntity(
    @PrimaryKey val atUtc:String,
    val cashDecimal:String,
    val realizedPnlDecimal:String,
    val unrealizedPnlDecimal:String,
    val equityDecimal:String,
    val exposureDecimal:String,
    val benchmarkDecimal:String?
)

@Entity(tableName="scheduler_jobs")
data class SchedulerJobEntity(
    @PrimaryKey val id:String,
    val lastRunUtc:String?,
    val nextRunUtc:String?,
    val state:String,
    val durationMs:Long?,
    val success:Boolean?,
    val retryCount:Int,
    val errorCode:String?,
    val errorMessage:String?
)

@Entity(tableName="models")
data class ModelEntity(
    @PrimaryKey val version:String,
    val role:String,
    val createdAtUtc:String,
    val weightsJson:String,
    val validationJson:String,
    val sampleCount:Int,
    val reason:String,
    val parentVersion:String?,
    val active:Boolean
)

@Entity(tableName="audit_events", indices=[Index(value=["operationId"]),Index(value=["timestampUtc"])])
data class AuditEventEntity(
    @PrimaryKey val id:String,
    val timestampUtc:String,
    val level:String,
    val subsystem:String,
    val operationId:String,
    val code:String,
    val message:String,
    val metadataJson:String,
    val appVersion:String,
    val modelVersion:String,
    val formulaVersion:String,
    val dataSchemaVersion:String,
    @ColumnInfo(defaultValue="'{}'") val provenanceJson:String
)


@Entity(tableName="ai_audits", indices=[Index(value=["marketFingerprint","purpose","schemaVersion"]),Index(value=["requestedAtUtc"])])
data class AiAuditEntity(
    @PrimaryKey val id:String,
    val marketFingerprint:String,
    val purpose:String,
    val schemaVersion:String,
    val provider:String,
    val model:String?,
    val requestedAtUtc:String,
    val completedAtUtc:String?,
    val status:String,
    val requestFingerprint:String,
    val responseFingerprint:String?,
    val responseJson:String?,
    val errorCode:String?,
    val retryable:Boolean,
    @ColumnInfo(defaultValue="1") val paidCall:Boolean
)


@Entity(
    tableName="instrument_lifecycles",
    primaryKeys=["symbol","listedAtUtc"],
    indices=[Index(value=["symbol"])]
)
data class InstrumentLifecycleEntity(
    val symbol:String,
    val listedAtUtc:String,
    val delistedAtUtc:String?,
    val source:String,
    val sourceFingerprint:String,
    val verifiedAtUtc:String
)

@Entity(tableName="universe_snapshots")
data class UniverseSnapshotEntity(
    @PrimaryKey val asOfDate:String,
    val symbolsJson:String,
    val source:String,
    val sourceFingerprint:String,
    val pointInTimeVerified:Boolean,
    val capturedAtUtc:String
)


@Entity(
    tableName="market_bars",
    primaryKeys=["symbol","atUtc","provider"],
    indices=[Index(value=["symbol","atUtc"])]
)
data class MarketBarEntity(
    val symbol:String,
    val atUtc:String,
    val provider:String,
    val openDecimal:String?,
    val highDecimal:String?,
    val lowDecimal:String?,
    val closeDecimal:String,
    val adjustedCloseDecimal:String?,
    val volumeDecimal:String?,
    val currency:String?,
    val requestedAtUtc:String,
    val receivedAtUtc:String,
    val quality:String,
    val freshness:String,
    val rawSourceFingerprint:String
)


@Entity(tableName="trade_alert_outbox", indices=[Index(value=["state"]),Index(value=["createdAtUtc"])])
data class TradeAlertOutboxEntity(
    @PrimaryKey val eventId:String,
    val createdAtUtc:String,
    val payloadJson:String,
    val state:String,
    val attempts:Int,
    val lastAttemptAtUtc:String?,
    val sentAtUtc:String?,
    val lastError:String?
)

@Entity(tableName="notification_deliveries", indices=[Index(value=["fingerprint"]),Index(value=["deliveredAtUtc"])])
data class NotificationDeliveryEntity(
    @PrimaryKey val id:String,
    val fingerprint:String,
    val eventType:String,
    val channel:String,
    val importance:String,
    val deliveredAtUtc:String,
    val title:String,
    val body:String
)


@Entity(tableName="qualified_trade_states")
data class QualifiedTradeStateEntity(
    @PrimaryKey val symbol:String,
    val status:String,
    val firstSeenAtUtc:String,
    val firstMarketAtUtc:String?,
    val entryRunToken:String,
    val processedRunTokensJson:String,
    val observationCount:Int,
    val buyAtUtc:String?,
    val buyPriceDecimal:String?,
    val stopLossPriceDecimal:String?,
    val stopMethod:String?,
    val stopEvidenceAtUtc:String?=null,
    val maxPriceDecimal:String?,
    val maxPriceAtUtc:String?=null,
    val activeProfitLockPctDecimal:String?,
    val profitLockEvidenceAtUtc:String?=null,
    val sellAtUtc:String?,
    val sellPriceDecimal:String?,
    val exitReason:String?,
    val aboveEntrySeen:Boolean,
    val leftSelection:Boolean
)

@Entity(tableName="portfolio_positions")
data class PortfolioPositionEntity(
    @PrimaryKey val symbol:String,
    val quantityDecimal:String,
    val costDecimal:String,
    val entryPriceDecimal:String,
    val entryAtUtc:String,
    val lastPriceDecimal:String,
    val lastMarkedAtUtc:String,
    val targetCostDecimal:String,
    val sourceSignalId:String
)

@Entity(tableName="portfolio_transactions", indices=[Index(value=["symbol","atUtc"]),Index(value=["idempotencyKey"], unique=true)])
data class PortfolioTransactionEntity(
    @PrimaryKey val id:String,
    val idempotencyKey:String,
    val atUtc:String,
    val type:String,
    val symbol:String,
    val quantityDecimal:String,
    val priceDecimal:String,
    val grossAmountDecimal:String,
    val feeDecimal:String,
    val cashDeltaDecimal:String,
    val realizedPnlDecimal:String?,
    val reason:String,
    val sourceSignalId:String?
)

@Entity(tableName="portfolio_state")
data class PortfolioStateEntity(
    @PrimaryKey val key:String="state",
    val startingCapitalDecimal:String,
    val cashDecimal:String,
    val realizedPnlDecimal:String,
    val defaultPositionDecimal:String,
    val createdAtUtc:String,
    val resetAtUtc:String,
    val lastUpdatedAtUtc:String
)


@Entity(tableName="operation_progress", indices=[Index(value=["state"]),Index(value=["updatedAtUtc"])])
data class OperationProgressEntity(
    @PrimaryKey val operationId:String,
    val operationType:String,
    val stage:String,
    val processed:Int,
    val total:Int,
    val currentInstrument:String?,
    val provider:String?,
    val elapsedMs:Long,
    val errorCode:String?,
    val state:String,
    val cancelRequested:Boolean,
    val startedAtUtc:String,
    val updatedAtUtc:String
)


@Entity(
    tableName="k_historical_rows",
    indices=[
        Index(value=["kind"]),
        Index(value=["knSourceDate"]),
        Index(value=["reelSourceDate"])
    ]
)
data class KHistoricalRowEntity(
    @PrimaryKey val id:String,
    val kind:String,
    val knRunId:String,
    val knSourceDate:String,
    val knTimestampUtc:String,
    val knTopJson:String,
    val reelSourceDate:String?,
    val reelTimestampUtc:String?,
    val reelTopJson:String,
    val hitsJson:String,
    val topN:Int,
    val frozen:Boolean,
    val archivedAtUtc:String?,
    val updatedAtUtc:String
)

@Entity(tableName="pipeline_stage_publications")
data class PipelineStagePublicationEntity(
    @PrimaryKey val stage:String,
    val sourceDataPublicationUtc:String,
    val publishedAtUtc:String,
    val triggerSource:String,
    val payloadJson:String
)

@Entity(
    tableName="news_items",
    indices=[
        Index(value=["region","publishedAtUtc"]),
        Index(value=["link","publishedAtUtc"], unique=true)
    ]
)
data class NewsItemEntity(
    @PrimaryKey val id:String,
    val region:String,
    val title:String,
    val link:String,
    val source:String?,
    val publishedAtUtc:String,
    val receivedAtUtc:String,
    val provider:String,
    val rawSourceFingerprint:String
)


@Entity(
    tableName="selection_outcomes",
    indices=[
        Index(value=["evaluatedAtUtc"]),
        Index(value=["runId","symbol"], unique=true)
    ]
)
data class SelectionOutcomeEntity(
    @PrimaryKey val id:String,
    val runId:String,
    val symbol:String,
    val decisionAtUtc:String,
    val evaluatedAtUtc:String,
    val entryAtUtc:String,
    val entryPriceDecimal:String,
    val exitAtUtc:String,
    val exitCloseDecimal:String,
    val maxHighDecimal:String,
    val grossReturnDecimal:String,
    val netReturnDecimal:String,
    val targetReturnPctDecimal:String,
    val targetHit:Boolean,
    val decisionScoreDecimal:String,
    val regime:String,
    val decisionWindow:String,
    val modelVersion:String,
    val formulaVersion:String,
    val eligibleForLearning:Boolean,
    val ineligibilityReason:String?
)


@Entity(tableName="import_journal", indices=[Index(value=["state"]),Index(value=["updatedAtUtc"])])
data class ImportJournalEntity(
    @PrimaryKey val id:String,
    val state:String,
    val previousSettingsJson:String,
    val incomingSettingsJson:String,
    val payloadChecksum:String,
    val createdAtUtc:String,
    val updatedAtUtc:String
)


@Entity(tableName="scheduler_runs", indices=[Index(value=["jobId","startedAtUtc"])])
data class SchedulerRunEntity(
    @PrimaryKey val runId:String,
    val jobId:String,
    val startedAtUtc:String,
    val completedAtUtc:String?,
    val state:String,
    val durationMs:Long?,
    val success:Boolean?,
    val retryCount:Int,
    val errorCode:String?,
    val errorMessage:String?
)

@Entity(tableName="portal_quotes", indices=[Index(value=["region"]),Index(value=["capturedAtUtc"])])
data class PortalQuoteEntity(
    @PrimaryKey val key:String,
    val label:String,
    val region:String,
    val valueDecimal:String?,
    val currency:String?,
    val provider:String,
    val marketTimestampUtc:String?,
    val capturedAtUtc:String,
    val freshness:String,
    val quality:String,
    val errorCode:String?,
    val attemptsJson:String
)


@Entity(tableName="trade_removal_tombstones", indices=[Index(value=["symbol","removedAtUtc"])])
data class TradeRemovalTombstoneEntity(
    @PrimaryKey val signalId:String,
    val symbol:String,
    val removedAtUtc:String,
    val reason:String
)


@Entity(tableName="blocked_instruments")
data class BlockedInstrumentEntity(
    @PrimaryKey val symbol:String,
    val blockedAtUtc:String,
    val reason:String
)
