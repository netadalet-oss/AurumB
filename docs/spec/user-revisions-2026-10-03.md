# Birleşik kullanıcı revizyon sözleşmesi — 2026-10-03

Bu belge, devir talimatnamesinden sonra kullanıcı tarafından verilen ek talimatların tek kanonik sözleşmesidir. Devir talimatnamesindeki fail-closed, point-in-time, provenance, temiz-oda ve exact-head doğrulama hükümleri yürürlüktedir; bu belgedeki daha yeni açık kullanıcı talimatları önceki kullanıcı tercihleriyle çeliştiğinde yeni talimat uygulanır.

## 1. Veriler yayını, kalite kapısı ve downstream freeze

- Ana veri aktarımı kalite merdiveni Ayarlar'dan düzenlenebilir beş azalan eşikten oluşur; varsayılan 100 → 95 → 90 → 80 → 70'tir.
- En yüksek sağlanan eşik kabul edilir; kabulden sonra daha düşük basamaklar denenmez.
- Ham Veriler aktarım sonunda kalite alt eşiğinin altında kalsa dahi persist edilir ve yayınlanır.
- Kalite alt eşiği sağlanmadığında Kn, K_Tarihsel, S/F, AL/SAT, portföy, öğrenme, AI ve diğer downstream sahipleri önceki doğrulanmış snapshot'larını ve kendi zaman damgalarını korur; boşaltılmaz veya yeni ham publication zamanına taşınmaz.
- Otomatik zamanlayıcı sonucu retry/failure yerine açıklayıcı SUCCEEDED_WITH_NOTE/downstream-freeze notu taşır.
- Hücre doluluk kapısı tablo, satır ve sütun için ayrı uygulanır. Kullanıcı eşiği varsayılan %70'tir ve strictly greater-than semantiği kullanır: tam eşik yeterli değildir.
- Satır eşiği aşmıyorsa enstrüman/fon hesaplama evreninde yok sayılır; sütun eşiği aşmıyorsa o feature bütün downstream hesaplarında maskelenir. Ham veri yine saklanabilir/gösterilebilir.
- Kalite kapısı, hücre doluluk kapısı ve ilgili eşikler Ayarlar'dan kullanıcı tarafından değiştirilebilir ve yeni çalışmalara anında uygulanır.

## 2. Otomatik ve manuel pipeline sahipliği

- Otomatik zamanlayıcıyla kesinleşen Veriler publication'ından sonra sıra zorunludur: Veriler → Kn → K_Tarihsel → S; AurumF final seçim sahibi F'dir.
- Her stage yalnız aynı source-data publication'a ait predecessor tamamlandıysa çalışabilir.
- Manuel Veriler aktarımı Kn/K_Tarihsel/S/F'yi otomatik çalıştırmaz.
- Manuel downstream stage'ler ayrıca kullanıcı tarafından tetiklenir; tetiklenmeyen stage'in eski verisi ve timestamp'i korunur.

## 3. Ana aktarım sonrası Eksikleri Tamamla

### AurumB
- Ana aktarımın kesinleşmesinden 30 dakikadan fazla zaman geçtiyse repair bütün Veriler tablosunu baştan çeker.
- Ana aktarım son 30 dakika içindeyse yalnız eksik hücre/satırlar ile veri/evidence timestamp'i 30 dakikadan eski olan hedefler yenilenir.
- Tam 30 dakika sınırı targeted repair tarafındadır; receive/transport zamanı veri zamanının yerine kullanılamaz.

### AurumF
- 30 dakika kuralı uygulanmaz.
- Günlük/current fon verilerinde aynı fon zaman dilimi/gün yeterlidir.
- Tabloda karışık/null latest fund date varsa ilgili current/day window tam refetch edilir; bütün latest tarihler aynı günse yalnız eksikler tamamlanır.
- Uzun vadeli teknik, tarihsel ve dönemsel metrikler bu intraday/same-day eşzamanlılık kuralına tabi değildir.

