package dev.localoperator.teambridge

import android.content.Context

/**
 * The two strings the native decorator draws with, in the reader's language.
 *
 * WHY STORED HERE. The catalogue lives in JS (`src/i18n`); a push to a killed
 * app is decorated with no JS running. So JS hands these over on every
 * language-frame change (`src/team-bridge/android-presentation.ts`) and they
 * persist in this module's own SharedPreferences file. Until the first
 * hand-over the English defaults below are used, the same words as the `en`
 * catalogue (`mobile.notifications.team_bridge.self_name`,
 * `mobile.notifications.category.message_placeholder`).
 *
 * Not secrets and not account data: UI copy only.
 */
internal object PresentationStrings {
  private const val FILE = "dev.localoperator.teambridge.strings"
  private const val SELF_NAME = "selfName"
  private const val HIDDEN_PREVIEW = "hiddenPreview"
  const val DEFAULT_SELF_NAME = "You"
  const val DEFAULT_HIDDEN_PREVIEW = "Team Bridge message"

  fun save(context: Context, selfName: String, hiddenPreview: String) {
    // Blank copy would build an invalid MessagingStyle (its "me" Person needs a
    // name) or an empty lock-screen line; keep the previous value instead.
    if (selfName.isBlank() || hiddenPreview.isBlank()) return
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
      .putString(SELF_NAME, selfName)
      .putString(HIDDEN_PREVIEW, hiddenPreview)
      .apply()
  }

  fun selfName(context: Context): String =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(SELF_NAME, null) ?: DEFAULT_SELF_NAME

  fun hiddenPreview(context: Context): String =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(HIDDEN_PREVIEW, null) ?: DEFAULT_HIDDEN_PREVIEW
}
