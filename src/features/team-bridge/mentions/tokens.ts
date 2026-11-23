/**
 * The composer's mention TOKENS: a range map over the plain draft text.
 *
 * PORTED FROM DESKTOP (local-operator-ui `src/renderer/src/features/team-bridge/
 * mentions/tokens.ts` @ 3786d6e8fb); keep the two in step.
 *
 * WHY A SIDECAR MAP, NOT RICH TEXT. The text stays plain (`@Ben Tran` is
 * literally in the draft, which is also the readable body the hub receives),
 * so the draft store, the refused-send restore and the IME keep working on a
 * plain `TextInput`. A token records where a picked mention sits; every edit
 * rebases the map (`rebaseTokens`) and drops any token whose characters were
 * touched, so a token can never claim text that no longer spells its name.
 * Mobile draws tokens as plain text in v1: a mirrored highlight overlay over a
 * React Native `TextInput` cannot be measured reliably, so desktop's
 * `segmentText` and its arrow-key `clampCaret` (no arrow keys on a phone
 * keyboard) are not ported.
 *
 * All offsets are UTF-16 indices, the unit React Native's `selection` speaks.
 */
import type { MentionRow } from "@/team-bridge/contract";
import type { MentionCandidate, MentionKind } from "./matcher";

export type MentionToken = {
	/** Index of the `@`. */
	start: number;
	/** Exclusive end: `start + 1 + label.length`. */
	end: number;
	kind: MentionKind;
	accountId: string;
	endpointId?: string;
	label: string;
	/**
	 * False for someone who is not an ACTIVE member of the conversation: the
	 * name stays in the text but the token is dropped from the wire `mentions[]`.
	 */
	notify: boolean;
};

/** The wire row is the contract's `MentionRow`: one shape, validated by the
 *  client before it is sent (`mentionRowsSchema`). */
export type MentionWireRow = MentionRow;

/** The text after an insertion already starts with whitespace. */
const LEADS_WITH_SPACE = /^\s/;

export type MentionEdit = {
	text: string;
	caret: number;
	tokens: MentionToken[];
};

/**
 * Replace the `@query` at [start, end) with `@Label ` and record its token.
 * Tokens after the insertion shift by the length change.
 */
export function insertMention(
	text: string,
	tokens: readonly MentionToken[],
	range: { start: number; end: number },
	candidate: Pick<
		MentionCandidate,
		"kind" | "accountId" | "endpointId" | "label"
	>,
	notify = true,
): MentionEdit {
	const spelled = `@${candidate.label}`;
	// One trailing space so the next word does not glue onto the name, but not
	// a second one when the text already continues with whitespace.
	const after = text.slice(range.end);
	const pad = LEADS_WITH_SPACE.test(after) ? "" : " ";
	// Joined as parts, not a template literal: the draft is user text, and the
	// i18n string scanner reads a bare `${…}${…}` literal as untranslated copy.
	const next = [text.slice(0, range.start), spelled, pad, after].join("");
	const token: MentionToken = {
		start: range.start,
		end: range.start + spelled.length,
		kind: candidate.kind,
		accountId: candidate.accountId,
		...(candidate.kind === "agent" && candidate.endpointId
			? { endpointId: candidate.endpointId }
			: {}),
		label: candidate.label,
		notify,
	};
	const rebased = rebaseTokens(text, next, tokens).filter(
		(existing) => existing.end <= range.start || existing.start >= token.end,
	);
	return {
		text: next,
		caret: token.end + 1,
		tokens: sortTokens([...rebased, token]),
	};
}

function sortTokens(tokens: MentionToken[]): MentionToken[] {
	return tokens.sort((a, b) => a.start - b.start);
}

/**
 * Carry the map across an arbitrary edit (typing, paste, cut, dictation).
 *
 * The edit is located by common prefix and suffix, the only thing an
 * `onChange` tells us. A token entirely before the changed span is kept, one
 * entirely after it shifts, and one that the span touches is DROPPED: a
 * half-edited name is plain text again, never a token pointing at the wrong
 * characters. A final spelling check drops any token whose range no longer
 * reads `@label` (belt and braces for ambiguous diffs).
 *
 * A native undo that re-inserts a deleted mention brings back its TEXT but not
 * its token: there is nothing left to re-expand, so it sends as plain text.
 */
