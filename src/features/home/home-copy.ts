/**
 * The composer home's copy, in one place, with its budgets asserted in
 * `home-copy.test.ts` rather than argued in review.
 *
 * The greeting is the desktop's verbatim line. The suggestion pool is the
 * spec's mobile pool — six entries, ≥24 characters checked, and read as a set
 * they obey the desktop's own two rules (no two entries share a leading verb;
 * at most one entry creates an agent). The tips are the desktop pool's entries
 * whose move is true on a phone, shortened to the phone row's width.
 */
export const GREETING = "What can I help you with today?";

/** The splash's replacement while the first send is in flight — one line, so
 *  the composer never moves when the splash changes height under it. */
export const STARTING = "Starting…";

/** The refused-start sentence, verbatim from `/new` (the relay's own sentence
 *  is preferred when it has one — see `home.tsx`). */
export const REFUSED_START_FALLBACK =
	"That folder doesn't exist on this computer.";

/** The composer's disabled reason when nothing is connected. Also the sentence
 *  the connect action's slot is named for in the spec. */
export const CONNECT_DISABLED_REASON = "Connect a computer to send.";

/** The folders read failed — the same sentence `/new` uses for the same failure
 *  (`new-session.tsx`), so one failure has one voice. Carried here because the
 *  home also has to clear it on a successful re-read (review M2). */
export const FOLDERS_READ_FAILED =
	"We couldn't read this computer's folders just now.";

/**
 * Whether the composer holds a draft at all.
 *
 * THE predicate, shared by its three readers so they cannot disagree: the
 * splash's tip clock, the suggestions' slot, and the state marker
 * (`home-markers.tsx`). `trim()`, not `!== ""`: a whitespace-only draft is
 * EMPTY here — the marker already reads it that way, and before this helper a
 * whitespace-only draft froze the tip while the frame declared `idle` (review
 * n2).
 */
export const draftExistsFor = (draft: string): boolean => draft.trim() !== "";

/** The pool's own character ceiling, asserted. 24 is the spec's number; it is
 *  what keeps a full-width row on one line at 320 pt inside the row's 48 pt. */
export const SUGGESTION_CHAR_BUDGET = 24;

/**
 * The mobile suggestion pool, pinned head first: the first screen shows the
 * head deterministically (a reproducible frame — the desktop's own device), and
 * a sampler over the tail is a follow-up rather than a reason for the first
 * frame to differ per run.
 */
export const HOME_SUGGESTIONS = [
	"Turn on phone access",
	"Create a team of agents",
	"Show me the last turn",
	"Set up Linear MCP",
	"Review this repo",
	"Wake me with a summary",
] as const;

/** How many rows the splash shows: 3 at 390 pt, 2 at 320 (`>=` keeps the
 *  spec's own pair exact; a 375 pt phone is nearer the 320 case's pressure). */
export const suggestionCountFor = (viewportWidth: number): number =>
	viewportWidth >= 390 ? 3 : 2;

/**
 * What occupies the suggestions' slot under the greeting.
 *
 * `suggestions` renders the pool's head while the draft is empty; `connect`
 * fills the slot with the one move that changes a no-route state; and `none`
 * is review B1's fix: the slot empties while a draft is held — spec decision
 * 6, "suggestions render only while the draft is empty" (§3.5 `draft exists` →
 * "suggestions hidden"), because a suggestion's tap REPLACES the field's text
 * and a chip that overwrites typed text is a data-loss control (P-4).
 *
 * The connect row is not a text-overwriter (its row navigates instead of
 * staging a draft), so it stays reachable in the no-route state; only the
 * suggestions themselves hide. A whitespace-only draft counts as empty
 * (`draftExistsFor`), so the tip, the marker and this slot read one state.
 */
export type SuggestionSlot =
	| { kind: "suggestions"; rows: readonly string[] }
	| { kind: "connect" }
	| { kind: "none" };

export const suggestionSlotFor = (input: {
	connected: boolean;
	draft: string;
	width: number;
}): SuggestionSlot => {
	if (!input.connected) return { kind: "connect" };
	if (draftExistsFor(input.draft)) return { kind: "none" };
	return {
		kind: "suggestions",
		rows: HOME_SUGGESTIONS.slice(0, suggestionCountFor(input.width)),
	};
};

/** The tip's own character ceiling — the phone row is ~288 pt of `text-meta`
 *  at its narrowest, which is about 48 characters. Asserted, not felt. */
export const TIP_CHAR_BUDGET = 48;

/**
 * The rotating tip pool. Twelve seconds (desktop/TUI rule: under eight and the
 * line turns while being read; over fifteen and a short session only meets the
 * first entry), suspended while the draft is non-empty, one fixed line, never
 * a control, never announced. The pool is short because the row is: an entry
 * that clips is a fragment, not a tip.
 */
export const HOME_TIPS = [
	"set a schedule to run a prompt on a timer",
	"ask for parallel work to fan out subagents",
	"search past conversations to reopen a session",
] as const;

/** One tip's dwell time. `tipAt` wraps, so the ring's length is the pool's. */
export const HOME_TIP_ROTATE_MS = 12_000;

export const tipAt = (index: number): string =>
	HOME_TIPS[index % HOME_TIPS.length] ?? HOME_TIPS[0];
