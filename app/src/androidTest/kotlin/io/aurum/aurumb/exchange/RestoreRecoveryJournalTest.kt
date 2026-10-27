package io.aurum.aurumb.exchange

import android.content.Context
import android.util.AtomicFile
import java.io.File
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RestoreRecoveryJournalTest {
    @Test
    fun encryptedJournalSurvivesObjectRecreationAndClears() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val a=RestoreRecoveryJournal(context)
        runCatching{a.clear()}

        val payload="rollback-state-aurumb".toByteArray()
        a.write(payload)
        assertTrue(a.exists())

        val b=RestoreRecoveryJournal(context)
        assertArrayEquals(payload,b.read())
        b.clear()
        assertFalse(b.exists())
    }
    @Test
    fun interruptedReplacementKeepsLastCommittedRollback() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val journal=RestoreRecoveryJournal(context)
        journal.clear()
        try {
            val committed="last-complete-rollback".toByteArray()
            journal.write(committed)
            val file=File(context.noBackupFilesDir,"aurum-full-restore-recovery-v1.json")
            // Simulate process death after writing an incomplete new file,
            // before AtomicFile.finishWrite publishes it.
            AtomicFile(file).startWrite().use { it.write("partial".toByteArray()) }
            assertArrayEquals(committed,RestoreRecoveryJournal(context).read())
            journal.write("next-complete-rollback".toByteArray())
            assertArrayEquals("next-complete-rollback".toByteArray(),journal.read())
        } finally {
            journal.clear()
        }
    }
}
