/**
 * Team Bridge reactions: the pure model behind the pills and the quick row.
 *
 * WHY A PORT, NOT A REDESIGN. The operator asked for Slack/Discord-style
 * reactions on the phone; the desktop already ships them, and a reaction made
 * on one surface must read the same on the other. So the projection rules are
 * the desktop's own (`local-operator-ui`
 * `src/renderer/src/features/team-bridge/team-bridge-emoji-model.ts`, read at
 * origin/main 2026-11-19), function for function, so the two cannot drift:
 *  - `QUICK_EMOJI`: the same eight, in the same order.
 *  - `toggleReaction`: tap my pill → remove (my last one removes the pill);
 *    tap another's → +1 and mine; absent → append `{count: 1, mine}`.
 *  - `recordEmojiUsage` / `frequentEmoji`: per-account usage whose score halves
 *    every 30 days, ranked ∪ quick set, first eight.
 * The desktop's bundled picker corpus is NOT ported (spec §4.4: the system
 * emoji keyboard is the full picker), so `isSingleEmoji` below replaces its
 * corpus lookups with Unicode properties.
 *
 * Spec: lop-dev "Mobile Team Bridge: reactions and start-a-thread", §3, §4.8.
 */
import type { Reaction } from "@/team-bridge/contract";

export const QUICK_EMOJI: readonly string[] = [
	"👍",
	"❤️",
	"😂",
	"🎉",
	"👀",
	"🙏",
	"✅",
	"🔥",
];

/** Emoji → decayed score and the last time it was used. Emoji keys only:
 *  never message ids, labels or bodies. */
export type EmojiUsage = Record<string, { score: number; at: number }>;

const HALF_LIFE_MS = 30 * 86_400_000;
const scoreAt = (entry: { score: number; at: number }, now: number) =>
	entry.score * 2 ** (-Math.max(0, now - entry.at) / HALF_LIFE_MS);
/* The desktop's cap on remembered emoji (200), so one account's map is bounded
 *  by the same number on both surfaces. */
const USAGE_CAP = 200;

/** Decay by elapsed time, not app launches: reopening cannot inflate recency.
 *  Called only after the hub CONFIRMED an add (a refused tap is not usage). */
export function recordEmojiUsage(
	usage: EmojiUsage,
	emoji: string,
	now: number,
): EmojiUsage {
	const held = usage[emoji];
	const next = {
		...usage,
		[emoji]: { score: (held ? scoreAt(held, now) : 0) + 1, at: now },
	};
	return Object.fromEntries(
		Object.entries(next)
			.sort((a, b) => scoreAt(b[1], now) - scoreAt(a[1], now))
			.slice(0, USAGE_CAP),
	);
}

/** The quick row's source: most-used first, topped up from the quick set. */
export function frequentEmoji(usage: EmojiUsage, now: number): string[] {
	const ranked = Object.entries(usage)
		.sort(
			(a, b) => scoreAt(b[1], now) - scoreAt(a[1], now) || b[1].at - a[1].at,
		)
		.map(([emoji]) => emoji);
	return [...new Set([...ranked, ...QUICK_EMOJI])].slice(0, 8);
}

/** The optimistic projection of one tap. The server's answer replaces it;
 *  a refusal restores the snapshot taken before it (`store.toggleReaction`). */
export function toggleReaction(
	rows: readonly Reaction[],
	emoji: string,
): Reaction[] {
	const existing = rows.find((r) => r.emoji === emoji);
	if (!existing)
		return [
			...rows,
			{ emoji, count: 1, reacted_by_me: true, sample_labels: [] },
		];
	return rows.flatMap((r) =>
		r.emoji !== emoji
			? [r]
			: r.reacted_by_me
				? r.count === 1
					? []
					: [{ ...r, count: r.count - 1, reacted_by_me: false }]
				: [{ ...r, count: r.count + 1, reacted_by_me: true }],
	);
}

/** Whether a tap on `emoji` adds (PUT) or removes (DELETE) mine. */
export const reactionAdds = (rows: readonly Reaction[], emoji: string) =>
	!rows.some((r) => r.emoji === emoji && r.reacted_by_me);

const segmenter =
	typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: null;

/* A grapheme is an emoji when it has a pictographic code point, or is a
 *  keycap (digit/#/* + U+20E3) or a regional-indicator flag pair. Plain digits
 *  and "#" are `Emoji` but not `Extended_Pictographic`, which is why the
 *  pictographic property, not `Emoji`, is the test. */
// Match the complete emoji, not merely a pictographic substring. Modifiers
// require a modifier base; tag flags require their terminating CANCEL TAG.
const EMOJI_ATOM =
	"(?:\\p{Emoji_Modifier_Base}\\uFE0F?\\p{Emoji_Modifier}|\\p{Extended_Pictographic}\\uFE0F?)";
const PICTOGRAPHIC = new RegExp(
	`^${EMOJI_ATOM}(?:\\u200D${EMOJI_ATOM})*$`,
	"u",
);
const TAG_FLAG = /^\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}$/u;
const KEYCAP = /^[0-9#*]\uFE0F?\u20E3$/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;
const EXTEND_EMOJI = /^[\p{Grapheme_Extend}\p{Emoji_Modifier}\u200D]$/u;
const REGIONAL_INDICATOR = /^\p{Regional_Indicator}$/u;

/** Split keyboard input into emoji-safe clusters even on Hermes versions
 *  without Intl.Segmenter. This fallback is not a general text segmenter. */
export function graphemes(text: string): string[] {
	if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
	// Emoji-relevant UAX #29 rules: Extend (including tag characters),
	// modifiers, ZWJ chains and paired regional indicators stay indivisible.
	// Keep malformed suffixes attached too: validation must reject the whole
	// choice, never silently turn a skin tone/unfinished sequence into its base.
	const parts: string[] = [];
	for (const cp of text) {
		const last = parts.at(-1);
		if (
			last &&
			(EXTEND_EMOJI.test(cp) ||
				last.endsWith("\u200D") ||
				(REGIONAL_INDICATOR.test(last) && REGIONAL_INDICATOR.test(cp)))
		) {
			parts[parts.length - 1] = last + cp;
		} else parts.push(cp);
	}
	return parts;
}

/** One emoji grapheme, nothing else. The hub still decides validity; this only
 *  keeps a typed letter from the system keyboard out of a reaction write. */
export function isSingleEmoji(value: string): boolean {
	const parts = graphemes(value);
	if (parts.length !== 1) return false;
	const g = parts[0] ?? "";
	// The daemon's pre-guard (≤ 128 UTF-8 bytes), so the phone refuses what it would.
	if (new TextEncoder().encode(g).length > 128) return false;
	return (
		PICTOGRAPHIC.test(g) || KEYCAP.test(g) || FLAG.test(g) || TAG_FLAG.test(g)
	);
}

/** The first emoji grapheme in what the keyboard typed, or null (spec §4.4). */
export function firstEmoji(text: string): string | null {
	return graphemes(text).find(isSingleEmoji) ?? null;
}

/** Total reactions across a message's pills (the screen reader's summary). */
export const reactionTotal = (rows: readonly Reaction[]) =>
	rows.reduce((sum, r) => sum + r.count, 0);
