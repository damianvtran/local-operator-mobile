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
