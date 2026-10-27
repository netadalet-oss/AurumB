package io.aurum.aurumb.persistence

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities=[
        MarketObservationEntity::class,
        AnalysisRunEntity::class,
        SelectionResultEntity::class,
        SignalEntity::class,
        PortfolioSnapshotEntity::class,
        SchedulerJobEntity::class,
        ModelEntity::class,
        AuditEventEntity::class,
        AiAuditEntity::class,
        InstrumentLifecycleEntity::class,
        UniverseSnapshotEntity::class,
        MarketBarEntity::class,
        NotificationDeliveryEntity::class,
        TradeAlertOutboxEntity::class,
        QualifiedTradeStateEntity::class,
        PortfolioPositionEntity::class,
        PortfolioTransactionEntity::class,
        PortfolioStateEntity::class,
        OperationProgressEntity::class,
        PipelineStagePublicationEntity::class,
        KHistoricalRowEntity::class,
        NewsItemEntity::class,
        SelectionOutcomeEntity::class,
        ImportJournalEntity::class,
        SchedulerRunEntity::class,
        PortalQuoteEntity::class,
        TradeRemovalTombstoneEntity::class,
        BlockedInstrumentEntity::class
    ],
    version=21,
    exportSchema=true
)
abstract class AurumDatabase:RoomDatabase() {
    abstract fun aurumDao():AurumDao

