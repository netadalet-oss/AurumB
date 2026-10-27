package io.aurum.aurumb

import io.aurum.aurumb.ui.LegacyTableContracts

fun legacyTableContractChecks() {
    val h=LegacyTableContracts.bDataHeaders
    check(h.size==484)
    check(h.first()=="Hisse")
    check(h[47]=="Getiri_XU_6A_T0")
    check(h[48]=="FiyatDegisim%_T1")
    check(h[227]=="HacimDegisim%_T30")
    check(h[228]=="FiyatDegisim%_T31")
    check(h[347]=="HacimDegisim%_T60")
    check(h[348]=="FiyatDegisim%_T61")
    check(h[467]=="HacimDegisim%_T90")
    check(h[468]=="Davranış Skoru")
    check(h[483]=="Çapraz Uyum")
    check(LegacyTableContracts.bBands.values.flatMap{it.toList()}==(0 until 484).toList())
    check(h.takeLast(16)==listOf(
        "Davranış Skoru","Davranış Tipi","DNA Skoru","DNA Olasılığı","ATR%","Hacim Kırılımı","Göreceli 5G",
        "Tahmini Maliyet%","Piyasa Rejimi","Kalite","Veri Tamlık","Kaynak",
        "İş Yatırım Öneri","İş Yatırım Hedef","İş Yatırım Potansiyel%","Çapraz Uyum"
    ))
}
