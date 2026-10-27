package io.aurum.aurumb

import android.content.Context
import io.aurum.aurumb.calendar.BistCalendarFactory
import io.aurum.aurumb.network.HttpClientFactory
import io.aurum.aurumb.persistence.DatabaseFactory
import io.aurum.aurumb.pipeline.HistoricalSyncService
import io.aurum.aurumb.pipeline.SelectionComputationService
import io.aurum.aurumb.provider.BigparaCompanyDirectoryProvider
import io.aurum.aurumb.provider.KapCompanyDirectoryProvider
import io.aurum.aurumb.provider.YahooHistoricalProvider
import io.aurum.aurumb.universe.UniverseDirectoryService

data class AurumRuntime(
    val historicalSync:HistoricalSyncService,
    val selection:SelectionComputationService
)

object AurumRuntimeFactory {
    fun create(context:Context):AurumRuntime {
        val dao=DatabaseFactory.get(context).aurumDao()
        val client=HttpClientFactory.market()
        val directory=UniverseDirectoryService(
            listOf(
                KapCompanyDirectoryProvider(client),
                BigparaCompanyDirectoryProvider(client)
            ),
            dao
        )
        val historical=HistoricalSyncService(
            dao,
            directory,
            YahooHistoricalProvider(client)
        )
        val selection=SelectionComputationService(
            dao,
            BistCalendarFactory.create2026()
        )
        return AurumRuntime(historical,selection)
    }
}
