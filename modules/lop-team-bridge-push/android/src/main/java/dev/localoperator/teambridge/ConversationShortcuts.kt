package dev.localoperator.teambridge

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.core.app.Person
import androidx.core.content.LocusIdCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Long-lived conversation shortcuts for Team Bridge (ADR 0010 §4 step 3).
 *
 * WHY. On Android 11+ a notification is shown as a CONVERSATION (its own shade
 * section, the sender's face with the app badge in the corner, priority and
 * bubble controls) only when it carries MessagingStyle AND names a long-lived
 * shortcut with a Person (developer.android.com "People and conversations").
 * The shortcut is a separate object from the notification, so the AndroidX
 * Compat API is fine here even though the notification itself is platform-typed.
 *
 * PRIVACY. A shortcut holds a conversation name and a face, and outlives the
 * notification. They are account data: `removeAll` runs on sign-out and when
 * the Team Bridge switch turns off (`src/team-bridge/push.ts`).
 *
 * NOT EXCLUDED FROM THE LAUNCHER (QA F1, PR #304). A shortcut marked
 * `setExcludedFromSurfaces(SURFACE_LAUNCHER)` is never stored by the platform:
 * `ShortcutPackage.pushDynamicShortcut` (AOSP frameworks/base, main) keeps an
 * excluded shortcut only in `mTransientShortcuts`, and only when AppSearch is
 * enabled, instead of `forceReplaceShortcutInner`. So on API 33+ the shortcut
 * does not exist, `reportShortcutUsed` logs "doesn't have shortcut tb:...", the
 * `getShortcuts` check below finds nothing, and the notification falls back
 * to plain MessagingStyle with no conversation (installed-app run 44247024803,
 * API 36). On 30-32 AndroidX itself fakes success for an excluded shortcut
 * without publishing. A conversation therefore needs a launcher-visible
 * dynamic shortcut, the same trade every messaging app makes: the launcher's
 * long-press menu may list recent conversations until sign-out removes them.
 */
internal object ConversationShortcuts {
  /** The deep link the app's router already resolves for a thread
   *  (`teamBridgeThreadPath` in `src/team-bridge/push-payload.ts`; scheme from
   *  `app.config.ts`). Opening the shortcut lands on the conversation. */
  fun deepLink(push: BridgePush): Uri =
    Uri.parse("localoperator://team-bridge/${Uri.encode(push.tenantId)}/${Uri.encode(push.conversationId)}")

  /**
   * The shortcut's icon (UX U7 / design D3, PR #304). On API 31+ the shade
   * draws the SHORTCUT's icon on every notification row that names it, not
   * each message's Person icon. One shortcut serves a whole conversation and is
   * republished per message, so in a group or channel a sender face here made
   * EVERY row show whoever spoke last. A group/channel shortcut therefore gets
   * the fixed conversation face (`AvatarRenderer.CONVERSATION_SPEC`), the same
   * pixels for every message; each sender's face stays on the MessagingStyle
   * Person (`TeamBridgeDecorator.messaging`). A DM has one other person, so
   * their face is the conversation's face. A missing `conv` block (an older
   * cloud) is treated as a DM, as `setGroupConversation` already does.
   */
  fun shortcutFace(push: BridgePush, senderFace: Bitmap): Bitmap =
    if (push.conv?.group == true) {
      AvatarRenderer.render(AvatarRenderer.CONVERSATION_SPEC, senderFace.width)
    } else {
      senderFace
    }

  fun publish(context: Context, push: BridgePush, label: String, sender: Person, senderFace: Bitmap): Boolean {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return false
    val intent = launch.apply {
      // A shortcut intent must carry an action, and VIEW + data is what the
      // router's deep-link path reads; the launch component keeps it in-app.
      action = Intent.ACTION_VIEW
      data = deepLink(push)
    }
    val shortcut = ShortcutInfoCompat.Builder(context, push.conversationKey)
      .setShortLabel(label)
      .setLongLived(true)
      .setLocusId(LocusIdCompat(push.conversationKey))
      .setPerson(sender)
      .setIcon(IconCompat.createWithBitmap(shortcutFace(push, senderFace)))
      .setIntent(intent)
      // Never setExcludedFromSurfaces: see NOT EXCLUDED FROM THE LAUNCHER above.
      .build()
    // pushDynamicShortcut is not rate-limited (unlike setDynamicShortcuts) and
    // evicts the oldest dynamic shortcut at the launcher's cap.
    if (!ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)) return false
    return ShortcutManagerCompat.getShortcuts(
      context, ShortcutManagerCompat.FLAG_MATCH_DYNAMIC or ShortcutManagerCompat.FLAG_MATCH_CACHED,
    ).any { it.id == shortcut.id && it.isEnabled }
  }

  /** Remove every Team Bridge shortcut, dynamic and cached. */
  fun removeAll(context: Context) {
    val ids = ShortcutManagerCompat
      .getShortcuts(context, ShortcutManagerCompat.FLAG_MATCH_DYNAMIC or ShortcutManagerCompat.FLAG_MATCH_CACHED)
      .map { it.id }
      .filter { it.startsWith(BridgePush.KEY_PREFIX) }
    if (ids.isEmpty()) return
    // removeLongLivedShortcuts also drops the CACHED copy the system keeps for
    // a conversation; removeDynamicShortcuts alone would leave it behind.
    ShortcutManagerCompat.removeLongLivedShortcuts(context, ids)
  }
}
