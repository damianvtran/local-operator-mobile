package dev.localoperator.loopback

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder

/** Chrome's session-scoped client lifetime binding, not a foreground service.
 *
 * The browser is a different UID, so this empty service must be exported. It
 * exposes no binder commands, authentication data, callback or activity launch;
 * binding can only retain process importance while the owned Custom Tab is up.
 * Chrome releases it with the tab; the management activity also unbinds its
 * CustomTabsService connection on every terminal path. No new permission or
 * persistent/background work is introduced.
 *
 * Protocol: Chromium CustomTabsConnection.keepAliveForSession / ClientManager;
 * GoogleChrome/custom-tabs-client README, "Lifecycle" (KEEP_ALIVE service).
 */
class OAuthKeepAliveService : Service() {
  private val binder = Binder()
  override fun onBind(intent: Intent?): IBinder {
    OAuthCoordinator.keepAliveObserved = true
    return binder
  }
}
