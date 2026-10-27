package io.aurum.aurumb.provider

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class GoogleNewsRssProviderTest {
    @Test
    fun parsesTimestampedHttpsItems() {
        val xml="""<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0"><channel>
              <item>
                <title>AEX stijgt na ECB-besluit</title>
                <link>https://news.google.com/rss/articles/example</link>
                <pubDate>Thu, 01 Oct 2026 10:30:00 GMT</pubDate>
                <source>Example Finance</source>
              </item>
            </channel></rss>
        """.trimIndent().toByteArray()
        val rows=GoogleNewsRssProvider.parse(xml,"google-news-rss","fp")
        assertEquals(1,rows.size)
        assertEquals(Instant.parse("2026-10-01T10:30:00Z"),rows.single().publishedAt)
        assertEquals("Example Finance",rows.single().source)
        assertTrue(rows.single().link.startsWith("https://"))
    }

    @Test
    fun ignoresNonHttpsItems() {
        val xml="""<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0"><channel>
              <item>
                <title>Unsafe link</title>
                <link>http://example.com/item</link>
                <pubDate>Thu, 01 Oct 2026 10:30:00 GMT</pubDate>
              </item>
            </channel></rss>
        """.trimIndent().toByteArray()
        assertTrue(GoogleNewsRssProvider.parse(xml,"google-news-rss","fp").isEmpty())
    }

    @Test
    fun rejectsDoctypePayload() {
        val xml="""<?xml version="1.0"?>
            <!DOCTYPE rss [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
            <rss version="2.0"><channel>
              <item>
                <title>&xxe;</title>
                <link>https://news.google.com/rss/articles/example</link>
                <pubDate>Thu, 01 Oct 2026 10:30:00 GMT</pubDate>
              </item>
            </channel></rss>
        """.trimIndent().toByteArray()
        assertThrows(Exception::class.java) {
            GoogleNewsRssProvider.parse(xml,"google-news-rss","fp")
        }
    }
}
