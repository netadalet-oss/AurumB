package io.aurum.aurumb.backtest

import java.time.Instant

data class DatedSample<T>(val at:Instant,val value:T)
data class WalkForwardFold<T>(val train:List<DatedSample<T>>,val validation:List<DatedSample<T>>,val test:List<DatedSample<T>>)

object WalkForward {
    fun <T> expanding(
        samples:List<DatedSample<T>>,
        minTrain:Int,
        validationSize:Int,
        testSize:Int,
        step:Int=testSize
    ):List<WalkForwardFold<T>> {
        require(minTrain>0 && validationSize>0 && testSize>0 && step>0)
        val sorted=samples.sortedBy{it.at}
        require(sorted.map{it.at}.distinct().size==sorted.size) { "duplicate sample timestamp" }
        val out=mutableListOf<WalkForwardFold<T>>()
        var trainEnd=minTrain
        while(trainEnd+validationSize+testSize<=sorted.size){
            val train=sorted.subList(0,trainEnd)
            val validation=sorted.subList(trainEnd,trainEnd+validationSize)
            val test=sorted.subList(trainEnd+validationSize,trainEnd+validationSize+testSize)
            require(train.maxOf{it.at}<validation.minOf{it.at})
            require(validation.maxOf{it.at}<test.minOf{it.at})
            out += WalkForwardFold(train.toList(),validation.toList(),test.toList())
            trainEnd += step
        }
        return out
    }
}
