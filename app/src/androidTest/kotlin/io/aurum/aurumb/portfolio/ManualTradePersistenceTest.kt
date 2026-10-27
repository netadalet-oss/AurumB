package io.aurum.aurumb.portfolio

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.aurum.aurumb.persistence.*
import io.aurum.aurumb.signal.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.math.BigDecimal
import java.time.Instant

@RunWith(AndroidJUnit4::class)
class ManualTradePersistenceTest {
    @Test fun blockedBuyIsRejectedAndPersistedBuySurvivesDatabaseReopen()=runBlocking {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val dbName="manual-trade-"+System.nanoTime()+".db"
        val at=Instant.parse("2026-10-04T10:00:00Z")
        fun open()=Room.databaseBuilder(context,AurumDatabase::class.java,dbName).allowMainThreadQueries().build()
        var db=open()
        try {
            var dao=db.aurumDao()
            val portfolio=VirtualPortfolioService(
                dao,PortfolioExecutionPolicy(
                    startingCapital=BigDecimal("10000"),defaultPosition=BigDecimal("1000"),
                    commissionBps=BigDecimal.ZERO,slippageBps=BigDecimal.ZERO
                )
            ){at}
            val manual=ManualProductCardTradeService(dao,portfolio,QualifiedTradePolicy()){at}
            dao.insertObservation(MarketObservationEntity("obs-block","BLOCK","PERSISTED",at.toString(),at.toString(),at.toString(),"100","TRY","OK","LIVE","fp","test"))
            dao.insertObservation(MarketObservationEntity("obs-keep","KEEP","PERSISTED",at.toString(),at.toString(),at.toString(),"100","TRY","OK","LIVE","fp","test"))
            dao.putBlockedInstrument(BlockedInstrumentEntity("BLOCK",at.toString(),"TEST"))
            assertTrue(runCatching{manual.apply("BLOCK",SignalSide.BUY)}.isFailure)
            assertTrue(dao.portfolioPositions().none{it.symbol=="BLOCK"})
            assertTrue(dao.qualifiedTradeStates().none{it.symbol=="BLOCK"})

            manual.apply("KEEP",SignalSide.BUY)
            assertEquals("BUY",dao.qualifiedTradeStates().single{it.symbol=="KEEP"}.status)
            assertEquals("KEEP",dao.portfolioPositions().single().symbol)

            val blocker=BlockedInstrumentService(dao){at.plusSeconds(60)}
            blocker.block("KEEP")
            assertNotNull(dao.blockedInstrument("KEEP"))
            assertTrue(dao.qualifiedTradeStates().none{it.symbol=="KEEP"})
            assertTrue(dao.portfolioPositions().none{it.symbol=="KEEP"})
            assertTrue(dao.portfolioTransactions().none{it.symbol=="KEEP"})
            val removedSignal=dao.tradeRemovalTombstones().singleOrNull()
            assertNotNull(removedSignal)
            blocker.unblock("KEEP")
            assertNull(dao.blockedInstrument("KEEP"))
            assertTrue(dao.qualifiedTradeStates().none{it.symbol=="KEEP"})
            assertTrue(dao.portfolioPositions().none{it.symbol=="KEEP"})
            // Blocking intentionally purges canonical local price evidence. Unblocking must not
            // resurrect deleted data, so a fresh persisted observation is required before BUY.
            dao.insertObservation(MarketObservationEntity("obs-keep-refetched","KEEP","PERSISTED",at.toString(),at.toString(),at.toString(),"100","TRY","OK","LIVE","fp-refetched","test"))

            manual.apply("KEEP",SignalSide.BUY)
            assertEquals("BUY",dao.qualifiedTradeStates().single{it.symbol=="KEEP"}.status)
            assertEquals("KEEP",dao.portfolioPositions().single().symbol)
            db.close()

            db=open(); dao=db.aurumDao()
            assertEquals("BUY",dao.qualifiedTradeStates().single{it.symbol=="KEEP"}.status)
            assertEquals("KEEP",dao.portfolioPositions().single().symbol)
            assertEquals("BUY",dao.portfolioTransactions().single().type)
        } finally {
            if(db.isOpen) db.close()
            context.deleteDatabase(dbName)
        }
    }
}
