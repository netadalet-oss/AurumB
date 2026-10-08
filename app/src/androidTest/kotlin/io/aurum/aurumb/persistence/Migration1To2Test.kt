package io.aurum.aurumb.persistence

import android.content.Context
import androidx.room.Room
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class Migration1To21Test {
    private fun createV1(db:SupportSQLiteDatabase) {
        db.execSQL("""CREATE TABLE market_observations (
            id TEXT NOT NULL PRIMARY KEY, symbol TEXT NOT NULL, provider TEXT NOT NULL,
            requestedAtUtc TEXT NOT NULL, receivedAtUtc TEXT NOT NULL, marketTimestampUtc TEXT,
            valueDecimal TEXT, currency TEXT, quality TEXT NOT NULL, freshness TEXT NOT NULL,
            rawSourceFingerprint TEXT NOT NULL, transformVersion TEXT NOT NULL)""")
        db.execSQL("CREATE INDEX index_market_observations_symbol_marketTimestampUtc ON market_observations(symbol, marketTimestampUtc)")
        db.execSQL("""CREATE TABLE analysis_runs (
            id TEXT NOT NULL PRIMARY KEY, asOfUtc TEXT NOT NULL, appVersion TEXT NOT NULL,
            modelVersion TEXT NOT NULL, formulaVersion TEXT NOT NULL, dataSchemaVersion TEXT NOT NULL,
            marketRegime TEXT NOT NULL, dataFingerprint TEXT NOT NULL, status TEXT NOT NULL,
            integrityPassed INTEGER NOT NULL)""")
        db.execSQL("""CREATE TABLE selection_results (
            runId TEXT NOT NULL, symbol TEXT NOT NULL, rank INTEGER NOT NULL, scoreDecimal TEXT NOT NULL,
            alphaScoreDecimal TEXT NOT NULL, dataQualityDecimal TEXT NOT NULL, confidenceDecimal TEXT NOT NULL,
            applicabilityDecimal TEXT NOT NULL, contributionsJson TEXT NOT NULL, rejectionReason TEXT,
            PRIMARY KEY(runId,symbol))""")
        db.execSQL("""CREATE TABLE signals (
            id TEXT NOT NULL PRIMARY KEY, instrument TEXT NOT NULL, signal TEXT NOT NULL, signalTimeUtc TEXT NOT NULL,
            effectiveEntryTimeUtc TEXT, entryBasis TEXT NOT NULL, reasonsJson TEXT NOT NULL,
            contributionsJson TEXT NOT NULL, confidenceDecimal TEXT NOT NULL, marketRegime TEXT NOT NULL,
            dataFreshness TEXT NOT NULL, invalidationCondition TEXT NOT NULL, targetHorizon TEXT NOT NULL,
            appVersion TEXT NOT NULL, modelVersion TEXT NOT NULL, formulaVersion TEXT NOT NULL,
            dataSchemaVersion TEXT NOT NULL)""")
        db.execSQL("CREATE INDEX index_signals_instrument_signalTimeUtc ON signals(instrument, signalTimeUtc)")
        db.execSQL("""CREATE TABLE portfolio_snapshots (
            atUtc TEXT NOT NULL PRIMARY KEY, cashDecimal TEXT NOT NULL, realizedPnlDecimal TEXT NOT NULL,
            unrealizedPnlDecimal TEXT NOT NULL, equityDecimal TEXT NOT NULL, exposureDecimal TEXT NOT NULL,
            benchmarkDecimal TEXT)""")
        db.execSQL("""CREATE TABLE scheduler_jobs (
            id TEXT NOT NULL PRIMARY KEY, lastRunUtc TEXT, nextRunUtc TEXT, state TEXT NOT NULL,
            durationMs INTEGER, success INTEGER, retryCount INTEGER NOT NULL, errorCode TEXT, errorMessage TEXT)""")
        db.execSQL("""CREATE TABLE models (
            version TEXT NOT NULL PRIMARY KEY, role TEXT NOT NULL, createdAtUtc TEXT NOT NULL,
            weightsJson TEXT NOT NULL, validationJson TEXT NOT NULL, sampleCount INTEGER NOT NULL,
            reason TEXT NOT NULL, parentVersion TEXT, active INTEGER NOT NULL)""")
        db.execSQL("""CREATE TABLE audit_events (
            id TEXT NOT NULL PRIMARY KEY, timestampUtc TEXT NOT NULL, level TEXT NOT NULL, subsystem TEXT NOT NULL,
            operationId TEXT NOT NULL, code TEXT NOT NULL, message TEXT NOT NULL, metadataJson TEXT NOT NULL,
            appVersion TEXT NOT NULL, modelVersion TEXT NOT NULL, formulaVersion TEXT NOT NULL,
            dataSchemaVersion TEXT NOT NULL)""")
        db.execSQL("CREATE INDEX index_audit_events_operationId ON audit_events(operationId)")
        db.execSQL("CREATE INDEX index_audit_events_timestampUtc ON audit_events(timestampUtc)")
        db.execSQL("INSERT INTO audit_events VALUES ('a1','2026-01-01T00:00:00Z','INFO','test','op','C','m','{}','1','m1','f1','d1')")
    }

    @Test
    fun migrationPreservesAuditAndCreatesAiCache() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val name="migration-1-21.db"
        context.deleteDatabase(name)
        val config=SupportSQLiteOpenHelper.Configuration.builder(context)
            .name(name)
            .callback(object:SupportSQLiteOpenHelper.Callback(1){
                override fun onCreate(db:SupportSQLiteDatabase)=createV1(db)
                override fun onUpgrade(db:SupportSQLiteDatabase,oldVersion:Int,newVersion:Int)=Unit
            }).build()
        FrameworkSQLiteOpenHelperFactory().create(config).use { it.writableDatabase }

        val migrated=Room.databaseBuilder(context,AurumDatabase::class.java,name)
            .addMigrations(AurumDatabase.MIGRATION_1_2,AurumDatabase.MIGRATION_2_3,AurumDatabase.MIGRATION_3_4,AurumDatabase.MIGRATION_4_5,AurumDatabase.MIGRATION_5_6,AurumDatabase.MIGRATION_6_7,AurumDatabase.MIGRATION_7_8,AurumDatabase.MIGRATION_8_9,AurumDatabase.MIGRATION_9_10,AurumDatabase.MIGRATION_10_11,AurumDatabase.MIGRATION_11_12,AurumDatabase.MIGRATION_12_13,AurumDatabase.MIGRATION_13_14,AurumDatabase.MIGRATION_14_15,AurumDatabase.MIGRATION_15_16,AurumDatabase.MIGRATION_16_17,AurumDatabase.MIGRATION_17_18,AurumDatabase.MIGRATION_18_19,AurumDatabase.MIGRATION_19_20,AurumDatabase.MIGRATION_20_21)
            .build()
        migrated.openHelper.writableDatabase.query(
            "SELECT provenanceJson, COUNT(*) FROM audit_events WHERE id='a1'"
        ).use { cursor ->
            cursor.moveToFirst()
            assertEquals("{}",cursor.getString(0))
            assertEquals(1,cursor.getInt(1))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM ai_audits").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("PRAGMA table_info(ai_audits)").use { cursor ->
            var foundPaid=false
            val nameIx=cursor.getColumnIndex("name")
            while(cursor.moveToNext()) if(cursor.getString(nameIx)=="paidCall") foundPaid=true
            assertTrue(foundPaid)
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM instrument_lifecycles").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM universe_snapshots").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM market_bars").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM notification_deliveries").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM qualified_trade_states").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("PRAGMA table_info(qualified_trade_states)").use { cursor ->
            val required=setOf("stopEvidenceAtUtc","maxPriceAtUtc","profitLockEvidenceAtUtc")
            val found=mutableSetOf<String>()
            val nameIx=cursor.getColumnIndex("name")
            while(cursor.moveToNext()) cursor.getString(nameIx)?.let(found::add)
            assertTrue(found.containsAll(required))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM portfolio_positions").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM portfolio_transactions").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM portfolio_state").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM operation_progress").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM news_items").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.execSQL(
            "INSERT INTO instrument_lifecycles VALUES ('AAA','2026-01-01T00:00:00Z','2026-05-01T00:00:00Z','TEST','fp1','2026-05-01T00:00:00Z')"
        )
        migrated.openHelper.writableDatabase.execSQL(
            "INSERT INTO instrument_lifecycles VALUES ('AAA','2026-06-01T00:00:00Z',NULL,'TEST','fp2','2026-06-01T00:00:00Z')"
        )
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM instrument_lifecycles WHERE symbol='AAA'").use { cursor ->
            cursor.moveToFirst()
            assertEquals(2,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM selection_outcomes").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM import_journal").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("PRAGMA table_info(selection_results)").use { cursor ->
            var found=false
            val nameIx=cursor.getColumnIndex("name")
            while(cursor.moveToNext()) if(cursor.getString(nameIx)=="targetProbabilityDecimal") found=true
            assertTrue(found)
        }
        migrated.openHelper.writableDatabase.query("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_audits'").use { cursor -> assertTrue(cursor.moveToFirst()) }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM scheduler_runs").use { cursor ->
            cursor.moveToFirst(); assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM portal_quotes").use { cursor ->
            cursor.moveToFirst(); assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM pipeline_stage_publications").use { cursor ->
            cursor.moveToFirst(); assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM trade_alert_outbox").use { cursor ->
            cursor.moveToFirst(); assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM k_historical_rows").use { cursor ->
            cursor.moveToFirst(); assertEquals(0,cursor.getInt(0))
        }
        migrated.openHelper.writableDatabase.query("PRAGMA table_info(k_historical_rows)").use { cursor ->
            val required=setOf("id","kind","knRunId","knSourceDate","knTimestampUtc","knTopJson",
                "reelSourceDate","reelTimestampUtc","reelTopJson","hitsJson","topN","frozen",
                "archivedAtUtc","updatedAtUtc")
            val found=mutableSetOf<String>()
            val nameIx=cursor.getColumnIndex("name")
            while(cursor.moveToNext()) cursor.getString(nameIx)?.let(found::add)
            assertTrue(found.containsAll(required))
        }
        migrated.openHelper.writableDatabase.query("SELECT COUNT(*) FROM blocked_instruments").use { cursor ->
            cursor.moveToFirst(); assertEquals(0,cursor.getInt(0))
        }
        migrated.close()
        context.deleteDatabase(name)
    }
}
