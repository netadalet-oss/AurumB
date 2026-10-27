package io.aurum.aurumb.health

import android.content.Context
import io.aurum.aurumb.persistence.AurumDao
import io.aurum.common.health.*
import java.time.Duration
import java.time.Instant

class HealthService(
    private val context:Context,
    private val dao:AurumDao,
    private val clock:()->Instant={Instant.now()}
) {
    suspend fun snapshot():HealthSnapshot {
        val now=clock()
        val lastMarket=dao.latestMarketBarReceivedAt()?.let{runCatching{Instant.parse(it)}.getOrNull()}
        val latestRun=dao.latestValidRun()
        val model=dao.champion()
        val scheduler=dao.schedulerJobs()
        val schedulerRuns=dao.recentSchedulerRuns(50)
        val latestAi=dao.latestAiAudit()
        val bars=dao.marketBarCount()
        val universes=dao.universeSnapshotCount()
        val aiCount=dao.successfulAiAuditCount()
        val newsCount=dao.newsItemCount()
        val outcomeCount=dao.selectionOutcomeCount()
        val components=mutableListOf<HealthComponent>()

        components += HealthComponent(
            "database",
            HealthLevel.HEALTHY,
            "Room açık; market barları="+bars,
            now
        )
        val marketLevel=when {
            lastMarket==null -> HealthLevel.UNKNOWN
            Duration.between(lastMarket,now)>Duration.ofDays(4) -> HealthLevel.FAILED
            Duration.between(lastMarket,now)>Duration.ofDays(2) -> HealthLevel.DEGRADED
            else -> HealthLevel.HEALTHY
        }
        components += HealthComponent("marketProviders",marketLevel,lastMarket?.toString()?:"Henüz veri yok",now)

        val schedulerLevel=when {
            scheduler.isEmpty() && schedulerRuns.isEmpty() -> HealthLevel.UNKNOWN
            schedulerRuns.take(10).any{it.state=="FAILED"} -> HealthLevel.FAILED
            schedulerRuns.take(10).any{it.state=="RETRY_PENDING"} -> HealthLevel.DEGRADED
            scheduler.any{it.state=="FAILED"} -> HealthLevel.FAILED
            scheduler.any{it.state=="RETRY_PENDING"} -> HealthLevel.DEGRADED
            else -> HealthLevel.HEALTHY
        }
        components += HealthComponent(
            "scheduler",schedulerLevel,
            (if(schedulerRuns.isNotEmpty()) schedulerRuns.take(6).joinToString { it.jobId+":"+it.state } else scheduler.joinToString { it.id+":"+it.state }),
            now
        )

        val aiLevel=when {
            latestAi==null -> HealthLevel.UNKNOWN
            latestAi.status=="SUCCESS" -> HealthLevel.HEALTHY
            latestAi.retryable -> HealthLevel.DEGRADED
            else -> HealthLevel.FAILED
        }
        components += HealthComponent("ai",aiLevel,latestAi?.status?:"AI çağrısı yok",now)

        val universeLevel=if(universes>0)HealthLevel.HEALTHY else HealthLevel.UNKNOWN
        components += HealthComponent("universe",universeLevel,"snapshot="+universes,now)

        val newsLevel=if(newsCount>0)HealthLevel.HEALTHY else HealthLevel.UNKNOWN
        components += HealthComponent("news",newsLevel,"persisted="+newsCount,now)

        val analysisLevel=if(latestRun?.integrityPassed==true)HealthLevel.HEALTHY else HealthLevel.UNKNOWN
        components += HealthComponent("analysis",analysisLevel,latestRun?.status?:"Henüz run yok",now)

        val outcomeLevel=if(outcomeCount>0)HealthLevel.HEALTHY else HealthLevel.UNKNOWN
        components += HealthComponent("outcomes",outcomeLevel,"matured="+outcomeCount,now)

        val dbFile=context.getDatabasePath("aurumb.db")
        val storageBytes=if(dbFile.exists())dbFile.length() else 0L
        components += HealthComponent(
            "storage",
            if(storageBytes>=0)HealthLevel.HEALTHY else HealthLevel.UNKNOWN,
            storageBytes.toString()+" bytes",
            now
        )

        return HealthSnapshot(
            now,components,bars,universes,aiCount,lastMarket,
            latestRun?.asOfUtc?.let{runCatching{Instant.parse(it)}.getOrNull()},
            model?.version,
            storageBytes
        )
    }
}
