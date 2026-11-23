package dev.localoperator.teambridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import java.io.ByteArrayOutputStream
import java.net.URL
import java.io.IOException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * The sender's photo for a Team Bridge notification (ADR 0010 S5, step 2).
 *
 * THE CAPABILITY. The cloud adds `sender.photo = {url, nonce}` only when the
 * sender has a photo. The nonce is an opaque, short-lived, server-stored
 * capability (ADR 0010 §3, §6): presented ONLY as `Authorization: PushAvatar
 * <nonce>`, never in a URL, because URL logs keep paths and headers are
 * redacted. The server answers every failure with the same 404.
 *
 * RULES, each a guard below:
 * - only to the REGISTERED hub origin (JS hands it over, `HubOrigin`): a
 *   payload naming another host gets no request and no nonce;
 * - redirects OFF: a 3xx could carry the Authorization header elsewhere;
 * - a hard budget (`BUDGET_MS`, the manager's ≤ 3 s): the notification waits
 *   at most this long, then posts with initials;
 * - a byte cap and a decode-bounds check before any full decode;
 * - NO LOGGING of the nonce, the URL's response or its bytes (ADR 0010 §6);
 * - no disk cache: the bitmap lives only in the posted notification/shortcut.
 *
 * Every failure returns null and the caller draws initials. Never throws.
 */
internal object PushAvatarFetcher {
  /** Total wall-clock budget for connect + read, from the manager's S5 brief. */
  const val BUDGET_MS = 3_000
  /** The server serves one 256 px derivative; 512 KiB is generous headroom
   *  and still bounds a hostile or broken response. */
  private const val MAX_BYTES = 512 * 1024
  /** Decoded side bound before allocation (a 256 px avatar; 1024 refuses a
   *  decompression bomb without rejecting a slightly larger derivative). */
  private const val MAX_SIDE = 1024

  private val NONCE = Regex("^[A-Za-z0-9_-]{22}$")

  data class Photo(val url: String, val nonce: String)

  /** Pure: the request target, or null when the payload may not be fetched. */
  fun target(photo: Photo?, registeredOrigin: String?): URL? {
    if (photo == null || registeredOrigin == null) return null
    if (!NONCE.matches(photo.nonce)) return null
    val url = try { URL(photo.url) } catch (_: Exception) { return null }
    val origin = try { URL(registeredOrigin) } catch (_: Exception) { return null }
    if (url.query != null || url.ref != null || url.userInfo != null) return null
    if (!sameOrigin(url, origin)) return null
    // HTTPS always, except a loopback hub (the instrumentation stub): a
    // loopback socket never leaves the device.
    if (url.protocol != "https" && !(url.protocol == "http" && isLoopback(url.host))) return null
    return url
  }

  private fun port(url: URL) = if (url.port == -1) url.defaultPort else url.port

  private fun sameOrigin(a: URL, b: URL) =
    a.protocol.equals(b.protocol, ignoreCase = true) &&
      a.host.equals(b.host, ignoreCase = true) &&
      port(a) == port(b)

  private fun isLoopback(host: String) = host == "127.0.0.1" || host == "localhost" || host == "[::1]"

  /**
   * NO CONNECTION REUSE (#304 QA R5 Q10). Pushes arrive seconds to minutes
   * apart, far past most servers' keep-alive (Node's 5 s, a load balancer's
   * idle timeout), while OkHttp keeps an idle socket for 5 min. OkHttp 4.9
   * health-checks a pooled socket for a GET only locally (`isHealthy` skips
   * the EOF probe unless the method is not GET, and even then probes only a
   * socket idle for >= 10 s, `IDLE_CONNECTION_HEALTHY_NS`), so the next photo
   * is written to a socket the server already closed and fails at once — and with
   * `retryOnConnectionFailure(false)` (kept: one attempt, one nonce
   * presentation, inside the budget) nothing recovers it. The sender's face
   * then silently became initials for every photo push after the first in a
   * live process. A fresh connection per photo costs one handshake inside the
   * 3 s budget; a pool of 0 idle connections closes each socket on release.
   */
  private val client by lazy {
    OkHttpClient.Builder()
      .followRedirects(false)
      .followSslRedirects(false)
      .retryOnConnectionFailure(false)
      .connectionPool(ConnectionPool(0, 1, TimeUnit.SECONDS))
      .build()
  }

  /** Bound the caller as well as the socket. DNS, dispatcher queueing and
   * bitmap decode can otherwise hold up delivery even with a call timeout. */
  fun fetch(photo: Photo?, registeredOrigin: String?, side: Int, budgetMs: Int = BUDGET_MS): Bitmap? {
    val url = target(photo, registeredOrigin) ?: return null
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMs.toLong())
    val result = CompletableFuture<Bitmap?>()
    // Recheck the actual HTTP client's canonical authority before attaching
    // the capability: java.net.URL and HttpUrl normalize inputs differently.
    val target = url.toString().toHttpUrlOrNull() ?: return null
    val origin = registeredOrigin?.toHttpUrlOrNull() ?: return null
    if (target.scheme != origin.scheme || target.host != origin.host || target.port != origin.port ||
      target.username.isNotEmpty() || target.password.isNotEmpty() || target.query != null || target.fragment != null) return null
    val call = client.newCall(Request.Builder().url(target)
      .header("Authorization", "PushAvatar ${photo!!.nonce}")
      .header("Accept", "image/png, image/jpeg")
      .build())
    call.timeout().deadlineNanoTime(deadline)
    return try {
      call.enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { result.complete(null) }

        override fun onResponse(call: Call, response: Response) {
          val image = try {
            response.use { readPhoto(it, side) }
          } catch (_: Exception) { null }
          if (!result.complete(image)) image?.recycle()
        }
      })
      result.get(deadline - System.nanoTime(), TimeUnit.NANOSECONDS)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      null
    } catch (_: Exception) {
      null
    } finally {
      // A passed deadline must also release the socket, not just abandon a wait.
      if (result.complete(null)) call.cancel()
    }
  }

  private fun readPhoto(response: Response, side: Int): Bitmap? {
    if (response.code != 200) return null
    val body = response.body ?: return null
    if (body.contentLength() > MAX_BYTES) return null
    val bytes = ByteArrayOutputStream()
    val buffer = ByteArray(8 * 1024)
    body.byteStream().use { input ->
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        if (bytes.size() + read > MAX_BYTES) return null
        bytes.write(buffer, 0, read)
      }
    }
    return decodeCircle(bytes.toByteArray(), side)
  }

  /** Bounds-checked decode, centre-crop to a circle at `side` px (transparent
   *  corners, like the initials face, so the OS crop has no halo). */
  fun decodeCircle(bytes: ByteArray, side: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    if (bounds.outWidth > MAX_SIDE || bounds.outHeight > MAX_SIDE) return null
    val source = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
    val out = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val scale = side.toFloat() / minOf(source.width, source.height)
    val matrix = Matrix().apply {
      setScale(scale, scale)
      postTranslate((side - source.width * scale) / 2f, (side - source.height * scale) / 2f)
    }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
      shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply { setLocalMatrix(matrix) }
    }
    Canvas(out).drawOval(RectF(0f, 0f, side.toFloat(), side.toFloat()), paint)
    source.recycle()
    return out
  }
}

/**
 * The registered hub origin, handed over by JS (`android-presentation.ts`,
 * from `RADIENT_API_BASE`) and kept for the killed-app case. Without one, no
 * photo is ever fetched: initials only.
 */
internal object HubOrigin {
  private const val FILE = "dev.localoperator.teambridge.hub"
  private const val KEY = "origin"

  fun save(context: Context, origin: String) {
    val parsed = try { URL(origin) } catch (_: Exception) { return }
    if (parsed.protocol != "https" || parsed.host.isNullOrEmpty()) return
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(KEY, origin).apply()
  }

  fun get(context: Context): String? =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null)
}
