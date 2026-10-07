import { Platform } from "react-native";

/**
 * The web-target harness hook for the TABLE's scroll position — the `lo-md-scroll`
 * query value a capture cell may set.
 *
 * Same convention as `lo-dictation`/`lo-recorder`/`lo-relay`: a URL can steer the
 * harness's PAGE and never the installed app, and it says nothing the app can act
 * on beyond what it draws.
 *
 * WHY IT EXISTS. The wide-table frame set needs a picture of the table scrolled
 * to its end — the left-mirror fade and the retired right fade are read from that
 * frame, not from a marker (`fix/hero-tables-strips` §4.1/§4.3) — and a scroll
 * position is a viewport interaction no wire action can declare: `S5/scroll` is a
 * declared gap in `matrix.ts` for exactly this reason, and its owner text says the
 * next person needs "a wire action or an app-side id". This is that app-side hook,
 * scoped to the table so the transcript itself is untouched.
 *
 * WHAT IT DELIBERATELY DOES NOT DO, exactly like the dictation hook: it never
 * drives a real interaction. It sets one initial scroll offset on one viewer and
 * nothing else; an installed app (where `location` is not a web page) reads null,
 * and a page without the parameter renders the table at its start.
 *
 * TWO VALUES, because the two affordance directions live in two axes:
 * - `end` scrolls the TABLE's own horizontal view to its end (the left-mirror
 *   fade and the retired right fade; `S5/tables-end`).
 * - `bring` scrolls the TRANSCRIPT vertically so the first table sits at the
 *   transcript viewport's top (review round 1, D2): at 200 % text on a phone
 *   the transcript window is ~59 pt tall and the settled frame otherwise shows
 *   chrome above the fold, so no 200 % frame would ever show a table. It leaves
 *   the horizontal offset alone (`inline: "nearest"`), so the state it lands in
 *   is the same cut-edge state the un-hooked cell renders.
 */

/** The values the hook accepts. The record shape keeps the refusal of an
 *  unknown value explicit. */
const FORCED = ["end", "bring"] as const;
export type ForcedTableScroll = (typeof FORCED)[number];

/** The state a `lo-md-scroll` value names, or `null` for an absent/unknown value.
 *  An unknown value is `null` rather than an error: this is a viewer, and a page
 *  asking for a state that does not exist should render the ordinary table rather
 *  than crash the capture. */
export function tableScrollFromHook(
	value: string | null | undefined,
): ForcedTableScroll | null {
	return value !== null &&
		value !== undefined &&
		FORCED.includes(value as never)
		? (value as ForcedTableScroll)
		: null;
}

/** The `lo-md-scroll` value this page carries, or `null` when it is not a web page. */
const hookValue = (): string | null => {
	if (Platform.OS !== "web" || typeof location === "undefined") return null;
	return new URLSearchParams(location.search).get("lo-md-scroll");
};

/** The scroll offset this page forces, or `null` when it forces none. */
export const forcedTableScroll = (): ForcedTableScroll | null =>
	tableScrollFromHook(hookValue());
