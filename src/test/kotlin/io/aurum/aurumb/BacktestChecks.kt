package io.aurum.aurumb

import io.aurum.aurumb.backtest.*
import java.time.Instant

fun backtestChecks() {
    val samples=(0 until 12).map { i -> DatedSample(Instant.ofEpochSecond(i.toLong()),i) }
    val folds=WalkForward.expanding(samples,minTrain=4,validationSize=2,testSize=2,step=2)
    check(folds.isNotEmpty())
    check(folds.all { it.train.maxOf{s->s.at} < it.validation.minOf{s->s.at} })
    check(folds.all { it.validation.maxOf{s->s.at} < it.test.minOf{s->s.at} })
}
