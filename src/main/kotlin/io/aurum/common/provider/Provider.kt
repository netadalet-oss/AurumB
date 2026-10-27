package io.aurum.common.provider
import io.aurum.common.model.*
import java.math.BigDecimal
import java.time.Instant
data class Observation(val symbol:String,val value:BigDecimal?,val currency:String?,val provenance:Provenance)
sealed interface ProviderResult { data class Success(val observation:Observation):ProviderResult; data class Failure(val provider:String,val code:String,val message:String,val retryable:Boolean):ProviderResult }
interface MarketProvider { val id:String; fun fetch(symbol:String, asOf:Instant):ProviderResult }
