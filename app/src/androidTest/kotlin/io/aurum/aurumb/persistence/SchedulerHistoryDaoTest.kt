package io.aurum.aurumb.persistence

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SchedulerHistoryDaoTest {
    private lateinit var db:AurumDatabase
    private lateinit var dao:AurumDao

    @Before
    fun setUp() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        db=Room.inMemoryDatabaseBuilder(context,AurumDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao=db.aurumDao()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun repeatedTriggersRemainAppendOnlyAndKeepTerminalStates()=runBlocking {
        val first=SchedulerRunEntity(
            runId="run-1",jobId="market",startedAtUtc="2026-10-02T00:00:00Z",
            completedAtUtc=null,state="RUNNING",durationMs=null,success=null,retryCount=0,
            errorCode=null,errorMessage=null
        )
        val second=SchedulerRunEntity(
            runId="run-2",jobId="market",startedAtUtc="2026-10-02T06:00:00Z",
            completedAtUtc=null,state="RUNNING",durationMs=null,success=null,retryCount=1,
            errorCode=null,errorMessage=null
        )
        dao.insertSchedulerRun(first)
        dao.insertSchedulerRun(second)
        dao.updateSchedulerRun(first.copy(
            completedAtUtc="2026-10-02T00:01:00Z",state="SUCCEEDED",
            durationMs=60000,success=true
        ))
        dao.updateSchedulerRun(second.copy(
            completedAtUtc="2026-10-02T06:00:30Z",state="FAILED",
            durationMs=30000,success=false,errorCode="TEST",errorMessage="fixture"
        ))

        val rows=dao.recentSchedulerRuns(10)
        assertEquals(2,rows.size)
        assertEquals(listOf("run-2","run-1"),rows.map{it.runId})
        assertTrue(rows.any{it.runId=="run-1" && it.state=="SUCCEEDED" && it.success==true})
        assertTrue(rows.any{it.runId=="run-2" && it.state=="FAILED" && it.success==false})

        val note=SchedulerRunEntity(
            runId="run-3",jobId="market",startedAtUtc="2026-10-02T12:00:00Z",
            completedAtUtc="2026-10-02T12:00:05Z",state="SUCCEEDED_WITH_NOTE",durationMs=5000,
            success=true,retryCount=0,errorCode="DATA_QUALITY_LT_70_DOWNSTREAM_FROZEN",
            errorMessage="Veriler yayımlandı; downstream zaman damgaları korundu"
        )
        dao.insertSchedulerRun(note)
        val latest=dao.recentSchedulerRuns(10)
        assertTrue(latest.any{
            it.runId=="run-3" && it.success==true &&
            it.state=="SUCCEEDED_WITH_NOTE" &&
            it.errorCode=="DATA_QUALITY_LT_70_DOWNSTREAM_FROZEN"
        })
    }

    @Test
    fun lowQualityPublicationRemainsTheGateUntilLaterCompletedPass()=runBlocking {
        val low=OperationProgressEntity(
            operationId="low",operationType="HISTORICAL_SYNC",stage="COMPLETE_LT_70",
            processed=7,total=10,currentInstrument=null,provider="fixture",elapsedMs=1000,
            errorCode="DATA_QUALITY_LT_70_DOWNSTREAM_FROZEN",state="SUCCEEDED",
            cancelRequested=false,startedAtUtc="2026-10-02T10:00:00Z",updatedAtUtc="2026-10-02T10:01:00Z"
        )
        dao.putOperationProgress(low)

        val failed=OperationProgressEntity(
            operationId="failed",operationType="HISTORICAL_SYNC",stage="FAILED",
            processed=1,total=10,currentInstrument=null,provider="fixture",elapsedMs=500,
            errorCode="IOException",state="FAILED",cancelRequested=false,
            startedAtUtc="2026-10-02T11:00:00Z",updatedAtUtc="2026-10-02T11:00:30Z"
        )
        dao.putOperationProgress(failed)

        val stillFrozen=dao.latestCompletedDataPublication("HISTORICAL_SYNC")
        assertEquals("low",stillFrozen?.operationId)
        assertEquals("DATA_QUALITY_LT_70_DOWNSTREAM_FROZEN",stillFrozen?.errorCode)

        val good=OperationProgressEntity(
            operationId="good",operationType="HISTORICAL_SYNC",stage="COMPLETE_Q70",
            processed=10,total=10,currentInstrument=null,provider="fixture",elapsedMs=900,
            errorCode=null,state="SUCCEEDED",cancelRequested=false,
            startedAtUtc="2026-10-02T12:00:00Z",updatedAtUtc="2026-10-02T12:01:00Z"
        )
        dao.putOperationProgress(good)

        val reopened=dao.latestCompletedDataPublication("HISTORICAL_SYNC")
        assertEquals("good",reopened?.operationId)
        assertEquals(null,reopened?.errorCode)
    }
    @Test
    fun latestFinalizedDataPublicationPrefersNewerRepairState()=runBlocking {
        dao.putOperationProgress(OperationProgressEntity(
            operationId="main-low",operationType="HISTORICAL_SYNC",stage="COMPLETE_BELOW_GATE",
            processed=7,total=10,currentInstrument=null,provider="fixture",elapsedMs=1000,
            errorCode="DATA_QUALITY_BELOW_GATE_DOWNSTREAM_FROZEN",state="SUCCEEDED",
            cancelRequested=false,startedAtUtc="2026-10-02T10:00:00Z",updatedAtUtc="2026-10-02T10:01:00Z"
        ))
        dao.putOperationProgress(OperationProgressEntity(
            operationId="repair-open",operationType="HISTORICAL_REPAIR",stage="COMPLETE_TARGETED_GATE_OPEN",
            processed=3,total=3,currentInstrument=null,provider="fixture",elapsedMs=500,
            errorCode=null,state="SUCCEEDED",cancelRequested=false,
            startedAtUtc="2026-10-02T10:05:00Z",updatedAtUtc="2026-10-02T10:06:00Z"
        ))

        val latest=dao.latestCompletedDataPublicationAmong(listOf("HISTORICAL_SYNC","HISTORICAL_REPAIR"))
        assertEquals("repair-open",latest?.operationId)
        assertEquals("COMPLETE_TARGETED_GATE_OPEN",latest?.stage)
    }

    @Test
    fun processRestartRecoversRunningButPreservesExplicitCancelIntent()=runBlocking {
        val running=OperationProgressEntity(
            operationId="op-running",operationType="HISTORICAL_SYNC",stage="FETCH",
            processed=2,total=10,currentInstrument="X",provider="fixture",elapsedMs=100,
            errorCode=null,state="RUNNING",cancelRequested=false,
            startedAtUtc="2026-10-02T10:00:00Z",updatedAtUtc="2026-10-02T10:01:00Z"
        )
        val cancelRequested=OperationProgressEntity(
            operationId="op-cancel",operationType="HISTORICAL_SYNC",stage="FETCH",
            processed=3,total=10,currentInstrument="Y",provider="fixture",elapsedMs=200,
            errorCode=null,state="CANCEL_REQUESTED",cancelRequested=true,
            startedAtUtc="2026-10-02T10:00:00Z",updatedAtUtc="2026-10-02T10:02:00Z"
        )
        dao.putOperationProgress(running)
        dao.putOperationProgress(cancelRequested)
        dao.insertSchedulerRun(SchedulerRunEntity(
            runId="sched-running",jobId="market",startedAtUtc="2026-10-02T10:00:00Z",
            completedAtUtc=null,state="RUNNING",durationMs=null,success=null,retryCount=0,
            errorCode=null,errorMessage=null
        ))
        dao.putSchedulerJob(SchedulerJobEntity(
            id="market",lastRunUtc="2026-10-02T10:00:00Z",nextRunUtc=null,state="RUNNING",
            durationMs=null,success=null,retryCount=0,errorCode=null,errorMessage=null
        ))

        val at="2026-10-02T10:03:00Z"
        dao.finalizePendingUserCancellations(at)
        dao.markActiveOperationsInterrupted(at)
        dao.markRunningSchedulerRunsInterrupted(at)
        dao.markRunningSchedulerJobsRecoveryPending()

        assertEquals("INTERRUPTED",dao.operationProgress("op-running")?.state)
        assertEquals("PROCESS_INTERRUPTED_RECOVERABLE",dao.operationProgress("op-running")?.errorCode)
        assertEquals("CANCELLED",dao.operationProgress("op-cancel")?.state)
        assertEquals("USER_CANCELLED",dao.operationProgress("op-cancel")?.errorCode)
        val sched=dao.recentSchedulerRuns(10).first{it.runId=="sched-running"}
        assertEquals("INTERRUPTED",sched.state)
        assertEquals(false,sched.success)
        assertEquals("RECOVERY_PENDING",dao.schedulerJobs().first{it.id=="market"}.state)
    }

}
