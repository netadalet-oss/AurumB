package io.aurum.aurumb.notification

import android.content.Context
import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.persistence.TradeAlertOutboxEntity
import io.aurum.aurumb.signal.QualifiedLifecycleEvent
import io.aurum.aurumb.security.SecureSecretStore
import io.aurum.aurumb.network.AllowedHostsInterceptor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant

data class TradeAlertConfig(
    val email:String,
    val relayUrl:String,
    val configured:Boolean
)

data class TradeAlertSendResult(val ok:Boolean,val status:String,val detail:String?=null)

class TradeAlertDeliveryService(
    context:Context,
    private val dao:AurumDao
) {
    private val app=context.applicationContext
    private val prefs=app.getSharedPreferences("aurumb.trade-alert.v1",Context.MODE_PRIVATE)
    private val secrets=SecureSecretStore(app)
    private val client=OkHttpClient.Builder()
        .connectTimeout(Duration.ofSeconds(8))
        .readTimeout(Duration.ofSeconds(15))
        .callTimeout(Duration.ofSeconds(20))
        .followRedirects(true)
        .followSslRedirects(true)
        .addInterceptor(AllowedHostsInterceptor(setOf(
            "script.google.com",
            "script.googleusercontent.com"
        )))
        .build()

    fun config():TradeAlertConfig {
        val email=prefs.getString("email","").orEmpty().trim()
        val base=prefs.getString("relayBase","").orEmpty().trim()
        val token=runCatching{secrets.get(TOKEN_KEY)}.getOrNull()
        val relay=try {
            if(base.isBlank() || token==null || token.isEmpty()) ""
            else base.toHttpUrlOrNull()?.newBuilder()
                ?.setQueryParameter("token",token.concatToString())
                ?.build()?.toString().orEmpty()
        } finally {
            token?.fill('\u0000')
        }
        return TradeAlertConfig(email,relay,email.isNotBlank()&&relay.isNotBlank())
    }

    fun saveConfig(emailRaw:String,relayRaw:String):TradeAlertConfig {
        val email=emailRaw.trim()
        require(email.isBlank() || EMAIL.matches(email)) { "Geçerli alıcı e-posta adresi gerekli" }
        val relay=relayRaw.trim()
        if(relay.isBlank()) {
            secrets.remove(TOKEN_KEY)
            prefs.edit().putString("email",email).putString("relayBase","").apply()
            return TradeAlertConfig(email,"",false)
        }
        val url=relay.toHttpUrlOrNull() ?: throw IllegalArgumentException("Relay URL geçersiz")
        require(url.isHttps && url.host.equals("script.google.com",ignoreCase=true)) {
            "Geçerli Google Apps Script HTTPS /exec URL gerekli"
        }
        require(Regex("^/macros/s/[^/]+/exec$").matches(url.encodedPath)) {
            "Geçerli Google Apps Script /exec URL gerekli"
        }
        val token=url.queryParameter("token")?.trim().orEmpty()
        require(token.isNotEmpty()) { "URL sonunda ?token=... gerekli" }
        val base=url.newBuilder().removeAllQueryParameters("token").build().toString()
        secrets.put(TOKEN_KEY,token.toCharArray())
        prefs.edit().putString("email",email).putString("relayBase",base).apply()
        return config()
    }

    suspend fun enqueueAndFlush(
        events:List<QualifiedLifecycleEvent>,
        runId:String,
        at:Instant
    ):TradeAlertSendResult? {
        if(events.isEmpty()) {
            flush()
            return null
        }
        val eventIds=events.map{runId+":"+it.symbol+":"+it.side.name}.sorted()
        val eventId="TRADE_LIST|"+eventIds.joinToString("|")
        val activeBuys=dao.qualifiedTradeStates()
            .filter{it.status=="BUY"}
            .map{it.symbol}
            .distinct().sorted()
        val currentSells=events.filter{it.side.name=="SELL"}.map{it.symbol}.distinct().sorted()
        val currentBuys=events.filter{it.side.name=="BUY"}.map{it.symbol}.distinct().sorted()
        val holdings=dao.portfolioPositions().map{it.symbol}.distinct().sorted()
        val cfg=config()
        val payload=JSONObject()
            .put("type","AURUM_AL_SAT")
            .put("recipient",cfg.email)
            .put("event",JSONObject()
                .put("id",eventId)
                .put("at",at.toString())
                .put("tradeDate",at.toString().take(10))
                .put("jobId",runId)
                .put("snapshotId",runId)
                .put("buys",JSONArray(currentBuys))
                .put("sells",JSONArray(currentSells)))
            .put("lists",JSONObject()
                .put("activeBuys",JSONArray(activeBuys))
                .put("currentSells",JSONArray(currentSells)))
            .put("portfolio",JSONObject()
                .put("activeHoldings",JSONArray(holdings)))
            .toString()
        dao.insertTradeAlertOutbox(TradeAlertOutboxEntity(
            eventId=eventId,
            createdAtUtc=at.toString(),
            payloadJson=payload,
            state="PENDING",
            attempts=0,
            lastAttemptAtUtc=null,
            sentAtUtc=null,
            lastError=null
        ))
        return flush().lastOrNull()
    }

    suspend fun flush():List<TradeAlertSendResult> {
        val cfg=config()
        if(!cfg.configured) return emptyList()
        val out=mutableListOf<TradeAlertSendResult>()
        for(row in dao.pendingTradeAlertOutbox(50)) {
            val now=Instant.now()
            val result=sendPayload(row.payloadJson,cfg)
            dao.updateTradeAlertOutbox(row.copy(
                state=if(result.ok)"SENT" else "ERROR",
                attempts=row.attempts+1,
                lastAttemptAtUtc=now.toString(),
                sentAtUtc=if(result.ok)now.toString() else row.sentAtUtc,
                lastError=if(result.ok)null else (result.status+(result.detail?.let{" · "+it}?:"")).take(500)
            ))
            out+=result
        }
        return out
    }

    suspend fun test(emailRaw:String,relayRaw:String):TradeAlertSendResult {
        val cfg=saveConfig(emailRaw,relayRaw)
        require(cfg.configured) { "E-posta ve relay adresi gerekli" }
        val now=Instant.now()
        val payload=JSONObject()
            .put("type","AURUM_AL_SAT")
            .put("recipient",cfg.email)
            .put("event",JSONObject()
                .put("id","TEST|"+now.toEpochMilli())
                .put("at",now.toString())
                .put("tradeDate",now.toString().take(10))
                .put("jobId","")
                .put("snapshotId","")
                .put("buys",JSONArray(listOf("TEST")))
                .put("sells",JSONArray())
                .put("test",true))
            .put("portfolio",JSONObject().put("activeHoldings",JSONArray()))
            .toString()
        return sendPayload(payload,cfg)
    }

    private suspend fun sendPayload(payload:String,cfg:TradeAlertConfig):TradeAlertSendResult =
        withContext(Dispatchers.IO) {
            val url=cfg.relayUrl.toHttpUrlOrNull()
                ?: return@withContext TradeAlertSendResult(false,"INVALID_RELAY_URL")
            val routedPayload=runCatching {
                JSONObject(payload).put("recipient",cfg.email).toString()
            }.getOrElse { payload }
            val endpoint=url.newBuilder()
                .setQueryParameter("mode","send")
                .setQueryParameter("transport","AURUM_NATIVE_GET_R220")
                .setQueryParameter("payload",routedPayload)
                .build()
            if(endpoint.toString().length>7200)
                return@withContext TradeAlertSendResult(false,"RELAY_URL_TOO_LONG",endpoint.toString().length.toString())
            try {
                val request=Request.Builder()
                    .url(endpoint)
                    .get()
                    .header("Accept","application/json")
                    .header("X-Aurum-Relay","REV20.20")
                    .build()
                client.newCall(request).execute().use { response ->
                    val body=response.body?.string().orEmpty()
                    val json=runCatching{JSONObject(body)}.getOrNull()
                    if(json?.optBoolean("ok")==true) {
                        val status=json.optString("status","SENT")
                        return@withContext TradeAlertSendResult(
                            status.equals("SENT",true)||status.equals("ALREADY_SENT",true),
                            status,
                            body.take(260)
                        )
                    }
                    if(json?.has("ok")==true && !json.optBoolean("ok")) {
                        return@withContext TradeAlertSendResult(
                            false,
                            json.optString("error",json.optString("status","RELAY_REJECTED")),
                            body.take(260)
                        )
                    }
                    if(!response.isSuccessful)
                        return@withContext TradeAlertSendResult(false,"HTTP_"+response.code,body.take(260))
                    TradeAlertSendResult(false,"HTTP_OK_BUT_UNCONFIRMED",body.take(260))
                }
            } catch(t:Throwable) {
                TradeAlertSendResult(false,"NATIVE_GET_FAILED",t.message?.take(260))
            }
        }

    companion object {
        private const val TOKEN_KEY="trade-alert-relay-token"
        private val EMAIL=Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")
    }
}
