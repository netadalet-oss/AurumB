# R7 kaynak eşitleme — 15 Ekim 2026

Bu çalışma Aurum R7 test APK davranışının GitHub kaynaklarına güvenli aktarımıdır.

## Ortak düzenlemeler
- AL listesi artık en güncel işlem zamanından en eskiye sıralanır; SAT yeni→eski.
- K_Tarihsel KnTrend yalnız K1–K7 değerini, HER SATIRIN kendi `hitCount/total` isabetine göre sıralar; reel getiriyle tie-break yapılmaz.
- Veriler > Veri Zamanı: başlık/hücre tespitiyle 205 px varsayılan, Ayarlar üzerinden 170–360 px değiştirilebilir genişlik ve yatay kaydırma.
- Ayarlar: Veri/Kaynak, İşlem/Risk, Kriter/Öğrenme, Zamanlama ve diğer basit düzenlenebilir alanlar kendi kapalı akordeon menülerinde.
- Eksik tamamlama: ana aktarım sonrası 1 zorunlu eksik-odaklı tur; sonraki 4 tur yalnız sırasıyla %95, %90, %80, %70 eşiği karşılanmazsa açılır. 30 dakika kontrolü sadece tur açılacaksa uygulanır.
- UI kaynakları `app/src/main/assets/aurum-r7-github.js` ve CSS üzerinden yüklenir.

## Depoya özel
- **AurumB:** Tamamlama algoritması runtime içinde; OpenAI API Android güvenli anahtar köprüsü ile mevcut.
- **AurumF:** Ana fon aktarma işlemi sonrası eksik tamamlama sarmalayıcısı; `activeProfitLockPct=null` yanlışlıkla %0 sayılmaz.

## Sınırlar
Bu değişiklikler ChatGPT hesabıyla doğrudan OAuth oturum açmayı veya AI'nin APK'yi kendi başına imzalayıp kurmasını sağlamaz. Bunun için kayıtlı OAuth istemcisi ve güvenli dağıtım altyapısı gerekir.
Fon Ayarlar'ındaki ChatGPT bağlantısı kullanıcıyı ChatGPT sayfasına yönlendirir; API yetkisi vermez.
APK'ler bu PR'de ayrıca oluşturulmadı. Android cihaz/gerçek veri servisleriyle uçtan uca test bu PR kapsamında yapılmadı.
