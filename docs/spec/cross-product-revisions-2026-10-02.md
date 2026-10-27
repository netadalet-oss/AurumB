# Cross-product revisions — 2026-10-02

These requirements apply to both clean-room products unless a product-specific threshold is stated.

- Overview AL/SAT lists are driven only by persisted qualified signal events. Empty lists remain visibly empty until rules produce events.
- The virtual portfolio is driven by the same qualified events, with idempotent transactions and integrity checks against source signals/open qualified states.
- Financial-news links are displayed in abbreviated single-line form; the full HTTPS URL remains the click target.
- Portal choice is user-controlled and persisted. Background refresh must never switch Türkiye/Nederland portal selection.
- Data completeness means populated cells divided by all cells. The same canonical 70% rule is evaluated independently for the whole table, each row and each column. Below-threshold rows/columns stay persisted/displayable but are excluded from downstream calculations until they recover. If the whole Veriler table remains below 70% after transfer attempts, raw/persisted Veriler are still published; every other table/module remains on its last valid snapshot and keeps its original timestamps until a later completed publication reaches at least 70%. This is a successful scheduler run with an explicit downstream-freeze note, not a retry/failure. Any derived writes attempted before the table-completeness decision are rolled back atomically.
- Long-running transfer/calculation/refresh work is owned by durable background workers rather than an Activity lifecycle.
- K_Tarihsel Kn Trend renders K1–K7 in descending n/20 order; ties are deterministic by K id.
- Scheduler execution reporting is append-only per trigger, not only the latest job state.
- Product-specific temporary extreme-move exclusion:
  - AurumB stock universe: absolute current OR daily move > 12.5%.
  - AurumF fund universe: absolute current OR daily move > 22.5%.
  Instruments remain visible in stored/display data but are excluded from analysis, AI, learning, signals and dependent calculations until fresh values return to/below the threshold.


## Ana veri aktarımı kalite ladder'ı

Ana aktarımın tamamlanma kalitesi, başarılı aktarım birimi / beklenen aktarım birimi oranından hesaplanır. Kabul sırası katıdır: **100% → 95% → 90% → 80% → 70%**. Sistem en yüksek sağlanan eşiği kabul eder ve daha düşük eşikleri değerlendirmeyi durdurur. %70'in altı fail-closed'dur. Kabul edilen eşik operasyon ilerleme durumuna `COMPLETE_Q{eşik}` olarak yazılır.

## S/F hak edişi ve AL listesi

AL listesi doğrudan S/F listesinin kopyası değildir. S/F üyeliği UI gözlemi değil, başarılı formül/selection run'larında persist edilen hak ediş durumudur. Uygulamanın ekranda açık olmaması hak ediş süresini sıfırlamaz. Persist edilmiş başarılı run üyeliği yalnız point-in-time entitlement evidence'dır; tek başına bir sonraki snapshot'a kadar olan görünmeyen aralığı kanıtlamaz. Açık interval/coverage evidence yoksa iki snapshot arası `UNVERIFIED_EVIDENCE_GAP` olarak fail-closed edilir ve WATCHING entitlement saati yeni kanıt noktasından yeniden başlar. Açık non-membership sürekliliği sıfırlar. Failed/integrity-fail veya formula-version sınırı da bilinmeyen geçmiş kabul edilir; reconstruction bu sınırları geçmez ve `SF_ENTITLEMENT_FAIL_CLOSED` audit nedeni üretir.

AL hak ediş koşulları:
- normal seans içi giriş: açık seans dakikaları üzerinden kesintisiz toplam 4 saat;
- seansın son iki saatinde giriş: aynı seans kapanışına kadar S/F hak edişinin sürmesi;
- seans dışı giriş: sonraki açık seansta 2 saat S/F hak edişinin sürmesi.

SAT listesi kanonik qualified lifecycle'dan üretilir. Zarar-kes kâr kilidinden önce değerlendirilir; effective stop teknik stop ile entry×0.97 arasından kaybı daha erken sınırlayandır. +5–<20 peak aralığında izin verilen geri çekilme 2 puan; +20'den itibaren her tamamlanan +10 peak basamağında 2 puan daha artar (+20→4, +30→6, …, +100→20). Exact geri çekilme sınırı satış değildir; yalnız sınırın ötesi SAT üretir. High-water, stop ve aktif lock kanıt zamanları Room'da persist edilir. BIST 2026 yarım günlerinde Pay Piyasası kapanışı 12:40 kabul edilir.