export function rebaseTokens(
	before: string,
	after: string,
	tokens: readonly MentionToken[],
): MentionToken[] {
	if (tokens.length === 0) return [];
	if (before === after) return tokens.filter((t) => spells(after, t));
	let prefix = 0;
	const max = Math.min(before.length, after.length);
	while (prefix < max && before[prefix] === after[prefix]) prefix += 1;
	let suffix = 0;
	while (
		suffix < max - prefix &&
		before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
	)
		suffix += 1;
	const changedEnd = before.length - suffix;
	const delta = after.length - before.length;
	const kept: MentionToken[] = [];
	for (const token of tokens) {
		if (token.end <= prefix) kept.push(token);
		else if (token.start >= changedEnd)
			kept.push({
				...token,
				start: token.start + delta,
				end: token.end + delta,
			});
		// else: the edit touched this token's characters; it becomes text.
	}
	return kept.filter((t) => spells(after, t));
}

function spells(text: string, token: MentionToken): boolean {
	return text.slice(token.start, token.end) === `@${token.label}`;
}

/**
 * Backspace / Delete as ONE token: mobile calls this from `onChangeText` with
 * the range the platform already deleted (there is no key event to intercept
 * on a phone keyboard). Returns null when the edit does not touch a token.
 *
 * A non-collapsed selection that overlaps a token is widened to cover the
 * whole token, so a drag-select across half a mention deletes the mention.
 */
export function deleteAcrossToken(
	text: string,
	tokens: readonly MentionToken[],
	selection: { start: number; end: number },
	key: "Backspace" | "Delete",
): MentionEdit | null {
	let { start, end } = selection;
	if (start === end) {
		const hit = tokens.find((t) =>
			key === "Backspace"
				? start > t.start && start <= t.end
				: start >= t.start && start < t.end,
		);
		if (!hit) return null;
		start = hit.start;
		end = hit.end;
	} else {
		let widened = false;
		for (const t of tokens) {
			if (t.start < end && t.end > start) {
				if (t.start < start) {
					start = t.start;
					widened = true;
				}
				if (t.end > end) {
					end = t.end;
					widened = true;
				}
			}
		}
		if (!widened) return null;
	}
	const next = text.slice(0, start) + text.slice(end);
	return { text: next, caret: start, tokens: rebaseTokens(text, next, tokens) };
}

/**
 * The wire `mentions[]`: notifying tokens only, deduplicated by member
 * (kind + account, and endpoint for an agent), in first-mention order. Humans
 * never carry `endpoint_id`; an agent without one is not addressable and is
 * left out rather than sent as a row the backend refuses with a 422.
 */
export function serializeMentions(
	tokens: readonly MentionToken[],
	/**
	 * `kind:account_id` of the conversation's ACTIVE members at send time. A
	 * row naming anyone else makes the hub refuse the WHOLE message, so the
	 * filter is applied here, at the last moment, whatever the token says: a
	 * member who left after the pick, or a token restored from an old draft,
	 * cannot turn a send into a 400 (review R1-01). Omitted only by tests of
	 * the shape itself.
	 */
	activeMembers?: ReadonlySet<string>,
): MentionWireRow[] {
	const seen = new Set<string>();
	const rows: MentionWireRow[] = [];
	for (const token of tokens) {
		if (!token.notify) continue;
		if (activeMembers && !activeMembers.has(`${token.kind}:${token.accountId}`))
			continue;
		if (token.kind === "agent" && !token.endpointId) continue;
		const key = `${token.kind}:${token.accountId}:${token.endpointId ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		rows.push(
			token.kind === "agent" && token.endpointId
				? {
						kind: "agent",
						account_id: token.accountId,
						endpoint_id: token.endpointId,
					}
				: { kind: "human", account_id: token.accountId },
		);
	}
	return rows;
}
