package io.aurum.aurumb

import android.view.ViewGroup
import android.widget.TextView
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.aurum.bistterminal8.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Device-level smoke for the real APK WebView, not the superseded native-view mocks.
 * Read-only: does not start providers, calculations, scheduled jobs or alter IndexedDB.
 */
@RunWith(AndroidJUnit4::class)
class AurumWebViewStabilityTest {
    private fun eval(scenario: ActivityScenario<MainActivity>, script: String): String {
        val done = CountDownLatch(1)
        val result = AtomicReference<String>("null")
        scenario.onActivity { activity ->
            val root = activity.findViewById<ViewGroup>(android.R.id.content)
            val view = root.getChildAt(0) as? WebView
            check(view != null) { "Expected foreground WebView rather than renderer-crash fallback" }
            view.evaluateJavascript(script) { answer ->
                result.set(answer)
                done.countDown()
            }
        }
        check(done.await(15, TimeUnit.SECONDS)) { "JavaScript callback timed out" }
        return result.get()
    }

    @Test
    fun tabsReactAndVerilerNeverMaterializesTheFullWideGrid() {
        val versionMajor = WebView.getCurrentWebViewPackage()?.versionName?.substringBefore('.')?.toIntOrNull()
        if (versionMajor != null && versionMajor < 80) {
            // Android API 26 system images can bundle Chromium too old to parse ES2020.
            // Verify an actionable, non-destructive compatibility screen instead of a blank tab.
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { activity ->
                    val root = activity.findViewById<ViewGroup>(android.R.id.content)
                    val panel = root.getChildAt(0) as? ViewGroup
                    val description = (0 until (panel?.childCount ?: 0))
                        .mapNotNull { panel?.getChildAt(it) as? TextView }
                        .joinToString(" ") { it.text.toString() }
                    assertTrue("Old WebView must display upgrade instructions", description.contains("çok eski"))
                    assertTrue("Local data must not be cleared", description.contains("silinmedi"))
                }
            }
            return
        }
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var ready = false
            repeat(60) {
                if (!ready) {
                    ready = eval(scenario, "typeof goPage === 'function' && !!document.querySelector('.bottom-nav')") == "true"
                    if (!ready) Thread.sleep(300)
                }
            }
            assertTrue("Aurum UI scripts did not initialize", ready)

            val dataTab = eval(scenario, """
                (() => {
                    const nav = document.querySelector('.bottom-nav button[data-page="data"]');
                    if (!nav) return false;
                    nav.click();
                    const title = document.querySelector('#content');
                    const head = document.querySelectorAll('#dataTable thead th');
                    return title?.dataset.page === 'data' && head.length > 0 && head.length <= 20;
                })()
            """.trimIndent())
            assertEquals("The data tab should respond and build at most 20 table columns", "true", dataTab)

            assertEquals("Column paging must never hide symbol and market time", "true",
                eval(scenario, """
                    (() => {
                        const h1 = Array.from(document.querySelectorAll('#dataTable thead th')).map(x=>x.textContent);
                        if (!h1.includes('Hisse') || !h1.includes('Veri Zamanı')) return false;
                        const next = document.querySelector('.aurum-column-pager button:last-child');
                        if (!next || next.disabled) return false;
                        next.click();
                        const h2 = Array.from(document.querySelectorAll('#dataTable thead th')).map(x=>x.textContent);
                        return h2.length <= 20 && h2.includes('Hisse') && h2.includes('Veri Zamanı')
                            && h1.join('|') !== h2.join('|');
                    })()
                """.trimIndent()))

            assertEquals("Other tabs must stay usable after a Veriler table render", "true",
                eval(scenario, """
                    (() => {
                        const general = document.querySelector('.bottom-nav button[data-page="overview"]');
                        general?.click();
                        return document.querySelector('#content')?.dataset.page === 'overview';
                    })()
                """.trimIndent()))
        }
    }
}
