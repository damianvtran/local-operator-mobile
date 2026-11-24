package dev.localoperator.teambridge

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.notifications.model.Notification
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.model.RemoteNotificationContent
import expo.modules.notifications.notifications.model.triggers.FirebaseNotificationTrigger

/**
 * The wire → device session channel remap (ADR 0010 S4, §7 row 4).
 *
 * WHY. Session pushes name `data.channelId = "sound.<v>"` (agent-server
 * `sessionpush/envelope.go`). Those channels were created at
 * IMPORTANCE_DEFAULT — sound, but no heads-up banner — and Android fixes a
 * channel's importance at creation, so the app now creates `alert.<v>` at HIGH
 * and deletes `sound.<v>` (`src/notifications/sound-catalog.ts`). Rewriting the
 * id here, on the device, is what lets the cloud keep sending `sound.<v>`:
 * no cloud change, and an old app against the same cloud is unaffected.
 *
 * SAFETY. The rewrite happens only when the `alert.<v>` channel EXISTS. A phone
 * whose JS has not yet run the migration keeps posting on its old channel; any
 * failure returns the notification untouched, which is today's behaviour.
 *
 * The prefixes are the contract with `sound-catalog.ts`
 * (`WIRE_SESSION_CHANNEL_PREFIX`, `DEVICE_SESSION_CHANNEL_PREFIX`);
 * `session-channels.test.ts` reads this file and fails if they drift.
 */
internal object SessionChannels {
  const val WIRE_PREFIX = "sound."
  const val DEVICE_PREFIX = "alert."

  /** Pure: the device channel for a wire id, or null when it is not a session
   *  sound channel (Team Bridge's `team-bridge`, anything unknown). */
  fun deviceChannelFor(wire: String?): String? {
    if (wire == null || !wire.startsWith(WIRE_PREFIX)) return null
    val value = wire.removePrefix(WIRE_PREFIX)
    return if (value.isEmpty()) null else DEVICE_PREFIX + value
  }

  /**
   * The same notification with its channel rewritten, or `notification` itself
   * when nothing applies. Expo reads the channel from the trigger's
   * RemoteMessage (`FirebaseNotificationTrigger.getNotificationChannel`, a final
   * class), so the message is rebuilt with the one `channelId` entry changed.
   * Everything Expo later reads — title, text, the `body` JSON the tap router
   * parses, the tag/identifier, the origin date — is carried over unchanged.
   * The FCM priority is not (RemoteMessage.Builder cannot set it); on API 26+
   * it has no effect, because the channel's importance decides the heads-up.
   */
  fun remap(context: Context, notification: Notification): Notification {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return notification
    val request = notification.notificationRequest
    val trigger = request.trigger as? FirebaseNotificationTrigger ?: return notification
    val original = trigger.remoteMessage
    val target = deviceChannelFor(original.data["channelId"]) ?: return notification
    return try {
      val manager = context.getSystemService(NotificationManager::class.java) ?: return notification
      if (manager.getNotificationChannel(target) == null) return notification
      val rebuilt = RemoteMessage.Builder(original.to ?: original.from ?: "local-operator")
        .apply {
          original.messageId?.let { setMessageId(it) }
          original.collapseKey?.let { setCollapseKey(it) }
          original.messageType?.let { setMessageType(it) }
          setTtl(original.ttl)
          setData(original.data + ("channelId" to target))
        }
        .build()
      Notification(
        NotificationRequest(request.identifier, RemoteNotificationContent(rebuilt), FirebaseNotificationTrigger(rebuilt)),
        notification.originDate,
      )
    } catch (_: Throwable) {
      notification
    }
  }
}
