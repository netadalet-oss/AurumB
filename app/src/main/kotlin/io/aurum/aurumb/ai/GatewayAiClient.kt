package io.aurum.aurumb.ai

import io.aurum.aurumb.persistence.AiAuditEntity
import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.provider.Fingerprint
import io.aurum.common.ai.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

class GatewayAiClient(
    private val client:OkHttpClient,
    private val endpoint:HttpUrl,
    private val dao:AurumDao,
    private val providerName:String="AURUM_GATEWAY",
    private val modelName:String?=null,
    private val dailyPaidCallLimit:Int=2,
    private val minimumGapMillis:Long=2_000,
    private val clock:()->Instant={Instant.now()}
):AiClient {
    private val gate=Mutex()
    private var lastPaidCallNanos:Long=0L
    private val jsonType="application/json; charset=utf-8".toMediaType()

    init {
        require(endpoint.isHttps) { "AI_GATEWAY_HTTPS_REQUIRED" }
        require(dailyPaidCallLimit in 0..24) { "AI_DAILY_LIMIT_INVALID" }
        require(minimumGapMillis in 0..60_000) { "AI_MIN_GAP_INVALID" }
    }

    override suspend fun advise(request:AiRequest):AiResult {
        cached(request)?.let{return it}
        return gate.withLock {
            cached(request)?.let{return@withLock it}
            val now=clock()
            val dayStart=AiBudget.utcDayStart(now)
            val usedToday=dao.paidAiCallCountSince(dayStart.toString())
            if(!AiBudget.allowsPaidCall(usedToday,dailyPaidCallLimit)) {
                return@withLock AiResult.Failure("DAILY_BUDGET_EXHAUSTED",false)
            }
            val elapsed=System.nanoTime()-lastPaidCallNanos
            val minimumGap=minimumGapMillis*1_000_000L
            if(lastPaidCallNanos!=0L && elapsed<minimumGap) {
                delay((minimumGap-elapsed+999_999L)/1_000_000L)
            }
            val requestBody=buildRequestJson(request).toString().toByteArray(Charsets.UTF_8)
            val requestFingerprint=Fingerprint.sha256(requestBody)
            var lastFailure:AiResult.Failure?=null
            for(attempt in 0..2) {
                if(attempt>0) delay(500L shl (attempt-1))
                val started=clock()
                val dayStart=AiBudget.utcDayStart(started)
                val currentUsed=dao.paidAiCallCountSince(dayStart.toString())
                if(!AiBudget.allowsPaidCall(currentUsed,dailyPaidCallLimit)) {
                    return@withLock AiResult.Failure("DAILY_BUDGET_EXHAUSTED",false)
                }
                lastPaidCallNanos=System.nanoTime()
                val http=Request.Builder()
                    .url(endpoint)
                    .post(requestBody.toRequestBody(jsonType))
                    .header("Accept","application/json")
                    .header("X-Aurum-Request-Fingerprint",requestFingerprint)
                    .build()
                try {
                    client.newCall(http).execute().use { response ->
                        val completed=clock()
                        if(!response.isSuccessful) {
                            val retryable=response.code==408 || response.code==429 || response.code>=500
                            val code="HTTP_"+response.code
                            appendAudit(request,requestFingerprint,null,null,started,completed,"FAILED",code,retryable)
                            lastFailure=AiResult.Failure(code,retryable)
                            if(retryable && attempt<2) return@use
                            return@withLock lastFailure!!
                        }
                        val bytes=response.body?.bytes() ?: ByteArray(0)
                        if(bytes.isEmpty() || bytes.size>1_000_000) {
                            val code=if(bytes.isEmpty())"EMPTY_BODY" else "BODY_TOO_LARGE"
                            appendAudit(request,requestFingerprint,null,null,started,completed,"FAILED",code,false)
                            return@withLock AiResult.Failure(code,false)
                        }
                        val raw=String(bytes,Charsets.UTF_8)
                        val advisory=parseStrict(raw,request.schemaVersion)
                            ?: run {
                                appendAudit(request,requestFingerprint,null,null,started,completed,"FAILED","SCHEMA_INVALID",false)
                                return@withLock AiResult.Failure("SCHEMA_INVALID",false)
                            }
                        val responseFingerprint=Fingerprint.sha256(bytes)
                        appendAudit(request,requestFingerprint,responseFingerprint,raw,started,completed,"SUCCESS",null,false)
                        return@withLock AiResult.Success(advisory,responseFingerprint)
                    }
                } catch (c:CancellationException) {
                    throw c
                } catch (t:Exception) {
                    val completed=clock()
                    appendAudit(request,requestFingerprint,null,null,started,completed,"FAILED","NETWORK",true)
                    lastFailure=AiResult.Failure("NETWORK",true)
                }
            }
            lastFailure ?: AiResult.Failure("UNKNOWN",false)
        }
    }

    private suspend fun cached(request:AiRequest):AiResult.Success? {
        val row=dao.cachedAiSuccess(request.marketFingerprint,request.purpose,request.schemaVersion) ?: return null
        val raw=row.responseJson ?: return null
        val advisory=parseStrict(raw,request.schemaVersion) ?: return null
        return AiResult.Success(advisory,row.responseFingerprint ?: Fingerprint.sha256(raw.toByteArray()))
    }

    private fun buildRequestJson(request:AiRequest)=JSONObject().apply {
        put("schemaVersion",request.schemaVersion)
        put("marketFingerprint",request.marketFingerprint)
        put("purpose",request.purpose)
        put("requestedAt",request.requestedAt.toString())
        put("payload",JSONObject(request.payloadJson))
    }

    private fun parseStrict(raw:String,expectedSchema:String):AiAdvisory? {
        return try {
            val o=JSONObject(raw)
            if(o.optString("schemaVersion")!=expectedSchema) return null
            val summary=o.optString("summary").takeIf{it.isNotBlank() && it.length<=8000} ?: return null
            val confidence=o.optDouble("confidence",Double.NaN)
            if(!confidence.isFinite() || confidence !in 0.0..1.0) return null
            val risksArray=o.optJSONArray("risks") ?: JSONArray()
            val risks=(0 until risksArray.length()).map {
                risksArray.optString(it).takeIf{s->s.isNotBlank() && s.length<=1000} ?: return null
            }
            val weights=if(o.has("candidateWeights") && !o.isNull("candidateWeights")) {
                val w=o.getJSONObject("candidateWeights")
                val keys=w.keys().asSequence().toSet()
                val expected=(1..7).map{"K"+it}.toSet()
                if(keys!=expected) return null
                expected.associateWith { key ->
                    val v=w.optDouble(key,Double.NaN)
                    if(!v.isFinite() || v !in 0.0..1.0) return null
                    v
                }
            } else null
            AiAdvisory(expectedSchema,summary,risks,weights,confidence)
        } catch (_:Exception) {
            null
        }
    }

    private suspend fun appendAudit(
        request:AiRequest,
        requestFingerprint:String,
        responseFingerprint:String?,
        responseJson:String?,
        started:Instant,
        completed:Instant,
        status:String,
        errorCode:String?,
        retryable:Boolean
    ) {
        dao.appendAiAudit(AiAuditEntity(
            id=UUID.randomUUID().toString(),
            marketFingerprint=request.marketFingerprint,
            purpose=request.purpose,
            schemaVersion=request.schemaVersion,
            provider=providerName,
            model=modelName,
            requestedAtUtc=started.toString(),
            completedAtUtc=completed.toString(),
            status=status,
            requestFingerprint=requestFingerprint,
            responseFingerprint=responseFingerprint,
            responseJson=responseJson,
            errorCode=errorCode,
            retryable=retryable,
            paidCall=true
        ))
    }
}