Repair/time-coherence kararı downstream eligibility ölçütü değildir. Main+repair tamamlandıktan sonra downstream sahipleri Veriler'i, ayrıca kalite/completeness kapıları açık olduğu sürece kullanabilir.

## 4. AL/SAT, stop ve e-posta teslimi

- AL/SAT yalnız persisted qualified lifecycle olaylarından doğar; S/F üyeliği doğrudan trade değildir.
- Stop-loss, teknik stop ve profit-lock parametrelerinin tamamı Ayarlar'dan düzenlenebilir. Varsayılan sözleşme %3 max-loss, ATR/fallback/support teknik stop ve +5/+10/+20… peak lock davranışıdır.
- Stop-loss profit-lock'tan önce değerlendirilir; high-water/tier/stop/evidence zamanları persist edilir; işlemler idempotent/restart-safe kalır.
- AL/SAT listelerinde değişiklik olduğunda Ayarlar'daki e-posta hedefi için idempotent outbox oluşur; payload güncel aktif AL listesi, o run'ın SAT listesi ve aktif portföy holdings'i taşır.
- Relay tokenları Android Keystore dışında düz metin tutulmaz.

## 5. Referans APK arayüz ve davranış parity'si

- Sağlanan AurumB/AurumF referans APK'ları temiz-oda forensik kaynaktır; legacy JS/WebView runtime çalıştırılmaz.
- Sekmeler, tablolar, modüller, renkler, gradientler, ikonlar, logo, font ölçüleri/ağırlıkları, spacing, radius, opacity, top/bottom bar ölçüleri, tablo cell ölçüleri ve responsive eşikler sayısal/kod düzeyinde referanstan taşınır.
- Revizyon/iyileştirme talepleri dışında çalışma şekli, manuel/otomatik düğmeler, ikon/aksiyonlar, scheduler ve Ayarlar davranışı referansla korunur.
- Ürün ayrımları korunur: AurumB ve AurumF header sırası, marka, scheduler profili ve AI/meta semantiği birbirine zorla eşitlenmez.

## 6. Kriter ve formül sahipliği

- Karar kriterlerinin ana ekseni, ağırlık/hesap sırası ve referans çalışma koşulları korunur; yalnız kanıtlanmış missing-evidence fabrication, look-ahead, fail-open, çelişki veya sayısal kararsızlık düzeltilir.
- Eksik kanıt nötr/sahte veriyle tamamlanmaz.
- AurumB K1–K7 karar; K8–K12 meta/diagnostic/memory/behavior katmanları sıfır karar ağırlığıyla ayrı kanıt taşır. K10 effective reward/penalty memory, K11 davranış karakteri, K12 davranış/genome + K10 hafızasıdır.
- AurumF K1–K7 karar; K8–K10 meta/diagnostic/learning katmanları bağımsız F koltuğu/AL-SAT hakkı vermez.

## 7. Ayarlar ve kullanıcı inisiyatifi

- Kullanıcı tarafından zamanla değiştirilebilir bütün runtime tercihleri Ayarlar'da bir owner üzerinden düzenlenebilir ve kaydetme sonrası doğru sisteme anında uygulanır.
- Kapsam; kalite/completeness eşikleri, transfer ladder, stop/profit-lock/technical-stop, portföy parametreleri, scheduler aktiflik/saatleri, portal tercihi, AL/SAT e-posta/relay, öğrenme/AI bütçeleri ve desteklenen kullanıcı tercihleridir.
- Ayarlar mevcut referans tasarım dili/ölçülerini bozmadan genişletilir.
- Scheduler Kaydet ve Kur / Alarmları Yeniden Kur / Varsayılana dön, manuel Veriler/Kn/K_Tarihsel/S-F/Piyasa aksiyonları ve ürün özel default slotları korunur.

## 8. Arka plan dayanıklılığı

