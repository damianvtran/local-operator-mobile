package dev.localoperator.loopback

import android.app.Activity
import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.browser.customtabs.CustomTabsClient
import org.json.JSONObject
import java.io.File
import java.lang.ref.WeakReference
import java.net.ConnectException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLEncoder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/** DEBUG ONLY: actual production core, Custom Tab, activities and TCP traffic.
 * Fixture labels are diagnostic English, not new production chrome. No real
 * provider, OAuth account, credential, tunnel or relay session is involved.
 */
class OAuthProofActivity : Activity(), Application.ActivityLifecycleCallbacks {
  private lateinit var mode: String
  private lateinit var status: TextView
  private var flow: LoopbackAuthSession? = null
  private var provider: ServerSocket? = null
  private val jobs = Executors.newFixedThreadPool(2)
  private val rejected = AtomicInteger()
  private var started = false
  private var ended = false
  @Volatile private var served = false
  @Volatile private var clicked = false
  @Volatile private var fallbackUsed = false
  @Volatile private var destroyed = false
  private var preparedAt = 0L
  private var socketProbesPassed = false
  private var socketProbeRejections = 0
  private var wrongStateRejections = 0
  private var lateRefused: Boolean? = null
  private var stage = "ready"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    mode = intent.getStringExtra("proof_mode") ?: "positive"
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 80, 24, 24) }
    status = TextView(this).apply { textSize = 20f; text = "Ready $mode"; contentDescription = "proof.status" }
    root.addView(status)
    root.addView(Button(this).apply {
      text = "Start $mode"
      setOnClickListener { if (!started) { isEnabled = false; startProof() } }
    })
    setContentView(root)
    application.registerActivityLifecycleCallbacks(this)
    persist(null, "ready")
  }

  private fun startProof() {
    started = true; stage = "starting"; status.text = "Starting $mode"; persist(null, "starting")
    val browser = CustomTabsClient.getPackageName(this, null)
    if (browser == null) { record(false, "fixture-no-custom-tabs-provider"); return }
    try {
      val provider = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
      this.provider = provider
      lateinit var flow: LoopbackAuthSession
      flow = LoopbackAuthSession(
        mapOf("received" to "Sign-in response received. Return to the app.",
          "returnLabel" to "Return to Local Operator", "invalid" to "Invalid test callback", "direction" to "ltr"),
        "intent://oauth-return#Intent;scheme=$packageName.oauth;package=$packageName;end",
        requestReturn = { OAuthCoordinator.requestReturn(flow) },
        completed = { result, error -> OAuthCoordinator.main.post { completeCase(result, error) } },
        rejected = { rejected.incrementAndGet() },
      )
      this.flow = flow
      preparedAt = System.currentTimeMillis()
      val redirect = flow.prepare()
      val path = if (mode == "positive") "/authorize" else "/wait"
      val url = "http://127.0.0.1:${provider.localPort}$path?redirect_uri=${encode(redirect)}&state=proof-state"
      flow.arm(url, redirect)
      OAuthCoordinator.keepAliveObserved = false
      OAuthCoordinator.active = flow
      OAuthCoordinator.owner = WeakReference(this)
      OAuthCoordinator.authorizeUrl = url
      OAuthCoordinator.browserPackage = browser
      Thread({
        try {
          while (!provider.isClosed) {
            val client = provider.accept()
            jobs.execute { client.use { serve(it, redirect) } }
          }
        } catch (_: Exception) { /* Provider closes at case teardown. */ }
      }, "proof-provider").apply { isDaemon = true; start() }
      // A hostile Host is not forgeable by browser JS. Send a real raw request
      // before browser launch so the native rejection is discriminating as well.
      jobs.execute {
        val address = URI(redirect)
        socketProbesPassed = try {
          Socket("127.0.0.1", address.port).use {
            it.soTimeout = 5000
            it.getOutputStream().write("GET /callback?code=synthetic&state=proof-state HTTP/1.1\r\nHost: evil.example\r\n\r\n".toByteArray())
            it.getInputStream().bufferedReader().readLine().contains("400")
          }
        } catch (_: Exception) { false }
        if (mode == "positive" && socketProbesPassed) {
          val oversizedRejected = try {
            Socket("127.0.0.1", address.port).use {
              it.soTimeout = 7000
              it.getOutputStream().write(("GET /callback?state=proof-state HTTP/1.1\r\nHost: ${address.rawAuthority}\r\nX: " + "a".repeat(4097)).toByteArray())
              it.getInputStream().bufferedReader().readLine().contains("400")
            }
          } catch (_: Exception) { false }
          val dripClosed = try {
            Socket("127.0.0.1", address.port).use {
              it.soTimeout = 7000
              val started = System.nanoTime()
              it.getOutputStream().write('G'.code); it.getOutputStream().flush()
              Thread.sleep(4000)
              it.getOutputStream().write('E'.code); it.getOutputStream().flush()
              val eof = it.getInputStream().read() == -1
              eof && (System.nanoTime() - started) / 1000000 in 4500..6500
            }
          } catch (_: Exception) { false }
          socketProbesPassed = oversizedRejected && dripClosed
        }
        OAuthCoordinator.main.post {
          if (!socketProbesPassed) { record(false, "native-socket-probes-failed"); flow.cancel() }
          else {
            socketProbeRejections = rejected.get()
            startActivity(Intent(this, OAuthActivity::class.java))
          }
        }
      }
    } catch (_: Exception) { record(false, "fixture-setup-failed"); flow?.cancel() }
  }

  private fun serve(client: Socket, redirect: String) {
    try {
      client.soTimeout = 5000
      val reader = client.getInputStream().bufferedReader()
      val first = reader.readLine() ?: return
      var total = first.length
      while (true) {
        val line = reader.readLine() ?: return
        total += line.length
        if (total > 8192) return
        if (line.isEmpty()) break
      }
      val target = first.split(' ').getOrNull(1) ?: return
      if (target == "/proof-wrong-state") {
        // A same-origin browser acknowledgement runs AFTER the wrong-state image request
        // settles, BEFORE other rejection probes and the valid navigation.
        wrongStateRejections = rejected.get() - socketProbeRejections
        client.getOutputStream().apply {
          write("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); flush()
        }
        return
      }
      served = true
      OAuthCoordinator.main.post { stage = "browser-ready"; persist(null, "browser-ready") }
      val body = if (target.startsWith("/clicked")) {
        clicked = true
        OAuthCoordinator.main.post { persist(null, "browser-clicked") }
        val good = "$redirect?code=synthetic-only&state=proof-state"
        val badState = "$redirect?code=synthetic-bad&state=wrong-state"
        val badPath = redirect.replace("/callback", "/wrong") + "?code=synthetic-bad&state=proof-state"
        val duplicate = "$good&state=proof-state"
        // Images issue real cross-port browser GETs without fetch/CORS response
        // access. A same-origin acknowledgement measures exactly the wrong-state
        // rejection BEFORE the remaining probes; the final navigation is real.
        "<script>function image(u){return new Promise(r=>{const i=new Image();i.onload=i.onerror=r;i.src=u;});}" +
          "image('$badState').then(()=>fetch('/proof-wrong-state'))" +
          ".then(()=>image('$badPath'))" +
          ".then(()=>fetch('$good',{method:'POST',mode:'no-cors'}))" +
          ".then(()=>image('$duplicate')).then(()=>location.assign('$good'));</script>"
      } else {
        val title = if (mode == "positive") "Complete test sign-in" else "Test callback waiting"
        // Fixed geometry is the real-tap fallback when Chrome omits its web AX
        // tree: full viewport width, 200 CSS px immediately below the toolbar.
        "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
          "<style>body{margin:0}a{display:flex;width:100%;height:200px;align-items:center;justify-content:center;font-size:24px}</style>" +
          "<a href='/clicked' onclick=\"location.assign(this.href);return false;\">$title</a><h1>Browser fixture ready</h1>"
      }
      val bytes = body.toByteArray(Charsets.UTF_8)
      client.getOutputStream().apply {
        write("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray())
        write(bytes); flush()
      }
    } catch (_: Exception) { /* Failure retained through native/driver receipts. */ }
  }

  private fun completeCase(result: String?, error: String?) {
    if (ended) return
    val elapsed = System.currentTimeMillis() - preparedAt
    val outcome = when (mode) {
      "positive" -> clicked && result?.contains("code=synthetic-only") == true && error == null && rejected.get() == 6 && wrongStateRejections == 1
      "cancel" -> result == null && error == null
      "timeout" -> result == null && error == "ERR_AUTH_TIMEOUT" && elapsed in 295000..330000
      "destroy" -> result == null && error == null
      else -> false
    }
    // Wait for the real activity destruction callback, not merely finish() being called.
    OAuthCoordinator.main.postDelayed({
      Thread({
        val port = URI(flow?.redirectUri ?: "http://127.0.0.1:1").port
        val refused = try { Socket("127.0.0.1", port).use { false } }
          catch (_: ConnectException) { true } catch (_: Exception) { false }
        OAuthCoordinator.main.post {
          lateRefused = refused
          val fixtureReady = socketProbesPassed && served
          val pass = outcome && fixtureReady && refused && (mode != "destroy" || destroyed)
          record(pass, if (!fixtureReady) "fixture-not-ready" else if (pass) "native-case-complete" else "native-case-failed")
        }
      }, "proof-late-tcp").apply { isDaemon = true; start() }
    }, 500)
  }

  private fun record(pass: Boolean, detail: String) {
    if (ended) return
    ended = true; stage = "completed"
    try { provider?.close() } catch (_: Exception) {}
    jobs.shutdownNow()
    persist(pass, detail)
    status.text = if (pass) "PASS $mode" else "FAIL $mode: $detail"
  }

  private fun persist(pass: Boolean?, detail: String) {
    val receipt = JSONObject().put("mode", mode).put("pass", pass ?: JSONObject.NULL)
      .put("stage", stage).put("detail", detail).put("provider_served", served)
      .put("native_socket_probes_passed", socketProbesPassed)
      .put("provider_clicked", clicked).put("browser_keepalive_bound", OAuthCoordinator.keepAliveObserved)
      .put("socket_probe_rejections", socketProbeRejections).put("wrong_state_rejections", wrongStateRejections)
      .put("late_refused", lateRefused ?: JSONObject.NULL)
      .put("rejected", rejected.get()).put("fallback_used", fallbackUsed).put("activity_destroyed", destroyed)
      .put("elapsed_ms", if (preparedAt == 0L) 0 else System.currentTimeMillis() - preparedAt)
    File(filesDir, "oauth-proof-$mode.json").writeText(receipt.toString(2))
  }

  override fun onActivityCreated(activity: Activity, state: Bundle?) {
    if (activity is OAuthActivity) management = WeakReference(activity)
    if (activity is OAuthReturnActivity) fallbackUsed = true
  }
  override fun onActivityDestroyed(activity: Activity) { if (activity is OAuthActivity) destroyed = true }
  override fun onActivityStarted(activity: Activity) {}
  override fun onActivityResumed(activity: Activity) {}
  override fun onActivityPaused(activity: Activity) {}
  override fun onActivityStopped(activity: Activity) {}
  override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
  override fun onDestroy() { application.unregisterActivityLifecycleCallbacks(this); flow?.cancel(); super.onDestroy() }

  companion object {
    var management: WeakReference<Activity> = WeakReference(null)
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
  }
}

/** Debug-only destructive lifecycle control; absent from every Release manifest. */
class OAuthProofControlReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == "dev.localoperator.loopback.PROOF_DESTROY")
      OAuthCoordinator.main.post { OAuthProofActivity.management.get()?.finish() }
  }
}
