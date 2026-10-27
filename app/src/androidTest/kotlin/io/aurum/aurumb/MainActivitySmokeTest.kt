package io.aurum.aurumb

import com.aurum.bistterminal8.MainActivity
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import android.widget.EditText
import io.aurum.aurumb.settings.SettingsRepository
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.aurum.aurumb.persistence.DatabaseFactory
import io.aurum.aurumb.persistence.SignalEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class MainActivitySmokeTest {
    @Test
    fun launchesAndRendersOverviewWithoutCrash() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            scenario.onActivity { activity ->
                assertFalse(activity.isFinishing)
                assertTrue("Configured NoActionBar theme was not applied",activity.actionBar==null)
                val root=activity.findViewById<View>(android.R.id.content)
                assertNotNull(root)
                assertTrue(root.isShown)
            }
        }
    }

    @Test
    fun nederlandPortalChoiceRemainsUserControlled() {
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val repo=SettingsRepository(context)
        val previous=repo.load().first.getValue("marketPortal")
        assertTrue(repo.put("marketPortal","NL"))
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                clickWhenRendered(scenario,"Piyasa Özeti")
                waitForText(scenario,"Nederland · Laatste nieuws")
                assertEquals("NL",repo.load().first["marketPortal"])
            }
        } finally {
            assertTrue(repo.put("marketPortal",previous))
        }
    }

    @Test
    fun persistedBuySignalAppearsOnOverview() {
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val dao=DatabaseFactory.get(context).aurumDao()
        val symbol="TST"+UUID.randomUUID().toString().replace("-","").take(4).uppercase()
        runBlocking {
            dao.appendSignal(
                SignalEntity(
                    id="ui-test-"+UUID.randomUUID(),
                    instrument=symbol,
                    signal="BUY",
                    signalTimeUtc="2099-10-02T00:00:00Z",
                    effectiveEntryTimeUtc="2099-10-02T00:00:00Z",
                    entryBasis="100",
                    reasonsJson="[\"TEST\"]",
                    contributionsJson="[]",
                    confidenceDecimal="0.8",
                    marketRegime="TEST",
                    dataFreshness="LIVE",
                    invalidationCondition="test",
                    targetHorizon="SHORT_TERM",
                    appVersion="test",
                    modelVersion="test",
                    formulaVersion="test",
                    dataSchemaVersion="15"
                )
            )
        }

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val instrumentation=InstrumentationRegistry.getInstrumentation()
            var found=false
            repeat(50) {
                instrumentation.waitForIdleSync()
                scenario.onActivity { activity ->
                    found=allTexts(activity.findViewById(android.R.id.content))
                        .any{text->text.contains(symbol)}
                }
                if(found) return@repeat
                Thread.sleep(100)
            }
            assertTrue("Persisted BUY signal did not become visible on overview",found)
        }
    }

    @Test
    fun policySettingCanBeEditedAndPersisted() {
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val repo=SettingsRepository(context)
        assertTrue(repo.put("maxStopLossPct","3"))

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val instrumentation=InstrumentationRegistry.getInstrumentation()
            clickWhenRendered(scenario,"Bildirimler ve günlük")
            var saved=false
            repeat(60) {
                instrumentation.waitForIdleSync()
                scenario.onActivity { activity ->
                    val root=activity.findViewById<ViewGroup>(android.R.id.content)
                    val editor=findViews(root).filterIsInstance<EditText>()
                        .firstOrNull{it.contentDescription?.toString()=="maxStopLossPct"}
                    val save=findViews(root).filterIsInstance<TextView>()
                        .firstOrNull{it.isClickable && it.text.toString()=="Kaydet · maxStopLossPct"}
                    if(editor!=null && save!=null) {
                        editor.setText("2.5")
                        save.performClick()
                        saved=true
                    }
                }
                if(saved) return@repeat
                Thread.sleep(100)
            }
            assertTrue("Editable maxStopLossPct control was not rendered",saved)
        }
        assertEquals("2.5",repo.load().first["maxStopLossPct"])
        assertTrue(repo.put("maxStopLossPct","3"))
    }

    @Test
    fun primaryNavigationMatchesForensicSevenTabContract() {
        val expected=listOf("Genel","S","Veriler","Kn","K_Tarihsel","Öğrenme","AI")
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            scenario.onActivity { activity ->
                val root=activity.findViewById<ViewGroup>(android.R.id.content)
                val nav=findViews(root).filterIsInstance<ViewGroup>()
                    .single{it.tag=="primary-navigation"}
                assertEquals(expected,(0 until nav.childCount).map {
                    nav.getChildAt(it).contentDescription?.toString()
                })
                val texts=allTexts(root)
                assertTrue(texts.any{it.contains("AURUM BIST REV 20")})
            }
        }
    }

    private fun clickWhenRendered(scenario:ActivityScenario<MainActivity>,description:String) {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val deadline=SystemClock.elapsedRealtime()+6000
        while(SystemClock.elapsedRealtime()<deadline) {
            instrumentation.waitForIdleSync()
            var clicked=false
            scenario.onActivity { activity ->
                findViews(activity.findViewById(android.R.id.content)).firstOrNull {
                    it.isClickable && it.contentDescription?.toString()==description
                }?.let { it.performClick(); clicked=true }
            }
            if(clicked) return
            SystemClock.sleep(50)
        }
        throw AssertionError("Clickable control was not rendered: "+description)
    }

    private fun waitForText(scenario:ActivityScenario<MainActivity>,expected:String) {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val deadline=SystemClock.elapsedRealtime()+6000
        while(SystemClock.elapsedRealtime()<deadline) {
            instrumentation.waitForIdleSync()
            var found=false
            scenario.onActivity { activity ->
                found=allTexts(activity.findViewById(android.R.id.content)).any{it.contains(expected)}
            }
            if(found) return
            SystemClock.sleep(50)
        }
        throw AssertionError("Expected page content was not rendered: "+expected)
    }

    private fun findViews(view:View):List<View> = buildList {
        add(view)
        if(view is ViewGroup) {
            for(i in 0 until view.childCount) addAll(findViews(view.getChildAt(i)))
        }
    }

    private fun findButtons(view:View):List<Button> = buildList {
        if(view is Button) add(view)
        if(view is ViewGroup) {
            for(i in 0 until view.childCount) addAll(findButtons(view.getChildAt(i)))
        }
    }

    private fun allTexts(view:View):List<String> = buildList {
        if(view is TextView) add(view.text.toString())
        if(view is ViewGroup) {
            for(i in 0 until view.childCount) addAll(allTexts(view.getChildAt(i)))
        }
    }
}
