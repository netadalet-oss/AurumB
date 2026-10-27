package io.aurum.aurumb.universe

import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.persistence.InstrumentLifecycleEntity
import io.aurum.aurumb.persistence.UniverseSnapshotEntity
import io.aurum.common.provider.*
import org.json.JSONArray
import java.time.Instant
import java.time.LocalDate

data class DirectoryAttempt(val provider:String,val success:Boolean,val code:String?,val count:Int)
data class DirectorySyncResult(val published:Boolean,val source:String?,val count:Int,val attempts:List<DirectoryAttempt>)

class UniverseDirectoryService(
    private val providers:List<CompanyDirectoryProvider>,
    private val dao:AurumDao
) {
    init { require(providers.isNotEmpty()); require(providers.map{it.id}.distinct().size==providers.size) }

    suspend fun refresh(asOfDate:LocalDate,capturedAt:Instant):DirectorySyncResult {
        val attempts=mutableListOf<DirectoryAttempt>()
        for(provider in providers) {
            when(val result=provider.fetch()) {
                is CompanyDirectoryResult.Success -> {
                    val symbols=result.entries.map{it.symbol}.distinct().sorted()
                    if(symbols.size<100) {
                        attempts += DirectoryAttempt(provider.id,false,"INSUFFICIENT_DIRECTORY",symbols.size)
                        continue
                    }

                    val current=symbols.toSet()
                    val known=dao.instrumentLifecycles()
                    val active=known.filter { row ->
                        val listed=runCatching{Instant.parse(row.listedAtUtc)}.getOrNull() ?: return@filter false
                        val delisted=row.delistedAtUtc?.let{runCatching{Instant.parse(it)}.getOrNull()}
                        !listed.isAfter(capturedAt) && (delisted==null || capturedAt.isBefore(delisted))
                    }

                    val activeBySymbol=active.groupBy{it.symbol}
                    for(symbol in symbols) {
                        if(activeBySymbol[symbol].isNullOrEmpty()) {
                            dao.putInstrumentLifecycle(
                                InstrumentLifecycleEntity(
                                    symbol=symbol,
                                    listedAtUtc=capturedAt.toString(),
                                    delistedAtUtc=null,
                                    source=result.provider,
                                    sourceFingerprint=result.sourceFingerprint,
                                    verifiedAtUtc=capturedAt.toString()
                                )
                            )
                        }
                    }

                    for(row in active) {
                        if(row.symbol !in current) {
                            dao.putInstrumentLifecycle(
                                row.copy(
                                    delistedAtUtc=capturedAt.toString(),
                                    source=result.provider,
                                    sourceFingerprint=result.sourceFingerprint,
                                    verifiedAtUtc=capturedAt.toString()
                                )
                            )
                        }
                    }

                    dao.putUniverseSnapshot(UniverseSnapshotEntity(
                        asOfDate=asOfDate.toString(),
                        symbolsJson=JSONArray(symbols).toString(),
                        source=result.provider,
                        sourceFingerprint=result.sourceFingerprint,
                        pointInTimeVerified=true,
                        capturedAtUtc=capturedAt.toString()
                    ))
                    attempts += DirectoryAttempt(provider.id,true,null,symbols.size)
                    return DirectorySyncResult(true,result.provider,symbols.size,attempts)
                }
                is CompanyDirectoryResult.Failure -> attempts += DirectoryAttempt(provider.id,false,result.code,0)
            }
        }
        return DirectorySyncResult(false,null,0,attempts)
    }
}
