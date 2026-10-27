package io.aurum.aurumb.update

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.aurum.bistterminal8.MainActivity
import io.aurum.aurumb.persistence.DatabaseFactory
import io.aurum.aurumb.persistence.AuditEventEntity
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Two separate CI invocations, running against original versionCode 3 and patched versionCode 4:
 * seed proof records, adb install -r the update, then assert all stores and the web origin survived.
 * This deliberately never touches production records or requires network access.
 */
@RunWith(AndroidJUnit4::class)
class UpgradePersistenceTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val key = "cleanroom-v3-to-v4-upgrade-proof"

    private fun webScript(script: String): String {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            fun evaluate(js: String): String {
                val output = AtomicReference<String>("null")
                val done = CountDownLatch(1)
                scenario.onActivity { activity ->
                    val root = activity.findViewById<ViewGroup>(android.R.id.content)
                    val webView = root.getChildAt(0) as? WebView
                    check(webView != null) { "WebView did not start" }
                    webView.evaluateJavascript(js) { result ->
                        output.set(result)
                        done.countDown()
                    }
                }
                assertTrue("WebView JS callback did not finish", done.await(20, TimeUnit.SECONDS))
                return output.get()
            }
            var appOriginReady = false
            repeat(90) {
                if (!appOriginReady) {
                    val state = evaluate("location.origin + '|' + document.readyState")
                    appOriginReady = state.contains("appassets.androidplatform.net|complete")
                    if (!appOriginReady) Thread.sleep(200)
                }
            }
            assertTrue("Aurum appassets origin not ready", appOriginReady)
            assertEquals("\"STARTED\"", evaluate("""
              (function() {
                window.__aurumUpgradeProofResult='PENDING';
                (async function(){
                  const deadline=Date.now()+12000;
                  while(document.readyState!=='complete' && Date.now()<deadline)
                    await new Promise(r=>setTimeout(r,100));
                  $script
                })().then(result=>window.__aurumUpgradeProofResult=result)
                   .catch(error=>window.__aurumUpgradeProofResult='ERROR:'+String(error));
                return 'STARTED';
              })()
            """.trimIndent()))
            repeat(60) {
                val state = evaluate("window.__aurumUpgradeProofResult")
                if (state != "\"PENDING\"") return state
                Thread.sleep(200)
            }
            error("IndexedDB operation did not finish")
        }
    }

    @Test
    fun seedVersion3() {
        assertEquals(3L, installedVersionCode())
        context.getSharedPreferences("aurum-upgrade-proof-v1", Context.MODE_PRIVATE)
            .edit().putString(key, "shared-pref-survives").commit().also { assertTrue(it) }

        context.openOrCreateDatabase("aurum-upgrade-proof.db", Context.MODE_PRIVATE, null).use { db ->
            db.execSQL("CREATE TABLE IF NOT EXISTS test_proof (name TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execSQL("INSERT OR REPLACE INTO test_proof(name,value) VALUES(?,?)",
                arrayOf(key, "sqlite-survives"))
        }

        // Store a real domain row in AurumB's Room database as well as the
        // independent SQLite / SharedPreferences / WebView IndexedDB proof.
        runBlocking {
            DatabaseFactory.get(context).aurumDao().appendAudit(
                AuditEventEntity(
                    id=key,
                    timestampUtc="2026-10-27T20:00:00Z",
                    level="INFO",
                    subsystem="UPGRADE_TEST",
                    operationId=key,
                    code="IN_PLACE_PRESERVATION_PROOF",
                    message="room-row-survives",
                    metadataJson="{}",
                    appVersion="3",
                    modelVersion="test",
                    formulaVersion="test",
                    dataSchemaVersion="test",
                    provenanceJson="{}"
                )
            )
        }

        assertEquals("\"PASS\"", webScript("""
          localStorage.setItem('$key','local-storage-survives');
          return await new Promise((resolve,reject)=>{
            const q=indexedDB.open('aurum-upgrade-proof-idb-v1',1);
            q.onupgradeneeded=()=>{
              if(!q.result.objectStoreNames.contains('values')) q.result.createObjectStore('values');
            };
            q.onerror=()=>reject(q.error);
            q.onsuccess=()=>{
              const db=q.result,tx=db.transaction('values','readwrite');
              tx.objectStore('values').put('indexeddb-survives','$key');
              tx.oncomplete=()=>{db.close();resolve('PASS');};
              tx.onerror=()=>reject(tx.error);
            };
          });
        """.trimIndent()))
    }

    @Test
    fun verifyVersion4() {
        assertEquals(4L, installedVersionCode())
        assertEquals("shared-pref-survives",
            context.getSharedPreferences("aurum-upgrade-proof-v1", Context.MODE_PRIVATE).getString(key, null))

        SQLiteDatabase.openDatabase(
            context.getDatabasePath("aurum-upgrade-proof.db").absolutePath,
            null,
            SQLiteDatabase.OPEN_READONLY
        ).use { db ->
            db.rawQuery("SELECT value FROM test_proof WHERE name=?", arrayOf(key)).use { cursor ->
                assertTrue("SQLite proof row missing after update", cursor.moveToFirst())
                assertEquals("sqlite-survives", cursor.getString(0))
            }
        }
        val roomProof = runBlocking {
            DatabaseFactory.get(context).aurumDao().allAudit().firstOrNull { it.id == key }
        }
        assertEquals("room-row-survives", roomProof?.message)
        assertEquals("IN_PLACE_PRESERVATION_PROOF", roomProof?.code)

        assertEquals("\"PASS\"", webScript("""
          if(localStorage.getItem('$key')!=='local-storage-survives') return 'MISSING_LOCAL_STORAGE';
          return await new Promise((resolve,reject)=>{
            const q=indexedDB.open('aurum-upgrade-proof-idb-v1',1);
            q.onerror=()=>reject(q.error);
            q.onsuccess=()=>{
              const db=q.result,tx=db.transaction('values','readonly');
              const entry=tx.objectStore('values').get('$key');
              entry.onsuccess=()=>{db.close();resolve(entry.result==='indexeddb-survives'?'PASS':'MISSING_INDEXEDDB');};
              entry.onerror=()=>reject(entry.error);
            };
          });
        """.trimIndent()))
    }

    @Suppress("DEPRECATION")
    private fun installedVersionCode(): Long {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode
               else info.versionCode.toLong()
    }
}
