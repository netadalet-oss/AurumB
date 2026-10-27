package io.aurum.common.ai
import java.time.Instant
data class AiRequest(val schemaVersion:String,val marketFingerprint:String,val purpose:String,val payloadJson:String,val requestedAt:Instant)
data class AiAdvisory(val schemaVersion:String,val summary:String,val risks:List<String>,val candidateWeights:Map<String,Double>?,val confidence:Double)
sealed interface AiResult { data class Success(val advisory:AiAdvisory,val responseFingerprint:String):AiResult; data class Failure(val code:String,val retryable:Boolean):AiResult }
interface AiClient { suspend fun advise(request:AiRequest):AiResult }
