/**
 * State for the Team Bridge composer's @-mentions: the token map, the caret,
 * the one-shot selection, and the "not notified" notice. Every rule is in
 * `mention-state.ts`; this hook only holds the values between renders.
 *
 * The thread screen owns and persists text and picked spans together. Caret,
 * selection, suggestion visibility and notices belong only to this visit:
 * restoring text can emit selection events without any reader interaction.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type {
	NativeSyntheticEvent,
	TextInputSelectionChangeEventData,
} from "react-native";
import type { TeamBridgeDraft } from "@/team-bridge/thread-drafts";
import { type MentionCandidateRow, notifiable } from "./candidates";
import type { MentionCandidate } from "./matcher";
import {
	editDraft,
	type MentionDraft,
	mentionView,
	nextDismissed,
	pickMention,
} from "./mention-state";

export type MentionNotice = {
	label: string;
	reason: "not_member" | "invited" | "no_endpoint";
};

export function useMentions(input: {
	value: TeamBridgeDraft;
	setValue: (next: TeamBridgeDraft) => void;
	candidates: readonly MentionCandidateRow[];
	/** The organization directory has never answered (see `mentionView`). */
	directoryMissing: boolean;
}) {
	const { value, setValue, candidates, directoryMissing } = input;
	const { text, tokens } = value;
	const draft = useRef<MentionDraft>({
		text,
		tokens,
		caret: text.length,
		queryEnabled: false,
		dismissedAt: null,
	});
	const [, rerender] = useState(0);
	const [selection, setSelection] = useState<number | null>(null);
	const [notice, setNotice] = useState<MentionNotice | null>(null);
	// An external clear after send must not carry across any interaction state.
	if (draft.current.text !== text || draft.current.tokens !== tokens) {
		draft.current = {
			text,
			tokens,
			caret: text.length,
			queryEnabled: false,
			dismissedAt: null,
		};
		setSelection(null);
		setNotice(null);
	}

	const commit = useCallback(
		(next: MentionDraft, oneShot: number | null) => {
			const dismissedAt = nextDismissed(next, candidates);
			draft.current = { ...next, dismissedAt };
			if (oneShot !== null) setSelection(oneShot);
			if (next.text !== text || next.tokens !== tokens)
				setValue({ text: next.text, tokens: next.tokens });
			else rerender((n) => n + 1);
		},
		[candidates, setValue, text, tokens],
	);

	const onChangeText = useCallback(
		(next: string) => {
			const result = editDraft(draft.current, next);
			commit(result, result.selection);
		},
		[commit],
	);

	const onSelectionChange = useCallback(
		(event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
			const { end } = event.nativeEvent.selection;
			// The platform reported where the caret is: release the one-shot.
			if (selection !== null) setSelection(null);
			if (end === draft.current.caret) return;
			draft.current = { ...draft.current, caret: end };
			rerender((n) => n + 1);
		},
		[selection],
	);

	const suspend = useCallback(() => {
		draft.current = {
			...draft.current,
			queryEnabled: false,
			dismissedAt: null,
		};
		setSelection(null);
		setNotice(null);
		rerender((n) => n + 1);
	}, []);
	const view = mentionView(draft.current, candidates, directoryMissing);

	const pick = useCallback(
		(candidate: MentionCandidate) => {
			if (!view) return;
			const notify = notifiable(candidate);
			const result = pickMention(draft.current, view.query, candidate, notify);
			commit(result, result.selection);
			setNotice(
				notify
					? null
					: {
							label: candidate.label,
							reason: candidate.invited
								? "invited"
								: candidate.member
									? "no_endpoint"
									: "not_member",
						},
			);
		},
		[commit, view],
	);

	const dismissNotice = useCallback(() => setNotice(null), []);
	/*
	 * The notice explains ONE mention ("won't be notified"), so it lives as long
	 * as that mention does: deleting it, editing it into plain text, or the
	 * draft clearing after a send retires the notice with it.
	 */
	const liveNotice =
		notice &&
		draft.current.tokens.some(
			(token) => !token.notify && token.label === notice.label,
		)
			? notice
			: null;

	const selectionProp = useMemo(
		() =>
			selection === null ? undefined : { start: selection, end: selection },
		[selection],
	);

	return {
		/** The strip's content, or null when it is closed. */
		view,
		pick,
		onChangeText,
		onSelectionChange,
		/** Pass to the field: a one-shot caret placement, else undefined. */
		selection: selectionProp,
		suspend,
		notice: liveNotice,
		dismissNotice,
	};
}
