package io.aurum.aurumb.criteria

import java.math.BigDecimal

object AurumBCriteriaCatalog {
 private fun d(v:String)=BigDecimal(v)
 val specs=listOf(
  CriterionSpec("K1","Fiyat-Hacim Kırılımı","Zirve yakınlığı, güçlü kapanış, hacim ve işlem değeri ivmesi",CriterionRole.DECISION,d("0.196970"),"b-k1-v1"),
  CriterionSpec("K2","Kontrollü Momentum","Kısa momentum, MACD ivmesi, RSI/MFI ve EMA yapısı",CriterionRole.DECISION,d("0.181819"),"b-k2-v1"),
  CriterionSpec("K3","Volatilite Genişlemesi","Kontrollü ATR, bant ve gün içi aralık genişlemesi",CriterionRole.DECISION,d("0.136364"),"b-k3-v1"),
  CriterionSpec("K4","Kısa Vadeli Göreceli Güç","5/10/21 günlük endeks üstü performans ve rejim uyumu",CriterionRole.DECISION,d("0.151515"),"b-k4-v1"),
  CriterionSpec("K5","Likidite ve Uygulanabilirlik","İşlem değeri, katılım, fiyat adımı, Amihud ve tahmini maliyet",CriterionRole.DECISION,d("0.121212"),"b-k5-v1"),
  CriterionSpec("K6","Gap ve Gün İçi Devam","Makul gap sonrası devam, güçlü kapanış ve düşük üst fitil",CriterionRole.DECISION,d("0.121212"),"b-k6-v1"),
  CriterionSpec("K7","Destekten Toparlanma","Alt fitil, RSI/MACD toparlanması, Bollinger yakınlığı ve hacim teyidi",CriterionRole.DECISION,d("0.090908"),"b-k7-v1"),
  CriterionSpec("K8","Tanısal Konsensüs ve Teknik Uyum","K1-K7 uzlaşmasını denetler; tek başına seçim koltuğu üretmez",CriterionRole.DIAGNOSTIC,BigDecimal.ZERO,"b-k8-v1"),
  CriterionSpec("K9","Başarısızlık Riski Filtresi","Risk ve veri kalitesini ayrı görünür kılar",CriterionRole.RISK_META,BigDecimal.ZERO,"b-k9-v1"),
  CriterionSpec("K10","Ceza / Ödül Hafızası","Yalnız K1-K7 saf tam sıralamalarını sonraki işlem gününün kesin Reel sıralamasıyla karşılaştırır ve son 30 kesinleşmiş olayın azalan ağırlıklı hafızasını üretir; bağımsız aday/koltuk vermez",CriterionRole.LEARNING_META,BigDecimal.ZERO,"b-k10-r29"),
  CriterionSpec("K11","Hisse Davranış Karakteri","Son 252 seans ve arşivden davranış karakterini tanısal olarak özetler; bağımsız seçim ağırlığı veya AL/SAT hakkı vermez",CriterionRole.DIAGNOSTIC,BigDecimal.ZERO,"b-k11-v1"),
  CriterionSpec("K12","Piyasa Karakteri + K10 Hafızası","Piyasa rüzgârı ile hisse davranış/DNA karakter uyumunu %70, K10 ödül-ceza hafızasını %30 birleştirir; S puanına ve işlem koltuğuna katkısı sıfırdır",CriterionRole.DIAGNOSTIC,BigDecimal.ZERO,"b-k12-r29"))
 val decision=specs.filter{it.role==CriterionRole.DECISION}
}
