/**
 * The composer home's copy, in one place, with its budgets asserted in
 * `home-copy.test.ts` rather than argued in review.
 *
 * The greeting is the desktop's verbatim line. The suggestion pool is the
 * spec's mobile pool — six entries, ≥24 characters checked, and read as a set
 * they obey the desktop's own two rules (no two entries share a leading verb;
 * at most one entry creates an agent). The tips are the desktop pool's entries
 * whose move is true on a phone, shortened to the phone row's width.
 *
 * EVERY LINE BELOW COMES FROM THE CATALOGUE (`src/i18n/`), and the copy itself
 * lives in `src/i18n/catalogues/en/mobile.home.json` with its translator context
 * beside it. Each one is a FUNCTION rather than a constant: a `const` calls `t`
 * once at import, so a screen already mounted when the relay's language arrives
 * would keep the language this module was first evaluated in. The budgets stay
 * constants — they are numbers about layout, not translatable text.
 */
import type { StartupPhase } from "@/features/new-session/startup-coordinator";
import { type NoParamKey, type ShippedLocale, t } from "@/i18n";

export const greeting = (): string => t("mobile.home.greeting");

/** The splash's replacement while the first send is in flight — one line, so
 *  the composer never moves when the splash changes height under it. */
export const startingLine = (): string => t("mobile.home.starting");

/** The refused-start sentence, verbatim from `/new` (the relay's own sentence
 *  is preferred when it has one — see `home.tsx`). */
export const refusedStartFallback = (): string =>
	t("mobile.home.refused_start_fallback");

/** The composer's disabled reason when nothing is connected. Also the sentence
 *  the connect action's slot is named for in the spec. */
export const connectDisabledReason = (): string =>
	t("mobile.home.connect_disabled_reason");

/** The folders read failed — the same sentence `/new` uses for the same failure
 *  (`new-session.tsx`), so one failure has one voice. Carried here because the
 *  home also has to clear it on a successful re-read (review M2). */
export const foldersReadFailed = (): string =>
	t("mobile.home.folders_read_failed");

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

/**
 * The pool's character ceiling PER SHIPPED LOCALE, not one number for all of
 * them (review m6).
 *
 * WHY PER LOCALE. 24 is the spec's number, and it is calibrated on ENGLISH: the
 * longest English chip ("Create a team of agents", 23) fits one full-width row
 * inside the row's 48 pt at 320 pt. Applied to French it is a lossy budget, not
 * a layout rule — the French row physically fits more characters at the same
 * font size, because the same sentence is 30% longer and the row is measured in
 * points, not in letters. Forcing French into 24 characters bought
 * "Créez une équipe" for "Create a team of agents": the agent, which is the
 * whole point of the chip, was the word that got dropped.
 *
 * HOW 31 IS DERIVED. Measured on this head, over all 120 catalogue messages: the
 * median per-message French/English character ratio is 1.30 (mean 1.42).
 * 24 × 1.30 = 31.2, so 31 characters of French occupy the same width as 24 of
 * English — the same one-line row at 320 pt, not a larger budget by feel.
 *
 * WHY THE TYPE AND NOT A FALLBACK. `Record<ShippedLocale, number>` makes a
 * shipped locale with no measured budget a COMPILE error, so a new language
 * cannot inherit English's number silently; `home-copy.test.ts` asserts each
 * locale's own chips against its own row.
 */
export const SUGGESTION_CHAR_BUDGET: Readonly<Record<ShippedLocale, number>> = {
	en: 24,
	fr: 31,
};

/** The row's ceiling for one shipped locale. */
export const suggestionCharBudget = (locale: ShippedLocale): number =>
	SUGGESTION_CHAR_BUDGET[locale];

/**
 * The mobile suggestion pool's KEYS, pinned head first: the first screen shows
 * the head deterministically (a reproducible frame — the desktop's own device),
 * and a sampler over the tail is a follow-up rather than a reason for the first
 * frame to differ per run.
 *
 * The KEYS are what is exported as the pool (with `homeSuggestions()` rendering
 * them) because the pool is asserted per SHIPPED locale, not only in English:
 * a check that could only see the active language would call a French row fine
 * until someone ran the app in French.
 */
export const HOME_SUGGESTION_KEYS = [
	"mobile.home.suggestion.phone_access",
	"mobile.home.suggestion.team_of_agents",
	"mobile.home.suggestion.last_turn",
	"mobile.home.suggestion.linear_mcp",
	"mobile.home.suggestion.review_repo",
	"mobile.home.suggestion.wake_summary",
] as const satisfies readonly NoParamKey[];

/** The pool as the reader's language renders it, resolved per call. */
export const homeSuggestions = (): readonly string[] =>
	HOME_SUGGESTION_KEYS.map((key) => t(key));

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
		rows: homeSuggestions().slice(0, suggestionCountFor(input.width)),
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
export const HOME_TIP_KEYS = [
	"mobile.home.tip.schedule",
	"mobile.home.tip.parallel",
	"mobile.home.tip.search",
] as const satisfies readonly NoParamKey[];

/** The pool as the reader's language renders it, resolved per call. */
export const homeTips = (): readonly string[] =>
	HOME_TIP_KEYS.map((key) => t(key));

/** One tip's dwell time. `tipAt` wraps, so the ring's length is the pool's. */
export const HOME_TIP_ROTATE_MS = 12_000;

export const tipAt = (index: number): string => {
	const tips = homeTips();
	return tips[index % tips.length] ?? tips[0] ?? "";
};

/**
 * What Home says about work that has not left the device — state only, never the
 * count: the composer's own chip already says "1 queued", and saying it twice on
 * one screen was UX U2. `null` means this row has nothing to add.
 *
 * The important case is `unconfirmed`: the create may or may not have happened,
 * no session id exists, and no automatic retry is possible. "Waiting to start…"
 * was a lie there — nothing was waiting and nothing would start — so the copy
 * names the state instead and the row keeps the queued sheet one tap away.
 */
export function startupQueueState(
	phase: StartupPhase,
	sessionId: string | null,
): string | null {
	/* `null` for `starting`: the splash already paints "Starting…" on the same
	 * screen, and the row existed twice for one state (UX U2). The row still
	 * renders there — it keeps the queued sheet reachable — it just adds no words. */
	if (phase === "starting") return null;
	if (sessionId !== null)
		return phase === "blocked"
			? t("mobile.home.startup_queue.blocked")
			: t("mobile.home.startup_queue.sending");
	if (phase === "unconfirmed")
		return t("mobile.home.startup_queue.unconfirmed");
	return t("mobile.home.startup_queue.not_started");
}
