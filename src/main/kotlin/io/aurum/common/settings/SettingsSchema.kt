package io.aurum.common.settings

import java.math.BigDecimal

enum class SettingType { DECIMAL, INTEGER, BOOLEAN, STRING }
enum class SettingScope { MARKET, RISK, LEARNING, AI, NOTIFICATION, UI, SYSTEM }

data class SettingSpec(
    val key:String,
    val type:SettingType,
    val defaultValue:String,
    val min:BigDecimal?=null,
    val max:BigDecimal?=null,
    val description:String,
    val scope:SettingScope,
    val userEditable:Boolean=true
)

data class SettingsResolution(
    val values:Map<String,String>,
    val repairedKeys:List<String>
)

object SettingsSchema {
    const val VERSION=10
    val specs=listOf(
        SettingSpec("commissionBps",SettingType.DECIMAL,"8",BigDecimal.ZERO,BigDecimal("100"),"Tek yön komisyon baz puanı",SettingScope.RISK),
        SettingSpec("slippageBps",SettingType.DECIMAL,"12",BigDecimal.ZERO,BigDecimal("200"),"Baz slippage baz puanı",SettingScope.RISK),
        SettingSpec("maxParticipationPct",SettingType.DECIMAL,"2",BigDecimal("0.05"),BigDecimal("20"),"Pozisyon/medyan işlem değeri üst sınırı",SettingScope.RISK),
        SettingSpec("assumedPositionTRY",SettingType.DECIMAL,"100000",BigDecimal("1"),BigDecimal("100000000"),"Sanal uygulanabilirlik pozisyon büyüklüğü",SettingScope.RISK),
        SettingSpec("minTurnoverM",SettingType.DECIMAL,"5",BigDecimal.ZERO,BigDecimal("100000"),"Minimum 21 günlük medyan işlem değeri, milyon TRY",SettingScope.MARKET),
        SettingSpec("minPrice",SettingType.DECIMAL,"0.5",BigDecimal("0.01"),BigDecimal("1000000"),"Minimum hisse fiyatı",SettingScope.MARKET),
        SettingSpec("qualityMin",SettingType.INTEGER,"60",BigDecimal.ZERO,BigDecimal("100"),"Minimum veri kalite puanı",SettingScope.MARKET),
        SettingSpec("dataCellCompletenessPct",SettingType.DECIMAL,"70",BigDecimal("1"),BigDecimal("100"),"Tablo/satır/sütun hücre doluluk eşiği (%)",SettingScope.MARKET),
        SettingSpec("transferQualityTier1Pct",SettingType.INTEGER,"100",BigDecimal("1"),BigDecimal("100"),"Ana aktarım kalite 1. eşik (%)",SettingScope.MARKET),
        SettingSpec("transferQualityTier2Pct",SettingType.INTEGER,"95",BigDecimal("1"),BigDecimal("100"),"Ana aktarım kalite 2. eşik (%)",SettingScope.MARKET),
        SettingSpec("transferQualityTier3Pct",SettingType.INTEGER,"90",BigDecimal("1"),BigDecimal("100"),"Ana aktarım kalite 3. eşik (%)",SettingScope.MARKET),
        SettingSpec("transferQualityTier4Pct",SettingType.INTEGER,"80",BigDecimal("1"),BigDecimal("100"),"Ana aktarım kalite 4. eşik (%)",SettingScope.MARKET),
        SettingSpec("transferQualityTier5Pct",SettingType.INTEGER,"70",BigDecimal("1"),BigDecimal("100"),"Ana aktarım kalite 5. eşik (%)",SettingScope.MARKET),
        SettingSpec("providerRetryCount",SettingType.INTEGER,"5",BigDecimal.ONE,BigDecimal("10"),"Provider azami deneme sayısı",SettingScope.SYSTEM),
        SettingSpec("maxDailyMovePct",SettingType.DECIMAL,"12.5",BigDecimal("0.1"),BigDecimal("100"),"Geçici hesap-dışı aşırı hareket eşiği (%)",SettingScope.MARKET,userEditable=false),
        SettingSpec("sfContinuousMinutes",SettingType.INTEGER,"240",BigDecimal("1"),BigDecimal("1440"),"S/F kesintisiz AL hakedişi (dakika)",SettingScope.RISK,userEditable=false),
        SettingSpec("sfFinalWindowMinutes",SettingType.INTEGER,"120",BigDecimal("1"),BigDecimal("480"),"Seans sonu AL hakediş penceresi (dakika)",SettingScope.RISK,userEditable=false),
        SettingSpec("sfPostOpenMinutes",SettingType.INTEGER,"120",BigDecimal("1"),BigDecimal("480"),"Seans sonrası giriş için açılıştan AL hakedişi (dakika)",SettingScope.RISK,userEditable=false),
        SettingSpec("maxStopLossPct",SettingType.DECIMAL,"3",BigDecimal("0.1"),BigDecimal("50"),"Alış fiyatına göre azami zarar-kes (%)",SettingScope.RISK),
        SettingSpec("technicalStopAtrMultiplier",SettingType.DECIMAL,"1.5",BigDecimal("0.1"),BigDecimal("10"),"Teknik stop ATR çarpanı",SettingScope.RISK),
        SettingSpec("technicalStopFallbackPct",SettingType.DECIMAL,"5",BigDecimal("0.1"),BigDecimal("50"),"ATR yoksa teknik stop geri çekilmesi (%)",SettingScope.RISK),
        SettingSpec("technicalStopSupportBufferPct",SettingType.DECIMAL,"0.5",BigDecimal.ZERO,BigDecimal("20"),"Destek altı teknik stop tamponu (%)",SettingScope.RISK),
        SettingSpec("profitLockStartPct",SettingType.DECIMAL,"5",BigDecimal("0.1"),BigDecimal("500"),"Kâr kilidinin başladığı zirve getiri (%)",SettingScope.RISK),
        SettingSpec("profitLockInitialPullbackPct",SettingType.DECIMAL,"2",BigDecimal("0.1"),BigDecimal("100"),"İlk kâr kilidi azami geri çekilme (puan)",SettingScope.RISK),
        SettingSpec("profitLockStepStartPct",SettingType.DECIMAL,"20",BigDecimal("0.1"),BigDecimal("500"),"Basamaklı kâr kilidinin başladığı zirve (%)",SettingScope.RISK),
        SettingSpec("profitLockStepSizePct",SettingType.DECIMAL,"10",BigDecimal("0.1"),BigDecimal("100"),"Kâr kilidi zirve basamak büyüklüğü (puan)",SettingScope.RISK),
        SettingSpec("profitLockStepPullbackPct",SettingType.DECIMAL,"2",BigDecimal("0.1"),BigDecimal("100"),"Her kâr kilidi basamağı başına izin verilen geri çekilme (puan)",SettingScope.RISK),
        SettingSpec("topN",SettingType.INTEGER,"20",BigDecimal.ONE,BigDecimal("20"),"Seçilecek azami aday sayısı",SettingScope.MARKET),
        SettingSpec("adaptiveSelection",SettingType.BOOLEAN,"true",description="Adaptive seçim filtrelerini etkinleştir",scope=SettingScope.RISK),
        SettingSpec("minSelectionScore",SettingType.DECIMAL,"58",BigDecimal.ZERO,BigDecimal("100"),"Minimum final seçim puanı",SettingScope.RISK),
        SettingSpec("minTargetProbability",SettingType.DECIMAL,"0.04",BigDecimal.ZERO,BigDecimal.ONE,"Minimum hedef olasılığı",SettingScope.RISK),
        SettingSpec("maxExecutionRisk",SettingType.DECIMAL,"0.70",BigDecimal.ZERO,BigDecimal.ONE,"Maksimum execution risk",SettingScope.RISK),
        SettingSpec("sectorMaxPct",SettingType.DECIMAL,"0.20",BigDecimal("0.05"),BigDecimal.ONE,"Bilinen sektörler için maksimum portföy payı",SettingScope.RISK),
        SettingSpec("pairwiseMaxCorr",SettingType.DECIMAL,"0.80",BigDecimal("-1"),BigDecimal.ONE,"Maksimum pairwise korelasyon",SettingScope.RISK),
        SettingSpec("targetReturnPct",SettingType.DECIMAL,"5",BigDecimal("0.1"),BigDecimal("100"),"Kısa vadeli hedef getiri yüzdesi",SettingScope.LEARNING),
        SettingSpec("crossSectionalTargetPct",SettingType.DECIMAL,"0.05",BigDecimal("0.001"),BigDecimal("1"),"Reel çapraz-kesit hedef oranı",SettingScope.LEARNING),
        SettingSpec("learningHalfLifeDays",SettingType.INTEGER,"20",BigDecimal.ONE,BigDecimal("3650"),"Arşiv öğrenme yarı ömrü (gün)",SettingScope.LEARNING),
        SettingSpec("behaviorLookbackDays",SettingType.INTEGER,"252",BigDecimal("21"),BigDecimal("2000"),"Davranış bakış süresi (seans)",SettingScope.LEARNING),
        SettingSpec("behaviorMinSamples",SettingType.INTEGER,"40",BigDecimal.ONE,BigDecimal("1000"),"Minimum davranış örneği",SettingScope.LEARNING),
        SettingSpec("behaviorLifetimeWeight",SettingType.DECIMAL,"0.30",BigDecimal.ZERO,BigDecimal("0.6"),"Davranış lifetime ağırlığı",SettingScope.LEARNING),
        SettingSpec("genomeLookbackDays",SettingType.INTEGER,"252",BigDecimal("63"),BigDecimal("2000"),"Genome bakış süresi (seans)",SettingScope.LEARNING),
        SettingSpec("genomeNearestNeighbors",SettingType.INTEGER,"40",BigDecimal("5"),BigDecimal("500"),"Genome yakın komşu sayısı",SettingScope.LEARNING),
        SettingSpec("genomeMinAnalogs",SettingType.INTEGER,"20",BigDecimal.ONE,BigDecimal("500"),"Minimum genome analog sayısı",SettingScope.LEARNING),
        SettingSpec("genomePriorStrength",SettingType.DECIMAL,"16",BigDecimal.ZERO,BigDecimal("500"),"Genome prior gücü",SettingScope.LEARNING),
        SettingSpec("genomeHistoryDays",SettingType.INTEGER,"400",BigDecimal("30"),BigDecimal("5000"),"Genome günlük arşiv süresi (gün)",SettingScope.LEARNING),
        SettingSpec("lookbackDays",SettingType.INTEGER,"450",BigDecimal("120"),BigDecimal("2000"),"Historical bar lookback günü",SettingScope.MARKET),
        SettingSpec("portfolioStartingCapitalTRY",SettingType.DECIMAL,"100000",BigDecimal("1000"),BigDecimal("1000000000"),"Sanal portföy başlangıç sermayesi",SettingScope.RISK),
        SettingSpec("portfolioDefaultPositionTRY",SettingType.DECIMAL,"5000",BigDecimal("100"),BigDecimal("100000000"),"Sanal portföy varsayılan pozisyon büyüklüğü",SettingScope.RISK),
        SettingSpec("aiEnabled",SettingType.BOOLEAN,"false",description="OpenAI denetim modülü etkin",scope=SettingScope.AI),
        SettingSpec("openaiModel",SettingType.STRING,"gpt-5.6-luna",description="OpenAI Responses modeli",scope=SettingScope.AI),
        SettingSpec("openaiMaxOutputTokens",SettingType.INTEGER,"8000",BigDecimal("512"),BigDecimal("16000"),"OpenAI azami çıktı tokenı",SettingScope.AI),
        SettingSpec("openaiReasoningEffort",SettingType.STRING,"low",description="OpenAI muhakeme düzeyi: low, medium veya boş",scope=SettingScope.AI),
        SettingSpec("aiAutoDaily",SettingType.BOOLEAN,"false",description="S tamamlandıktan sonra günlük otomatik AI denetimi",scope=SettingScope.AI),
        SettingSpec("aiDailyHour",SettingType.INTEGER,"19",BigDecimal.ZERO,BigDecimal("23"),"Türkiye saatine göre günlük AI denetim saati",SettingScope.AI),
        SettingSpec("aiAllowCandidates",SettingType.BOOLEAN,"true",description="AI aday model önerisine izin ver",scope=SettingScope.AI),
        SettingSpec("aiMinValidationPeriods",SettingType.INTEGER,"60",BigDecimal("12"),BigDecimal("240"),"AI adayından önce minimum bağımsız ileri dönem",SettingScope.AI),
        SettingSpec("aiMaxRecentRuns",SettingType.INTEGER,"90",BigDecimal("5"),BigDecimal("200"),"AI snapshot azami yakın geçmiş run sayısı",SettingScope.AI),
        SettingSpec("aiDailyPaidCallLimit",SettingType.INTEGER,"2",BigDecimal.ZERO,BigDecimal("24"),"UTC günü başına azami ücretli AI ağ çağrısı",SettingScope.AI),
        SettingSpec("aiRequireManualPaidCall",SettingType.BOOLEAN,"true",description="Manuel ücretli AI çağrısında kullanıcı onayı",scope=SettingScope.AI),
        SettingSpec("aiRequireNewMarketBucket",SettingType.BOOLEAN,"true",description="Ücretli AI çağrısında yeni veri ve yeni piyasa kovası şartı",scope=SettingScope.AI),
        SettingSpec("aiMarketTimeBuckets",SettingType.STRING,"08:20,12:20,18:20,21:30",description="AI piyasa zaman kovaları HH:MM listesi",scope=SettingScope.AI),
        SettingSpec("aiMinAuditConfidenceForCandidate",SettingType.DECIMAL,"0.45",BigDecimal.ZERO,BigDecimal.ONE,"Aday model için minimum AI denetim güveni",SettingScope.AI),
        SettingSpec("aiAutoPromoteValidated",SettingType.BOOLEAN,"false",description="Otomatik model terfisi; güvenlik gereği daima kapalı",scope=SettingScope.AI,userEditable=false),
        SettingSpec("quietHoursEnabled",SettingType.BOOLEAN,"false",description="Bildirim sessiz saatleri",scope=SettingScope.NOTIFICATION),
        SettingSpec("quietHoursStart",SettingType.STRING,"22:00",description="Sessiz saat başlangıcı",scope=SettingScope.NOTIFICATION),
        SettingSpec("quietHoursEnd",SettingType.STRING,"08:00",description="Sessiz saat bitişi",scope=SettingScope.NOTIFICATION),
        SettingSpec("marketPortal",SettingType.STRING,"TR",description="Piyasa portalı: TR veya NL",scope=SettingScope.UI)
    )
    private val byKey=specs.associateBy{it.key}

    fun resolve(raw:Map<String,String>):SettingsResolution {
        val repaired=mutableListOf<String>()
        val values=specs.associate { spec ->
            val candidate=raw[spec.key]
            val valid=when(spec.type) {
                SettingType.DECIMAL -> candidate?.toBigDecimalOrNull()?.let { n ->
                    (spec.min==null||n>=spec.min) && (spec.max==null||n<=spec.max)
                }==true
                SettingType.INTEGER -> candidate?.toIntOrNull()?.let { n ->
                    val b=BigDecimal(n)
                    (spec.min==null||b>=spec.min) && (spec.max==null||b<=spec.max)
                }==true
                SettingType.BOOLEAN -> candidate=="true" || candidate=="false"
                SettingType.STRING -> candidate!=null && candidate.length<=256
            }
            if(!valid && candidate!=null) repaired += spec.key
            spec.key to if(valid) candidate!! else spec.defaultValue
        }
        return SettingsResolution(values,repaired)
    }

    fun spec(key:String):SettingSpec=requireNotNull(byKey[key]){"unknown setting"}
}
