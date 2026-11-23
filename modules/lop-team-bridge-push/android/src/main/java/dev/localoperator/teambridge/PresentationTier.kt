package dev.localoperator.teambridge

/**
 * How much of the conversation presentation an API level can carry (ADR 0010
 * §4 step 2). The app's minSdk is 24 (React Native's `libs.versions.toml`).
 *
 * - PLAIN (< 28): `android.app.Person` and `MessagingStyle(Person)` do not
 *   exist. Expo's notification stays as built, plus the group and the
 *   lock-screen public version.
 * - MESSAGING (28–29): platform `MessagingStyle` with the sender `Person` and
 *   its face. No conversation section: that needs a long-lived shortcut.
 * - CONVERSATION (30+): MESSAGING plus the long-lived shortcut and LocusId, so
 *   Android lists it under Conversations with the face and the app badge.
 *
 * A pure function of the SDK int, so the gate is pinned for 24/27/28/29/30 by
 * the instrumentation runner without needing an emulator per level.
 */
internal enum class PresentationTier {
  PLAIN, MESSAGING, CONVERSATION;

  companion object {
    fun forSdk(sdk: Int): PresentationTier = when {
      sdk >= 30 -> CONVERSATION
      sdk >= 28 -> MESSAGING
      else -> PLAIN
    }
  }
}
