package dev.localoperator.loopback

import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** No Android dependency: the real socket/parser/state machine is shared by the
 * Expo adapter and the hosted debug proof. HTTP loopback is a registered OAuth
 * redirect, not a scheme a Custom Tab can intercept. Never log callback URLs.
 */
class LoopbackAuthSession(
  private val copy: Map<String, String>,
  private val returnUri: String,
  private val requestReturn: () -> Unit,
  private val completed: (String?, String?) -> Unit,
  private val rejected: () -> Unit = {},
  private val timeoutSeconds: Long = 300,
) {
  private val ended = AtomicBoolean(false)
  private val consumed = AtomicBoolean(false)
  private val permits = Semaphore(8)
  private val clients = ConcurrentHashMap.newKeySet<Socket>()
  private val workers = Executors.newFixedThreadPool(2) { Thread(it, "oauth-callback").apply { isDaemon = true } }
  private val clock = Executors.newSingleThreadScheduledExecutor { Thread(it, "oauth-deadline").apply { isDaemon = true } }
  private var server: ServerSocket? = null
  @Volatile private var state: String? = null
  @Volatile private var pending: String? = null
  @Volatile var redirectUri: String? = null
    private set

  @Synchronized fun prepare(): String {
    check(server == null && !ended.get()) { "ERR_AUTH_BUSY" }
    val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    server = socket
    val redirect = "http://127.0.0.1:${socket.localPort}/callback"
    redirectUri = redirect
    clock.schedule({ finish(null, "ERR_AUTH_TIMEOUT") }, timeoutSeconds, TimeUnit.SECONDS)
    Thread({
      try {
        while (!ended.get() && !socket.isClosed) {
          val client = socket.accept()
          if (!permits.tryAcquire()) { client.close(); continue }
          clients.add(client)
          try {
            // SO_TIMEOUT alone resets on each byte: also bound slow-drip peers
            // by an absolute deadline measured from accept, including queue time.
            val deadline = clock.schedule({ try { client.close() } catch (_: Exception) {} }, 5, TimeUnit.SECONDS)
            workers.execute {
              try { receive(client) }
              finally { deadline.cancel(false); clients.remove(client); client.close(); permits.release() }
            }
          } catch (_: RuntimeException) {
            clients.remove(client); client.close(); permits.release()
          }
        }
      } catch (_: Exception) {
        if (!ended.get() && !consumed.get()) finish(null, "ERR_AUTH_LISTENER")
      }
    }, "oauth-accept").apply { isDaemon = true; start() }
    return redirect
  }

  @Synchronized fun arm(authorizeUrl: String, redirect: String) {
    check(!ended.get() && state == null && redirect == redirectUri) { "ERR_AUTH_NOT_READY" }
    val url = URI(authorizeUrl)
    check(url.scheme == "http" || url.scheme == "https") { "ERR_AUTH_URL" }
    val query = query(url.rawQuery)
    check(query["redirect_uri"] == listOf(redirect)) { "ERR_AUTH_REDIRECT" }
    state = query["state"]?.singleOrNull()?.takeIf { it.isNotEmpty() }
      ?: error("ERR_AUTH_STATE")
  }

  /** Browser close returns a validated pending code, or a genuine cancellation.
   * A return intent itself is never an authentication assertion. */
  fun returned() { finish(pending, null) }
  fun cancel() { finish(null, null) }
  fun fail(code: String) { finish(null, code) }
  fun hasPending(): Boolean = pending != null && !ended.get()
  fun isEnded(): Boolean = ended.get()

  private fun receive(client: Socket) {
    try {
      client.soTimeout = 5000
      val input = client.getInputStream()
      val bytes = ByteArrayOutputStream()
      var tail = 0
      while (bytes.size() < 4096) {
        val value = input.read()
        if (value < 0) break
        bytes.write(value)
        tail = (tail shl 8) or value
        if (tail == 0x0d0a0d0a) break
      }
      val raw = bytes.toString(StandardCharsets.UTF_8.name())
      val callback = validate(raw)
      // Serialize admission with finish/cancel: a late peer must never resurrect
      // a pending authorization result after its owner abandoned the attempt.
      val committed = synchronized(this) {
        if (ended.get() || callback == null || !consumed.compareAndSet(false, true)) false
        else { pending = callback; true }
      }
      if (!committed) {
        rejected()
        reply(client, 400, copy.getValue("invalid"), false)
        return
      }
      try { reply(client, 200, copy.getValue("received"), true) }
      finally {
        // The code/state remain ONLY in this process. The user-gesture fallback
        // contains a package-targeted control URI with no OAuth payload at all.
        // Even a disconnected browser must not leave a consumed listener open.
        server?.close()
        clients.filter { it !== client }.forEach { try { it.close() } catch (_: Exception) {} }
        requestReturn()
      }
    } catch (_: Exception) {
      // A disconnected/malformed local peer must not consume a valid attempt.
      // If a valid request was already committed, returning via Back still works.
      if (consumed.get()) requestReturn()
    }
  }

  private fun validate(raw: String): String? {
    if (ended.get() || !raw.contains("\r\n\r\n")) return null
    val expected = state ?: return null
    val redirect = redirectUri ?: return null
    val lines = raw.split("\r\n")
    val first = lines[0].split(" ")
    if (first.size != 3 || first[0] != "GET" || first[2] != "HTTP/1.1") return null
    val host = URI(redirect).rawAuthority
    val hosts = lines.drop(1).filter { it.substringBefore(':').equals("Host", ignoreCase = true) }
      .map { it.substringAfter(':').trim() }
    if (hosts != listOf(host) || !first[1].startsWith("/callback?")) return null
    return try {
      val url = URI("http://$host${first[1]}")
      if (url.scheme != "http" || url.host != "127.0.0.1" || url.rawAuthority != host ||
          url.rawPath != "/callback" || url.rawFragment != null || url.rawUserInfo != null) return null
      val query = query(url.rawQuery)
      val returnedState = query["state"]?.singleOrNull() ?: return null
      if (!MessageDigest.isEqual(returnedState.toByteArray(StandardCharsets.UTF_8),
          expected.toByteArray(StandardCharsets.UTF_8))) return null
      val code = query["code"]?.singleOrNull()
      val error = query["error"]?.singleOrNull()
      if (code.isNullOrEmpty() && error.isNullOrEmpty()) return null
      url.toASCIIString()
    } catch (_: Exception) { null }
  }

  private fun reply(client: Socket, status: Int, text: String, html: Boolean) {
    val body = if (html) {
      val dir = if (copy["direction"] == "rtl") "rtl" else "ltr"
      "<!doctype html><html dir='$dir'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
        "<meta name='color-scheme' content='light dark'><style>body{font:17px/1.5 system-ui;padding:24px;max-width:40rem}" +
        "a{display:inline-flex;align-items:center;min-height:48px;padding:0 16px}</style><body>" +
        "<p>${escape(text)}</p><a href='${escape(returnUri)}'>${escape(copy.getValue("returnLabel"))}</a></body></html>"
    } else text
    val data = body.toByteArray(StandardCharsets.UTF_8)
    val header = "HTTP/1.1 $status ${if (status == 200) "OK" else "Bad Request"}\r\n" +
      "Content-Type: ${if (html) "text/html" else "text/plain"}; charset=utf-8\r\n" +
      "Content-Length: ${data.size}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n"
    client.getOutputStream().apply { write(header.toByteArray(StandardCharsets.US_ASCII)); write(data); flush() }
  }

  @Synchronized private fun finish(callback: String?, error: String?) {
    if (!ended.compareAndSet(false, true)) return
    try { server?.close() } catch (_: Exception) {}
    clients.forEach { try { it.close() } catch (_: Exception) {} }; clients.clear()
    workers.shutdownNow(); clock.shutdownNow()
    state = null; pending = null
    completed(callback, error)
    requestReturn()
  }

  companion object {
    private fun query(raw: String?): Map<String, List<String>> = (raw ?: "").split('&')
      .filter { it.isNotEmpty() }.map {
        val pair = it.split('=', limit = 2)
        URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair.getOrElse(1) { "" }, "UTF-8")
      }.groupBy({ it.first }, { it.second })
    private fun escape(value: String) = value.replace("&", "&amp;").replace("<", "&lt;")
      .replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")
  }
}