    companion object {
        val MIGRATION_1_2=object:Migration(1,2) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE audit_events ADD COLUMN provenanceJson TEXT NOT NULL DEFAULT '{}'")
            }
        }

        val MIGRATION_2_3=object:Migration(2,3) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS ai_audits (
                    id TEXT NOT NULL PRIMARY KEY,
                    marketFingerprint TEXT NOT NULL,
                    purpose TEXT NOT NULL,
                    schemaVersion TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT,
                    requestedAtUtc TEXT NOT NULL,
                    completedAtUtc TEXT,
                    status TEXT NOT NULL,
                    requestFingerprint TEXT NOT NULL,
                    responseFingerprint TEXT,
                    responseJson TEXT,
                    errorCode TEXT,
                    retryable INTEGER NOT NULL
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_ai_audits_marketFingerprint_purpose_schemaVersion ON ai_audits(marketFingerprint,purpose,schemaVersion)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_ai_audits_requestedAtUtc ON ai_audits(requestedAtUtc)")
            }
        }

        val MIGRATION_3_4=object:Migration(3,4) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS instrument_lifecycles (
                    symbol TEXT NOT NULL PRIMARY KEY,
                    listedAtUtc TEXT NOT NULL,
                    delistedAtUtc TEXT,
                    source TEXT NOT NULL,
                    sourceFingerprint TEXT NOT NULL,
                    verifiedAtUtc TEXT NOT NULL
                )""")
                db.execSQL("""CREATE TABLE IF NOT EXISTS universe_snapshots (
                    asOfDate TEXT NOT NULL PRIMARY KEY,
                    symbolsJson TEXT NOT NULL,
                    source TEXT NOT NULL,
                    sourceFingerprint TEXT NOT NULL,
                    pointInTimeVerified INTEGER NOT NULL,
                    capturedAtUtc TEXT NOT NULL
                )""")
            }
        }

        val MIGRATION_4_5=object:Migration(4,5) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS market_bars (
                    symbol TEXT NOT NULL,
                    atUtc TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    openDecimal TEXT,
                    highDecimal TEXT,
                    lowDecimal TEXT,
                    closeDecimal TEXT NOT NULL,
                    adjustedCloseDecimal TEXT,
                    volumeDecimal TEXT,
                    currency TEXT,
                    requestedAtUtc TEXT NOT NULL,
                    receivedAtUtc TEXT NOT NULL,
                    quality TEXT NOT NULL,
                    freshness TEXT NOT NULL,
                    rawSourceFingerprint TEXT NOT NULL,
                    PRIMARY KEY(symbol,atUtc,provider)
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_market_bars_symbol_atUtc ON market_bars(symbol,atUtc)")
            }
        }

        val MIGRATION_5_6=object:Migration(5,6) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS notification_deliveries (
                    id TEXT NOT NULL PRIMARY KEY,
                    fingerprint TEXT NOT NULL,
                    eventType TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    importance TEXT NOT NULL,
                    deliveredAtUtc TEXT NOT NULL,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_notification_deliveries_fingerprint ON notification_deliveries(fingerprint)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_notification_deliveries_deliveredAtUtc ON notification_deliveries(deliveredAtUtc)")
            }
        }

        val MIGRATION_6_7=object:Migration(6,7) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS qualified_trade_states (
                    symbol TEXT NOT NULL PRIMARY KEY,
                    status TEXT NOT NULL,
                    firstSeenAtUtc TEXT NOT NULL,
                    firstMarketAtUtc TEXT,
                    entryRunToken TEXT NOT NULL,
                    processedRunTokensJson TEXT NOT NULL,
                    observationCount INTEGER NOT NULL,
                    buyAtUtc TEXT,
                    buyPriceDecimal TEXT,
                    stopLossPriceDecimal TEXT,
                    stopMethod TEXT,
                    maxPriceDecimal TEXT,
                    activeProfitLockPctDecimal TEXT,
                    sellAtUtc TEXT,
                    sellPriceDecimal TEXT,
                    exitReason TEXT,
                    aboveEntrySeen INTEGER NOT NULL,
                    leftSelection INTEGER NOT NULL
                )""")
                db.execSQL("""CREATE TABLE IF NOT EXISTS portfolio_positions (
                    symbol TEXT NOT NULL PRIMARY KEY,
                    quantityDecimal TEXT NOT NULL,
                    costDecimal TEXT NOT NULL,
                    entryPriceDecimal TEXT NOT NULL,
                    entryAtUtc TEXT NOT NULL,
                    lastPriceDecimal TEXT NOT NULL,
                    lastMarkedAtUtc TEXT NOT NULL,
                    targetCostDecimal TEXT NOT NULL,
                    sourceSignalId TEXT NOT NULL
                )""")
                db.execSQL("""CREATE TABLE IF NOT EXISTS portfolio_transactions (
                    id TEXT NOT NULL PRIMARY KEY,
                    idempotencyKey TEXT NOT NULL,
                    atUtc TEXT NOT NULL,
                    type TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    quantityDecimal TEXT NOT NULL,
                    priceDecimal TEXT NOT NULL,
                    grossAmountDecimal TEXT NOT NULL,
                    feeDecimal TEXT NOT NULL,
                    cashDeltaDecimal TEXT NOT NULL,
                    realizedPnlDecimal TEXT,
                    reason TEXT NOT NULL,
                    sourceSignalId TEXT
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_portfolio_transactions_symbol_atUtc ON portfolio_transactions(symbol,atUtc)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_portfolio_transactions_idempotencyKey ON portfolio_transactions(idempotencyKey)")
                db.execSQL("""CREATE TABLE IF NOT EXISTS portfolio_state (
                    key TEXT NOT NULL PRIMARY KEY,
                    startingCapitalDecimal TEXT NOT NULL,
                    cashDecimal TEXT NOT NULL,
                    realizedPnlDecimal TEXT NOT NULL,
                    defaultPositionDecimal TEXT NOT NULL,
                    createdAtUtc TEXT NOT NULL,
                    resetAtUtc TEXT NOT NULL,
                    lastUpdatedAtUtc TEXT NOT NULL
                )""")
            }
        }

        val MIGRATION_7_8=object:Migration(7,8) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS operation_progress (
                    operationId TEXT NOT NULL PRIMARY KEY,
                    operationType TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    processed INTEGER NOT NULL,
                    total INTEGER NOT NULL,
                    currentInstrument TEXT,
                    provider TEXT,
                    elapsedMs INTEGER NOT NULL,
                    errorCode TEXT,
                    state TEXT NOT NULL,
                    cancelRequested INTEGER NOT NULL,
                    startedAtUtc TEXT NOT NULL,
                    updatedAtUtc TEXT NOT NULL
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_operation_progress_state ON operation_progress(state)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_operation_progress_updatedAtUtc ON operation_progress(updatedAtUtc)")
            }
        }

        val MIGRATION_8_9=object:Migration(8,9) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS news_items (
                    id TEXT NOT NULL PRIMARY KEY,
                    region TEXT NOT NULL,
                    title TEXT NOT NULL,
                    link TEXT NOT NULL,
                    source TEXT,
                    publishedAtUtc TEXT NOT NULL,
                    receivedAtUtc TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    rawSourceFingerprint TEXT NOT NULL
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_news_items_region_publishedAtUtc ON news_items(region,publishedAtUtc)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_news_items_link_publishedAtUtc ON news_items(link,publishedAtUtc)")
            }
        }

        val MIGRATION_9_10=object:Migration(9,10) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS instrument_lifecycles_new (
                    symbol TEXT NOT NULL,
                    listedAtUtc TEXT NOT NULL,
                    delistedAtUtc TEXT,
                    source TEXT NOT NULL,
                    sourceFingerprint TEXT NOT NULL,
                    verifiedAtUtc TEXT NOT NULL,
                    PRIMARY KEY(symbol,listedAtUtc)
                )""")
                db.execSQL("""INSERT INTO instrument_lifecycles_new
                    (symbol,listedAtUtc,delistedAtUtc,source,sourceFingerprint,verifiedAtUtc)
                    SELECT symbol,listedAtUtc,delistedAtUtc,source,sourceFingerprint,verifiedAtUtc
                    FROM instrument_lifecycles""")
                db.execSQL("DROP TABLE instrument_lifecycles")
                db.execSQL("ALTER TABLE instrument_lifecycles_new RENAME TO instrument_lifecycles")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_instrument_lifecycles_symbol ON instrument_lifecycles(symbol)")
            }
        }

        val MIGRATION_10_11=object:Migration(10,11) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE selection_results ADD COLUMN targetProbabilityDecimal TEXT NOT NULL DEFAULT '0'")
            }
        }

        val MIGRATION_11_12=object:Migration(11,12) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS selection_outcomes (
                    id TEXT NOT NULL PRIMARY KEY,
                    runId TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    decisionAtUtc TEXT NOT NULL,
                    evaluatedAtUtc TEXT NOT NULL,
                    entryAtUtc TEXT NOT NULL,
                    entryPriceDecimal TEXT NOT NULL,
                    exitAtUtc TEXT NOT NULL,
                    exitCloseDecimal TEXT NOT NULL,
                    maxHighDecimal TEXT NOT NULL,
                    grossReturnDecimal TEXT NOT NULL,
                    netReturnDecimal TEXT NOT NULL,
                    targetReturnPctDecimal TEXT NOT NULL,
                    targetHit INTEGER NOT NULL,
                    decisionScoreDecimal TEXT NOT NULL,
                    regime TEXT NOT NULL,
                    decisionWindow TEXT NOT NULL,
                    modelVersion TEXT NOT NULL,
                    formulaVersion TEXT NOT NULL,
                    eligibleForLearning INTEGER NOT NULL,
                    ineligibilityReason TEXT
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_selection_outcomes_evaluatedAtUtc ON selection_outcomes(evaluatedAtUtc)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_selection_outcomes_runId_symbol ON selection_outcomes(runId,symbol)")
            }
        }

        val MIGRATION_12_13=object:Migration(12,13) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE ai_audits ADD COLUMN paidCall INTEGER NOT NULL DEFAULT 1")
            }
        }

        val MIGRATION_13_14=object:Migration(13,14) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS import_journal (
                    id TEXT NOT NULL PRIMARY KEY,
                    state TEXT NOT NULL,
                    previousSettingsJson TEXT NOT NULL,
                    incomingSettingsJson TEXT NOT NULL,
                    payloadChecksum TEXT NOT NULL,
                    createdAtUtc TEXT NOT NULL,
                    updatedAtUtc TEXT NOT NULL
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_import_journal_state ON import_journal(state)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_import_journal_updatedAtUtc ON import_journal(updatedAtUtc)")
            }
        }

        val MIGRATION_14_15=object:Migration(14,15) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS scheduler_runs (
                    runId TEXT NOT NULL PRIMARY KEY,
                    jobId TEXT NOT NULL,
                    startedAtUtc TEXT NOT NULL,
                    completedAtUtc TEXT,
                    state TEXT NOT NULL,
                    durationMs INTEGER,
                    success INTEGER,
                    retryCount INTEGER NOT NULL,
                    errorCode TEXT,
                    errorMessage TEXT
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_scheduler_runs_jobId_startedAtUtc ON scheduler_runs(jobId,startedAtUtc)")
                db.execSQL("""CREATE TABLE IF NOT EXISTS portal_quotes (
                    key TEXT NOT NULL PRIMARY KEY,
                    label TEXT NOT NULL,
                    region TEXT NOT NULL,
                    valueDecimal TEXT,
                    currency TEXT,
                    provider TEXT NOT NULL,
                    marketTimestampUtc TEXT,
                    capturedAtUtc TEXT NOT NULL,
                    freshness TEXT NOT NULL,
                    quality TEXT NOT NULL,
                    errorCode TEXT,
                    attemptsJson TEXT NOT NULL
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_portal_quotes_region ON portal_quotes(region)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_portal_quotes_capturedAtUtc ON portal_quotes(capturedAtUtc)")
            }
        }

        val MIGRATION_15_16=object:Migration(15,16) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE qualified_trade_states ADD COLUMN stopEvidenceAtUtc TEXT")
                db.execSQL("ALTER TABLE qualified_trade_states ADD COLUMN maxPriceAtUtc TEXT")
                db.execSQL("ALTER TABLE qualified_trade_states ADD COLUMN profitLockEvidenceAtUtc TEXT")
            }
        }

        val MIGRATION_16_17=object:Migration(16,17) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS pipeline_stage_publications (
                    stage TEXT NOT NULL PRIMARY KEY,
                    sourceDataPublicationUtc TEXT NOT NULL,
                    publishedAtUtc TEXT NOT NULL,
                    triggerSource TEXT NOT NULL,
                    payloadJson TEXT NOT NULL
                )""")
            }
        }

        val MIGRATION_17_18=object:Migration(17,18) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS trade_alert_outbox (
                    eventId TEXT NOT NULL PRIMARY KEY,
                    createdAtUtc TEXT NOT NULL,
                    payloadJson TEXT NOT NULL,
                    state TEXT NOT NULL,
                    attempts INTEGER NOT NULL,
                    lastAttemptAtUtc TEXT,
                    sentAtUtc TEXT,
                    lastError TEXT
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_trade_alert_outbox_state ON trade_alert_outbox(state)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_trade_alert_outbox_createdAtUtc ON trade_alert_outbox(createdAtUtc)")
            }
        }
        val MIGRATION_18_19=object:Migration(18,19) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS k_historical_rows (
                    id TEXT NOT NULL PRIMARY KEY,
                    kind TEXT NOT NULL,
                    knRunId TEXT NOT NULL,
                    knSourceDate TEXT NOT NULL,
                    knTimestampUtc TEXT NOT NULL,
                    knTopJson TEXT NOT NULL,
                    reelSourceDate TEXT,
                    reelTimestampUtc TEXT,
                    reelTopJson TEXT NOT NULL,
                    hitsJson TEXT NOT NULL,
                    topN INTEGER NOT NULL,
                    frozen INTEGER NOT NULL,
                    archivedAtUtc TEXT,
                    updatedAtUtc TEXT NOT NULL
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_k_historical_rows_kind ON k_historical_rows(kind)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_k_historical_rows_knSourceDate ON k_historical_rows(knSourceDate)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_k_historical_rows_reelSourceDate ON k_historical_rows(reelSourceDate)")
            }
        }
        val MIGRATION_19_20=object:Migration(19,20) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS trade_removal_tombstones (
                    signalId TEXT NOT NULL PRIMARY KEY,
                    symbol TEXT NOT NULL,
                    removedAtUtc TEXT NOT NULL,
                    reason TEXT NOT NULL
                )""")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_trade_removal_tombstones_symbol_removedAtUtc ON trade_removal_tombstones(symbol,removedAtUtc)")
            }
        }
        val MIGRATION_20_21=object:Migration(20,21) {
            override fun migrate(db:SupportSQLiteDatabase) {
                db.execSQL("""CREATE TABLE IF NOT EXISTS blocked_instruments (
                    symbol TEXT NOT NULL PRIMARY KEY,
                    blockedAtUtc TEXT NOT NULL,
                    reason TEXT NOT NULL
                )""")
            }
        }
    }
}
