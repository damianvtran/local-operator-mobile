package dev.localoperator.teambridge

import android.content.Context
import expo.modules.notifications.notifications.model.Notification
import expo.modules.notifications.notifications.model.NotificationContent
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.model.NotificationResponse
import expo.modules.notifications.notifications.model.RemoteNotificationContent
import expo.modules.notifications.service.delegates.ExpoHandlingDelegate
import expo.modules.notifications.service.interfaces.HandlingDelegate
import org.json.JSONObject

/**
 * The foreground fix for Team Bridge (ADR 0010 §7 row 2).
 *
 * THE GAP. While the app is in the foreground, Expo hands an arriving push to
 * `NotificationsHandler.onNotificationReceived`, which DROPS a data-only remote
 * message before the JS handler runs (`NotificationsHandler.kt:95-103`,
 * expo-notifications 57.0.21: "We do not notify JS about data-only
 * notifications, for consistency with iOS"). Every Team Bridge push is
 * data-only (the cloud keeps it so, ADR 0010 §4), so on Android a teammate's
 * message in ANOTHER conversation showed no banner at all while the app was
 * open; iOS shows one.
 *
 * THE FIX. For a foreground, data-only Team Bridge push with a title, rewrap
 * the content as a local `NotificationContent`. The handler then consults the
 * JS `setNotificationHandler`, whose `foregroundBehaviour` rule
 * (`src/team-bridge/push.ts`) shows the banner unless the reader is looking at
 * that exact thread — one rule, both platforms. The trigger (and so the tap
 * payload's `dataString`), the identifier and the date are unchanged. Session
 * pushes are NOT rewrapped: the JS handler's rule for them is "not shown in the
 * foreground", which is what dropping them already does.
 *
 * Composition, not inheritance: `ExpoHandlingDelegate` is final. Its listener
 * registry is static, so a fresh instance per broadcast is what Expo itself does.
 */
class LoHandlingDelegate(
  private val context: Context,
  private val expo: ExpoHandlingDelegate = ExpoHandlingDelegate(context),
) : HandlingDelegate by expo {
  override fun handleNotification(notification: Notification) {
    val content = notification.notificationRequest.content
    val push = BridgePushPayload.parse(content.body)
    if (push == null) {
      expo.handleNotification(notification)
      return
    }
    val lease = BridgePresentationScope.current(context) ?: return
    if (expo.isAppInForeground()) {
      expo.handleNotification(ForegroundBridge.rewrap(notification, lease))
    } else if (!content.title.isNullOrEmpty() || !content.text.isNullOrEmpty()) {
      // Same visibility rule as Expo's background handling, but keep the
      // ingress lease across the deferred presentation rather than reacquire it.
      LoPresentationDelegate(context).enqueueBridge(notification, null, push, lease)
    }
  }

  override fun handleNotificationResponse(response: NotificationResponse) {
    expo.handleNotificationResponse(response)
    val request = response.notification.notificationRequest
    if (BridgePushPayload.parse(request.content.body) != null) {
      val removed = if (request.content.isAutoDismiss && response.actionIdentifier == NotificationResponse.DEFAULT_ACTION_IDENTIFIER)
        setOf(request.identifier to BridgeNotificationGroups.CHILD_ID) else emptySet()
      synchronized(BridgePresentationScope) { BridgeNotificationGroups.prune(context, removed) }
    }
  }
}

internal object ForegroundBridge {
  /** Pure apart from Expo's model types: the rewrapped notification, or the
   *  same one when the rule does not apply. */
  fun rewrap(notification: Notification, lease: String? = null): Notification {
    val request = notification.notificationRequest
    val content = request.content as? RemoteNotificationContent ?: return notification
    if (!content.isDataOnly) return notification
    if (content.title.isNullOrEmpty()) return notification
    BridgePushPayload.parse(content.body) ?: return notification
    val body = content.body ?: return notification
    val localBody = if (lease == null) body else JSONObject(body.toString()).put(BridgePresentationScope.LOCAL_LEASE, lease)
    val local = NotificationContent.Builder()
      .setTitle(content.title)
      .setText(content.text)
      .setSubtitle(content.subText)
      .setBody(localBody)
      .setAutoDismiss(content.isAutoDismiss)
      .setSticky(content.isSticky)
      .apply {
        content.priority?.let { setPriority(it) }
        content.color?.let { setColor(it) }
        content.categoryId?.let { setCategoryId(it) }
      }
      .build()
    return Notification(NotificationRequest(request.identifier, local, request.trigger), notification.originDate)
  }
}
