package io.aurum.aurumb.history

import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.persistence.KHistoricalRowEntity
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

private val KH_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class KTrendEntry(
    val criterion:String,
    val hits:Int,
    val total:Int
)

data class KHistoricalTimelineRow(
    val label:String,
    val knRunId:String,
    val knSourceDate:String,
    val knTimestampUtc:String,
    val reelSourceDate:String?,
    val reelTimestampUtc:String?,
    val topN:Int,
    val knTop:Map<String,List<String>>,
    val reelTop:List<Pair<String,BigDecimal>>,
    val hits:Map<String,Pair<Int,Int>>,
    val frozen:Boolean
)

data class KHistoricalSnapshot(
    val runId:String,
    val evaluatedAt:Instant,
    val entries:List<KTrendEntry>,
    val rows:List<KHistoricalTimelineRow>
)

class KHistoricalService(
    private val dao:AurumDao,
    private val clock:()->Instant={Instant.now()}
) {
    private val criteria=(1..12).map{"K"+it}
    private val decisionCriteria=(1..7).map{"K"+it}
    private val zone=ZoneId.of("Europe/Istanbul")

    suspend fun mirrorKn(knPayloadJson:String,knPublishedAtUtc:String):KHistoricalRowEntity? {
        refreshFromData()
        val root=JSONObject(knPayloadJson)
        val run=root.optJSONObject("run") ?: return null
        val rows=root.optJSONArray("selectionRows") ?: return null
        val runId=run.optString("id")
        if(runId.isBlank()) return null
        val topN=root.optInt("topN",20).coerceIn(1,100)
        val knDate=dao.latestMarketBarDate()
            ?: runCatching {
                LocalDate.ofInstant(Instant.parse(run.getString("asOfUtc")),zone).toString()
            }.getOrNull()
            ?: return null
        val knTop=buildKnTop(rows,topN)
        val reel=realTop(knDate,topN)
        val now=clock().toString()
        val entity=KHistoricalRowEntity(
            id="LIVE",
            kind="LIVE",
            knRunId=runId,
            knSourceDate=knDate,
            knTimestampUtc=knPublishedAtUtc,
            knTopJson=encodeKnTop(knTop),
            reelSourceDate=knDate,
            reelTimestampUtc=reel.second,
            reelTopJson=encodeReel(reel.first),
            hitsJson=encodeHits(knTop,reel.first,topN),
            topN=topN,
            frozen=false,
            archivedAtUtc=null,
            updatedAtUtc=now
        )
        dao.putKHistoricalRow(entity)
        return entity
    }

    /**
     * Data entitlement owner. It is intentionally independent from downstream
     * eligibility: the first persisted row of a later market date is sufficient
     * to archive the previous live Kn snapshot to T1. Kn itself is never
     * recomputed here.
     */
    suspend fun refreshFromData():Boolean {
        val latestDate=dao.latestMarketBarDate() ?: return false
        val live=dao.kHistoricalLive()
        var shifted=false
        if(live!=null && latestDate>live.knSourceDate) {
            val pending=live.knRunId.startsWith("PENDING:")
            if(!pending && dao.kHistoricalArchiveForRun(live.knRunId)==null) {
                val reelDate=dao.nextMarketBarDateAfter(live.knSourceDate)
                val reel=if(reelDate!=null && reelDate<=latestDate) realTop(reelDate,live.topN)
                    else emptyList<Pair<String,BigDecimal>>() to null
                dao.putKHistoricalRow(live.copy(
                    id="ARCHIVE:"+live.knRunId+":"+live.knSourceDate,
                    kind="ARCHIVE",
                    reelSourceDate=reelDate,
                    reelTimestampUtc=reel.second,
                    reelTopJson=encodeReel(reel.first),
                    hitsJson=encodeHits(decodeKnTop(live.knTopJson),reel.first,live.topN),
                    frozen=true,
                    archivedAtUtc=clock().toString(),
                    updatedAtUtc=clock().toString()
                ))
                shifted=true
            }
            // The old T0 Kn snapshot has now earned T1. Do not duplicate it in
            // T0 while the new day's Kn calculation is still pending. T0 and T1
            // intentionally share the live d+1 ReelTOPn until that list finishes.
            val liveReel=realTop(latestDate,live.topN)
            dao.putKHistoricalRow(KHistoricalRowEntity(
                id="LIVE",
                kind="LIVE",
                knRunId="PENDING:"+latestDate,
                knSourceDate=latestDate,
                knTimestampUtc=clock().toString(),
                knTopJson=encodeKnTop(criteria.associateWith{emptyList()}),
                reelSourceDate=latestDate,
                reelTimestampUtc=liveReel.second,
                reelTopJson=encodeReel(liveReel.first),
                hitsJson=encodeHits(criteria.associateWith{emptyList()},liveReel.first,live.topN),
                topN=live.topN,
                frozen=false,
                archivedAtUtc=null,
                updatedAtUtc=clock().toString()
            ))
        } else if(live!=null) {
            // T0 is the current Kn mirror (or a PENDING placeholder). Its Reel
            // cells always belong to the same source day and remain live.
            val reel=realTop(live.knSourceDate,live.topN)
            dao.putKHistoricalRow(live.copy(
                reelSourceDate=live.knSourceDate,
                reelTimestampUtc=reel.second,
                reelTopJson=encodeReel(reel.first),
                hitsJson=encodeHits(decodeKnTop(live.knTopJson),reel.first,live.topN),
                updatedAtUtc=clock().toString()
            ))
        }

        dao.kHistoricalArchives(30).forEach { row ->
            val expected=dao.nextMarketBarDateAfter(row.knSourceDate)
            if(expected!=null && expected<=latestDate) {
                val reel=realTop(expected,row.topN)
                dao.putKHistoricalRow(row.copy(
                    reelSourceDate=expected,
                    reelTimestampUtc=reel.second,
                    reelTopJson=encodeReel(reel.first),
                    hitsJson=encodeHits(decodeKnTop(row.knTopJson),reel.first,row.topN),
                    updatedAtUtc=clock().toString()
                ))
            }
        }
        dao.trimKHistoricalArchives()
        return shifted
    }

    /** Rebuild T0-T30 strictly from persisted point-in-time analysis runs.
     * Historical Kn is never recomputed with today's data; each row reuses the
     * contributions persisted by its own run. Reel evidence is attached only
     * from the same day (T0) or the first later persisted market day (T1-T30).
     */
    suspend fun rebuildFromPersistedRuns():Int {
        val runs=dao.recentRuns(250).filter { it.integrityPassed }
            .mapNotNull { run -> runCatching { LocalDate.ofInstant(Instant.parse(run.asOfUtc),zone).toString() }.getOrNull()?.let { it to run } }
            .groupBy { it.first }.mapValues { (_,v) -> v.maxBy { it.second.asOfUtc }.second }
            .toSortedMap(compareByDescending { it }).entries.take(31)
        if(runs.isEmpty()) return 0
        val rebuilt=mutableListOf<KHistoricalRowEntity>()
        runs.forEachIndexed { index,(date,run) ->
            val rows=dao.selectionsForRun(run.id)
            val payload=JSONArray().apply {
                rows.forEach { row -> put(JSONObject().put("symbol",row.symbol).put("contributionsJson",row.contributionsJson)) }
            }
            val topN=rows.count { it.rank>0 }.coerceIn(1,100)
            val knTop=buildKnTop(payload,topN)
            val reelDate=if(index==0) date else dao.nextMarketBarDateAfter(date)
            val reel=if(reelDate!=null) realTop(reelDate,topN) else emptyList<Pair<String,BigDecimal>>() to null
            rebuilt += KHistoricalRowEntity(
                id=if(index==0)"LIVE" else "ARCHIVE:REBUILD:"+run.id+":"+date,
                kind=if(index==0)"LIVE" else "ARCHIVE", knRunId=run.id, knSourceDate=date,
                knTimestampUtc=run.asOfUtc, knTopJson=encodeKnTop(knTop),
                reelSourceDate=reelDate, reelTimestampUtc=reel.second,
                reelTopJson=encodeReel(reel.first), hitsJson=encodeHits(knTop,reel.first,topN),
                topN=topN, frozen=index>0, archivedAtUtc=if(index>0) clock().toString() else null,
                updatedAtUtc=clock().toString()
            )
        }
        dao.clearKHistoricalRows()
        rebuilt.forEach { dao.putKHistoricalRow(it) }
        dao.trimKHistoricalArchives()
        return rebuilt.size
    }

    suspend fun latestTrend():KHistoricalSnapshot? {
        refreshFromData()
        val live=dao.kHistoricalLive() ?: return null
        val entities=listOf(live)+dao.kHistoricalArchives(30)
        val rows=entities.mapIndexed { index,row -> row.toTimeline(if(index==0)"T0" else "T"+index) }
        val aggregates=decisionCriteria.mapNotNull { id ->
            // T1 may be a live, still-forming ReelTOPn row. It is displayed
            // immediately, but it does not become historical hit evidence until
            // the Reel list has reached the row's configured TopN size.
            val values=rows.drop(1)
                .filter { it.reelTop.size>=it.topN }
                .mapNotNull { it.hits[id] }
            if(values.isEmpty()) return@mapNotNull null
            KTrendEntry(id,values.sumOf{it.first},values.sumOf{it.second})
        }.sortedWith(
            compareByDescending<KTrendEntry>{ if(it.total>0) it.hits.toDouble()/it.total else -1.0 }
                .thenBy{it.criterion}
        )
        val evaluated=entities.mapNotNull {
            it.reelTimestampUtc?.let { raw -> runCatching{Instant.parse(raw)}.getOrNull() }
                ?: runCatching{Instant.parse(it.updatedAtUtc)}.getOrNull()
        }.maxOrNull() ?: clock()
        return KHistoricalSnapshot(live.knRunId,evaluated,aggregates,rows)
    }

    private suspend fun realTop(date:String,topN:Int):Pair<List<Pair<String,BigDecimal>>,String?> {
        val prev=dao.previousMarketBarDateBefore(date) ?: return emptyList<Pair<String,BigDecimal>>() to null
        fun lastBySymbol(rows:List<io.aurum.aurumb.persistence.MarketBarEntity>) =
            rows.filter{it.symbol!="XU100"}.groupBy{it.symbol}.mapValues { (_,v) -> v.maxBy{it.receivedAtUtc} }
        val current=lastBySymbol(dao.marketBarsOnDate(date))
        val previous=lastBySymbol(dao.marketBarsOnDate(prev))
        val ranked=current.mapNotNull { (symbol,row) ->
            val p=previous[symbol] ?: return@mapNotNull null
            val a=row.closeDecimal.toBigDecimalOrNull()
                ?: row.adjustedCloseDecimal?.toBigDecimalOrNull()
                ?: return@mapNotNull null
            val b=p.closeDecimal.toBigDecimalOrNull()
                ?: p.adjustedCloseDecimal?.toBigDecimalOrNull()
                ?: return@mapNotNull null
            if(a<=BigDecimal.ZERO || b<=BigDecimal.ZERO) return@mapNotNull null
            val ret=a.divide(b,KH_MC).subtract(BigDecimal.ONE,KH_MC)
                .multiply(BigDecimal("100"),KH_MC)
            if(ret<=BigDecimal("-99.5")) null else symbol to ret
        }.sortedWith(compareByDescending<Pair<String,BigDecimal>>{it.second}.thenBy{it.first})
            .take(topN)
        val timestamp=current.values.mapNotNull{runCatching{Instant.parse(it.atUtc)}.getOrNull()}
            .maxOrNull()?.toString()
        return ranked to timestamp
    }

    private fun buildKnTop(rows:JSONArray,topN:Int):Map<String,List<Pair<String,Int>>> {
        val out=linkedMapOf<String,MutableList<Pair<String,Int>>>()
        criteria.forEach{out[it]=mutableListOf()}
        for(i in 0 until rows.length()) {
            val row=rows.optJSONObject(i) ?: continue
            val symbol=row.optString("symbol").takeIf{it.isNotBlank()} ?: continue
            val contributions=runCatching{JSONArray(row.optString("contributionsJson"))}.getOrNull() ?: continue
            for(j in 0 until contributions.length()) {
                val c=contributions.optJSONObject(j) ?: continue
                val id=c.optString("criterion")
                if(id !in out.keys) continue
                val rank=c.optInt("criterionRank",0)
                if(rank>0) out.getValue(id).add(symbol to rank)
            }
        }
        return out.mapValues { (_,v) ->
            v.sortedWith(compareBy<Pair<String,Int>>{it.second}.thenBy{it.first}).take(topN)
        }
    }

    private fun encodeKnTop(kn:Map<String,List<Pair<String,Int>>>):String =
        JSONObject().apply {
            kn.forEach { (id,list) ->
                put(id,JSONArray().apply {
                    list.forEach { (symbol,rank) ->
                        put(JSONObject().put("symbol",symbol).put("rank",rank))
                    }
                })
            }
        }.toString()

    private fun decodeKnTop(raw:String):Map<String,List<Pair<String,Int>>> {
        val root=runCatching{JSONObject(raw)}.getOrElse{JSONObject()}
        return criteria.associateWith { id ->
            val a=root.optJSONArray(id) ?: JSONArray()
            buildList {
                for(i in 0 until a.length()) {
                    val x=a.optJSONObject(i) ?: continue
                    val symbol=x.optString("symbol")
                    val rank=x.optInt("rank",0)
                    if(symbol.isNotBlank() && rank>0) add(symbol to rank)
                }
            }
        }
    }

    private fun encodeReel(rows:List<Pair<String,BigDecimal>>):String =
        JSONArray().apply {
            rows.forEachIndexed { index,(symbol,ret) ->
                put(JSONObject()
                    .put("symbol",symbol)
                    .put("rank",index+1)
                    .put("returnPct",ret.toPlainString()))
            }
        }.toString()

    private fun decodeReel(raw:String):List<Pair<String,BigDecimal>> {
        val a=runCatching{JSONArray(raw)}.getOrElse{JSONArray()}
        return buildList {
            for(i in 0 until a.length()) {
                val x=a.optJSONObject(i) ?: continue
                val symbol=x.optString("symbol")
                val ret=x.optString("returnPct").toBigDecimalOrNull()
                if(symbol.isNotBlank() && ret!=null) add(symbol to ret)
            }
        }
    }

    private fun encodeHits(
        kn:Map<String,List<Pair<String,Int>>>,
        reel:List<Pair<String,BigDecimal>>,
        topN:Int
    ):String {
        val real=reel.map{it.first}.toSet()
        return JSONObject().apply {
            decisionCriteria.forEach { id ->
                val symbols=kn[id].orEmpty().map{it.first}
                val hits=symbols.filter{it in real}
                put(id,JSONObject()
                    .put("hits",hits.size)
                    .put("total",minOf(topN,symbols.size))
                    .put("symbols",JSONArray(hits))
                    .put("metaOnly",false))
            }
            criteria.filterNot{it in decisionCriteria}.forEach { id ->
                put(id,JSONObject()
                    .put("hits",JSONObject.NULL)
                    .put("total",0)
                    .put("symbols",JSONArray())
                    .put("metaOnly",true))
            }
        }.toString()
    }

    private fun decodeHits(raw:String):Map<String,Pair<Int,Int>> {
        val root=runCatching{JSONObject(raw)}.getOrElse{JSONObject()}
        return decisionCriteria.associateWith { id ->
            val x=root.optJSONObject(id)
            (x?.optInt("hits",0)?:0) to (x?.optInt("total",0)?:0)
        }
    }

    private fun KHistoricalRowEntity.toTimeline(label:String)=KHistoricalTimelineRow(
        label=label,
        knRunId=knRunId,
        knSourceDate=knSourceDate,
        knTimestampUtc=knTimestampUtc,
        reelSourceDate=reelSourceDate,
        reelTimestampUtc=reelTimestampUtc,
        topN=topN,
        knTop=decodeKnTop(knTopJson).mapValues{(_,v)->v.map{it.first}},
        reelTop=decodeReel(reelTopJson),
        hits=decodeHits(hitsJson),
        frozen=frozen
    )
}
