package io.aurum.aurumb.ui

/** Exact external table contract extracted from the legacy final runtime. */
object LegacyTableContracts {
    val bDataHeaders:List<String> by lazy {
        val t0=listOf(
            "Hisse","VeriZamani","Anlik","AnlikDegisim%","Degisim3Gun(%)_T0","Destekler(3)_T0","Direncler(3)_T0",
            "KapanisTarihi_T0","FiyatDegisim%_T0","Kapanis_T0","Min_T0","Max_T0","Hacim_T0","HacimDegisim%_T0",
            "EMA20_T0","EMA50_T0","EMA200_T0","MACD_T0","MACDSignal_T0","MACDHist_T0","RSI14_T0","Momentum10_T0",
            "Volatilite5G_T0","Volatilite21G_T0","Volatilite63G_T0","Boll_Orta_T0","Boll_Std_T0","Boll_Alt_T0","Boll_Ust_T0",
            "PD_T0","SERMAYE_T0","FD_T0","FAVOK_T0","FD_FAVOK_T0","F_K_T0","PD_DD_T0","ROE_Yaklasik_T0","Beta_T0",
            "Teknik_Sinyal_T0","Getiri_TL_1A_T0","Getiri_TL_3A_T0","Getiri_TL_6A_T0",
            "Getiri_USD_1A_T0","Getiri_USD_3A_T0","Getiri_USD_6A_T0","Getiri_XU_1A_T0","Getiri_XU_3A_T0","Getiri_XU_6A_T0"
        )
        fun hist(start:Int,end:Int,full:Boolean)=buildList {
            for(n in start..end) {
                add("FiyatDegisim%_T$n"); add("Kapanis_T$n")
                if(full) { add("Min_T$n"); add("Max_T$n") }
                add("Hacim_T$n"); add("HacimDegisim%_T$n")
            }
        }
        val extras=listOf(
            "Davranış Skoru","Davranış Tipi","DNA Skoru","DNA Olasılığı","ATR%","Hacim Kırılımı","Göreceli 5G",
            "Tahmini Maliyet%","Piyasa Rejimi","Kalite","Veri Tamlık","Kaynak",
            "İş Yatırım Öneri","İş Yatırım Hedef","İş Yatırım Potansiyel%","Çapraz Uyum"
        )
        buildList { addAll(t0); addAll(hist(1,30,true)); addAll(hist(31,90,false)); addAll(extras) }
            .also { check(it.size==484) }
    }
    val bBands=linkedMapOf("T0" to (0 until 48),"T1_30" to (48 until 228),"T31_60" to (228 until 348),"T61_90" to (348 until 468),"EK" to (468 until 484))
}
