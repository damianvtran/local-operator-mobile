package dev.localoperator.loopback

import android.app.Activity
import android.content.Intent
import android.content.ComponentName
import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsCallback
import androidx.browser.customtabs.CustomTabsServiceConnection

/** Own the auth tab in the app's task. Returning via Back/X is a real cancel
 * unless the socket already committed a correctly scoped callback. No auth
 * payload is stored in intents, instance state, or browser navigation hooks.
 */
class OAuthActivity : Activity() {
  private var flow: LoopbackAuthSession? = null
  private var launched = false
  private var paused = false
  private var bound = false
  private val bindDeadline = Runnable {
    if (!launched && !isFinishing) { flow?.fail("ERR_AUTH_BROWSER_UNAVAILABLE"); finish() }
  }
  private val connection = object : CustomTabsServiceConnection() {
    override fun onCustomTabsServiceConnected(name: ComponentName, client: CustomTabsClient) {
      if (isFinishing || flow?.isEnded() != false) { finish(); return }
      val url = OAuthCoordinator.authorizeUrl ?: run { flow?.fail("ERR_AUTH_NOT_READY"); finish(); return }
      val browser = OAuthCoordinator.browserPackage ?: run { flow?.fail("ERR_AUTH_NOT_READY"); finish(); return }
      val session = client.newSession(CustomTabsCallback()) ?: run { flow?.fail("ERR_AUTH_BROWSER_UNAVAILABLE"); finish(); return }
      try {
        // A bare CustomTabsIntent has no client lifetime contract. Chrome's
        // session-bound KEEP_ALIVE binding keeps our loopback receiver/deadline
        // runnable while the browser covers this activity; no foreground-service
        // permission, notification or authentication data crosses this binder.
        val tab = CustomTabsIntent.Builder(session).setShowTitle(true).build()
        tab.intent.setPackage(browser)
        tab.intent.putExtra("android.support.customtabs.extra.KEEP_ALIVE", Intent(this@OAuthActivity, OAuthKeepAliveService::class.java))
        launched = true
        tab.launchUrl(this@OAuthActivity, Uri.parse(url))
        OAuthCoordinator.main.removeCallbacks(bindDeadline)
      } catch (_: RuntimeException) { flow?.fail("ERR_AUTH_BROWSER_UNAVAILABLE"); finish() }
    }
    override fun onServiceDisconnected(name: ComponentName) {
      if (!isFinishing) { flow?.fail("ERR_AUTH_BROWSER_UNAVAILABLE"); finish() }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    flow = OAuthCoordinator.active
    OAuthCoordinator.management = java.lang.ref.WeakReference(this)
    if (savedInstanceState != null || flow == null || intent.getBooleanExtra(RETURN, false)) {
      // Restoration cannot reconstruct PKCE/state. A process death or destroyed
      // management activity ends the attempt, never starts a stale browser again.
      if (savedInstanceState == null) flow?.returned() else flow?.cancel()
      finish()
      return
    }
    val url = OAuthCoordinator.authorizeUrl
    val browser = OAuthCoordinator.browserPackage
    if (url == null || browser == null) { flow?.fail("ERR_AUTH_NOT_READY"); finish(); return }
    try {
      // Bind a real session before launch; preserve same-task ownership, never
      // Expo's NEW_TASK proxy or browser-history/code scraping.
      bound = CustomTabsClient.bindCustomTabsService(this, browser, connection)
      if (!bound) { flow?.fail("ERR_AUTH_BROWSER_UNAVAILABLE"); finish() }
      else OAuthCoordinator.main.postDelayed(bindDeadline, 20000)
    } catch (_: RuntimeException) { flow?.fail("ERR_AUTH_BROWSER_UNAVAILABLE"); finish() }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    if (intent.getBooleanExtra(RETURN, false)) { flow?.returned(); finish() }
  }

  override fun onResume() {
    super.onResume()
    if (launched && paused) { flow?.returned(); finish() }
  }

  override fun onPause() { super.onPause(); if (launched) paused = true }

  override fun onDestroy() {
    OAuthCoordinator.main.removeCallbacks(bindDeadline)
    flow?.cancel()
    // Release only after the owned management activity actually finishes. The
    // completed callback must not clear the flow before CLEAR_TOP reaches it.
    flow?.let { OAuthCoordinator.managementDestroyed(it) }
    if (bound) { unbindService(connection); bound = false }
    super.onDestroy()
  }

  companion object { const val RETURN = "dev.localoperator.loopback.RETURN" }
}

/** This exported entry is a browser USER GESTURE control, not an OAuth callback.
 * Forged invocations can only bring the app forward; a code is available only
 * after the non-exported flow's literal-loopback HTTP/state validation succeeds.
 */
class OAuthReturnActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val expected = "${packageName}.oauth"
    val uri = intent.data
    if (uri?.scheme == expected && uri.host == "oauth-return" && uri.query == null && uri.fragment == null) {
      val flow = OAuthCoordinator.active
      if (flow?.hasPending() == true) flow.returned()
      val owner = OAuthCoordinator.owner.get()
      val target = if (owner != null) Intent(this, owner.javaClass)
        else packageManager.getLaunchIntentForPackage(packageName)
      target?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
    }
    finish()
  }
}
