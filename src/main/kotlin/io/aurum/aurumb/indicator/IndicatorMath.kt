package io.aurum.aurumb.indicator

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

object IndicatorMath {
    fun changes(a:List<Double?>):List<Double?> = a.mapIndexed { i,v ->
        if(i<=0) null else {
            val end=v
            val start=a[i-1]
            if(end==null || start==null || !end.isFinite() || !start.isFinite() || end<=0.0 || start<=0.0) null
            else ((end/start-1.0)*100.0).takeIf{it.isFinite() && it > -99.5}
        }
    }

    fun rollingMean(a:List<Double?>,w:Int,minCount:Int=w):List<Double?> {
        require(w>0)
        return a.indices.map { i ->
            if(i<w-1) null else {
                val xs=a.subList(i-w+1,i+1).filterNotNull().filter{it.isFinite()}
                if(xs.size>=minCount) xs.average() else null
            }
        }
    }

    fun rollingStdev(a:List<Double?>,w:Int,minCount:Int=kotlin.math.ceil(w*.8).toInt()):List<Double?> {
        require(w>0)
        return a.indices.map { i ->
            if(i<w-1) null else {
                val xs=a.subList(i-w+1,i+1).filterNotNull().filter{it.isFinite()}
                if(xs.size<max(2,minCount)) null else {
                    val m=xs.average()
                    sqrt(xs.sumOf{(it-m)*(it-m)}/(xs.size-1))
                }
            }
        }
    }

    fun ema(a:List<Double?>,period:Int):List<Double?> {
        require(period>0)
        val k=2.0/(period+1.0)
        var prev:Double?=null
        return a.map { v ->
            if(v==null || !v.isFinite()) null
            else {
                prev=if(prev==null) v else k*v+(1-k)*prev!!
                prev
            }
        }
    }

    fun wilder(a:List<Double?>,period:Int):List<Double?> {
        require(period>0)
        val out=MutableList<Double?>(a.size){null}
        val seed=mutableListOf<Double>()
        for(i in a.indices) {
            val v=a[i] ?: continue
            if(!v.isFinite()) continue
            if(seed.size<period) {
                seed+=v
                if(seed.size==period) out[i]=seed.average()
            } else {
                val last=out.subList(0,i).asReversed().firstOrNull{it!=null}
                if(last!=null) out[i]=(last*(period-1)+v)/period
            }
        }
        return out
    }

    fun rsi(a:List<Double?>,period:Int=14):List<Double?> {
        val ch=changes(a)
        val gains=ch.map{it?.let{x->max(0.0,x)}}
        val losses=ch.map{it?.let{x->max(0.0,-x)}}
        val ag=wilder(gains,period)
        val al=wilder(losses,period)
        return ag.indices.map { i ->
            val g=ag[i]; val l=al[i]
            if(g==null || l==null) null else if(l==0.0) 100.0 else 100.0-100.0/(1.0+g/l)
        }
    }

    fun atr(high:List<Double?>,low:List<Double?>,close:List<Double?>,period:Int=14):List<Double?> {
        require(high.size==low.size && low.size==close.size)
        val tr=close.indices.map { i ->
            val h=high[i]; val l=low[i]
            if(h==null || l==null) null
            else if(i==0) h-l
            else {
                val prev=close[i-1]
                if(prev==null) h-l else max(h-l,max(abs(h-prev),abs(l-prev)))
            }
        }
        return wilder(tr,period)
    }

    fun adx(high:List<Double?>,low:List<Double?>,close:List<Double?>,period:Int=14):List<Double?> {
        require(high.size==low.size && low.size==close.size)
        val tr=close.indices.map { i ->
            val h=high[i]; val l=low[i]
            if(h==null || l==null) null
            else if(i==0 || close[i-1]==null) h-l
            else max(h-l,max(abs(h-close[i-1]!!),abs(l-close[i-1]!!)))
        }
        val plus=high.indices.map { i ->
            if(i==0 || high[i]==null || high[i-1]==null || low[i]==null || low[i-1]==null) null
            else {
                val up=max(0.0,high[i]!!-high[i-1]!!)
                val down=max(0.0,low[i-1]!!-low[i]!!)
                if(up>down) up else 0.0
            }
        }
        val minus=low.indices.map { i ->
            if(i==0 || high[i]==null || high[i-1]==null || low[i]==null || low[i-1]==null) null
            else {
                val up=max(0.0,high[i]!!-high[i-1]!!)
                val down=max(0.0,low[i-1]!!-low[i]!!)
                if(down>up) down else 0.0
            }
        }
        val atrW=wilder(tr,period)
        val pdm=wilder(plus,period)
        val mdm=wilder(minus,period)
        val pdi=atrW.indices.map{i->atrW[i]?.takeIf{x->x!=0.0}?.let{x->100.0*(pdm[i]?:0.0)/x}}
        val mdi=atrW.indices.map{i->atrW[i]?.takeIf{x->x!=0.0}?.let{x->100.0*(mdm[i]?:0.0)/x}}
        val dx=pdi.indices.map { i ->
            val p=pdi[i]; val m=mdi[i]
            if(p==null || m==null || p+m==0.0) null else 100.0*abs(p-m)/(p+m)
        }
        return wilder(dx,period)
    }

    fun obv(close:List<Double?>,volume:List<Double?>):List<Double?> {
        require(close.size==volume.size)
        var x=0.0
        return close.indices.map { i ->
            if(i>0 && volume[i]!=null && close[i]!=null && close[i-1]!=null) {
                x += if(close[i]!!>close[i-1]!!) volume[i]!! else if(close[i]!!<close[i-1]!!) -volume[i]!! else 0.0
            }
            x
        }
    }

    fun mfi(high:List<Double?>,low:List<Double?>,close:List<Double?>,volume:List<Double?>,period:Int=14):List<Double?> {
        require(high.size==low.size && low.size==close.size && close.size==volume.size)
        val tp=close.indices.map{i->if(high[i]!=null&&low[i]!=null&&close[i]!=null)(high[i]!!+low[i]!!+close[i]!!)/3.0 else null}
        val flow=tp.indices.map{i->if(tp[i]!=null&&volume[i]!=null)tp[i]!!*volume[i]!! else null}
        val out=MutableList<Double?>(close.size){null}
        for(i in period until close.size) {
            var pos=0.0; var neg=0.0; var valid=false
            for(j in i-period+1..i) {
                val cur=tp[j]; val prev=tp[j-1]; val f=flow[j]
                if(cur==null||prev==null||f==null) continue
                valid=true
                if(cur>prev) pos+=f else if(cur<prev) neg+=f
            }
            if(valid) out[i]=if(neg==0.0)100.0 else 100.0-100.0/(1.0+pos/neg)
        }
        return out
    }

    fun rollingReturn(a:List<Double?>,gap:Int):List<Double?> = a.indices.map { i ->
        if(i<gap) null else {
            val end=a[i]; val start=a[i-gap]
            if(end==null||start==null||end<=0.0||start<=0.0||!end.isFinite()||!start.isFinite()) null
            else ((end/start-1.0)*100.0).takeIf{it.isFinite()&&it > -99.5}
        }
    }

    fun maxDrawdown(a:List<Double?>):Double {
        var peak=Double.NEGATIVE_INFINITY
        var mdd=0.0
        for(x in a.filterNotNull().filter{it.isFinite()}) {
            peak=max(peak,x)
            if(peak>0) mdd=min(mdd,(x/peak-1.0)*100.0)
        }
        return mdd
    }
}
