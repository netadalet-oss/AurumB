package io.aurum.aurumb.persistence

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface AurumDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertObservation(row: MarketObservationEntity)

    @Query("SELECT * FROM market_observations WHERE symbol = :symbol AND (substr(receivedAtUtc,-1) = 'Z' AND substr(:asOfUtc,-1) = 'Z' AND (substr(receivedAtUtc,1,19) || substr(replace(replace(substr(receivedAtUtc,20),'.',''),'Z','') || '000000000',1,9)) <= (substr(:asOfUtc,1,19) || substr(replace(replace(substr(:asOfUtc,20),'.',''),'Z','') || '000000000',1,9))) AND (marketTimestampUtc IS NULL OR (substr(marketTimestampUtc,-1) = 'Z' AND substr(:asOfUtc,-1) = 'Z' AND (substr(marketTimestampUtc,1,19) || substr(replace(replace(substr(marketTimestampUtc,20),'.',''),'Z','') || '000000000',1,9)) <= (substr(:asOfUtc,1,19) || substr(replace(replace(substr(:asOfUtc,20),'.',''),'Z','') || '000000000',1,9)))) ORDER BY (substr(marketTimestampUtc,1,19) || substr(replace(replace(substr(marketTimestampUtc,20),'.',''),'Z','') || '000000000',1,9)) DESC, (substr(receivedAtUtc,1,19) || substr(replace(replace(substr(receivedAtUtc,20),'.',''),'Z','') || '000000000',1,9)) DESC LIMIT 1")
    suspend fun latestObservation(symbol:String,asOfUtc:String):MarketObservationEntity?

    @Query("DELETE FROM market_observations WHERE symbol = :symbol")
    suspend fun deleteObservationsForSymbol(symbol:String):Int

    @Query("DELETE FROM market_bars WHERE symbol = :symbol")
    suspend fun deleteMarketBarsForSymbol(symbol:String):Int

    @Query("DELETE FROM selection_results WHERE symbol = :symbol")
    suspend fun deleteSelectionsForSymbol(symbol:String):Int

    @Query("DELETE FROM market_observations WHERE receivedAtUtc < :cutoffUtc")
    suspend fun deleteObservationsBefore(cutoffUtc:String):Int

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertRun(row: AnalysisRunEntity)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertSelections(rows: List<SelectionResultEntity>)

    @Transaction
    suspend fun publishRun(run: AnalysisRunEntity, results: List<SelectionResultEntity>) {
        require(results.all { it.runId == run.id }) { "selection/run mismatch" }
        insertRun(run)
        insertSelections(results)
    }

    @Query("SELECT * FROM analysis_runs WHERE integrityPassed = 1 ORDER BY asOfUtc DESC LIMIT 1")
    suspend fun latestValidRun(): AnalysisRunEntity?

    @Query("SELECT * FROM selection_results WHERE runId = :runId ORDER BY rank ASC")
    suspend fun selectionsForRun(runId:String): List<SelectionResultEntity>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun appendSignal(row: SignalEntity)

    @Query("SELECT * FROM signals ORDER BY signalTimeUtc ASC, id ASC")
    suspend fun allSignals(): List<SignalEntity>

    @Query("SELECT * FROM signals WHERE id = :id LIMIT 1")
    suspend fun signalById(id:String): SignalEntity?

    @Query("SELECT * FROM signals WHERE instrument = :symbol ORDER BY signalTimeUtc ASC, id ASC")
    suspend fun signalsForInstrument(symbol:String):List<SignalEntity>

    @Query("DELETE FROM signals WHERE instrument = :symbol")
    suspend fun deleteSignalsForInstrument(symbol:String):Int

    @Query("DELETE FROM signals WHERE id IN (:ids)")
    suspend fun deleteSignalsByIds(ids:List<String>):Int

    @Query("SELECT * FROM trade_removal_tombstones ORDER BY removedAtUtc ASC")
    suspend fun tradeRemovalTombstones():List<TradeRemovalTombstoneEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun putTradeRemovalTombstones(rows:List<TradeRemovalTombstoneEntity>)

    @Query("SELECT * FROM trade_removal_tombstones WHERE signalId = :signalId LIMIT 1")
    suspend fun tradeRemovalTombstone(signalId:String):TradeRemovalTombstoneEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putBlockedInstrument(row:BlockedInstrumentEntity)

    @Query("DELETE FROM blocked_instruments WHERE symbol = :symbol")
    suspend fun unblockInstrument(symbol:String):Int

    @Query("SELECT * FROM blocked_instruments WHERE symbol = :symbol LIMIT 1")
    suspend fun blockedInstrument(symbol:String):BlockedInstrumentEntity?

    @Query("SELECT * FROM blocked_instruments ORDER BY symbol")
    suspend fun blockedInstruments():List<BlockedInstrumentEntity>

    @Query("SELECT * FROM signals WHERE signal = :side ORDER BY signalTimeUtc DESC, id DESC LIMIT :limit")
    suspend fun recentSignalsBySide(side:String,limit:Int):List<SignalEntity>

    @Query("SELECT * FROM signals WHERE signal = :side ORDER BY signalTimeUtc DESC, id DESC LIMIT :limit")
    fun observeRecentSignalsBySide(side:String,limit:Int):Flow<List<SignalEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putPortfolioSnapshot(row: PortfolioSnapshotEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putSchedulerJob(row: SchedulerJobEntity)

    @Query("SELECT * FROM scheduler_jobs ORDER BY id")
    suspend fun schedulerJobs(): List<SchedulerJobEntity>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertSchedulerRun(row:SchedulerRunEntity)

    @Update
    suspend fun updateSchedulerRun(row:SchedulerRunEntity)

    @Query("SELECT * FROM scheduler_runs ORDER BY startedAtUtc DESC LIMIT :limit")
    suspend fun recentSchedulerRuns(limit:Int):List<SchedulerRunEntity>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertModel(row: ModelEntity)

    @Query("UPDATE models SET active = 0, role = 'RETIRED' WHERE active = 1")
    suspend fun deactivateModels()

    @Query("UPDATE models SET active = 1, role = 'CHAMPION' WHERE version = :version")
    suspend fun activateModel(version:String)

    @Transaction
    suspend fun promoteModel(version:String) {
        deactivateModels()
        activateModel(version)
    }

    @Transaction
    suspend fun promoteModelWithAudit(version:String, audit:AuditEventEntity) {
        deactivateModels()
        activateModel(version)
        appendAudit(audit)
    }

    @Query("SELECT * FROM models WHERE active = 1 LIMIT 1")
    suspend fun champion(): ModelEntity?

    @Query("UPDATE models SET role = :role WHERE version = :version AND active = 0")
    suspend fun updateModelRole(version:String,role:String):Int

    @Transaction
    suspend fun transitionModelRoleWithAudit(version:String,fromRole:String,toRole:String,audit:AuditEventEntity) {
        val model=models().firstOrNull{it.version==version} ?: throw IllegalArgumentException("unknown model")
        require(!model.active) { "active champion role cannot be changed here" }
        require(model.role==fromRole) { "model role transition mismatch" }
        require(updateModelRole(version,toRole)==1) { "model role update failed" }
        appendAudit(audit)
    }

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun appendAudit(row: AuditEventEntity)

    @Query("SELECT * FROM audit_events ORDER BY timestampUtc DESC LIMIT :limit")
    suspend fun recentAudit(limit:Int): List<AuditEventEntity>

    @Query("DELETE FROM audit_events WHERE timestampUtc < :cutoffUtc")
    suspend fun deleteAuditBefore(cutoffUtc:String):Int

    @Query("DELETE FROM audit_events")
    suspend fun clearAudit():Int

    @Query("DELETE FROM notification_deliveries WHERE deliveredAtUtc < :cutoffUtc")
    suspend fun deleteNotificationDeliveriesBefore(cutoffUtc:String):Int

    @Query("DELETE FROM notification_deliveries")
    suspend fun clearNotificationDeliveries():Int

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun appendAiAudit(row: AiAuditEntity)

    @Query("SELECT * FROM ai_audits WHERE marketFingerprint = :marketFingerprint AND purpose = :purpose AND schemaVersion = :schemaVersion AND status = 'SUCCESS' ORDER BY completedAtUtc DESC LIMIT 1")
    suspend fun cachedAiSuccess(marketFingerprint:String,purpose:String,schemaVersion:String): AiAuditEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putInstrumentLifecycle(row: InstrumentLifecycleEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putUniverseSnapshot(row: UniverseSnapshotEntity)

    @Query("SELECT * FROM universe_snapshots WHERE asOfDate <= :asOfDate AND pointInTimeVerified = 1 ORDER BY asOfDate DESC LIMIT 1")
    suspend fun universeAtOrBefore(asOfDate:String): UniverseSnapshotEntity?

    @Query("SELECT * FROM instrument_lifecycles ORDER BY symbol")
    suspend fun instrumentLifecycles(): List<InstrumentLifecycleEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putMarketBars(rows: List<MarketBarEntity>)

    @Query("SELECT * FROM market_bars WHERE symbol = :symbol AND (substr(atUtc,-1) = 'Z' AND substr(:asOfUtc,-1) = 'Z' AND (substr(atUtc,1,19) || substr(replace(replace(substr(atUtc,20),'.',''),'Z','') || '000000000',1,9)) <= (substr(:asOfUtc,1,19) || substr(replace(replace(substr(:asOfUtc,20),'.',''),'Z','') || '000000000',1,9))) AND (substr(receivedAtUtc,-1) = 'Z' AND substr(:asOfUtc,-1) = 'Z' AND (substr(receivedAtUtc,1,19) || substr(replace(replace(substr(receivedAtUtc,20),'.',''),'Z','') || '000000000',1,9)) <= (substr(:asOfUtc,1,19) || substr(replace(replace(substr(:asOfUtc,20),'.',''),'Z','') || '000000000',1,9))) ORDER BY (substr(atUtc,1,19) || substr(replace(replace(substr(atUtc,20),'.',''),'Z','') || '000000000',1,9)) ASC")
    suspend fun marketBars(symbol:String,asOfUtc:String): List<MarketBarEntity>

    @Query("SELECT MAX(receivedAtUtc) FROM market_bars WHERE symbol = :symbol")
    suspend fun lastBarReceivedAt(symbol:String): String?

    @Query("SELECT MAX(substr(atUtc,1,10)) FROM market_bars")
    suspend fun latestMarketBarDate():String?

    @Query("SELECT MIN(substr(atUtc,1,10)) FROM market_bars WHERE substr(atUtc,1,10) > :date")
    suspend fun nextMarketBarDateAfter(date:String):String?

    @Query("SELECT MAX(substr(atUtc,1,10)) FROM market_bars WHERE substr(atUtc,1,10) < :date")
    suspend fun previousMarketBarDateBefore(date:String):String?

    @Query("SELECT * FROM market_bars WHERE substr(atUtc,1,10) = :date ORDER BY symbol ASC, receivedAtUtc ASC")
    suspend fun marketBarsOnDate(date:String):List<MarketBarEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertTradeAlertOutbox(row:TradeAlertOutboxEntity):Long

    @Query("SELECT * FROM trade_alert_outbox WHERE state != 'SENT' ORDER BY createdAtUtc ASC LIMIT :limit")
    suspend fun pendingTradeAlertOutbox(limit:Int=50):List<TradeAlertOutboxEntity>

    @Query("SELECT * FROM trade_alert_outbox WHERE eventId = :eventId LIMIT 1")
    suspend fun tradeAlertOutbox(eventId:String):TradeAlertOutboxEntity?

    @Update
    suspend fun updateTradeAlertOutbox(row:TradeAlertOutboxEntity)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun appendNotificationDelivery(row: NotificationDeliveryEntity)

    @Query("SELECT * FROM notification_deliveries WHERE fingerprint = :fingerprint ORDER BY deliveredAtUtc DESC LIMIT 1")
    suspend fun latestNotification(fingerprint:String): NotificationDeliveryEntity?

    @Query("SELECT COUNT(*) FROM notification_deliveries WHERE fingerprint = :fingerprint")
    suspend fun notificationCountForFingerprint(fingerprint:String): Int

    @Query("SELECT COUNT(*) FROM notification_deliveries WHERE deliveredAtUtc >= :sinceUtc")
    suspend fun notificationCountSince(sinceUtc:String): Int

    @Query("SELECT COUNT(*) FROM market_bars")
    suspend fun marketBarCount(): Int

    @Query("SELECT MAX(atUtc) FROM market_bars")
    suspend fun latestMarketBarAtUtc():String?

    @Query("SELECT MAX(marketTimestampUtc) FROM market_observations WHERE marketTimestampUtc IS NOT NULL")
    suspend fun latestMarketObservationTime():String?

    @Query("SELECT MAX(receivedAtUtc) FROM market_bars")
    suspend fun latestMarketBarReceivedAt(): String?

    @Query("SELECT COUNT(*) FROM ai_audits WHERE status = 'SUCCESS'")
    suspend fun successfulAiAuditCount(): Int

    @Query("SELECT COUNT(*) FROM ai_audits WHERE paidCall = 1")
    suspend fun paidAiCallCount(): Int

    @Query("SELECT COUNT(*) FROM ai_audits WHERE paidCall = 1 AND requestedAtUtc >= :sinceUtc")
    suspend fun paidAiCallCountSince(sinceUtc:String): Int

    @Query("SELECT * FROM ai_audits ORDER BY requestedAtUtc DESC LIMIT 1")
    suspend fun latestAiAudit(): AiAuditEntity?

    @Query("SELECT * FROM ai_audits WHERE purpose = :purpose AND status = 'SUCCESS' ORDER BY requestedAtUtc DESC LIMIT 1")
    suspend fun latestSuccessfulAiAudit(purpose:String):AiAuditEntity?

    @Query("SELECT * FROM audit_events WHERE subsystem = 'ai' AND code = 'AI_PAID_EVIDENCE' ORDER BY timestampUtc DESC LIMIT 1")
    suspend fun latestAiPaidEvidence():AuditEventEntity?

    @Query("SELECT COUNT(DISTINCT runId) FROM selection_outcomes WHERE eligibleForLearning = 1")
    suspend fun eligibleLearningRunCount():Int

    @Query("SELECT COUNT(*) FROM universe_snapshots")
    suspend fun universeSnapshotCount(): Int

    @Query("SELECT * FROM analysis_runs ORDER BY asOfUtc DESC LIMIT :limit")
    suspend fun recentRuns(limit:Int): List<AnalysisRunEntity>

    @Query("SELECT * FROM models ORDER BY createdAtUtc DESC")
    suspend fun models(): List<ModelEntity>

    @Query("SELECT * FROM portfolio_snapshots ORDER BY atUtc DESC LIMIT 1")
    suspend fun latestPortfolioSnapshot(): PortfolioSnapshotEntity?

    @Query("SELECT * FROM portfolio_snapshots ORDER BY atUtc ASC")
    suspend fun portfolioSnapshots(): List<PortfolioSnapshotEntity>

    @Query("SELECT COUNT(DISTINCT symbol) FROM market_bars")
    suspend fun marketSymbolCount(): Int

    @Query("SELECT COUNT(DISTINCT provider) FROM market_bars")
    suspend fun marketProviderCount(): Int

    @Query("""
        SELECT b.* FROM market_bars b
        INNER JOIN (
            SELECT symbol, MAX(atUtc) AS maxAt
            FROM market_bars
            GROUP BY symbol
        ) latest ON latest.symbol = b.symbol AND latest.maxAt = b.atUtc
        ORDER BY b.symbol ASC, b.provider ASC
        LIMIT :limit
    """)
    suspend fun latestMarketBars(limit:Int):List<MarketBarEntity>

    @Query("SELECT * FROM qualified_trade_states ORDER BY symbol")
    suspend fun qualifiedTradeStates(): List<QualifiedTradeStateEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putQualifiedTradeStates(rows: List<QualifiedTradeStateEntity>)

    @Query("DELETE FROM qualified_trade_states WHERE symbol NOT IN (:symbols)")
    suspend fun deleteQualifiedStatesNotIn(symbols:List<String>)

    @Query("DELETE FROM qualified_trade_states WHERE symbol = :symbol")
    suspend fun deleteQualifiedTradeState(symbol:String)

    @Query("SELECT * FROM portfolio_positions ORDER BY symbol")
    suspend fun portfolioPositions(): List<PortfolioPositionEntity>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertPortfolioPosition(row: PortfolioPositionEntity)

    @Update
    suspend fun updatePortfolioPosition(row: PortfolioPositionEntity)

    @Query("DELETE FROM portfolio_positions WHERE symbol = :symbol")
    suspend fun deletePortfolioPosition(symbol:String)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun appendPortfolioTransaction(row: PortfolioTransactionEntity)

    @Query("SELECT * FROM portfolio_transactions ORDER BY atUtc ASC, id ASC")
    suspend fun portfolioTransactions(): List<PortfolioTransactionEntity>

    @Query("SELECT * FROM portfolio_transactions WHERE idempotencyKey = :key LIMIT 1")
    suspend fun portfolioTransactionByIdempotencyKey(key:String): PortfolioTransactionEntity?

    @Query("SELECT * FROM portfolio_state WHERE key = 'state' LIMIT 1")
    suspend fun portfolioState(): PortfolioStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putPortfolioState(row: PortfolioStateEntity)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertPortfolioPositions(rows:List<PortfolioPositionEntity>)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertPortfolioTransactions(rows:List<PortfolioTransactionEntity>)

    @Query("DELETE FROM portfolio_positions")
    suspend fun clearPortfolioPositions()

    @Query("DELETE FROM portfolio_transactions")
    suspend fun clearPortfolioTransactions()

    @Query("DELETE FROM portfolio_snapshots")
    suspend fun clearPortfolioSnapshots()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putOperationProgress(row:OperationProgressEntity)

    @Query("SELECT * FROM operation_progress WHERE operationId = :operationId LIMIT 1")
    suspend fun operationProgress(operationId:String):OperationProgressEntity?

    @Query("SELECT * FROM operation_progress WHERE state IN ('RUNNING','CANCEL_REQUESTED') ORDER BY updatedAtUtc DESC")
    suspend fun activeOperations():List<OperationProgressEntity>

    @Query("SELECT * FROM operation_progress WHERE operationType = :operationType ORDER BY updatedAtUtc DESC LIMIT 1")
    suspend fun latestOperationProgress(operationType:String):OperationProgressEntity?

    @Query("SELECT * FROM operation_progress WHERE operationType = :operationType AND state IN ('SUCCEEDED','COMPLETED') AND stage LIKE 'COMPLETE%' ORDER BY updatedAtUtc DESC LIMIT 1")
    suspend fun latestCompletedDataPublication(operationType:String):OperationProgressEntity?

    @Query("SELECT * FROM operation_progress WHERE operationType IN (:operationTypes) AND state IN ('SUCCEEDED','COMPLETED') AND stage LIKE 'COMPLETE%' ORDER BY updatedAtUtc DESC LIMIT 1")
    suspend fun latestCompletedDataPublicationAmong(operationTypes:List<String>):OperationProgressEntity?

    @Query("UPDATE operation_progress SET cancelRequested = 1, state = 'CANCEL_REQUESTED', updatedAtUtc = :updatedAtUtc WHERE operationId = :operationId AND state = 'RUNNING'")
    suspend fun requestOperationCancel(operationId:String,updatedAtUtc:String):Int

    @Query("DELETE FROM operation_progress WHERE operationId = :operationId")
    suspend fun deleteOperationProgress(operationId:String)

    @Query("UPDATE operation_progress SET state = 'INTERRUPTED', errorCode = 'PROCESS_INTERRUPTED_RECOVERABLE', updatedAtUtc = :updatedAtUtc WHERE state = 'RUNNING'")
    suspend fun markActiveOperationsInterrupted(updatedAtUtc:String):Int

    @Query("UPDATE operation_progress SET state = 'CANCELLED', errorCode = 'USER_CANCELLED', updatedAtUtc = :updatedAtUtc WHERE state = 'CANCEL_REQUESTED'")
    suspend fun finalizePendingUserCancellations(updatedAtUtc:String):Int

    @Query("UPDATE scheduler_runs SET state = 'INTERRUPTED', completedAtUtc = :completedAtUtc, success = 0, errorCode = 'PROCESS_INTERRUPTED_RECOVERABLE', errorMessage = 'Process restarted; durable work will be rescheduled' WHERE state = 'RUNNING'")
    suspend fun markRunningSchedulerRunsInterrupted(completedAtUtc:String):Int

    @Query("UPDATE scheduler_jobs SET state = 'RECOVERY_PENDING', success = 0, errorCode = 'PROCESS_INTERRUPTED_RECOVERABLE', errorMessage = 'Process restarted; durable work will be rescheduled' WHERE state = 'RUNNING'")
    suspend fun markRunningSchedulerJobsRecoveryPending():Int

    @Query("DELETE FROM k_historical_rows")
    suspend fun clearKHistoricalRows():Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putKHistoricalRow(row:KHistoricalRowEntity)

    @Query("SELECT * FROM k_historical_rows WHERE id = 'LIVE' LIMIT 1")
    suspend fun kHistoricalLive():KHistoricalRowEntity?

    @Query("SELECT * FROM k_historical_rows WHERE kind = 'ARCHIVE' ORDER BY knSourceDate DESC, archivedAtUtc DESC LIMIT :limit")
    suspend fun kHistoricalArchives(limit:Int=30):List<KHistoricalRowEntity>

    @Query("SELECT * FROM k_historical_rows WHERE kind = 'ARCHIVE' AND knRunId = :runId LIMIT 1")
    suspend fun kHistoricalArchiveForRun(runId:String):KHistoricalRowEntity?

    @Query("DELETE FROM k_historical_rows WHERE kind = 'ARCHIVE' AND id NOT IN (SELECT id FROM k_historical_rows WHERE kind = 'ARCHIVE' ORDER BY knSourceDate DESC, archivedAtUtc DESC LIMIT 30)")
    suspend fun trimKHistoricalArchives():Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putPipelineStagePublication(row:PipelineStagePublicationEntity)

    @Query("SELECT * FROM pipeline_stage_publications WHERE stage = :stage LIMIT 1")
    suspend fun pipelineStagePublication(stage:String):PipelineStagePublicationEntity?

    @Query("SELECT * FROM pipeline_stage_publications ORDER BY publishedAtUtc DESC")
    suspend fun pipelineStagePublications():List<PipelineStagePublicationEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertNewsItems(rows:List<NewsItemEntity>):List<Long>

    @Query("SELECT * FROM news_items WHERE region = :region AND (substr(publishedAtUtc,-1) = 'Z' AND substr(:asOfUtc,-1) = 'Z' AND (substr(publishedAtUtc,1,19) || substr(replace(replace(substr(publishedAtUtc,20),'.',''),'Z','') || '000000000',1,9)) <= (substr(:asOfUtc,1,19) || substr(replace(replace(substr(:asOfUtc,20),'.',''),'Z','') || '000000000',1,9))) AND (substr(receivedAtUtc,-1) = 'Z' AND substr(:asOfUtc,-1) = 'Z' AND (substr(receivedAtUtc,1,19) || substr(replace(replace(substr(receivedAtUtc,20),'.',''),'Z','') || '000000000',1,9)) <= (substr(:asOfUtc,1,19) || substr(replace(replace(substr(:asOfUtc,20),'.',''),'Z','') || '000000000',1,9))) ORDER BY (substr(publishedAtUtc,1,19) || substr(replace(replace(substr(publishedAtUtc,20),'.',''),'Z','') || '000000000',1,9)) DESC, (substr(receivedAtUtc,1,19) || substr(replace(replace(substr(receivedAtUtc,20),'.',''),'Z','') || '000000000',1,9)) DESC, id ASC LIMIT :limit")
    suspend fun newsAsOf(region:String,asOfUtc:String,limit:Int):List<NewsItemEntity>

    @Query("SELECT COUNT(*) FROM news_items")
    suspend fun newsItemCount():Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putPortalQuotes(rows:List<PortalQuoteEntity>)

    @Query("SELECT * FROM portal_quotes ORDER BY region,key")
    suspend fun portalQuotes():List<PortalQuoteEntity>

    @Query("SELECT COUNT(*) FROM portal_quotes")
    suspend fun portalQuoteCount():Int

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun appendSelectionOutcome(row:SelectionOutcomeEntity)

    @Query("SELECT * FROM selection_outcomes WHERE runId = :runId AND symbol = :symbol LIMIT 1")
    suspend fun selectionOutcome(runId:String,symbol:String):SelectionOutcomeEntity?

    @Query("SELECT * FROM selection_outcomes WHERE runId = :runId ORDER BY symbol")
    suspend fun selectionOutcomesForRun(runId:String):List<SelectionOutcomeEntity>

    @Query("SELECT * FROM selection_outcomes WHERE (substr(evaluatedAtUtc,-1) = 'Z' AND substr(:asOfUtc,-1) = 'Z' AND (substr(evaluatedAtUtc,1,19) || substr(replace(replace(substr(evaluatedAtUtc,20),'.',''),'Z','') || '000000000',1,9)) <= (substr(:asOfUtc,1,19) || substr(replace(replace(substr(:asOfUtc,20),'.',''),'Z','') || '000000000',1,9))) AND eligibleForLearning = 1 ORDER BY (substr(evaluatedAtUtc,1,19) || substr(replace(replace(substr(evaluatedAtUtc,20),'.',''),'Z','') || '000000000',1,9)) ASC, id ASC")
    suspend fun eligibleSelectionOutcomesAsOf(asOfUtc:String):List<SelectionOutcomeEntity>

    @Query("SELECT COUNT(*) FROM selection_outcomes")
    suspend fun selectionOutcomeCount():Int

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertImportJournal(row:ImportJournalEntity)

    @Query("SELECT * FROM import_journal WHERE state IN ('PREPARED','DB_COMMITTED') ORDER BY createdAtUtc ASC")
    suspend fun pendingImportJournals():List<ImportJournalEntity>

    @Query("UPDATE import_journal SET state = :state, updatedAtUtc = :updatedAtUtc WHERE id = :id")
    suspend fun updateImportJournalState(id:String,state:String,updatedAtUtc:String):Int

    @Query("DELETE FROM import_journal WHERE id = :id")
    suspend fun deleteImportJournal(id:String):Int

    @Transaction
    suspend fun replacePortfolioImportWithJournal(
        state:PortfolioStateEntity,
        positions:List<PortfolioPositionEntity>,
        transactions:List<PortfolioTransactionEntity>,
        journalId:String,
        committedAtUtc:String
    ) {
        clearPortfolioPositions()
        clearPortfolioTransactions()
        clearPortfolioSnapshots()
        putPortfolioState(state)
        if(positions.isNotEmpty()) insertPortfolioPositions(positions)
        if(transactions.isNotEmpty()) insertPortfolioTransactions(transactions)
        require(updateImportJournalState(journalId,"DB_COMMITTED",committedAtUtc)==1) {
            "import journal state transition failed"
        }
    }

    @Transaction
    suspend fun replacePortfolioImport(
        state:PortfolioStateEntity,
        positions:List<PortfolioPositionEntity>,
        transactions:List<PortfolioTransactionEntity>
    ) {
        clearPortfolioPositions()
        clearPortfolioTransactions()
        clearPortfolioSnapshots()
        putPortfolioState(state)
        if(positions.isNotEmpty()) insertPortfolioPositions(positions)
        if(transactions.isNotEmpty()) insertPortfolioTransactions(transactions)
    }

    @Transaction
    suspend fun commitTradeRemoval(
        tombstones:List<TradeRemovalTombstoneEntity>,
        state:PortfolioStateEntity,
        positions:List<PortfolioPositionEntity>,
        transactions:List<PortfolioTransactionEntity>,
        snapshots:List<PortfolioSnapshotEntity>,
        symbol:String,
        signalIds:List<String>,
        audit:AuditEventEntity
    ) {
        if(tombstones.isNotEmpty()) putTradeRemovalTombstones(tombstones)
        clearPortfolioPositions()
        clearPortfolioTransactions()
        clearPortfolioSnapshots()
        putPortfolioState(state)
        if(positions.isNotEmpty()) insertPortfolioPositions(positions)
        if(transactions.isNotEmpty()) insertPortfolioTransactions(transactions)
        snapshots.forEach { putPortfolioSnapshot(it) }
        deleteQualifiedTradeState(symbol)
        if(signalIds.isNotEmpty()) deleteSignalsByIds(signalIds)
        appendAudit(audit)
    }

    @Transaction
    suspend fun applyPortfolioBuy(
        state:PortfolioStateEntity,
        position:PortfolioPositionEntity,
        transaction:PortfolioTransactionEntity
    ) {
        appendPortfolioTransaction(transaction)
        insertPortfolioPosition(position)
        putPortfolioState(state)
    }

    @Transaction
    suspend fun applyPortfolioSell(
        state:PortfolioStateEntity,
        symbol:String,
        transaction:PortfolioTransactionEntity
    ) {
        appendPortfolioTransaction(transaction)
        deletePortfolioPosition(symbol)
        putPortfolioState(state)
    }
}
