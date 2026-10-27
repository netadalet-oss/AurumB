package io.aurum.aurumb.history

data class KTrendValue(val criterion:String,val hits:Int,val total:Int) {
    init {
        require(criterion.matches(Regex("K[1-7]")))
        require(total>0)
        require(hits in 0..total)
    }
}

object KTrendOrdering {
    fun descending(values:List<KTrendValue>):List<KTrendValue> =
        values.sortedWith(
            compareByDescending<KTrendValue>{it.hits.toDouble()/it.total.toDouble()}
                .thenBy{it.criterion}
        )
}