- Veri sync, repair, manuel pipeline stage, audit, öğrenme/model değerlendirme ve portal refresh WorkManager + foreground dataSync owner'larıdır.
- Export, import, tam yedek, tam geri yükleme ve deklaratif runtime patch de foreground/expedited WorkManager'a devredilir.
- Process death/reboot/time change durumunda state recovery ve scheduler yeniden kurulum uygulanır.
- Uygulama task'ı kapansa veya kullanıcı başka uygulamaya geçse work owner Activity değildir.
- Android'in kullanıcı tarafından verilen Force stop durumu işletim sistemi kısıtıdır; hiçbir uygulama bu durumda kendi kendine çalışmayı sürdüremez.
- Backup/restore parolaları WorkManager Data'ya yazılmaz; tek-kullanımlık Android Keystore sırları worker sonunda silinir, stale sırlar temizlenir ve bu geçici sırlar yedek paketine alınmaz.

## 9. K_Tarihsel T0–T30

- Her satırın KnTOPn ve ReelTOPn verisi kendi tarih/timestamp kanıtını taşır.
- T0 KnTOPn canlı Kn tablosunun aynasıdır; T0 ReelTOPn aynı günün canlı Reel listesidir.
- Bir sonraki piyasa gününe ait gerçek persisted Veriler kanıtı oluştuğunda eski T0 Kn bir alt satıra arşivlenir; zincir T1→…→T30 olarak kayar ve T30 sonrası kırpılır.
- T1–T30'da ReelTOPn, ilgili Kn gününün d+1 Reel sonucudur.
- Yeni gün Reel listesi oluşurken T0 ve T1 aynı canlı d+1 Reel listesini gösterebilir; liste kesin topN oluşmadan tarihsel hit agregasyonuna girmez.
- KnTOPn isabeti aynı satırdaki ReelTOPn ile karşılaştırılır.

## 10. Dışa/içe aktarma, güncelleme ve tam yedek

- Uygulama veri tabloları ve persisted rapor/audit/öğrenme/AI kaynakları JSON, XLSX, CSV, TXT ve PDF olarak dışa aktarılabilir.
- Kullanıcı SAF ile hedef klasör seçer, aktarılacak tabloları seçebilir, tümünü seçebilir/seçimi temizleyebilir ve tek paket veya tablo başına ayrı dosya kullanabilir.
- Uygulamanın ürettiği beş format gömülü kayıpsız payload ile transaction kontrollü geri içe alınabilir; checksum/şema/ürün/table-column doğrulaması yapılır.
- Güvenli deklaratif AURUM_RUNTIME_PATCH_V1 paketi ayar/scheduler/veri düzeltmesi yapabilir; keyfi AI tarafından üretilmiş executable code çalıştırılmaz.
- Derlenmiş yazılım değişikliği aynı package + aynı signer + downgrade korumalı APK ile Android yerinde güncelleme yolundan yapılır; uninstall gerekmez.
- Tam yedek parola ile PBKDF2-HMAC-SHA256 + AES-GCM korunur; DB, Settings, scheduler, AL/SAT relay, kalıcı Keystore sırları ve export kullanıcı tercihleri restore edilir.
- Tek-kullanımlık backup/restore passphrase sırları yedeğe girmez.
- SAF klasör izni Android tarafından uninstall'da silindiği için yeniden kurulum sonrası kullanıcı klasörü bir kez yeniden seçer.

## Doğrulama durumu

Bu sözleşmenin yukarıdaki owner'ları kaynak kodda uygulanmıştır. Nihai kabul, yalnız branch HEAD'iyle birebir aynı SHA üzerinde CI + emulator/device smoke başarılı olduğunda yapılır. 2026-10-03 itibarıyla GitHub Actions yeni run'larda job yaratıp hiç step başlatmadan (steps=[], log blob yok) failure ile kapanmaktadır. Bu nedenle son HEAD'ler için CI yeşil iddiası yoktur; runner/Actions engeli kalkınca exact-head doğrulama yeniden çalıştırılmalıdır.
