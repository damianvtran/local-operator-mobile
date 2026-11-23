package dev.localoperator.teambridge

import android.app.Notification as AndroidNotification
import android.content.Context
import android.graphics.Bitmap
import android.service.notification.StatusBarNotification
import expo.modules.notifications.notifications.model.Notification
import expo.modules.notifications.notifications.model.NotificationBehaviorRecord
import expo.modules.notifications.service.delegates.ExpoPresentationDelegate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Expo still builds each child, including its tap intent and serialized
 * request. Bridge owns the final notify call because Expo otherwise posts
 * after createNotification returns, outside the account retirement lock. */
class LoPresentationDelegate internal constructor(
  context: Context,
  private val photoFor: (BridgeSender) -> Bitmap?,
) : ExpoPresentationDelegate(context) {
  constructor(context: Context) : this(context, { TeamBridgeDecorator.fetchPhoto(context, it) })

  override fun presentNotification(notification: Notification, behavior: NotificationBehaviorRecord?) {
    val request = notification.notificationRequest
    val push = BridgePushPayload.parse(request.content.body)
    if (push == null) {
      super.presentNotification(notification, behavior)
      return
    }
    val lease = request.content.body?.optString(BridgePresentationScope.LOCAL_LEASE)
      ?.takeIf { it.isNotEmpty() } ?: return
    if (BridgePresentationScope.current(context) != lease) return
    if (behavior?.shouldPresentAlert == false) {
      // Preserve Expo's sound-only semantics without handing off an async post.
      BridgePresentationScope.whileCurrent(context, lease) { super.presentNotification(notification, behavior) }
      return
    }
    enqueueBridge(notification, behavior, push, lease)
  }

  internal fun enqueueBridge(notification: Notification, behavior: NotificationBehaviorRecord?, push: BridgePush, lease: String) {
    CoroutineScope(Dispatchers.IO).launch { publishBridge(notification, behavior, push, lease) }
  }

  internal suspend fun publishBridge(
    notification: Notification, behavior: NotificationBehaviorRecord?, push: BridgePush, lease: String,
  ) {
    if (BridgePresentationScope.current(context) != lease) return
    val request = notification.notificationRequest
    val built = createNotification(notification, behavior)
    val photo = push.sender?.takeIf { it.photo != null }?.let { runCatching { photoFor(it) }.getOrNull() }
    var consumed = false
    try {
      BridgePresentationScope.whileCurrent(context, lease) {
        val child = runCatching {
          TeamBridgeDecorator.decorate(context, notification, built, photoFor = { photo })
        }.getOrDefault(built)
        consumed = true
        BridgeNotificationGroups.post(context, request.identifier, getNotifyId(request), child)
      }
    } finally {
      if (!consumed) photo?.recycle()
    }
  }

  override suspend fun createNotification(notification: Notification, notificationBehavior: NotificationBehaviorRecord?): AndroidNotification =
    super.createNotification(SessionChannels.remap(context, notification), notificationBehavior)

  override fun getNotification(statusBarNotification: StatusBarNotification): Notification? =
    if (BridgeNotificationGroups.isSummary(statusBarNotification)) null else super.getNotification(statusBarNotification)

  override fun dismissNotifications(identifiers: Collection<String>) {
    synchronized(BridgePresentationScope) {
      val removed = identifiers.mapTo(mutableSetOf<Pair<String?, Int>>()) { identifier ->
        parseNotificationIdentifier(identifier)?.let { it.first to it.second }
          ?: (identifier to getNotifyId(null))
      }
      super.dismissNotifications(identifiers)
      BridgeNotificationGroups.prune(context, removed)
    }
  }

  override fun dismissAllNotifications() {
    synchronized(BridgePresentationScope) { super.dismissAllNotifications() }
  }
}
