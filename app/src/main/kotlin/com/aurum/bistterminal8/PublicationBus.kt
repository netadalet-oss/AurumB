package com.aurum.bistterminal8

/**
 * Process-local notification from the background pipeline service to the foreground WebView.
 * It carries no market data and starts no network work; the Activity only reloads the durable
 * IndexedDB snapshot that the service has already published.
 */
object PublicationBus {
    @Volatile
    private var listener: (() -> Unit)? = null

    @Synchronized
    fun attach(callback: () -> Unit) {
        listener = callback
    }

    @Synchronized
    fun detach() {
        listener = null
    }

    fun publish() {
        listener?.invoke()
    }
}
