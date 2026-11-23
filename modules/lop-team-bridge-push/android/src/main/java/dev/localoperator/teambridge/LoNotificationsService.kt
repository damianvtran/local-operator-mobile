package dev.localoperator.teambridge

import android.content.Context
import android.content.Intent
import expo.modules.notifications.service.NotificationsService
import expo.modules.notifications.service.interfaces.HandlingDelegate
import expo.modules.notifications.service.interfaces.PresentationDelegate

/**
 * The app's notification receiver: Expo's `NotificationsService` with our two
 * delegates (ADR 0010 §4).
 *
 * Expo routes every notification event to "the first broadcast receiver in the
 * package that handles `expo.modules.notifications.NOTIFICATION_EVENT`"
 * (`NotificationsService.findDesignatedBroadcastReceiver`). The config plugin
 * `plugins/with-android-team-bridge-push.js` declares this class with Expo's
 * exact intent filter and removes Expo's own receiver from the merged
 * manifest, so this is the only match. `scripts/ci/native-config.ts` asserts
 * both on the release merged manifest.
 */
class LoNotificationsService : NotificationsService() {
  override fun handleIntent(context: Context, intent: Intent) {
    if (intent.action == BridgeNotificationGroups.CHILD_REMOVED) {
      val tag = intent.data?.lastPathSegment ?: return
      synchronized(BridgePresentationScope) {
        BridgeNotificationGroups.prune(context, setOf(tag to BridgeNotificationGroups.CHILD_ID))
      }
      return
    }
    super.handleIntent(context, intent)
  }

  override fun getPresentationDelegate(context: Context): PresentationDelegate = LoPresentationDelegate(context)

  override fun getHandlingDelegate(context: Context): HandlingDelegate = LoHandlingDelegate(context)
}
