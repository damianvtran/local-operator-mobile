/**
 * The session composer's `$skill` state: the per-session catalogue, the caret,
 * the one-shot selection after a pick, and the dismissal memory.
 *
 * It mirrors `team-bridge/mentions/use-mentions.ts` (PR #305), which solved the
 * same three problems on this platform:
 *
 *  - KEYBOARD STAYS UP. A pick writes the new text and hands the field a ONE-SHOT
 *    `selection`; nothing here ever blurs or focuses the input.
 *  - THE ONE-SHOT IS RELEASED on the next selection report, because a
 *    permanently controlled `selection` fights the IME's own cursor.
 *  - EVENT ORDER differs by platform (Android reports the text before the
 *    selection), so the caret is estimated from the edit (`editSkillDraft`).
 *
 * The catalogue is fetched ONCE per session, and only when the relay licenses
 * the `$` affordance for this conversation (`available`). ANY failure — a 404
 * `unknown_session`, a refusal, a dropped link — leaves the tray closed and says
 * nothing: the draft keeps working as plain prose, and a banner about a picker
 * the user never asked for would be worse than no picker (SKM-D5).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	NativeSyntheticEvent,
	TextInputSelectionChangeEventData,
} from "react-native";
import type { SkillEntry } from "@/contracts";
import type { RelayEndpoints } from "@/relay/endpoints";
import {
	dismissSkillDraft,
	editSkillDraft,
	initialSkillDraft,
	pickSkill,
	type SkillDraft,
	skillView,
} from "./skill-state";

export function useSkills(input: {
	sessionId: string;
	/** `null` while there is no relay to ask. */
	endpoints: Pick<RelayEndpoints, "skills"> | null;
	/** The relay advertises `capabilities.skill_invocation` AND this is a LOCAL
	 *  conversation. Off, the tray never opens and nothing is fetched. */
	available: boolean;
	/** The composer's draft, as the screen holds it. */
	text: string;
	setText: (next: string) => void;
	/** The slash sheet owns this draft (a leading `/`): one caret, one list. */
	slashDraft: boolean;
}) {
	const { sessionId, endpoints, available, text, setText, slashDraft } = input;
	const [skills, setSkills] = useState<readonly SkillEntry[]>([]);

	useEffect(() => {
		/* Cleared BEFORE the fetch, so a reused instance (the same screen
		 * repointed at another session) never shows the previous session's rows.
		 * A skill created mid-session needs a reload: the relay drops unknown names
		 * anyway, and fetch-once is the contract. */
		setSkills([]);
		if (!available || endpoints === null) return;
		let cancelled = false;
		endpoints
			.skills(sessionId)
			.then((answer) => {
				if (!cancelled) setSkills(answer.skills);
			})
			.catch(() => {
				if (!cancelled) setSkills([]);
			});
		return () => {
			cancelled = true;
		};
	}, [available, endpoints, sessionId]);

	const draft = useRef<SkillDraft>(initialSkillDraft(text));
	const [, rerender] = useState(0);
	const [selection, setSelection] = useState<number | null>(null);
	const focused = useRef(false);
	/* True from a row's press-in to its release. On the web build a row press
	 * moves focus, and the blur that follows must not close the tray before the
	 * press lands (native presses never blur the field). */
	const holding = useRef(false);
	/* The text changed under us — a restore, a dictation append, the clear after
	 * a send: nothing is armed and no caret is known until the user acts again. */
	if (draft.current.text !== text) {
		draft.current = initialSkillDraft(text);
		setSelection(null);
	}

	const onChangeText = useCallback(
		(next: string) => {
			draft.current = editSkillDraft(draft.current, next);
			setText(next);
			rerender((n) => n + 1);
		},
		[setText],
	);

	const onSelectionChange = useCallback(
		(event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
			const { start, end } = event.nativeEvent.selection;
			// The platform reported where the caret is: release the one-shot.
			setSelection(null);
			// A range is a selection, not a token being typed: closed.
			const caret = start === end ? end : null;
			if (caret === draft.current.caret) return;
			draft.current = {
				...draft.current,
				caret,
				armed: draft.current.armed || focused.current,
			};
			rerender((n) => n + 1);
		},
		[],
	);

	const onFocus = useCallback(() => {
		focused.current = true;
		// A tap into the field is an explicit gesture: it re-arms a dismissed tray.
		draft.current = { ...draft.current, armed: true, dismissed: null };
		rerender((n) => n + 1);
	}, []);

	const onBlur = useCallback(() => {
		focused.current = false;
		if (holding.current) return;
		draft.current = dismissSkillDraft(draft.current);
		rerender((n) => n + 1);
	}, []);

	/* Recomputed every render rather than memoised: the handlers mutate the ref
	 * and re-render, and a stale memo would show the previous caret's rows. */
	const live = skillView(draft.current, skills, available && !slashDraft);

	const pick = useCallback(
		(name: string) => {
			holding.current = false;
			const current = skillView(
				draft.current,
				skills,
				available && !slashDraft,
			);
			if (current === null) return;
			const result = pickSkill(draft.current, current, name);
			draft.current = {
				text: result.text,
				caret: result.caret,
				armed: result.armed,
				dismissed: null,
			};
			setSelection(result.selection);
			setText(result.text);
			rerender((n) => n + 1);
		},
		[available, setText, skills, slashDraft],
	);

	const selectionProp = useMemo(
		() =>
			selection === null ? undefined : { start: selection, end: selection },
		[selection],
	);

	return {
		/** The tray's rows; empty means closed. */
		rows: live?.rows ?? [],
		pick,
		onChangeText,
		onSelectionChange,
		/** Pass to the field: a one-shot caret placement, else undefined. */
		selection: selectionProp,
		onFocus,
		onBlur,
		hold: () => {
			holding.current = true;
		},
		release: () => {
			holding.current = false;
		},
	};
}
