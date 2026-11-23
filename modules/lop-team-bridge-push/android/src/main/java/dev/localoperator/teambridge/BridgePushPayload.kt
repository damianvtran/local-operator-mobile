package dev.localoperator.teambridge

import org.json.JSONObject

/**
 * The Team Bridge push body, read on the device (ADR 0010 §2, §5).
 *
 * The cloud (agent-server `models/bridge_push.go`, PR #399) sends the body as a
 * JSON string in the FCM `data.body`; Expo parses it into
 * `INotificationContent.body`. The id rules mirror `src/team-bridge/push-payload.ts`
 * exactly, so the native side never decorates a push the JS tap router would
 * refuse to route.
 *
 * `sender` and `conv` are ADDITIVE under v1: an older cloud omits them, and the
 * cloud also omits `sender` when it cannot seed the tone honestly (no hub origin
 * or no account id). Every absent or malformed block parses to `null`, and a
 * `null` sender means "today's notification", never a guessed face.
 *
 * Nothing here logs: title, preview and sender are message content (ADR 0010 §6).
 */
internal data class BridgeSender(
  val kind: Kind,
  val initials: String,
  val tone: Int,
  /** ADR 0010 S5: present only when the sender has a photo. Initials and
   *  tone stay mandatory: they are the fallback for every photo failure. */
  val photo: PushAvatarFetcher.Photo? = null,
) {
  enum class Kind { PERSON, AGENT }
}

internal data class BridgeConv(val group: Boolean, val members: Int)

internal data class BridgePush(
  val tenantId: String,
  val conversationId: String,
  val messageId: String?,
  val sender: BridgeSender?,
  val conv: BridgeConv?,
) {
  /** The per-conversation key: notification group, shortcut id and locus id.
   *  Same string as iOS `thread-id` (`tb:<conversation>`, ADR 0010 §4). */
  val conversationKey: String get() = "$KEY_PREFIX$conversationId"

  companion object {
    const val KEY_PREFIX = "tb:"
  }
}

internal object BridgePushPayload {
  const val TYPE = "team_bridge_message"

  /** Core's placeholder palette has 8 tones (`BridgePushPaletteSize`). */
  const val TONES = 8

  private val ID = Regex("^[A-Za-z0-9_.:-]{1,128}$")
  private val DOTS = Regex("^\\.+$")

  private fun idOf(value: Any?): String? =
    (value as? String)?.takeIf { ID.matches(it) && !DOTS.matches(it) }

  /** An integer that may arrive as a JSON number or a numeric string. */
  private fun intOf(value: Any?): Int? = when (value) {
    is Int -> value
    is Long -> value.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()
    is Double -> value.takeIf { it % 1.0 == 0.0 }?.toInt()
    is String -> value.toIntOrNull()
    else -> null
  }

  fun parse(body: JSONObject?): BridgePush? {
    if (body == null) return null
    if (body.opt("type") != TYPE) return null
    if (intOf(body.opt("v")) != 1) return null
    val tenantId = idOf(body.opt("tenant_id")) ?: return null
    val conversationId = idOf(body.opt("conversation_id")) ?: return null
    return BridgePush(
      tenantId = tenantId,
      conversationId = conversationId,
      messageId = idOf(body.opt("message_id")),
      sender = sender(body.optJSONObject("sender")),
      conv = conv(body.optJSONObject("conv")),
    )
  }

  /**
   * The sender block, or `null` when it cannot be drawn honestly. An agent
   * NEVER carries initials (its label may hold "(Owner)", whose letters would
   * put the owner on the agent's face — agent-server `bridgePushSenderMeta`), so
   * any it does carry are dropped here as well. Person initials are kept to the
   * cloud's own rule: at most two code points, each a Unicode letter or digit;
   * anything else becomes "" (the silhouette), never a partial guess.
   */
  fun sender(block: JSONObject?): BridgeSender? {
    if (block == null) return null
    val kind = when (block.opt("kind")) {
      "person" -> BridgeSender.Kind.PERSON
      "agent" -> BridgeSender.Kind.AGENT
      else -> return null
    }
    val tone = intOf(block.opt("tone"))?.takeIf { it in 0 until TONES } ?: return null
    val initials = if (kind == BridgeSender.Kind.AGENT) "" else cleanInitials(block.opt("initials"))
    return BridgeSender(kind, initials, tone, photo(block.optJSONObject("photo")))
  }

  /** `{url, nonce}` strings, or null. Shape only: the origin, scheme and
   *  nonce format are checked by `PushAvatarFetcher.target` before any I/O. */
  fun photo(block: JSONObject?): PushAvatarFetcher.Photo? {
    if (block == null) return null
    val url = block.opt("url") as? String ?: return null
    val nonce = block.opt("nonce") as? String ?: return null
    return PushAvatarFetcher.Photo(url, nonce)
  }

  fun cleanInitials(value: Any?): String {
    val raw = value as? String ?: return ""
    val points = raw.codePoints().toArray()
    if (points.isEmpty() || points.size > 2) return ""
    return if (points.all(::isLetterOrNumber)) raw else ""
  }

  /** Unicode categories L* and N*: the cloud's `unicode.IsLetter || unicode.IsNumber`.
   *  `Character.isLetterOrDigit` would miss Nl/No (e.g. "Ⅻ", "②"), which the
   *  cloud keeps, and blank a face the desktop draws. */
  private fun isLetterOrNumber(point: Int): Boolean = when (Character.getType(point)) {
    Character.UPPERCASE_LETTER.toInt(), Character.LOWERCASE_LETTER.toInt(),
    Character.TITLECASE_LETTER.toInt(), Character.MODIFIER_LETTER.toInt(),
    Character.OTHER_LETTER.toInt(), Character.DECIMAL_DIGIT_NUMBER.toInt(),
    Character.LETTER_NUMBER.toInt(), Character.OTHER_NUMBER.toInt() -> true
    else -> false
  }

  fun conv(block: JSONObject?): BridgeConv? {
    if (block == null) return null
    val group = block.opt("group") as? Boolean ?: return null
    val members = intOf(block.opt("members"))?.takeIf { it >= 0 } ?: return null
    return BridgeConv(group, members)
  }
}
