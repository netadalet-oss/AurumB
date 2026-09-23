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
        AurumScheduler.install(context, false, emptyList())
        AurumScheduler.cancelKnown(context)
    }

    @Test
    fun foregroundLaunchDoesNotArmScheduler() {
        ActivityScenario.launch(MainActivity::class.java).use { }
        assertFalse(hasAlarm("12:30"))
    }

    @Test
    fun explicitScheduleArmsAndDisableClearsAlarm() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals(
                    "OK",
                    activity.handleNative(
                        "aurum://native?cmd=schedule&enabled=1&times=12%3A30",
                        ""
                    )
                )
            }
        }
        assertTrue(hasAlarm("12:30"))

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals(
                    "OK",
                    activity.handleNative(
                        "aurum://native?cmd=schedule&enabled=0&times=12%3A30",
                        ""
                    )
                )
            }
        }
        assertFalse(hasAlarm("12:30"))
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
