package io.aurum.common.logging

import io.aurum.common.notification.NotificationEvent
import io.aurum.common.notification.NotificationImportance
import java.time.Instant

fun operationalEventPolicyChecks() {
    check(!OperationalEventPolicy.isImportantAudit(
        "INFO","qualified-trade","QUALIFIED_LIFECYCLE_SUMMARY","AL 3 · SAT 1 · toplam 4 enstrüman"
    ))
    check(OperationalEventPolicy.isImportantAudit(
        "INFO","qualified-trade","MANUAL_QUALIFIED_BUY","THYAO · MANUAL_PRODUCT_CARD"
    ))
    check(OperationalEventPolicy.isImportantAudit(
        "WARN","scheduler","SCHEDULER_FAILED","Alarm yeniden kurulamadı"
    ))
    check(OperationalEventPolicy.isImportantAudit(
        "INFO","blocked-universe","INSTRUMENT_LOCAL_DELETE","THYAO · USER_DELETE_WITHOUT_BLOCK"
    ))

    val routine=NotificationEvent("1","DATA_ROW_OK","Veri","THYAO güncellendi",
        NotificationImportance.NORMAL,"r1",Instant.EPOCH)
    val trade=NotificationEvent("2","TRADE_BUY","AL","THYAO",
        NotificationImportance.NORMAL,"r2",Instant.EPOCH)
    val critical=NotificationEvent("3","OTHER","Kritik","Güvenlik",
        NotificationImportance.CRITICAL,"r3",Instant.EPOCH)
    val model=NotificationEvent("4","MODEL_PROMOTED","Model","Aday model şampiyon oldu",
        NotificationImportance.NORMAL,"r4",Instant.EPOCH)
    check(!OperationalEventPolicy.isImportantNotification(routine))
    check(OperationalEventPolicy.isImportantNotification(trade))
    check(OperationalEventPolicy.isImportantNotification(critical))
    check(OperationalEventPolicy.isImportantNotification(model))

    val manualThyao=OperationalEventPolicy.dedupeKey(
        "qualified-trade","MANUAL_QUALIFIED_BUY","THYAO · MANUAL_PRODUCT_CARD"
    )
    val manualGaran=OperationalEventPolicy.dedupeKey(
        "qualified-trade","MANUAL_QUALIFIED_BUY","GARAN · MANUAL_PRODUCT_CARD"
    )
    check(manualThyao!=manualGaran)

    val idA=OperationalEventPolicy.dedupeKey(
        "scheduler","SCHEDULER_FAILED","job 01234567-89ab-cdef-0123-456789abcdef failed"
    )
    val idB=OperationalEventPolicy.dedupeKey(
        "scheduler","SCHEDULER_FAILED","job fedcba98-7654-3210-fedc-ba9876543210 failed"
    )
    check(idA==idB)
}
