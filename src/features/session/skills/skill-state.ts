/**
 * The session composer's `$skill` decisions as pure functions: where the caret
 * is believed to be, whether the tray is open and for which rows, and what a
 * pick does to the draft.
 *
 * WHY PURE, AND WHY IT LOOKS LIKE `mention-state.ts`. A phone has no Escape key,
 * no `isComposing` on Android, and `onChangeText` / `onSelectionChange` arrive
 * in a different order on iOS and Android. So — as for the Team Bridge
 * `@`-mention strip (`team-bridge/mentions/mention-state.ts`, PR #305) — every
 * rule works from what React Native DOES give it (the old text, the new text and
 * eventually a selection), and `use-skills.ts` only holds the state. The grammar
 * itself (`skill-token.ts`) is the relay web client's, ported verbatim.
 *
 * The web composer's dismissal rules (`skillDismissed` / `closedAtRef` in the
 * relay web client's composer) are ported for what a TOUCH keyboard can do:
 * Escape and the document-level pointer listeners have no equivalent, so a tray
 * closes when the caret leaves the token, when the user types past it, or when
 * the field loses focus (the keyboard going away); it re-opens on the next edit,
 * on focus, or on a caret move to a different parse.
 */
import type { SkillEntry } from "@/contracts";
import {
	isLeadingSkillToken,
	type SkillToken,
	skillMatches,
	skillSpanReplacement,
	skillToken,
} from "./skill-token";

export type SkillDraft = {
	text: string;
	/**
	 * Where the caret is believed to be, in UTF-16 units of `text`. `null` is
	 * "unknown / a range is selected" and reads as CLOSED, never as end-of-text:
	 * a restored `$ux` draft must not open the tray before the user has touched
	 * anything (the relay web client's UX review U2).
	 */
	caret: number | null;
	/**
	 * Set by the user's own gesture (focus or an edit) and cleared whenever the
	 * text changes under us (a restore, a dictation append, the clear after a
	 * send). Passive selection events on an untouched draft must not open the
	 * tray.
	 */
	armed: boolean;
	/**
	 * The parse the tray was closed at (`parseKey`). The tray stays closed for
	 * exactly that caret and token, and a different parse is a fresh decision —
	 * the web client's `closedAtRef` rule, which keeps the selection report a
	 * dismissing gesture itself produces from re-opening what it just closed.
	 */
	dismissed: string | null;
};

export const initialSkillDraft = (text: string): SkillDraft => ({
	text,
	caret: null,
	armed: false,
	dismissed: null,
});

/** The common suffix length of two strings: how much text sits after an edit. */
const commonSuffix = (before: string, after: string): number => {
	let prefix = 0;
	const max = Math.min(before.length, after.length);
	while (prefix < max && before[prefix] === after[prefix]) prefix += 1;
	let suffix = 0;
	while (
		suffix < max - prefix &&
		before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
	)
		suffix += 1;
	return suffix;
};

/**
 * Carry the draft across one `onChangeText`.
 *
 * The caret is ESTIMATED as the end of the inserted span. That is where every
 * platform puts it after typing, pasting or an autocorrect replacement, so the
 * token is right even when `onChangeText` arrives before the selection event
 * that confirms it (Android) — there is no frame where the tray reads a stale
 * caret against new text. An edit is a fresh gesture: it re-arms the tray and
 * invalidates the parse a dismissal recorded.
 */
export const editSkillDraft = (draft: SkillDraft, next: string): SkillDraft => {
	if (next === draft.text) return draft;
	return {
		text: next,
		caret: next.length - commonSuffix(draft.text, next),
		armed: true,
		dismissed: null,
	};
};

/** The identity of one parse (caret + token), for the dismissal snapshot. */
export const parseKey = (text: string, caret: number | null): string | null => {
	if (caret === null) return null;
	const token = skillToken(text, caret);
	return token === null
		? null
		: `${caret}:${token.start}:${token.end}:${token.query}`;
};

export type SkillView = {
	token: SkillToken;
	/** The matched rows, in catalogue order — never re-sorted. */
	rows: SkillEntry[];
};

/**
 * What the tray shows, or `null` when it is closed.
 *
 * `enabled` is everything outside the draft that closes the tray: the relay's
 * capability, a remote conversation, and a leading-`/` draft (the slash sheet
 * owns that caret; one caret, one list).
 */
export const skillView = (
	draft: SkillDraft,
	skills: readonly SkillEntry[],
	enabled: boolean,
): SkillView | null => {
	if (!enabled || !draft.armed || draft.caret === null) return null;
	const token = skillToken(draft.text, draft.caret);
	if (token === null) return null;
	if (draft.dismissed === parseKey(draft.text, draft.caret)) return null;
	const rows = skillMatches(
		token.query,
		skills,
		isLeadingSkillToken(draft.text, token),
	);
	return rows.length === 0 ? null : { token, rows };
};

/** Close the tray for the parse it is open at. */
export const dismissSkillDraft = (draft: SkillDraft): SkillDraft => {
	const key = parseKey(draft.text, draft.caret);
	return key === null ? draft : { ...draft, dismissed: key };
};

/**
 * Replace ONLY the token's span with `$name` plus one separator, and park the
 * caret after it (`skillSpanReplacement`'s arithmetic): prose before and after
 * the token survives byte for byte. The caller passes `selection` to the field
 * ONCE.
 */
export const pickSkill = (
	draft: SkillDraft,
	view: SkillView,
	name: string,
): SkillDraft & { selection: number } => {
	const edit = skillSpanReplacement(draft.text, view.token, name);
	return {
		text: edit.text,
		caret: edit.caret,
		armed: true,
		dismissed: null,
		selection: edit.caret,
	};
};

/** What the tray looked like to the extras scroller on one commit. */
export type SkillTrayFrame = {
	/** Rows showing (0 = the tray is closed). */
	rows: number;
	/** True when the extras scroller is capped (compact composer), i.e. it can hide content. */
	capped: boolean;
};

/**
 * Whether the capped extras scroller must be brought to its end so the tray is
 * on screen. The tray is the LAST child of `extras`, so with an attachment or a
 * notice above it a compact composer (short landscape, 320x568, 200 % text) can
 * leave it below the fold. Reveal when it opens, when it gains rows, or when the
 * cap arrives while it is already open (the cap is measured one layout later);
 * never when the scroller is uncapped (nothing can be hidden) or the tray is
 * closed/shrinking, so a reader who scrolled up is not pulled back down by the
 * tray merely staying open.
 */
export const shouldRevealSkillTray = (
	previous: SkillTrayFrame,
	next: SkillTrayFrame,
): boolean =>
	next.capped &&
	next.rows > 0 &&
	(previous.rows === 0 || next.rows > previous.rows || !previous.capped);

/**
 * Rows after which the tray stops growing: `SKILL_TRAY_MAX_PT` is 3.5 rows plus
 * padding, so a fourth row already fills it and more rows only scroll INSIDE the
 * tray. Kept here (the tray module reaches `uniwind`, which Node tests cannot
 * import); `skill-tray.tsx` documents the cap it derives from.
 */
export const SKILL_TRAY_GROWTH_ROWS = 4;

/**
 * Whether going from `previous` to `next` rows can change the tray's height,
 * i.e. whether the extras scroller will report a new content size. Arming the
 * post-layout scroll when it cannot would leave the flag set until some
 * unrelated content-size change fired it and yanked the reader to the end.
 */
export const trayHeightCanChange = (previous: number, next: number): boolean =>
	next > previous && previous < SKILL_TRAY_GROWTH_ROWS;
