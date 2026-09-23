package com.aurum.bistterminal8

import android.content.Context
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeSchedulerAcceptanceTest {
    private val context: Context
        get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Before
    fun resetScheduler() {
        // Cancel every known default plus the explicit acceptance slot before mutating prefs.
        // install(false) first would replace the configured list and could orphan an old 12:30 PendingIntent.
        AurumScheduler.cancelKnown(context)
        AurumScheduler.install(context, false, emptyList())
        cancelPending("03:17")
    }

    @Test
    fun foregroundLaunchDoesNotMutateSchedulerConfiguration() {
        val prefs = context.getSharedPreferences("aurum_scheduler", Context.MODE_PRIVATE)
        val beforeEnabled = prefs.getBoolean("enabled", false)
        val beforeTimes = prefs.getString("times", null)
        assertFalse(hasAlarm("03:17"))
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity {
                assertEquals(beforeEnabled, prefs.getBoolean("enabled", false))
                assertEquals(beforeTimes, prefs.getString("times", null))
                // Foreground startup must neither mutate scheduler prefs nor create an alarm.
                assertFalse(hasAlarm("03:17"))
            }
        }
    }

    @Test
    fun explicitScheduleArmsAndDisableClearsAlarm() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals(
                    "OK",
                    activity.handleNative(
                        "aurum://native?cmd=schedule&enabled=1&times=03%3A17",
                        ""
                    )
                )
            }
        }
        assertTrue(hasAlarm("03:17"))

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals(
                    "OK",
                    activity.handleNative(
                        "aurum://native?cmd=schedule&enabled=0&times=03%3A17",
                        ""
                    )
                )
            }
        }
        assertFalse(hasAlarm("03:17"))
    }

    @Test
    fun invalidScheduleIsRejectedWithoutArming() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals(
                    "ERR:INVALID_SCHEDULE",
                    activity.handleNative(
                        "aurum://native?cmd=schedule&enabled=1&times=99%3A99",
                        ""
                    )
                )
            }
        }
        assertFalse(hasAlarm("99:99"))
    }

    private fun hasAlarm(time: String): Boolean = pendingExists(time)

    private fun cancelPending(time: String) {
        val intent = android.content.Intent(context, TriggerReceiver::class.java)
            .setAction("com.aurum.bistterminal8.SCHEDULED_SLOT")
        android.app.PendingIntent.getBroadcast(
            context,
            time.hashCode(),
            intent,
            android.app.PendingIntent.FLAG_NO_CREATE or android.app.PendingIntent.FLAG_IMMUTABLE
        )?.let { pi ->
            context.getSystemService(android.app.AlarmManager::class.java).cancel(pi)
            pi.cancel()
        }
    }

    private fun pendingExists(time: String): Boolean {
        val intent = android.content.Intent(context, TriggerReceiver::class.java)
            .setAction("com.aurum.bistterminal8.SCHEDULED_SLOT")
        return android.app.PendingIntent.getBroadcast(
            context,
            time.hashCode(),
            intent,
            android.app.PendingIntent.FLAG_NO_CREATE or android.app.PendingIntent.FLAG_IMMUTABLE
        ) != null
    }
}
