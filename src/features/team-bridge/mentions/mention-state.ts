/**
 * The mention composer's decisions as pure functions: how an edit carries the
 * token map, where the caret is, whether the strip is open and for which
 * `@query`, and what a pick does to the text.
 *
 * WHY PURE. Desktop's `use-mention-autocomplete.ts` is one hook over DOM key
 * and composition events. A phone has neither: there is no Backspace key event
 * to intercept, no `isComposing` on Android, and `onChangeText` and
 * `onSelectionChange` arrive in different orders on iOS and Android. So mobile
 * works from what React Native DOES give it — the old text, the new text, and
 * (eventually) a selection — and every rule lives here, where a unit test can
 * drive the exact sequences each platform produces. `use-mentions.ts` only
 * holds the state.
 */
import {
	findMentionQuery,
	type MentionCandidate,
	type MentionQuery,
	type MentionSection,
	rankMentionCandidates,
} from "./matcher";
import {
	deleteAcrossToken,
	insertMention,
	type MentionToken,
	rebaseTokens,
} from "./tokens";

export type MentionDraft = {
	text: string;
	tokens: readonly MentionToken[];
	/** Passive selection/layout events on a restored draft must not open the strip. */
	queryEnabled: boolean;
	/** Where the caret is believed to be, in UTF-16 units of `text`. */
	caret: number;
	/**
	 * The `@` index whose query was dismissed (a typed space left zero
	 * matches, desktop's Esc rule); the strip stays closed for that `@` only.
	 */
	dismissedAt: number | null;
};

/**
 * The result of an edit. `selection` is set when the edit moved the caret
 * somewhere the platform will not put it on its own (a whole-mention delete,
 * a pick): the caller passes it to the field ONCE and clears it on the next
 * selection event, because a permanently controlled `selection` fights the
 * IME's own cursor while composing.
 */
export type MentionEditResult = MentionDraft & { selection: number | null };

const HAS_SPACE = /\s/;

/** The common prefix and suffix of two strings: where an edit happened. */
function diffSpan(before: string, after: string) {
	let prefix = 0;
	const max = Math.min(before.length, after.length);
	while (prefix < max && before[prefix] === after[prefix]) prefix += 1;
	let suffix = 0;
	while (
		suffix < max - prefix &&
		before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
	)
		suffix += 1;
	return { prefix, suffix };
}

/**
 * Carry the draft across one `onChangeText`.
 *
 * - A PURE DELETION that touches a mention removes the whole mention: on a
 *   phone, Backspace reaches us only as "one character fewer", so the deleted
 *   range is recovered from the diff and widened over the token
 *   (`deleteAcrossToken`). The caret goes to where the mention began.
 * - Anything else (typing, paste, autocorrect, dictation) rebases the map:
 *   a token whose characters the edit touched becomes plain text.
 * - The caret is ESTIMATED as the end of the inserted span. That is where
 *   every platform puts it after typing, pasting or an autocorrect
 *   replacement, so the query is right even when `onChangeText` arrives
 *   before the selection event that confirms it (Android) — no frame where
 *   the strip reads a stale caret against new text.
 */
export function editDraft(
	draft: MentionDraft,
	next: string,
): MentionEditResult {
	const before = draft.text;
	if (before === next) return { ...draft, selection: null };
	const { prefix, suffix } = diffSpan(before, next);
	const inserted = next.length - prefix - suffix;
	const removedEnd = before.length - suffix;
	if (inserted === 0 && removedEnd > prefix && draft.tokens.length > 0) {
		const whole = deleteAcrossToken(
			before,
			draft.tokens,
			{ start: prefix, end: removedEnd },
			"Backspace",
		);
		if (whole && whole.text !== next) {
			return {
				text: whole.text,
				tokens: whole.tokens,
				caret: whole.caret,
				queryEnabled: true,
				dismissedAt: draft.dismissedAt,
				selection: whole.caret,
			};
		}
	}
	return {
		text: next,
		tokens: rebaseTokens(before, next, draft.tokens),
		caret: next.length - suffix,
		queryEnabled: true,
		dismissedAt: draft.dismissedAt,
		selection: null,
	};
}

/** The `@query` being typed, unless it belongs to a placed mention. */
export function activeQuery(draft: MentionDraft): MentionQuery | null {
	if (!draft.queryEnabled) return null;
	const caret = Math.min(draft.caret, draft.text.length);
	const query = findMentionQuery(draft.text, caret);
	if (!query) return null;
	// An `@` that starts a picked mention is that mention, not a new query: the
	// caret right after "@Ben Tran " must not reopen the strip on Ben.
	if (draft.tokens.some((token) => token.start === query.start)) return null;
	return query;
}

export type MentionView = {
	query: MentionQuery;
	sections: MentionSection[];
	flat: MentionCandidate[];
};

/**
 * What the strip shows, or null when it is closed.
 *
 * `directoryMissing` is "the organization directory has never answered":
 * then the strip stays open even with no matches, so it can say why the list
 * is short instead of silently showing nothing.
 */
export function mentionView(
	draft: MentionDraft,
	candidates: readonly MentionCandidate[],
	directoryMissing = false,
): MentionView | null {
	const query = activeQuery(draft);
	if (!query || query.start === draft.dismissedAt) return null;
	const { sections, flat } = rankMentionCandidates(query.query, candidates);
	if (flat.length === 0 && !directoryMissing) return null;
	return { query, sections, flat };
}

/**
 * Desktop's "a typed space that leaves zero matches is Esc": once the query
 * holds a space and nothing matches, the reader is writing prose, so the
 * strip stays closed for that `@` even if a later word would match someone.
 * A different `@` (or none) clears the memory.
 */
export function nextDismissed(
	draft: MentionDraft,
	candidates: readonly MentionCandidate[],
): number | null {
	const query = activeQuery(draft);
	if (!query) return null;
	if (query.start === draft.dismissedAt) return draft.dismissedAt;
	if (!HAS_SPACE.test(query.query)) return null;
	const { flat } = rankMentionCandidates(query.query, candidates);
	return flat.length === 0 ? query.start : null;
}

/**
 * Replace the `@query` with `@Label ` and record the token. `notify` false
 * keeps the name as text with no wire row (a non-member, an invited member, an
 * agent with no endpoint): the reader still sees exactly what they picked.
 */
export function pickMention(
	draft: MentionDraft,
	query: MentionQuery,
	candidate: MentionCandidate,
	notify: boolean,
): MentionEditResult {
	const edit = insertMention(
		draft.text,
		draft.tokens,
		{ start: query.start, end: Math.min(draft.caret, draft.text.length) },
		candidate,
		notify,
	);
	return {
		text: edit.text,
		tokens: edit.tokens,
		caret: edit.caret,
		queryEnabled: draft.queryEnabled,
		dismissedAt: null,
		selection: edit.caret,
	};
}
