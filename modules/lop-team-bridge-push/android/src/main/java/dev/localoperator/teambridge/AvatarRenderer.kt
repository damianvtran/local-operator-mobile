package dev.localoperator.teambridge

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import java.text.Normalizer
import java.util.Locale

/**
 * The sender's placeholder face for a Team Bridge notification (ADR 0010 §5).
 *
 * ONE RULE, THREE RENDERERS. The cloud computes `initials` and `tone`; core
 * (`notification_avatar.py`, desktop), the iOS extension and this file only
 * DRAW them. So this renderer does no name parsing at all: it upper-cases the
 * cloud's case-preserved initials at draw time (as core's `_placeholder` does)
 * and paints them on `PALETTE[tone]`.
 *
 * WHAT IS DIFFERENT FROM THE DESKTOP COMPOSITE, ON PURPOSE. No LO corner badge:
 * Android 11+ draws the app's own badge on a conversation avatar, which is the
 * Slack look without us drawing the mark (ADR 0010 §4 step 4). So the content
 * is centred rather than pushed up-left to clear a badge.
 *
 * AGENTS. An agent shows the agent glyph (lucide `Bot`, the in-app agent mark)
 * on the tone the cloud seeded from the OWNER's account, never letters and
 * never the owner's face (ADR 0010 §5, manager decision 2026-11-17).
 *
 * `spec` is pure (no Canvas), so the instrumentation test can pin every
 * fixture row's inputs; `render` is the only part that touches graphics.
 */
internal object AvatarRenderer {
  /**
   * Core's LIGHT palette, `_PALETTE_LIGHT` in local-operator
   * `local_operator/team_bridge/notification_avatar.py` (read at origin/main
   * 2026-11-17). Light, not dark: the OS draws notification avatars outside app
   * theming, and these tones were chosen to hold white text. The order is the
   * tone index and must never be re-sorted. `push-avatar-palette.test.ts` pins
   * this list against the TS copy so a drift fails CI.
   */
  val PALETTE: IntArray = intArrayOf(
    0xFF2F6FB3.toInt(),
    0xFF8A4FB0.toInt(),
    0xFFB0476B.toInt(),
    0xFFA8551E.toInt(),
    0xFF3D7D3A.toInt(),
    0xFF1E7A78.toInt(),
    0xFF5A5FC8.toInt(),
    0xFF7A6345.toInt(),
  )

  sealed class Glyph {
    data class Initials(val text: String) : Glyph()
    /** No drawable initials (emoji- or punctuation-only names): a neutral
     *  silhouette, as core draws, rather than a tofu box or a guessed letter. */
    object Person : Glyph()
    object Agent : Glyph()
    /** A group or channel conversation (U7/D3, PR #304): lucide `Users`, the
     *  glyph the in-app list draws for a group row (`ConversationKindGlyph`). */
    object Group : Glyph()
  }

  data class Spec(val background: Int, val glyph: Glyph)

  fun spec(sender: BridgeSender): Spec {
    val background = PALETTE[sender.tone.coerceIn(0, PALETTE.size - 1)]
    val glyph = when {
      sender.kind == BridgeSender.Kind.AGENT -> Glyph.Agent
      sender.initials.isEmpty() -> Glyph.Person
      // NFC then upper-case with ROOT: a Turkish-locale phone must not turn
      // "i" into "İ" where the desktop draws "I".
      else -> Glyph.Initials(Normalizer.normalize(sender.initials, Normalizer.Form.NFC).uppercase(Locale.ROOT))
    }
    return Spec(background, glyph)
  }

  /**
   * The face of a group/channel CONVERSATION, as opposed to a sender
   * (UX U7 / design D3, PR #304). On API 31+ the shade draws the conversation
   * SHORTCUT's icon on every row that names the shortcut, so a shortcut
   * republished with each message's sender face made every earlier row show
   * the latest sender. A group shortcut therefore carries this fixed face,
   * identical for every message; senders keep their faces on the
   * MessagingStyle Person. The payload cannot tell a channel from a group
   * (`BridgeConv` has only `group`), so both draw `Users`.
   *
   * Background: the kit's light `ink-dim` (#656056, `src/ui/tokens.gen.ts`), a
   * warm neutral that is no sender tone, so it never reads as a person. White
   * ink on it is 6.2:1, and the disc stays distinct on light and dark shades,
   * the same reason the sender palette is the light one.
   */
  val CONVERSATION_BACKGROUND: Int = 0xFF656056.toInt()
  val CONVERSATION_SPEC: Spec = Spec(CONVERSATION_BACKGROUND, Glyph.Group)

  /** Text size as a share of the side: core's 0.33 measured with a badge to
   *  clear; centred with no badge there is room for a little more. */
  private const val INITIALS_RATIO = 0.40f

