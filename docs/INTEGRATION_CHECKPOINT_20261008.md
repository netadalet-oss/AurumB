# Kesinti güvenli entegrasyon kontrol noktası / 2026-10-08

**Uygulama:** AurumB Standalone Legacy

## Değişmez kaynak temel
- Last released/verified base commit: `a4f5eec2f962c21c0754ec1fffc7ac35016750f3`
- Verified integration implementation before this checkpoint: `75bad9cbd51ea91be5ef7e0159fb8e39db3832d8`
- Integration branch: `integrate/legacy-b-pending-safe-20261008`
- Tracking draft PR: #52
- Independent origin repo: `netadalet-oss/AurumB`

## Uygulanan kod (checkpoint öncesi)
Disable unsafe automatic OS backup; retain time slot and integrity checks; signed workflow protection

## CI durumu — checkpoint kaydedildiği an
Android Build 37782277961 failed — investigate before APK delivery

## Kesinti sonrası devam protokolü
1. Yukarıdaki branch'in yeni HEAD commit'ini ve PR diff'ini kontrol et.
2. Önceki başarılı APK'nın commit'i ile yanlış eşleştirme yapma; her APK kendi BUILD SHA'sına bağlıdır.
3. Korunan görünüm ve Legacy JS/HTML/CSS kaynaklarını, kaynak aktarım davranışını, zamanlayıcı sahipliğini ve imza sertifikasını kullanıcı talebi olmadan değiştirme.
4. Harici veri kaynakları için gerçek kaynak zaman damgası/provenance kullan; eksik sayıyı sıfıra dönüştürme; başarısız yenilemede son geçerli Room/Legacy verisini koru.
5. Önce Android/JS CI, sonra release/build, sonra apksigner ve hash, daha sonra teslimat. Sadece başarılı release artefaktını paylaş.
6. Sistem güvenliği veya verilere zarar riski olan eski yan dal revizyonlarını otomatik merge etme; güvenli uyarlama ve izole test uygula.

Bu dosya **checkpoint** kaydıdır; tek başına CI veya cihaz testi sonucu değildir.
