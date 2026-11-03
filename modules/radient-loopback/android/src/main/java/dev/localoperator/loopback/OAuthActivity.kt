package dev.localoperator.loopback

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsIntent

/** Own the auth tab in the app's task. Returning via Back/X is a real cancel
 * unless the socket already committed a correctly scoped callback. No auth
 * payload is stored in intents, instance state, or browser navigation hooks.
 */
class OAuthActivity : Activity() {
  private var flow: LoopbackAuthSession? = null
  private var launched = false
  private var paused = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    flow = OAuthCoordinator.active
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
      val tab = CustomTabsIntent.Builder().setShowTitle(true).build()
      tab.intent.setPackage(browser)
      // Do not use Expo's NEW_TASK proxy. We own a single same-task tab and do
      // not depend on HTTP app links, browser history scraping or a code bounce.
      tab.launchUrl(this, Uri.parse(url))
      launched = true
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
    flow?.cancel()
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
