# Müstakil AurumB — 15 bağlayıcı talep + AL/SAT e-posta devralma ve doğrulama matrisi

**Tarih:** 2026-10-10. **Kaynak:** `netadalet-oss/Aurum` içindeki `docs/AURUMB_15_ADDITIONAL_REQUIREMENTS_20261010.md`, kullanıcı devir talimatı ve GitHub kaynak incelemesi.

**Uyarı:** Tablo bir kabul sertifikası değildir. “Kod var” ifadesi Android gerçek cihazda işlev doğrulaması anlamına gelmez. Uygulamanın kendi paket kimliği, sürüm numarası, imzası, SQLite/IndexedDB anahtarları ve kullanıcı kayıtları korunacaktır. Kod farklı paketleri birbirine eşdeğer APK yapmaz. Tüm değişiklikler PR/branş geçmişiyle izlenir; veri silinmez ve eksik imzalama anahtarı yerine yeni anahtar oluşturulmaz.

| Kimlik | Bağlayıcı davranış | İnceleme yeri | Kaynağa göre gerçek durum / açık kabul | Kanıt için yapılacak test |
|---|---|---|---|---|
| 01 | AL/SAT küçük, etiketsiz giriş/çıkış zamanı | `runtime.js liste kartı + styles.css` | Birleşik AurumB ile aynı sürüm değil; UI cihaz kabulü açık | AL ve SAT olayı başlangıç saatinin cihazda karşılaştırılması |
| 02 | Nederland seçiminin yeniden çizimde korunması | `netherlands-news-portal.js` | Portal mevcut; yeniden çizim testi açık | NL → yenileme → sekme değişimi → NL geri dönüş |
| 03 | Zarar-kes satışının stop fiyatıyla kaydı | `runtime.js + sanal portföy defteri` | Stop ve portföy sözleşmesi bağımsız teyit edilecek | SAT ekranı, muhasebe, tekrar açılış ve kaynak gözlemi |
| 04 | Joker 2/3 gerçek seans/NAV kuralı | `runtime.js yaşam döngüsü` | Birleşik AurumB gerçek-seans Joker kodu bütünüyle eşlenmedi; açık | Resmî BIST/fon NAV günleri, tatiller, ilk eşik zamanı ve idempotency |
| 05 | K_Tarihsel 1/5/10 boşluk doldurma | `k-tarihsel.js veya runtime.js` | T1–T30 mantığı var; 1/5/10+AUTO karşılaştırması açık | Yalnız boş T1–T30, yeni→eski, AUTO arşiv üzerine yazılamaz |
| 06 | Eksiksiz Native+Legacy+AI yedek/restore | `Native backup / IndexedDB / localStorage` | Eksik; tam Native+Legacy+AI restore yok | Ayrık veri sahipleri, şifreleme, atomik round-trip, rollback |
| 07 | Zamanlayıcı Kaydet ve Alarmları Yeniden Kur | `scheduler-settings.js + Native alarm kayıtları` | Native alarm gerçek tetik testi açık | Android alarm kimliği ve gerçek tetik; hata mesajı |
| 08 | İlk görünüme sadık kompakt çalışma raporu | `scheduler-settings.js + styles.css` | Dar ekran görsel kanıt açık | Android 26/35 ve dar ekran görüntü farkı |
| 09 | Yalnız 20 önemli bildirim ve 20 önemli log | `core.js + Native/Legacy depolar` | Kalıcı depoda 20/20 yük testi açık | 1000+ eski kayıt ve kalıcı kayıt temizliği |
| 10 | Yasaklı enstrümanın tüm aktif evrenden çıkarılması | `blocked-universe + hesap motoru + AI` | Aktif evren/AI kapsam testi açık | Tüm veri sahipleri, devreden çıkar/geri al, tarihsel kanıtın saklanması |
| 11 | Tek denetim ve onarım modülü | `ayarlar ve bakım modülleri` | Bakım butonu fonksiyon matrisi açık | Tüm eski eylemler birebir işlev ve veri güvenliği |
| 12 | %70 veri kalitesi tek politikası | `Veriler + türev/AI/öğrenme/portföy` | Tüm hesap yollarında %70 denetimi açık | Düşük kalite yalnız Veriler'de; sonraki güncellemede yeniden kabul |
| 13 | K1–K7 Reel doğrulanmış ortalama sıralaması | `K_Tarihsel sıralama modülü` | Reel sıralaması var; golden replay açık | Golden historical replay, boş hücre ve arşiv kökeni |
| 14 | Sekme ve navigasyon performansı | `render/observer/scroll` | Cihaz frametime açık | Cihaz frametime, bellek ve yedi sekme UX |
| 15 | AL/SAT satırından mevcut enstrüman kartı | `runtime.js mevcut detay kartı` | Mevcut hisse kartı bağının cihaz testi açık | Dokunma/Enter/Space ve ekran eşdeğerliği |
| 16 | AL/SAT tam liste ve değişikliklerinin e-postası | `runtime.js kalıcı outbox + Native Apps Script relay` | Birleşik AurumB ile e-posta kaynak modülü birebir; gerçek relay teslimi açık | Başlangıç liste, fark, hata, yeniden deneme, sunucu SENT teyidi |

## Kaynak ve eşleştirme ilkeleri

- Önce veriyi koru; var olan IndexedDB, localStorage, Room, AI öğrenmesi, işlem geçmişi ve zamanlayıcı anahtarlarını yeniden adlandırma veya silme.
- Birleşik AurumB için orijinal sertifika SHA-256 `75eb737446685179ac02b4c17eb4b29c4b978933971e82309f2a1886230047a1`. Müstakil AurumB kendi imza kimliğini korumalıdır; farklı paketlerin APK'leri birbirine güncelleme diye sunulmaz.
- AurumB'nin “hisse/Joker BIST seansı” davranışı AurumF'de “fon/NAV yayın günleri” karşılığıyla **finansal olarak uyarlanmalı**, BIST saatleri fonlara yanlış taşınmamalıdır.
- 01–15 talepleri yeni sürüm için beraber geçerli. 16 numara relay TEST geçip gerçek listenin gitmemesi yeni kullanıcı hatasıdır; bağlantı testi gönderim başarı kanıtı değildir.
- AL/SAT e-posta kapsamı: tam aktif AL/SAT listesi, eklenen/çıkarılan enstrümanlar, değişen işlem fiyatı/zamanı, idempotent olay, kalıcı outbox, ağ hatasında tekrar deneme ve gerçek `SENT`/`ALREADY_SENT` teyidi. Gerçek alıcı testi gerekiyorsa kullanıcının izin verdiği test hesabı kullanılmalı; onaysız gerçek e-posta gönderilmemelidir.
- 06 numara tüm Legacy/AI verilerini kapsamadığı sürece “tam yedek” denilemez ve kurulum/güncelleme veri koruma kabulü tamamlanmış sayılamaz.

## Kabul durumunu güncelleme kuralı

Her satır için ileride ilgili dosya/commit, Android cihaz/run numarası, regresyon testi, açık hata ve gerekiyorsa kullanıcı onayı eklenmeli. **Bu belgenin yazılması işlevin tamamlandığını göstermez.**