  /** Draw a square bitmap; the OS crops conversation avatars to a circle, and
   *  `Icon.createWithBitmap` on API < 30 shows it as the MessagingStyle face,
   *  so the circle is drawn here too and the corners stay transparent. */
  fun render(spec: Spec, side: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = spec.background }
    val s = side.toFloat()
    canvas.drawOval(RectF(0f, 0f, s, s), fill)
    val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    when (val glyph = spec.glyph) {
      is Glyph.Initials -> {
        ink.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        ink.textSize = s * INITIALS_RATIO
        ink.textAlign = Paint.Align.CENTER
        // Vertical centre from the font metrics, so "AG" and "Jy" sit alike.
        val metrics = ink.fontMetrics
        val baseline = s / 2f - (metrics.ascent + metrics.descent) / 2f
        canvas.drawText(glyph.text, s / 2f, baseline, ink)
      }
      Glyph.Person -> {
        ink.alpha = 230
        val head = s * 0.18f
        canvas.drawCircle(s / 2f, s * 0.40f, head, ink)
        // Shoulders: the lower half-ellipse, clipped by the circle above.
        canvas.save()
        canvas.clipPath(android.graphics.Path().apply { addOval(RectF(0f, 0f, s, s), android.graphics.Path.Direction.CW) })
        canvas.drawOval(RectF(s * 0.22f, s * 0.64f, s * 0.78f, s * 1.10f), ink)
        canvas.restore()
      }
      Glyph.Agent -> drawAgent(canvas, s, ink)
      Glyph.Group -> drawGroup(canvas, s, ink)
    }
    return bitmap
  }

  /**
   * lucide `Bot` from its own 24-unit geometry, the same source core's
   * `_agent_face` draws: head `rect 4,8 16x12 r2`, antenna `12,8 → 12,4 → 8,4`,
   * ears at y=14, eyes at x=9 and x=15 from y=13 to 15. Stroke width 2 units,
   * round caps and joins, as the icon's SVG strokes it. Canvas strokes are
   * centred on the path already, so no inset correction is needed.
   */
  private fun drawAgent(canvas: Canvas, s: Float, ink: Paint) {
    val unit = s * 0.030f
    val ox = s / 2f - 12f * unit
    val oy = s / 2f - 12f * unit
    fun x(v: Float) = ox + v * unit
    fun y(v: Float) = oy + v * unit
    ink.style = Paint.Style.STROKE
    ink.strokeWidth = 2f * unit
    ink.strokeCap = Paint.Cap.ROUND
    ink.strokeJoin = Paint.Join.ROUND
    canvas.drawRoundRect(RectF(x(4f), y(8f), x(20f), y(20f)), 2f * unit, 2f * unit, ink)
    canvas.drawLine(x(12f), y(8f), x(12f), y(4f), ink)
    canvas.drawLine(x(12f), y(4f), x(8f), y(4f), ink)
    canvas.drawLine(x(2f), y(14f), x(4f), y(14f), ink)
    canvas.drawLine(x(20f), y(14f), x(22f), y(14f), ink)
    canvas.drawLine(x(9f), y(13f), x(9f), y(15f), ink)
    canvas.drawLine(x(15f), y(13f), x(15f), y(15f), ink)
  }

  /**
   * lucide `Users` (1.49.0, the in-app group glyph) from its 24-unit geometry:
   * head `circle 9,7 r4`, body `M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2`,
   * the second person's shoulder `M22 21v-2a4 4 0 0 0-3-3.87` and head arc
   * `M16 3.128a4 4 0 0 1 0 7.744`. Same stroke rules and scale as `drawAgent`.
   * Every arc has radius 4; its centre is solved from the SVG endpoints, so
   * `arcTo`/`drawArc` on the centre's oval draws the icon's own curve.
   */
  private fun drawGroup(canvas: Canvas, s: Float, ink: Paint) {
    val unit = s * 0.030f
    val ox = s / 2f - 12f * unit
    val oy = s / 2f - 12f * unit
    fun x(v: Float) = ox + v * unit
    fun y(v: Float) = oy + v * unit
    ink.style = Paint.Style.STROKE
    ink.strokeWidth = 2f * unit
    ink.strokeCap = Paint.Cap.ROUND
    ink.strokeJoin = Paint.Join.ROUND
    canvas.drawCircle(x(9f), y(7f), 4f * unit, ink)
    val body = Path().apply {
      moveTo(x(16f), y(21f))
      lineTo(x(16f), y(19f))
      arcTo(RectF(x(8f), y(15f), x(16f), y(23f)), 0f, -90f, false)
      lineTo(x(6f), y(15f))
      arcTo(RectF(x(2f), y(15f), x(10f), y(23f)), 270f, -90f, false)
      lineTo(x(2f), y(21f))
    }
    canvas.drawPath(body, ink)
    // `a4 4 0 0 0 -3-3.87` from (22, 19): centre (18, 19), so 0° to -75.5°.
    val shoulder = Path().apply {
      moveTo(x(22f), y(21f))
      lineTo(x(22f), y(19f))
      arcTo(RectF(x(14f), y(15f), x(22f), y(23f)), 0f, -75.5f, false)
    }
    canvas.drawPath(shoulder, ink)
    // `a4 4 0 0 1 0 7.744` from (16, 3.128): the small clockwise arc, centre
    // (15, 7) (offset sqrt(16 - 3.872^2) = 1.004), so -75.5° through 0° to 75.5°.
    canvas.drawArc(RectF(x(11f), y(3f), x(19f), y(11f)), -75.5f, 151f, false, ink)
  }
}
