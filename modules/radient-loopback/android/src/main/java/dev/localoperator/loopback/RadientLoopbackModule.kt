package dev.localoperator.loopback

import android.app.Activity
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.browser.customtabs.CustomTabsClient
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/** Only an already validated in-memory flow may supply an authentication result.
 * Neither exported return intents nor saved-instance state carry a code or state.
 */
internal object OAuthCoordinator {
  @Volatile var active: LoopbackAuthSession? = null
  var owner: WeakReference<Activity> = WeakReference(null)
  var management: WeakReference<OAuthActivity> = WeakReference(null)
  @Volatile var keepAliveObserved = false
  var authorizeUrl: String? = null
  var browserPackage: String? = null
  val main = Handler(Looper.getMainLooper())

  // The return target belongs to this flow, not the React root. In particular
  // timeout must clear Chrome ABOVE the management activity before releasing it.
  fun requestReturn(flow: LoopbackAuthSession) {
    main.post {
      if (active !== flow) return@post
      val activity = management.get()
      if (activity == null) { if (flow.isEnded()) release(flow); return@post }
      try {
        activity.startActivity(Intent(activity, OAuthActivity::class.java)
          .putExtra(OAuthActivity.RETURN, true)
          .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
      } catch (_: RuntimeException) {
        // Successful callback pages retain their code-free user-gesture fallback.
        // No result is fabricated when the OS refuses a task transition.
      }
    }
  }

  fun managementDestroyed(flow: LoopbackAuthSession) {
    if (active !== flow) return
    // External destruction can finish the management activity while Chrome is
    // still above it. There is then no management target left for CLEAR_TOP;
    // unwind to the recorded owner before dropping the only task reference.
    val activity = owner.get()
    try {
      if (activity != null && !activity.isFinishing && !activity.isDestroyed) {
        activity.startActivity(Intent(activity, activity.javaClass)
          .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
      }
    } catch (_: RuntimeException) { /* Native cleanup still closes the listener. */ }
    finally { release(flow) }
  }

  fun release(flow: LoopbackAuthSession) {
    if (active !== flow) return
    active = null; authorizeUrl = null; browserPackage = null
    management.clear(); owner.clear()
  }
}

class RadientLoopbackModule : Module() {
  private var prepared: LoopbackAuthSession? = null
  private var openPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("RadientLoopback")

    AsyncFunction("prepare") { copy: Map<String, String> ->
      check(prepared == null && OAuthCoordinator.active == null) { "ERR_AUTH_BUSY" }
      check(listOf("received", "returnLabel", "invalid", "direction").all { !copy[it].isNullOrEmpty() }) { "ERR_AUTH_COPY" }
      val context = appContext.reactContext ?: error("ERR_AUTH_CONTEXT")
      val packageName = context.packageName
      OAuthCoordinator.keepAliveObserved = false
      lateinit var flow: LoopbackAuthSession
      flow = LoopbackAuthSession(copy,
        "intent://oauth-return#Intent;scheme=$packageName.oauth;package=$packageName;end",
        requestReturn = { OAuthCoordinator.requestReturn(flow) },
        completed = { callback, error ->
          OAuthCoordinator.main.post {
            if (prepared === flow) prepared = null
            val promise = openPromise
            openPromise = null
            // Keep the owner until the management activity has actually returned.
            if (error == null) promise?.resolve(callback)
            else promise?.reject(error, error, null)
          }
        })
      try {
        val redirect = flow.prepare()
        prepared = flow
        OAuthCoordinator.active = flow
        redirect
      } catch (error: Exception) {
        flow.cancel()
        throw error
      }
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    AsyncFunction("open") { url: String, redirect: String, promise: Promise ->
      val flow = prepared
      val activity = appContext.currentActivity
      if (flow == null || activity == null || openPromise != null) {
        promise.reject("ERR_AUTH_NOT_READY", "ERR_AUTH_NOT_READY", null)
        // A missing owner must not leave a prepared port waiting for JS cleanup.
        // A duplicate open, however, must not cancel somebody else's active call.
        if (openPromise == null) flow?.cancel()
      } else {
        try {
          flow.arm(url, redirect)
          val browser = CustomTabsClient.getPackageName(activity, null)
            ?: error("ERR_AUTH_BROWSER_UNAVAILABLE")
          openPromise = promise
          OAuthCoordinator.owner = WeakReference(activity)
          OAuthCoordinator.authorizeUrl = url
          OAuthCoordinator.browserPackage = browser
          activity.startActivity(Intent(activity, OAuthActivity::class.java))
        } catch (_: Exception) {
          if (openPromise === promise) openPromise = null
          promise.reject("ERR_AUTH_BROWSER_UNAVAILABLE", "ERR_AUTH_BROWSER_UNAVAILABLE", null)
          flow.cancel()
          if (OAuthCoordinator.active === flow) OAuthCoordinator.active = null
        }
      }
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    AsyncFunction("dismiss") {
      prepared?.cancel()
      prepared = null
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    OnActivityDestroys { prepared?.cancel(); prepared = null }
    OnDestroy { prepared?.cancel(); prepared = null }
  }
}
