import type { Viewport } from "@/ui/column";

/**
 * The session header's title is measured by LAYOUT, not by a character budget.
 *
 * This module used to estimate how many characters of the conversation name the
 * header row could hold (viewport width minus a hand-summed chrome constant,
 * divided by a measured average glyph advance) and the screen middle-truncated
 * the name to that count before handing it to the platform. Every revision of
 * that sum was a guess about somebody else's layout, and it lost in both
 * directions: it over-promised whenever the row gained a control (two ellipses,
 * `Hello from…k prov…`), and it under-promised for any name narrower than the
 * average advance — the 2026-11 visual audit (D2) measured `Hello from th…ock
 * provider` ending 23 pt short of a 230 pt box that would have held the whole
 * name, and at 200 % text the name was cut mid-word on a row that had a second
 * line free (`Index the v… / catalogue`).
 *
 * The platform already knows the title box's real width and the real glyph
 * widths, so the title is now a `Text` with `numberOfLines` and a TAIL ellipsis
 * (`session-health.tsx`): one line inline, two full lines when the header
 * stacks at large text. A name that fits is never cut; a name that does not is
 * cut once, where the box actually ends.
 *
 * WHY THE TWO FUNCTIONS BELOW STILL EXIST. The session route
 * (`app/(app)/session/[id].tsx`) still calls
 * `middleTruncate(title, headerTitleChars(…) | compactTitleChars(…))`, and that
 * file is owned by other open pull requests, so this change does not edit it.
 * Both functions therefore keep their signatures and answer "no limit", which
 * makes that `middleTruncate` call an identity. Whoever next owns the route
 * should pass the raw title and delete these two shims with it.
 */

/** Which optional marks share the title row. Kept only for the legacy call
 *  signature below — layout, not arithmetic, now yields the width to them. */
export type HeaderExtras = {
	dot?: boolean;
	menu?: boolean;
	word?: boolean;
	avatar?: boolean;
};

/**
 * The bound agent's picture in the session header: the size `HeaderAgentAvatar`
 * renders (the same 28 pt as the navigation mark beside it, so the leading
 * cluster reads as one height). Exported so the component draws with THIS
 * number rather than a second copy of it.
 */
export const HEADER_AVATAR_PT = 28;

/** "No character limit": `middleTruncate(value, Infinity)` returns `value`. */
export const NO_TITLE_BUDGET = Number.POSITIVE_INFINITY;

/** @deprecated The header title is truncated by layout (see the module note).
 *  Returns {@link NO_TITLE_BUDGET} so the route's `middleTruncate` is a no-op. */
export const headerTitleChars = (
	_viewport: Viewport,
	_extras: HeaderExtras = {},
	_effectiveScale = 1,
	_nativeChrome = false,
): number => NO_TITLE_BUDGET;

/** @deprecated See {@link headerTitleChars}; the compact (short-landscape)
 *  title is one line with a tail ellipsis, measured by layout as well. */
export const compactTitleChars = (
	_viewport: Viewport,
	_effectiveScale: number,
	_extras: HeaderExtras = {},
	_nativeChrome = false,
): number => NO_TITLE_BUDGET;

/**
 * The conversation-title type style of a header: the class, the line clamp and
 * the ramp step they draw with, from the header's two layout facts.
 *
 * `heading` (17/600), not `display` (28): a 28 pt title in a 56 pt row with
 * three leading marks was the "crunched" header (D-S2). The relay uses the same
 * 17 pt step with a 12 pt subtitle; together they are 39.8 pt of text in the
 * 56 pt row. Compact (short landscape) keeps its `title` step. ONE line inline;
 * stacked (large text / narrow phone) the title owns its row and may use two
 * full lines before the tail is cut.
 *
 * EXPORTED so every conversation header draws the same title. The Team Bridge
 * thread header used its own 20 pt two-line `text-title` and the operator
 * called it "way too large" beside the agent chat title (TestFlight 753); a
 * copied class string would drift the next time this ramp step moves, so the
 * bridge reads this function instead. Pure and hook-free: callers pass the
 * facts they already derive (`useCompactChrome`, `headerStacks`). It lives
 * HERE, beside the title's width budget, rather than in `session-health.tsx`
 * (whose `SessionHealthControl` draws with it) because that component's
 * module graph does not load in the Node test host, and the bridge's suite
 * must assert against this very function, not a copy of its strings.
 */
export function sessionHeaderTitle({
	compact,
	stacked,
}: {
	compact: boolean;
	stacked: boolean;
}): {
	className: string;
	numberOfLines: 1 | 2;
	step: "title" | "heading";
} {
	return compact
		? { className: "text-title text-ink", numberOfLines: 1, step: "title" }
		: {
				className: "text-heading text-ink",
				numberOfLines: stacked ? 2 : 1,
				step: "heading",
			};
}
