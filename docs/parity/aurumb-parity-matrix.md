# AurumB parity matrix

Bu matris kaynak uygulamasını ve tarihsel kanıtları listeler; güncel HEAD için CI/emulator başarısı veya tüm ekranlarda sayısal/pixel parity kabulü değildir. Yeni regresyon testleri henüz çalıştırılmamıştır. Production signing ve fiziksel cihaz doğrulaması ayrı, açık gate olarak kalır.

| Feature | Verified legacy behavior | New canonical module | Test / evidence | Status | Intentional change |
|---|---|---|---|---|---|
| K1–K7 scoring | Weighted technical/liquidity criteria | AurumBFormulaEngine | FormulaChecks + aurumb-formula-golden-v1 | Implemented with legacy-derived golden fixture | Single formula owner |
| K8–K12 | diagnostic/risk/memory layers | criteria catalog + learning | DomainChecks | Implemented contract | Cannot independently select |
| extreme-move exclusion | User revision: >12.5% instantaneous or daily change must not participate | ExtremeMoveEligibility + SelectionComputationService + BacktestEngine | ExtremeMoveEligibilityChecks / point-in-time observation query | Implemented in AurumB | fixed >12.5% hard gate; exactly 12.5% remains eligible; data stays persisted/displayable |
| deterministic selection | ranking of eligible candidates | SelectionEngine | DomainChecks, SelectionParityChecks | Implemented | explicit missing-data rejection |
| market universe | BIST company/security universe | UniverseDirectoryService + UniverseBuilder | LearningUniverseChecks + Room v10 lifecycle migration | Implemented | append-only listing/delisting/relisting intervals; no synthetic active lifecycle |
| historical bars | remote OHLCV | YahooHistoricalProvider | provider/pipeline code | Implemented baseline | provenance + timestamps persisted |
| provider fallback | legacy fallback chains | explicit provider services/consensus | ProviderChecks | Implemented core | failure visible, no silent fallback |
| look-ahead protection | partly implicit legacy chronology | PointInTime + dated folds + Room as-of queries | BacktestChecks + PointInTimeDaoTest | Implemented | market/receive/publication/evaluation timestamps fail closed |
| backtest | historical scoring | BacktestEngine | BacktestChecks | Implemented core | production formulas reused |
| learning | legacy reward/penalty adaptations | ModelLifecycle + ChampionChallenger | LearningUniverseChecks | Implemented domain | challenger cannot self-promote |
| AI | advisory/explanation calls | GatewayAiClient + AiPolicy | schema/audit code | Implemented transport | no direct live mutation |
| secure secrets | native secure handling | SecureSecretStore | source review | Implemented | no JS/localStorage secret |
| scheduler | background publication | AppScheduler + Workers | scheduler state in Room + freeze history test | Implemented | transfer below the configurable ladder minimum or completeness not strictly above the configurable threshold still publishes raw Veriler with `SUCCEEDED_WITH_NOTE`; downstream owners preserve their prior verified snapshots/timestamps until both gates pass (ladder >= threshold; completeness > threshold) |
| signals | AL/SAT entitlement lifecycle | QualifiedTradeLifecycle/Coordinator | QualifiedLifecycleChecks | Implemented | persisted S/F reconstruction treats snapshots as point evidence and is fail-closed across unverified gaps plus invalid/formula boundaries; BIST half-days use 12:40 close; SAT high-water/stop/lock evidence timestamps persist; append/idempotent history |
| virtual portfolio | simulated positions/P&L | VirtualPortfolioService + PortfolioMetrics | PortfolioMetricsChecks | Implemented | transactionally persisted |
| broker future interface | no default real execution | BrokerContract | BrokerChecks | Implemented contract | real orders disabled by default |
| settings | many legacy keys | SettingsSchema + SettingsRepository | SettingsChecks | Implemented | transfer ladder, strict completeness, max stop loss, technical stop and profit-lock parameters are user configurable; invalid combinations are rejected without validation writes; entitlement timing defaults retain the canonical contract |
| notifications | local notifications | NotificationCoordinator | delivery table | Implemented baseline | dedupe persisted |
| health | scattered status | HealthService + HealthSnapshot | UI + health domain | Implemented | one health model |
| import/export | legacy transfer flows | StateTransferService | schema/checksum implementation | Implemented baseline | secrets excluded |
| 11 functional screens | legacy navigation pages | MainActivity sections | source/UI review | Implemented baseline | native clean UI, no legacy DOM |
| Turkey portal | market data/cards + financial news context | MarketPortalService + TCMB/Yahoo/GoogleNews providers | source review + news parser tests | Implemented baseline | news remains context-only, not a direct price signal |
| Netherlands/Euro portal | AEX/ECB market + NL financial news context | MarketPortalService + ECB/Yahoo/GoogleNews providers | source review + news parser tests | Implemented baseline | source/timestamp/freshness shown; no fake data |
| release APK/AAB | installable legacy app | Android build | GitHub Actions run 36933652278 | Build verified at SHA 9f557cb; device smoke still pending | debug/release APK + release AAB, unit/lint/security/instrumentation compilation passed; connected device gate remains |

Kaynak düzeltmeleri: runtime patch ayar doğrulaması yazma yapmaz; full restore ayarları çapraz politika doğrulamasından geçer; rollback journal AtomicFile ile yayımlanır. Eksik zorunlu meta evidence puanlanmaz. Bu değişikliklerin derleme/unit/device kabulü pending durumundadır.
