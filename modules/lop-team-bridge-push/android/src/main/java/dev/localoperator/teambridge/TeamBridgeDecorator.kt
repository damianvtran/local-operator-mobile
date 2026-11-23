package dev.localoperator.teambridge

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.app.Notification as AndroidNotification
import android.content.Context
import android.content.LocusId
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.os.Build
import androidx.core.graphics.drawable.IconCompat
import expo.modules.notifications.notifications.model.Notification

/**
 * Turns Expo's Team Bridge notification into a messaging notification with the
 * sender's face (ADR 0010 S2, §4 step 2), gated by API level.
 *
 * PLATFORM TYPES ONLY. `Notification.Builder.recoverBuilder` returns a PLATFORM
 * `android.app.Notification.Builder`, so the style, the Person and the icon are
 * platform types too. Mixing in AndroidX `*Compat` types does not compile, or
 * is a silent no-op through reflection (ADR 0010 §4).
 *
 * WHAT IS KEPT. recoverBuilder adopts Expo's notification whole: its content
 * intent, its extras (including `expo.notification_request`, the marshalled
 * request that taps, `getPresentedNotificationsAsync` and
 * `dismissNotificationAsync` read), its channel, small icon and sound. Only the
 * style, the group, the visibility/public version and (30+) the shortcut and
 * locus are changed.
 *
 * NEVER COSTS DELIVERY. Every failure returns Expo's notification as built
 * (`LoPresentationDelegate` also catches). A push that is not Team Bridge is
 * returned untouched.
 */
internal object TeamBridgeDecorator {
  /** Avatar side in px. 192 covers the largest notification avatar slot
   *  (48dp at xxxhdpi); the OS downsamples for smaller densities. */
  private const val AVATAR_SIDE = 192

  fun fetchPhoto(context: Context, sender: BridgeSender): Bitmap? =
    PushAvatarFetcher.fetch(sender.photo, HubOrigin.get(context), AVATAR_SIDE)

  fun decorate(
    context: Context,
    notification: Notification,
    built: AndroidNotification,
    sdk: Int = Build.VERSION.SDK_INT,
    /** The S5 photo, or null for initials. A seam so the instrumentation runner
     *  can drive both paths without a network; production fetches under
     *  `PushAvatarFetcher.BUDGET_MS` against the registered hub origin. */
    photoFor: (BridgeSender) -> Bitmap? = { s -> fetchPhoto(context, s) },
  ): AndroidNotification {
    val content = notification.notificationRequest.content
    val push = BridgePushPayload.parse(content.body) ?: return built
    val builder = AndroidNotification.Builder.recoverBuilder(context, built)

    // Every tier: one group per conversation (iOS `thread-id` parity), so the
    // shade bundles a conversation's messages instead of listing each alone.
    builder.setGroup(push.conversationKey)
    if (sdk >= 26) builder.setGroupAlertBehavior(AndroidNotification.GROUP_ALERT_CHILDREN)
    // Every tier (ADR 0010 §7 row 14): on a secure lock screen with "hide
    // sensitive content", Android shows this public version — no sender, no
    // face, no preview — the same placeholder iOS shows for hidden previews.
    builder.setVisibility(AndroidNotification.VISIBILITY_PRIVATE)
    builder.setPublicVersion(publicVersion(context, built))

    val tier = PresentationTier.forSdk(sdk)
    val sender = push.sender
    if (tier == PresentationTier.PLAIN || sender == null) return builder.build()

    val title = content.title?.takeIf { it.isNotBlank() } ?: return builder.build()
    val text = content.text ?: ""
    // The photo when the sender has one and it arrives within budget; the
    // initials/agent face otherwise (and for every failure), never a blank.
    val avatar = (if (sender.photo != null) photoFor(sender) else null)
      ?: AvatarRenderer.render(AvatarRenderer.spec(sender), AVATAR_SIDE)
    messaging(context, builder, push, title, text, content.subText, avatar, notification.originDate.time)

    if (tier == PresentationTier.CONVERSATION) {
      conversation(context, builder, push, title, content.subText, avatar)
    }
    return builder.build()
  }

  @TargetApi(Build.VERSION_CODES.P)
  private fun messaging(
    context: Context,
    builder: AndroidNotification.Builder,
    push: BridgePush,
    title: String,
    text: String,
    subtitle: String?,
    avatar: Bitmap,
    sentAt: Long,
  ) {
    val me = android.app.Person.Builder().setName(PresentationStrings.selfName(context)).build()
    val from = android.app.Person.Builder()
      .setName(title)
      .setIcon(Icon.createWithBitmap(avatar))
      // No `key`: the payload carries no sender id on purpose (ADR 0010 §6), and
      // a key derived from the name would merge two people who share one.
      .build()
    val group = push.conv?.group == true
    val style = AndroidNotification.MessagingStyle(me)
      .addMessage(AndroidNotification.MessagingStyle.Message(text, sentAt, from))
      .setGroupConversation(group)
    // The conversation name heads a group or channel; a DM is titled by its
    // sender already, and repeating the org name there adds nothing.
    if (group && !subtitle.isNullOrBlank()) style.setConversationTitle(subtitle)
    builder.setStyle(style)
  }

  @SuppressLint("NewApi")
  @TargetApi(Build.VERSION_CODES.R)
  private fun conversation(
    context: Context,
    builder: AndroidNotification.Builder,
    push: BridgePush,
    title: String,
    subtitle: String?,
    avatar: Bitmap,
  ) {
    val label = if (push.conv?.group == true && !subtitle.isNullOrBlank()) subtitle else title
    val person = androidx.core.app.Person.Builder()
      .setName(title)
      .setIcon(IconCompat.createWithBitmap(avatar))
      .build()
    try {
      if (!ConversationShortcuts.publish(context, push, label, person, avatar)) return
    } catch (_: Throwable) {
      // No shortcut (a launcher that refuses, a full quota): the notification
      // still renders as MESSAGING. Naming a shortcut that does not exist would
      // make Android demote it, so the ids are set only on success.
      return
    }
    builder.setShortcutId(push.conversationKey)
    builder.setLocusId(LocusId(push.conversationKey))
  }

  /**
   * A FRESH builder, not a recovered one: a recovered copy would carry Expo's
   * extras (the body JSON, the marshalled request with title and preview) into
   * the object the lock screen renders. Only the channel, small icon, colour
   * and time are copied — the parts that make it look like ours.
   */
  @Suppress("DEPRECATION")
  private fun publicVersion(context: Context, built: AndroidNotification): AndroidNotification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      AndroidNotification.Builder(context, built.channelId)
    } else {
      AndroidNotification.Builder(context)
    }
    built.smallIcon?.let { builder.setSmallIcon(it) }
    return builder
      .setColor(built.color)
      .setWhen(built.`when`)
      .setShowWhen(true)
      .setContentTitle(PresentationStrings.hiddenPreview(context))
      .build()
  }
}
