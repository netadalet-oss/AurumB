# AurumB conflict matrix

Status reflects the clean-room branch after canonical-owner cleanup.

| Legacy / duplicate responsibility | Conflict | Resolution | Canonical owner |
|---|---|---|---|
| core.js / runtime.js formula copies | Same K formula logic in runtime layers | REWRITE | core/formula/AurumBFormulaEngine |
| patch/final/rev20 market display layers | Later script overrides earlier behavior | REWRITE | provider + pipeline + UI modules |
| localStorage critical state | Multiple keys/checkpoints for model/selection state | REMOVE | Room AurumDatabase |
| multiple scheduler/timer chains | setInterval / native/background ownership overlap | REWRITE | AppScheduler + Workers |
| SchedulerBootstrap + AppScheduler | Two clean-room scheduler owners | REMOVE duplicate | AppScheduler |
| MarketSyncWorker + MarketRefreshWorker | Two market background workers | REMOVE duplicate | MarketRefreshWorker |
| root/scheduler AurumApplication | Two Application bootstrap classes | REMOVE duplicate | io.aurum.aurumb.AurumApplication |
| BackendAiClient + GatewayAiClient | Two AI transports | REMOVE duplicate | GatewayAiClient |
| duplicate AiAuditEntity | Two Room entities with same Kotlin name/table | MERGE | gateway-compatible AiAuditEntity |
| Health.kt + HealthSnapshot.kt | Two health domain models | REMOVE duplicate | HealthSnapshot |
| time.MarketCalendar + calendar.MarketCalendar | Two market calendar owners | MERGE | common.calendar.MarketCalendar; common.time only zones |
| YahooChartProvider / YahooHistoricalProvider | current quote vs historical bars | KEEP separately | network portal quote / historical provider |
| K8/K9/K10 decision weighting | Meta criteria could contaminate selection | REWRITE | zero decision weight; diagnostic/meta only |
| AI proposed weights | AI could be interpreted as model mutation | REWRITE | AiPolicy + deterministic challenger validation |
| duplicate signal writes | Repeated AL/SAT advancement risk | REWRITE | qualified lifecycle + DB idempotency |
| duplicate portfolio transaction | Repeated order/fill risk | REWRITE | idempotencyKey unique index + transaction methods |

No legacy patch file is copied into the clean-room source tree.
