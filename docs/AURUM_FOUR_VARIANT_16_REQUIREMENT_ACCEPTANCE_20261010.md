# Müstakil AurumB — 15 bağlayıcı talep + AL/SAT e-posta parity matrisi

Kayıt: 10.10.2026. Kaynak: netadalet-oss/Aurum, PR #43, docs/AURUMB_15_ADDITIONAL_REQUIREMENTS_20261010.md.

**Bu bir bitiş raporu değil, eksik takip sözleşmesidir.** 03/04 finansal yaşam döngüsü, 05 manuel arşiv ve 13 Reel sırası modülleri AurumB hibritten aktarıldı; cihaz kabulü açık.

## Her gereksinim için aynı kabul zorunluluğu

| No | Bağlayıcı gereksinim | İşlev/test kanıtı | Kabul |
|---|---|---|---|
| 01 | AL/SAT fiyat altı gerçek AL/SAT zamanı | Kodda buyAt/sellAt ve UI doğrula; görsel Android test zorunlu. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 02 | Nederland sekmesi yeniden çizimde NL kalır | Portal seçim durumunu TR→NL→yenile→geri dön testi. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 03 | Zarar-kes satışı belirlenen stop fiyatıyla | Listede, satış defterinde ve portföy muhasebesinde aynı stop; fiyat kaynağı ayrı. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 04 | Joker 2/3 seans ve kâr eşiği dönüşü | Gerçek seans/tatil, kaynak zaman, kâr eşiği kalıcılığı; F için fon NAV işlem takvimi uyarlaması. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 05 | K_Tarihsel 1/5/10 boş T1–T30 doldurma | Yalnız boş satır, yeni→eski, otomatik arşive asla yazma, kesinti geri alma. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 06 | Şifreli tam yedek/geri yükleme | Native + IndexedDB + localStorage + AI + öğrenme + portföy + alarm; round-trip eşitliği ve hata geri al. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 07 | Zamanlayıcı Kaydet / Alarmları Yeniden Kur | Native alarm API gerçek kayıt ve geri okuma; başarısızlığı başarı gösterme. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 08 | Çalışma raporu okunaklı ve taşmasız | Orijinal tasarım, Android26 ve Android35 dar ekran. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 09 | 20 önemli bildirim ve 20 önemli log | Önem ölçütü, gerçek kalıcı depodan taşan eski satır silme. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 10 | Yasaklı varlık bütün aktif modüllerden hariç | Sadece aktif kullanım dışı; tarihsel kanıtı izinsiz silme; kaldırma. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 11 | Tek denetim/onarma merkezi | Eski tüm komutlar işlevsel ve merkezi. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 12 | %70 satır/sütun yeterliliği | Ham tabloda görünür; türev tablo, AI, öğrenme ve işlemde hariç; eşik üzerine çıkınca geri al. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 13 | K1–K7 Reel doğrulanmış kesişim ortalaması | Gerçek kesişim puanı ile sıralama; golden tarih replay. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 14 | Performans ve gezinme | 7 sekme, uzun listeler, Android26/35 frametime ve bellek testi. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 15 | AL/SAT mevcut hisse/fon detay kartı | Yeni kart değil var olan detay kartı, dokunmatik/klavye testi. | **AÇIK – uçtan uca kabul kanıtı eksik** |
| 16 | AL/SAT tam liste ve değişiklik e-postası | İlk görünüm, fiyat/zaman güncellemesi, AL↔SAT, silinme; güvenilir outbox, retry, ACK, relay testi dışında uçtan uca kontrol. | **AÇIK – uçtan uca kabul kanıtı eksik** |

## Kapsam ve güvenlik kuralları

1. Her kod yolunda istenen davranış + dosya + test vakası + CI run + gerçek cihaz kanıtı ayrı izlenecek. Kod varlığı **PASS değildir**.
2. Veri sahipleri: Android Room/SQLite, Legacy IndexedDB/localStorage, sanal portföy, AL/SAT outbox, ham fiyat/NAV, AI öğrenimi, zamanlayıcı. Eksik veri sahibini "FULL BACKUP" diye adlandırma.
3. Resmî imza kimlikleri uygulama başına farklıdır. Müstakil uygulamanın mevcut keystore'u yoksa imzalı uyumlu APK hazır sayılmaz. Yeni key üretme.
4. Eski kullanıcı verisiyle güncelleme round-trip testi yapılmadan var olan telefona kurulum önerilmez.
5. Fon sürümünde BIST seansı/NAV zamanı ayrımı korunur; hisseye özgü hesaplayıcı fonlara doğrudan kopyalanmaz.
6. Uçtan uca e-posta testi, gerçek liste değişimi ve relay teyidini ayrı ayrı değerlendirir. "Relay Testi SUCCESS" tek başına kabul değildir.
7. İşin tamamı kabul edilene kadar yayımlama ve ana dal birleştirme kararı ayrı kayda bağlanır.

## Sonraki incelemeler için kanıt alanları

Her satırda dosya yolu, HEAD SHA, regresyon testi, Android26/35 run ID, veri bütünlüğü/geri alma testi ve kullanıcı onayı durumu doldurulacak. Boş alan = **doğrulanmadı**.
