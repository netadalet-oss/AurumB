package io.aurum.aurumb

import com.aurum.bistterminal8.MainActivity
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ScrollView
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Native UI evidence plus executable legacy shell-contract assertions. Pixel-reference diff remains a separate acceptance gate. */
@RunWith(AndroidJUnit4::class)
class UiParityEvidenceTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()

    @Test
    fun capturePrimaryPagesAndSettingsWithoutRunningDataOrTradeActions() {
        val argument=InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
        val base=argument?.let{File(it)} ?: File(
            requireNotNull(instrumentation.targetContext.externalMediaDirs.firstOrNull()),
            "additional_test_output"
        )
        val output=File(base,"ui-parity").apply{check(mkdirs() || isDirectory)}
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            assertLegacyShellContract(scenario)
            val primary=listOf("Genel","S","Veriler","Kn","K_Tarihsel","Öğrenme","AI")
            primary.forEachIndexed { index,label ->
                navigate(scenario,label,true)
                if(label=="S") {
                    assertIdleOperationGeometry(scenario,"S’yi Çalıştır","S")
                    assertStatusCards(scenario)
                }
                if(label=="Kn") {
                    assertIdleOperationGeometry(scenario,"Kn’yi Çalıştır","Kn")
                    assertCriteriaStructure(scenario)
                    assertStatusCards(scenario)
                }
                if(label=="Öğrenme") assertLearningStructure(scenario)
                if(label=="AI") assertAiStructure(scenario)
                if(label=="Veriler") {
                    assertIdleOperationGeometry(scenario,"Verileri Güncelle","Veriler")
                    assertDataMarketStrip(scenario,"Verileri Güncelle")
                    assertStatusCards(scenario,false)
                    assertDataPagerStructure(scenario)
                    assertDataEmptyTableContract(scenario)
                }
                if(label=="K_Tarihsel") assertDualOperationGeometry(
                    scenario,"K_Tarihsel’i Çalıştır",setOf("T1–T30’u Yenile / Hesapla")
                )
                capture(scenario,output,"0"+index+"-"+label)
            }
            navigate(scenario,"Genel",true)
            navigate(scenario,"Piyasa Özeti",false)
            assertMarketStructure(scenario)
            assertExactMarketPortalHierarchy(scenario)
            capture(scenario,output,"07-Piyasa Özeti")

            navigate(scenario,"Genel",true)
            navigate(scenario,"Sanal portföy (P)",false)
            assertPortfolioStructure(scenario)
            capture(scenario,output,"08-Portföy")

            navigate(scenario,"Genel",true)
            navigate(scenario,"Ayarlar",false)
            assertSettingsAccordion(scenario)
            capture(scenario,output,"09-Ayarlar")
            val groups=listOf(
                    "Otomatik Güncelleme Zamanlayıcısı",
                    "Sağlık / Süreklilik",
                    "Bildirimler ve Sistem Logları",
                    "Yasaklı Hisseler · Hisse Evreni Filtresi",
                    "Bakım ve Onarım",
                    "Dışa / İçe Aktarma · Tam Yedek",
                    "Uygulama Güncelleme",
                    "AL/SAT Bildirim Teslimi",
                    "API ve AI Ayarları",
                    "Öğrenme, Ağırlık ve Backtest Ayarları",
                    "Veri ve Çalışma Ayarları",
                    "Bildirim Ayarları",
                    "İşlem ve Uygulanabilirlik Ayarları",
                    "Aktarım Hızı ve Sağlayıcı Kontrolü",
                    "Görünüm Ayarları",
                    "Varsayılan Ayarlara Döndür"
                )
            groups.forEachIndexed { index,title ->
                openSettingsGroup(scenario,title)
                capture(scenario,output,"1"+index.toString().padStart(2,'0')+"-Ayarlar-"+index)
            }
        }
    }

    private fun navigate(scenario:ActivityScenario<MainActivity>,label:String,primary:Boolean) {
        val deadline=SystemClock.elapsedRealtime()+8000
        var clicked=false
        while(!clicked && SystemClock.elapsedRealtime()<deadline) {
            instrumentation.waitForIdleSync()
            scenario.onActivity { activity ->
                val views=flatten(activity.findViewById(android.R.id.content))
                val nav=views.filterIsInstance<ViewGroup>().single{it.tag=="primary-navigation"}
                val candidates=if(primary) (0 until nav.childCount).map{nav.getChildAt(it)} else views
                candidates.firstOrNull{it.isClickable && it.contentDescription?.toString()==label}
                    ?.let{it.performClick();clicked=true}
            }
            if(!clicked) SystemClock.sleep(50)
        }
        check(clicked){"Navigation control missing: "+label}
        var ready=false
        while(!ready && SystemClock.elapsedRealtime()<deadline) {
            instrumentation.waitForIdleSync()
            scenario.onActivity { activity ->
                val pageViews=flatten(activity.findViewById(android.R.id.content))
                val texts=pageViews.filterIsInstance<TextView>().map{it.text.toString()}
                val descriptions=pageViews.mapNotNull { it.contentDescription?.toString() }.toSet()
                assertFalse("Native page failed to render: "+label,texts.contains("Ekran yüklenemedi"))
                val pageReady=when(label) {
                    "Genel" -> setOf("Veriler","Kn Tabloları","K_Tarihsel","Piyasa Özeti","Yapay Zekâ Merkezi","Ayarlar","Sanal portföy (P)")
                        .all { it in descriptions }
                    "S","Kn" -> texts.any { it=="Piyasa gerçek veri zamanı" } &&
                        texts.any { it=="Güncelleme zamanı" } &&
                        texts.any { it=="Tabloda son değişiklik zamanı" } &&
                        texts.any { it=="GLN" } && texts.any { it=="GDN" }
                    "Veriler" -> texts.any { it=="Piyasa gerçek veri zamanı" } &&
                        texts.any { it=="Güncelleme zamanı" } &&
                        texts.any { it=="Tabloda son değişiklik zamanı" }
                    "Kriterler" -> "Kn Kriter Tabloları" in texts && "K10" in texts
                    "AI" -> setOf("OpenAI","Günlük kullanım","Son denetim","Aday model","Yönetim","OpenAI Ayarları","Son AI Denetimi","Aday Modeller","AI / Öğrenme Etki Raporu")
                        .all { it in texts }
                    "Öğrenme" -> setOf("Öğrenme","Davranış","50+ Karakter","Performans","Arşiv","Durum","Ayarlar")
                        .all { tab -> pageViews.filterIsInstance<TextView>().any { it.isClickable && it.text.toString()==tab } }
                    "Ayarlar" -> "Otomatik Güncelleme Zamanlayıcısı" in descriptions
                    "Piyasa Özeti" -> "Piyasa Özeti" in texts &&
                        "BİRLEŞTİRİLMİŞ CANLI FİNANS VE GÜNDEM PORTALI" in texts &&
                        "Piyasayı Yenile" in texts
                    else -> true
                }
                ready=!texts.contains("Yükleniyor…") && pageReady
            }
            if(!ready) SystemClock.sleep(50)
        }
        check(ready){"Page still loading: "+label}
    }

    private fun assertStatusCards(scenario:ActivityScenario<MainActivity>,requireGlnGdn:Boolean=true) {
        scenario.onActivity { activity ->
            val texts=flatten(activity.findViewById(android.R.id.content))
                .filterIsInstance<TextView>().map { it.text.toString() }
            check(texts.any { it=="Piyasa gerçek veri zamanı" || it=="TEFAS gerçek veri tarihi" }) {
                "Legacy real-data time row missing"
            }
            check(texts.any { it=="Güncelleme zamanı" }){"Legacy update-time row missing"}
            check(texts.any { it=="Tabloda son değişiklik zamanı" }){"Legacy table-change row missing"}
            if(requireGlnGdn) {
                check(texts.any { it=="GLN" }){"Legacy GLN row missing"}
                check(texts.any { it=="GDN" }){"Legacy GDN row missing"}
            }
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertCriteriaStructure(scenario:ActivityScenario<MainActivity>) {
        val expected=listOf("K1","K2","K3","K4","K5","K6","K7","K8","K9","K10","K11","K12")
        scenario.onActivity { activity ->
            val views=flatten(activity.findViewById(android.R.id.content))
            val texts=views.filterIsInstance<TextView>().map { it.text.toString() }
            check("Kn Kriter Tabloları" in texts){"Kn section title missing"}
            val clickable=views.filterIsInstance<TextView>().filter { it.isClickable }.map { it.text.toString() }.toSet()
            expected.forEach { tab -> check(tab in clickable){"Kn tab missing: "+tab} }
            check("Kn henüz hesaplanmadı." in texts){"Legacy Kn in-table empty state missing"}
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertLearningStructure(scenario:ActivityScenario<MainActivity>) {
        scenario.onActivity { activity ->
            val views=flatten(activity.findViewById(android.R.id.content))
            val clickableTabs=views.filterIsInstance<TextView>()
                .filter { it.isClickable }
                .map { it.text.toString() }
                .toSet()
            listOf("Öğrenme","Davranış","50+ Karakter","Performans","Arşiv","Durum","Ayarlar").forEach { title ->
                check(title in clickableTabs){"Learning tab missing: "+title}
            }
            val texts=views.filterIsInstance<TextView>().map { it.text.toString() }.toSet()
            check("Günlük öğrenme eğilimi" in texts) {
                "Legacy learning trend section missing"
            }
            check("AI / Öğrenme Etki Raporu" in texts) {
                "Learning impact report missing"
            }
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertAiStructure(scenario:ActivityScenario<MainActivity>) {
        scenario.onActivity { activity ->
            val views=flatten(activity.findViewById(android.R.id.content))
            val texts=views.filterIsInstance<TextView>().map { it.text.toString() }.toSet()
            listOf(
                "OpenAI","Günlük kullanım","Son denetim","Aday model","Yönetim",
                "OpenAI Ayarları","AI bağlantısı","Model","OpenAI API Anahtarı",
                "Azami çıktı tokenı","Muhakeme düzeyi","Günlük otomatik denetim",
                "Denetim saati","Aday model üretimi","Asgari bağımsız doğrulama dönemi",
                "Günlük azami ücretli AI çağrısı","Aday için asgari denetim güveni",
                "Son AI Denetimi","Aday Modeller","AI / Öğrenme Etki Raporu"
            ).forEach { title ->
                check(title in texts){"AI legacy presentation item missing: "+title}
            }
            val visibleEditors=views.filterIsInstance<EditText>().filter { it.visibility==View.VISIBLE }
            check(visibleEditors.size>=6) {
                "Legacy B AI page must expose the editable form fields shown by the standalone source"
            }
            listOf("API / AI Ayarları","Ayarları Kaydet","Bağlantıyı Test Et","Günlük Denetimi Çalıştır","Aday Model Üret").forEach { label ->
                check(views.filterIsInstance<TextView>().any { it.isClickable && it.text.toString()==label }) {
                    "Legacy B AI action missing: "+label
                }
            }
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertDataEmptyTableContract(scenario:ActivityScenario<MainActivity>) {
        scenario.onActivity { activity ->
            val views=flatten(activity.findViewById(android.R.id.content))
            check(views.any { it.contentDescription?.toString()=="Yatay kaydırılabilir veri tablosu" }) {
                "B Veriler must keep the canonical table frame mounted in empty state"
            }
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertDataPagerStructure(scenario:ActivityScenario<MainActivity>) {
        scenario.onActivity { activity ->
            val views=flatten(activity.findViewById(android.R.id.content))
            listOf("İlk","Önceki","Sonraki","Son").forEach { label ->
                val button=views.filterIsInstance<TextView>()
                    .first { it.contentDescription?.toString()==label }
                assertEquals("B pager button height "+label,dp(activity,30),button.layoutParams.height)
                assertEquals("B pager button sp "+label,9f,button.textSize/activity.resources.displayMetrics.scaledDensity,0.06f)
            }
            val center=views.filterIsInstance<TextView>()
                .first { it.text.toString().contains("24/sayfa") }
            assertEquals("B pager center sp",10f,center.textSize/activity.resources.displayMetrics.scaledDensity,0.06f)
            if(activity.resources.configuration.screenWidthDp<=560) {
                val first=views.filterIsInstance<TextView>().first { it.contentDescription?.toString()=="İlk" }
                val firstPair=first.parent as View
                val mobileRoot=center.parent as ViewGroup
                check(firstPair.parent===mobileRoot && mobileRoot.indexOfChild(center)<mobileRoot.indexOfChild(firstPair)) {
                    "Mobile legacy pager summary must precede button groups"
                }
            }
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertDataMarketStrip(
        scenario:ActivityScenario<MainActivity>,
        actionLabel:String
    ) {
        scenario.onActivity { activity ->
            val views=flatten(activity.findViewById(android.R.id.content))
            val texts=views.filterIsInstance<TextView>().map { it.text.toString() }.toSet()
            listOf("BIST 100","USD/TRY","EUR/TRY","EUR/USD","Gram Altın","Altın Ons").forEach { name ->
                check(name in texts){"Legacy rebuilt market indicator missing: "+name}
            }
            val refresh=views.filterIsInstance<TextView>()
                .first { it.contentDescription?.toString()=="Piyasa bilgilerini yenile" }
            assertEquals("legacy market refresh width",dp(activity,18),refresh.layoutParams.width)
            assertEquals("legacy market refresh height",dp(activity,18),refresh.layoutParams.height)
            val action=views.filterIsInstance<TextView>()
                .first { it.contentDescription?.toString()==actionLabel }
            check(action.isClickable){"Data primary action is not clickable"}
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertIdleOperationGeometry(
        scenario:ActivityScenario<MainActivity>,
        actionLabel:String,
        scopeLabel:String
    ) {
        val deadline=SystemClock.elapsedRealtime()+8000
        var ready=false
        while(!ready && SystemClock.elapsedRealtime()<deadline) {
            instrumentation.waitForIdleSync()
            scenario.onActivity { activity ->
                val views=flatten(activity.findViewById(android.R.id.content))
                val descriptions=views.mapNotNull { it.contentDescription?.toString() }.toSet()
                ready=views.filterIsInstance<TextView>().any {
                    it.isClickable && it.contentDescription?.toString()==actionLabel
                } && setOf("Baştan başlat","Eksikleri tamamla","İptal","Temizle").all { it in descriptions }
            }
            if(!ready) SystemClock.sleep(50)
        }
        check(ready){"Legacy idle operation controls did not stabilize: "+scopeLabel}
        scenario.onActivity { activity ->
            val views=flatten(activity.findViewById(android.R.id.content))
            val action=views.filterIsInstance<TextView>()
                .first { it.isClickable && it.contentDescription?.toString()==actionLabel }
            val actionCard=action.parent as ViewGroup
            val zone=actionCard.parent as ViewGroup
            assertEquals("legacy operation zone height",dp(activity,50),zone.layoutParams.height)
            assertEquals("legacy operation action card height",dp(activity,50),actionCard.layoutParams.height)
            val texts=views.filterIsInstance<TextView>().map { it.text.toString() }
            check(scopeLabel+" hazır" !in texts){"Idle legacy operation strip must be hidden"}
            listOf("Baştan başlat","Eksikleri tamamla","İptal","Temizle").forEach { name ->
                val control=views.first { it.contentDescription?.toString()==name }
                assertEquals("legacy mini operation height "+name,dp(activity,36),control.layoutParams.height)
            }
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertDualOperationGeometry(
        scenario:ActivityScenario<MainActivity>,
        primaryLabel:String,
        secondaryLabels:Set<String>
    ) {
        val deadline=SystemClock.elapsedRealtime()+8000
        var ready=false
        while(!ready && SystemClock.elapsedRealtime()<deadline) {
            instrumentation.waitForIdleSync()
            scenario.onActivity { activity ->
                val descriptions=flatten(activity.findViewById(android.R.id.content))
                    .filterIsInstance<TextView>()
                    .mapNotNull { it.contentDescription?.toString() }
                    .toSet()
                ready=primaryLabel in descriptions && secondaryLabels.any { it in descriptions }
            }
            if(!ready) SystemClock.sleep(50)
        }
        check(ready){"Legacy K_Tarihsel dual-action row did not stabilize"}
        scenario.onActivity { activity ->
            val views=flatten(activity.findViewById(android.R.id.content))
            val primary=views.filterIsInstance<TextView>()
                .first { it.contentDescription?.toString()==primaryLabel }
            val secondary=views.filterIsInstance<TextView>()
                .first { it.contentDescription?.toString() in secondaryLabels }
            val row=primary.parent as ViewGroup
            check(secondary.parent===row){"Legacy K_Tarihsel actions must share one action row"}
            val actionCard=row.parent as ViewGroup
            val zone=actionCard.parent as ViewGroup
            assertEquals("legacy dual-action row height",dp(activity,30),row.layoutParams.height)
            assertEquals("legacy dual-action primary height",dp(activity,30),primary.layoutParams.height)
            assertEquals("legacy dual-action secondary height",dp(activity,30),secondary.layoutParams.height)
            assertEquals("legacy dual-action card height",dp(activity,50),actionCard.layoutParams.height)
            assertEquals("legacy dual-action zone height",dp(activity,50),zone.layoutParams.height)
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertMarketStructure(scenario:ActivityScenario<MainActivity>) {
        scenario.onActivity { activity ->
            val views=flatten(activity.findViewById(android.R.id.content))
            val texts=views.filterIsInstance<TextView>().map { it.text.toString() }.toSet()
            check("Piyasa Özeti" in texts){"Legacy market heading missing"}
            check("BİRLEŞTİRİLMİŞ CANLI FİNANS VE GÜNDEM PORTALI" in texts){"Legacy combined portal heading missing"}
            listOf("BIST 100","USD/TRY","EUR/TRY","EUR/USD","Gram Altın","Altın Ons").forEach { label ->
                check(label in texts){"Legacy market indicator missing: "+label}
            }
            val refresh=views.filterIsInstance<TextView>().firstOrNull {
                it.isClickable && it.text.toString()=="Piyasayı Yenile"
            }
            check(refresh!=null){"Exact legacy market refresh control missing"}
            check(refresh.contentDescription?.toString()=="Piyasayı Yenile"){"Market refresh accessibility label drifted"}
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertExactMarketPortalHierarchy(scenario:ActivityScenario<MainActivity>) {
        scenario.onActivity { activity ->
            val views=flatten(activity.findViewById(android.R.id.content))
            val texts=views.filterIsInstance<TextView>().map { it.text.toString() }
            check("Piyasayı Yenile" in texts){"Legacy market refresh label missing"}
            check("BİRLEŞTİRİLMİŞ CANLI FİNANS VE GÜNDEM PORTALI" in texts){"Legacy combined portal title missing"}
            check("Birleştirilmiş Finans Portalı" in texts){"Legacy market portal section missing"}
            listOf("Öncelikli Akış","Piyasa","Yorum / Öneri","Ekonomi / Makro","Siyaset","Dünya","Şirket / KAP").forEach { chip ->
                check(chip in texts){"Legacy market category missing: "+chip}
            }
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertPortfolioStructure(scenario:ActivityScenario<MainActivity>) {
        val tabs=listOf("ÖZET","HİSSELER","İŞLEMLER","NAKİT HAREKETLERİ")
        val metrics=listOf("T.KZ","G.K/Z","Başlangıç Sermayesi")
        val deadline=SystemClock.elapsedRealtime()+8000
        var ready=false
        while(!ready && SystemClock.elapsedRealtime()<deadline) {
            instrumentation.waitForIdleSync()
            scenario.onActivity { activity ->
                val texts=flatten(activity.findViewById(android.R.id.content))
                    .filterIsInstance<TextView>().map { it.text.toString() }
                ready=tabs.all { it in texts } &&
                    metrics.all { key -> texts.any { it==key || it.startsWith(key) } }
            }
            if(!ready) SystemClock.sleep(50)
        }
        check(ready){"Portfolio legacy metrics did not stabilize"}
        scenario.onActivity { activity ->
            val texts=flatten(activity.findViewById(android.R.id.content))
                .filterIsInstance<TextView>().map { it.text.toString() }
            tabs.forEach { title -> check(title in texts){"Portfolio tab missing: "+title} }
            metrics.forEach { key ->
                check(texts.any { it==key || it.startsWith(key) }){"Portfolio metric missing: "+key}
            }
        }
        instrumentation.waitForIdleSync()
    }

    private fun openSettingsGroup(scenario:ActivityScenario<MainActivity>,title:String) {
        scenario.onActivity { activity ->
            flatten(activity.findViewById(android.R.id.content))
                .first { it.isClickable && it.contentDescription?.toString()==title }
                .performClick()
        }
        instrumentation.waitForIdleSync()
    }

    private fun assertSettingsAccordion(scenario:ActivityScenario<MainActivity>) {
        val expected=listOf(
            "Otomatik Güncelleme Zamanlayıcısı",
            "Sağlık / Süreklilik",
            "Bildirimler ve Sistem Logları",
            "Yasaklı Hisseler · Hisse Evreni Filtresi",
            "Bakım ve Onarım",
            "Dışa / İçe Aktarma · Tam Yedek",
            "Uygulama Güncelleme",
            "AL/SAT Bildirim Teslimi",
            "API ve AI Ayarları",
            "Öğrenme, Ağırlık ve Backtest Ayarları",
            "Veri ve Çalışma Ayarları",
            "Bildirim Ayarları",
            "İşlem ve Uygulanabilirlik Ayarları",
            "Aktarım Hızı ve Sağlayıcı Kontrolü",
            "Görünüm Ayarları",
            "Varsayılan Ayarlara Döndür"
        )
        val deadline=SystemClock.elapsedRealtime()+8000
        var accordionReady=false
        while(!accordionReady && SystemClock.elapsedRealtime()<deadline) {
            instrumentation.waitForIdleSync()
            scenario.onActivity { activity ->
                val clickable=flatten(activity.findViewById(android.R.id.content))
                    .filter { it.isClickable }
                    .mapNotNull { it.contentDescription?.toString() }
                    .toSet()
                accordionReady=expected.all { it in clickable }
            }
            if(!accordionReady) SystemClock.sleep(50)
        }
        check(accordionReady){"Settings accordion did not stabilize"}
        scenario.onActivity { activity ->
            val views=flatten(activity.findViewById(android.R.id.content))
            val clickable=views.filter { it.isClickable }
                .mapNotNull { it.contentDescription?.toString() }
                .toSet()
            expected.forEach { title ->
                check(title in clickable){"Settings accordion summary missing: "+title}
            }
            listOf(
                "Veri ve Çalışma Ayarları",
                "Aktarım Hızı ve Sağlayıcı Kontrolü",
                "İşlem ve Uygulanabilirlik Ayarları",
                "Öğrenme, Ağırlık ve Backtest Ayarları",
                "API ve AI Ayarları",
                "Bildirim Ayarları",
                "Görünüm Ayarları"
            ).forEach { title ->
                check(title in clickable){"Legacy settings tree group missing: "+title}
            }
            val summaryTexts=views.filterIsInstance<TextView>().map { it.text.toString() }.toSet()
            listOf(
                "Veriler ile Piyasa + Finans/Nederland bağımsızdır · mevcut saatler korunur",
                "Salt okunur · veri, tablo ve snapshot değiştirmez",
                "Önemli olaylar · en fazla 20 + 20 · Pazar 00:00 temizlik",
                "Tek merkez · doğruluk · süreklilik · sorun denetimi · onarım · staging · zamanlayıcı · veri aktarımı",
                "Her değişiklik kalıcı outbox'a yazılır",
                "Çalışma ayarlarını gömülü fabrika değerlerine getirir · kullanıcı verilerini silmez"
            ).forEach { subtitle ->
                check(subtitle in summaryTexts){"Effective legacy settings subtitle missing: "+subtitle}
            }
            expected.forEach { title ->
                val summary=views.first { it.isClickable && it.contentDescription?.toString()==title }
                assertEquals("B settings summary horizontal padding "+title,dp(activity,9),summary.paddingLeft)
                assertEquals("B settings summary vertical padding "+title,dp(activity,8),summary.paddingTop)
                val titleView=flatten(summary).filterIsInstance<TextView>().first { it.text.toString()==title }
                assertEquals("B settings summary title sp "+title,12f,titleView.textSize/activity.resources.displayMetrics.scaledDensity,0.06f)
                val chevron=flatten(summary).filterIsInstance<TextView>().first { it.text.toString()=="⌄" }
                assertEquals("B settings chevron sp "+title,20f,chevron.textSize/activity.resources.displayMetrics.scaledDensity,0.06f)
            }
            listOf("Sorunları Gider / Onarım","Tablo ve Hesaplama Denetimi","Bildirimler ve Loglar · Diğer").forEach { stale ->
                check(stale !in clickable){"Stale settings accordion must not be rendered: "+stale}
            }
            val renderedOrder=views.filter { it.isClickable }
                .mapNotNull { it.contentDescription?.toString() }
                .filter { it in expected }
            check(renderedOrder==expected){"Settings accordion order mismatch: "+renderedOrder}
            fun click(title:String) {
                flatten(activity.findViewById(android.R.id.content))
                    .first { it.isClickable && it.contentDescription?.toString()==title }
                    .performClick()
            }
            click("Yasaklı Hisseler · Hisse Evreni Filtresi")
            val blockedTexts=flatten(activity.findViewById(android.R.id.content))
                .filterIsInstance<TextView>().map { it.text.toString() }.toSet()
            check("Yasaklanacak hisse kodu / kodları" in blockedTexts){"Legacy blocked-instrument field label missing"}
            check("Listeyi Aç" in blockedTexts){"Legacy blocked-instrument list action missing"}
            check("Yasağı Kaldır" !in blockedTexts){"Stale direct unblock action must not be rendered"}
            click("Sağlık / Süreklilik")
            val healthTexts=flatten(activity.findViewById(android.R.id.content))
                .filterIsInstance<TextView>().map { it.text.toString() }
            listOf("Durumu Yenile","Runtime","Son başarılı veri","Aktif snapshot","Doluluk","Piyasa alanları","Son piyasa zamanı","Zamanlayıcı","Bekleyen onarım").forEach { label ->
                check(label in healthTexts){"Legacy health body item missing: "+label}
            }
            listOf("Genel sağlık","Storage","Bakım zamanlayıcısı").forEach { stale ->
                check(stale !in healthTexts){"Native-only health presentation leaked into legacy UI: "+stale}
            }
            var up=flatten(activity.findViewById(android.R.id.content))
                .filterIsInstance<TextView>().count { it.text.toString()=="⌄" && kotlin.math.abs(it.rotation-180f)<0.5f }
            check(up==1){"Exactly one settings section must be open; found "+up}
            click("Yasaklı Hisseler · Hisse Evreni Filtresi")
            up=flatten(activity.findViewById(android.R.id.content))
                .filterIsInstance<TextView>().count { it.text.toString()=="⌄" && kotlin.math.abs(it.rotation-180f)<0.5f }
            check(up==1){"Opening a settings section must close the previous one; found "+up}
            click("Bildirimler ve Sistem Logları")
            val historyTexts=flatten(activity.findViewById(android.R.id.content))
                .filterIsInstance<TextView>().map { it.text.toString() }
            listOf("Geçmişi Temizle","Bildirimler","Sistem Logları").forEach { label ->
                check(label in historyTexts){"Legacy notification history body item missing: "+label}
            }
            listOf("Önemli loglar · en fazla 20 olay","Önemli bildirim teslimleri · en fazla 20 olay","Log ve Bildirimleri Temizle").forEach { stale ->
                check(stale !in historyTexts){"Native-only notification history presentation leaked into legacy UI: "+stale}
            }
        }
        instrumentation.waitForIdleSync()
    }

    private fun capture(scenario:ActivityScenario<MainActivity>,output:File,name:String) {
        var tree=JSONObject()
        scenario.onActivity { activity ->
            val root=activity.findViewById<View>(android.R.id.content)
            flatten(root).filterIsInstance<ScrollView>().firstOrNull()?.fullScroll(View.FOCUS_UP)
            tree=JSONObject().apply {
                put("page",name)
                put("sdk",Build.VERSION.SDK_INT)
                put("density",activity.resources.displayMetrics.density)
                put("fontScale",activity.resources.configuration.fontScale)
                put("tree",viewEvidence(root))
            }
        }
        instrumentation.waitForIdleSync()
        File(output,name+".json").also { it.writeText(tree.toString(2));reportOutput(it) }
        screenshot(File(output,name+".png"))
        scenario.onActivity { activity ->
            flatten(activity.findViewById(android.R.id.content)).filterIsInstance<ScrollView>()
                .firstOrNull()?.fullScroll(View.FOCUS_DOWN)
        }
        instrumentation.waitForIdleSync()
        screenshot(File(output,name+"-end.png"))
    }

    private fun screenshot(file:File) {
        val bitmap=requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        try { file.outputStream().use{check(bitmap.compress(Bitmap.CompressFormat.PNG,100,it))} }
        finally { bitmap.recycle() }
        reportOutput(file)
    }

    private fun reportOutput(file:File) {
        instrumentation.sendStatus(2,Bundle().apply {
            putString("additionalTestOutputFile_"+file.name,file.absolutePath)
        })
    }

    private fun viewEvidence(view:View):JSONObject=JSONObject().apply {
        val location=IntArray(2).also{view.getLocationOnScreen(it)}
        put("class",view.javaClass.simpleName)
        put("x",location[0]);put("y",location[1])
        put("width",view.width);put("height",view.height)
        put("visible",view.isShown);put("clickable",view.isClickable)
        put("description",view.contentDescription?.toString())
        put("padding",JSONArray(listOf(view.paddingLeft,view.paddingTop,view.paddingRight,view.paddingBottom)))
        if(view is TextView && view !is EditText) {
            put("text",view.text.toString())
            put("textSizePx",view.textSize)
            put("lineHeightPx",view.lineHeight)
            put("lineSpacingMultiplier",view.lineSpacingMultiplier)
            put("includeFontPadding",view.includeFontPadding)
            put("letterSpacing",view.letterSpacing)
            put("textColorArgb","%08X".format(view.currentTextColor))
            put("typefaceStyle",view.typeface?.style)
        }
        if(view is ViewGroup) put("children",JSONArray().apply {
            for(i in 0 until view.childCount) put(viewEvidence(view.getChildAt(i)))
        })
    }

    private fun assertLegacyShellContract(scenario:ActivityScenario<MainActivity>) {
        val expectedQuickAccess=setOf("Veriler","Kn Tabloları","K_Tarihsel","Piyasa Özeti","Yapay Zekâ Merkezi","Ayarlar")
        val deadline=SystemClock.elapsedRealtime()+8000
        var shellReady=false
        while(!shellReady && SystemClock.elapsedRealtime()<deadline) {
            instrumentation.waitForIdleSync()
            scenario.onActivity { activity ->
                val clickable=flatten(activity.findViewById(android.R.id.content))
                    .filter { it.isClickable }
                    .mapNotNull { it.contentDescription?.toString() }
                    .toSet()
                shellReady=expectedQuickAccess.all { it in clickable }
            }
            if(!shellReady) SystemClock.sleep(50)
        }
        check(shellReady){"Overview quick-access shell did not stabilize"}
        scenario.onActivity { activity ->
            val root=activity.findViewById<View>(android.R.id.content)
            val views=flatten(root)
            val shellTexts=views.filterIsInstance<TextView>().map { it.text.toString() }
            val fullBrand="AURUM BIST REV 20 · R38 EKONOMİK / PURGED TERMİNAL"
            if(activity.resources.configuration.screenWidthDp<=560) {
                check("AURUM BIST REV 20" in shellTexts){"Legacy mobile B brand name missing"}
                check(fullBrand !in shellTexts){"Legacy terminal label must be hidden at <=560dp"}
                check(shellTexts.none { it.contains("R38 EKONOMİK / PURGED TERMİNAL") }) {
                    "Legacy terminal label leaked into mobile header"
                }
            } else {
                check(fullBrand in shellTexts){"Legacy wide B terminal label missing"}
                val brandView=views.filterIsInstance<TextView>().first { it.text.toString()==fullBrand }
                val spanned=brandView.text as? android.text.Spanned
                    ?: error("Legacy wide B brand must preserve terminal-label span")
                val suffixStart="AURUM BIST REV 20".length
                val suffixColor=spanned.getSpans(
                    suffixStart,
                    spanned.length,
                    android.text.style.ForegroundColorSpan::class.java
                ).firstOrNull()?.foregroundColor
                assertEquals("legacy B terminal-label color",android.graphics.Color.rgb(182,194,211),suffixColor)
            }
            val widthDp=activity.resources.configuration.screenWidthDp
            val compact=widthDp<=720
            val nav=views.filterIsInstance<ViewGroup>().single{it.tag=="primary-navigation"}
            val expectedNavHeight=if(compact)70 else 72
            val expectedNavSide=if(compact)8 else 10
            assertEquals("bottom nav height",dp(activity,expectedNavHeight),nav.height)
            assertEquals("bottom nav left margin",dp(activity,expectedNavSide),(nav.layoutParams as ViewGroup.MarginLayoutParams).leftMargin)
            assertEquals("bottom nav right margin",dp(activity,expectedNavSide),(nav.layoutParams as ViewGroup.MarginLayoutParams).rightMargin)
            val logo=views.first { it.contentDescription?.toString()=="BIST REV 20 logo" }
            val expectedLogo=when {
                widthDp<=420 -> 37
                compact -> 39
                else -> 42
            }
            assertEquals("legacy logo width",dp(activity,expectedLogo),logo.width)
            assertEquals("legacy logo height",dp(activity,expectedLogo),logo.height)
            val topbar=logo.parent as ViewGroup
            assertEquals("legacy topbar left padding",dp(activity,if(compact)10 else 12),topbar.paddingLeft)
            assertEquals("legacy topbar top padding",dp(activity,if(compact)9 else 10),topbar.paddingTop)
            assertEquals("legacy topbar right padding",dp(activity,if(compact)10 else 12),topbar.paddingRight)
            assertEquals("legacy topbar bottom padding",dp(activity,if(compact)9 else 10),topbar.paddingBottom)
            val scroll=views.filterIsInstance<ScrollView>().first()
            val content=scroll.getChildAt(0)
            val expectedPagePad=if(widthDp<=519)7 else 9
            assertEquals("page padding left",dp(activity,expectedPagePad),content.paddingLeft)
            assertEquals("page padding top",dp(activity,expectedPagePad),content.paddingTop)
            assertEquals("page padding right",dp(activity,expectedPagePad),content.paddingRight)
            assertEquals("page padding bottom",dp(activity,expectedPagePad),content.paddingBottom)
            val labels=(0 until nav.childCount).map { item ->
                val group=nav.getChildAt(item) as ViewGroup
                (0 until group.childCount).mapNotNull { group.getChildAt(it) as? TextView }.last()
            }
            labels.forEach { label ->
                assertEquals("bottom nav label sp",if(compact)9f else 9.5f,label.textSize/activity.resources.displayMetrics.scaledDensity,0.06f)
                val item=label.parent as View
                val expectedColor=if(item.contentDescription?.toString()=="Genel") io.aurum.aurumb.ui.UiTokens.GoldStrong else io.aurum.aurumb.ui.UiTokens.Muted
                assertEquals("bottom nav label color",expectedColor,label.currentTextColor)
            }
            assertEquals("legacy background",0xFF00030E.toInt(),io.aurum.aurumb.ui.UiTokens.Background)
            assertEquals("legacy deep background",0xFF00040F.toInt(),io.aurum.aurumb.ui.UiTokens.BackgroundDeep)
            assertEquals("legacy table head",0xFF071738.toInt(),io.aurum.aurumb.ui.UiTokens.TableHead)
            assertEquals("legacy gold",0xFFDFBF59.toInt(),io.aurum.aurumb.ui.UiTokens.Gold)
            assertEquals("legacy table header sp",7.6f,io.aurum.aurumb.ui.UiTokens.TableHeaderSp,0.001f)
            assertEquals("legacy table body sp",8.45f,io.aurum.aurumb.ui.UiTokens.TableBodySp,0.001f)
            assertEquals("legacy table cell padding",6,io.aurum.aurumb.ui.UiTokens.TableCellPadding)
            assertEquals("legacy table row height",30,io.aurum.aurumb.ui.UiTokens.TableRowHeight)
            val clickableDescriptions=views.filter { it.isClickable }
                .mapNotNull { it.contentDescription?.toString() }
                .toSet()
            listOf("Veriler","Kn Tabloları","K_Tarihsel","Piyasa Özeti","Yapay Zekâ Merkezi","Ayarlar").forEach { title ->
                check(title in clickableDescriptions){"Overview quick-access control missing: "+title}
            }
        }
    }

    private fun dp(activity:MainActivity,value:Int):Int =
        (value*activity.resources.displayMetrics.density+0.5f).toInt()

    private fun flatten(view:View):List<View> = buildList {
        add(view)
        if(view is ViewGroup) for(i in 0 until view.childCount) addAll(flatten(view.getChildAt(i)))
    }
}
