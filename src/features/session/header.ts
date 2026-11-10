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
