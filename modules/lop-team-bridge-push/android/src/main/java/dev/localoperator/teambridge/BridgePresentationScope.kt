package dev.localoperator.teambridge

import android.content.Context
import java.util.UUID

/** Local admission survives process death, but a presentation in flight must
 * still hold the exact lease it started with (even after off → on for one account).
 * Only the final publication and retirement are serialized; image I/O is not. */
internal object BridgePresentationScope {
  // Carried only in LoHandlingDelegate's local foreground copy. Expo may send
  // that copy back after the JS handler answers, even after an account switch.
  const val LOCAL_LEASE = "dev.localoperator.teambridge.localPresentationLease"
  private const val FILE = "dev.localoperator.teambridge.presentation-scope"
  private const val OWNER = "owner"
  private const val LEASE = "lease"

  private fun prefs(context: Context) = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  @Synchronized
  fun current(context: Context): String? = prefs(context).getString(LEASE, null)

  @Synchronized
  fun enable(context: Context, accountId: String) {
    val prefs = prefs(context)
    if (prefs.getString(OWNER, null) == accountId && current(context) != null) return
    retire(context, null)
    prefs.edit().putString(OWNER, accountId).putString(LEASE, UUID.randomUUID().toString()).apply()
  }

  @Synchronized
  fun retire(context: Context, accountId: String?) {
    val prefs = prefs(context)
    val owner = prefs.getString(OWNER, null)
    if (owner != null && accountId != null && owner != accountId) return
    // Invalidate before deleting any visible state. apply updates the process's
    // snapshot immediately; the same monitor guards notify and shortcut push.
    prefs.edit().clear().apply()
    try {
      BridgeNotificationGroups.removeAll(context)
    } finally {
      ConversationShortcuts.removeAll(context)
    }
  }

  @Synchronized
  fun whileCurrent(context: Context, lease: String, publish: () -> Unit) {
    if (current(context) == lease) publish()
  }
}
