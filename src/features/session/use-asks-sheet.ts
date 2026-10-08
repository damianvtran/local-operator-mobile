import { useIsFocused } from "expo-router";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { TextInput, View } from "react-native";
import { useStore } from "zustand";

import type { PendingAsk } from "@/contracts";
import { blockingPending, outstandingAsks } from "@/features/session/asks";
import {
	createAsksAutoOpen,
	expandTargetFor,
} from "@/features/session/asks-open-policy";
import { sessions } from "@/features/session/runtime";
import { readEntry } from "@/state";

/**
 * The asks sheet's visibility, for one session screen.
 *
 * WHY A HOOK OF ITS OWN. The screen used to hold `useState(false)` for this and
 * flip it from two places (the bar opens it, the sheet closes it). Opening it by
 * default needs a verdict that reads the projection store, the composer's draft
 * and its focus, and a close that is remembered — none of which belongs in the
 * screen's render path. The decisions are `asks-open-policy.ts`'s (pure, and
 * unit-tested); this file is only the React plumbing that feeds them facts and
 * acts on the answer, so the screen's diff stays a handful of one-line swaps.
 *
 * It reads the projection store ITSELF, as `useSessionRuntime` does, rather than
 * taking a projection from the runtime: the policy needs the entry's
 * `connected`/`awaitingSnapshot` flags (is this frame from THIS connection or a
 * leftover?), which the runtime does not expose, and widening `SessionRuntime`
 * for one consumer would put the session hook in every other ask change's way.
 */
export interface AsksSheetInput {
	sessionId: string;
	/** The composer's field. Focus is not React state, so it is READ at decision
	 *  time through this handle instead of being rendered into the dependency list. */
	fieldRef: React.RefObject<TextInput | null>;
	draft: string;
	/** The persisted draft has been read (see `ComposerState.draftReady`). */
	draftReady: boolean;
	/** Images attached and not yet sent. */
	attachments: number;
	/** A dictation is starting, recording or transcribing. */
	dictating: boolean;
	/** The model or effort sheet is open. */
	otherSheetOpen: boolean;
}

export interface AsksSheetControl {
	visible: boolean;
	/** The ask the sheet should open EXPANDED, or `null` (see `expandTargetFor`).
	 *  Non-null only while the sheet is up because the POLICY opened it. */
	initialOpenAsk: string | null;
	/** The frame's own rows, to draw the sheet's first frame from while its first
	 *  read is in flight - for a policy open only (see `AsksSheet.seedRows`). */
	seedRows: PendingAsk[] | null;
	/** Attach to the ask bar: it is the auto-opened sheet's opener, so the platform
	 *  returns focus to it on close (see the focus note in the hook). */
	barRef: React.RefObject<View | null>;
	/** The sheet's opening read failed: an auto-opened sheet closes back to the
	 *  bar (see `AsksAutoOpen.readFailed`). Wire to `AsksSheet.onReadFailed`. */
	readFailed: () => void;
	/** The bar's press. An auto-open is NOT this (contract rule 6): the door keeps
	 *  its own meaning, and pressing it never touches the dismissal record — it
	 *  only tells the policy the reader got there first. */
	open: () => void;
	/** Every way out of the sheet — the Close control, the scrim, the platform's
	 *  back gesture — because the policy must not tell them apart (rule 5). A close
	 *  while this conversation still has asks is remembered (rule 4). */
	close: () => void;
	/** Hide the sheet because the reader picked another conversation from inside
	 *  it. A navigation, not a refusal of THIS conversation's asks, so nothing is
	 *  remembered for it; the destination is (see `AsksAutoOpen.navigated`). */
	leave: (target: string) => void;
}

export const useAsksSheet = (input: AsksSheetInput): AsksSheetControl => {
	const {
		sessionId,
		fieldRef,
		draft,
		draftReady,
		attachments,
		dictating,
		otherSheetOpen,
	} = input;

	/* The same read `useSessionRuntime` makes. `readEntry` returns the stored entry
	 * by reference (or one shared constant), so the selector is stable and does not
	 * loop; the entry changes identity only when a frame or a stream flag does. */
	const entry = useStore(sessions, () =>
		readEntry(sessions.getState(), sessionId),
	);

	/* A blocking approval card is on screen. Derived here from the entry this hook
	 * already reads, through the SAME `blockingPending` the screen renders its card
	 * from - the legacy ask mirror (`kind === "ask"`) is not an approval once
	 * `asks` is published, so it must not count as one - rather than asking the
	 * screen for a second copy of that predicate. */
	const approvalOpen =
		blockingPending(
			entry.projection?.pending ?? null,
			entry.projection?.asks,
		) !== null;

	/* The stack keeps this screen MOUNTED under the agent drill-down, so "the screen
	 * exists" is not "the reader is looking at it". The sheet is a window-level
	 * `Modal`; opening it from a frame that lands while another route is on top
	 * would raise it over that route. Same hook the ack gate uses. */
	const screenFocused = useIsFocused();

	/* One controller per MOUNT of the screen: a view is a mount (rule 2), and the
	 * ledger it writes to is module-scoped so it outlives that mount (rule 4). */
	const [controller] = useState(() => createAsksAutoOpen());

	/* Whether the sheet is open is the controller's fact, KEYED BY CONVERSATION -
	 * not a `useState(false)` this hook owns. That is rule 4 holding if the same
	 * mounted screen were ever pointed at another conversation and back (dismiss A,
	 * land on B where the policy opens it, return to A: a boolean kept here would
	 * show A's sheet though nothing opened it, and A's sheet over B for the frame
	 * before an effect could correct it). No navigation call in this app does that
	 * today - see `AsksAutoOpen.openFor` for the router reading - so this is
	 * hardening, not the repair of a known leak. Derived from the id on every
	 * render, the answer is simply "no" for any conversation the controller did
	 * not open it for.
	 * `useSyncExternalStore` because the controller changes it from an effect
	 * (the policy), from the bar (a press) and from the sheet (a close), none of
	 * which are this component's state. */
	const visible = useSyncExternalStore(
		controller.subscribe,
		() => controller.isOpenFor(sessionId),
		() => false,
	);

	/* The head question, for a sheet the POLICY raised. Derived per render from the
	 * frame already in hand (not the sheet's own read) so the question is on the
	 * first painted frame; the sheet reads it once, on the opening transition. */
	const initialOpenAsk = visible
		? expandTargetFor(controller.openOrigin(), entry.projection?.asks)
		: null;
	const seedRows =
		visible && controller.openOrigin() === "policy"
			? (entry.projection?.asks ?? null)
			: null;

	/* THE BAR IS THE AUTO-OPENED SHEET'S OPENER (UX round 1, U3). The platform's
	 * `Modal` returns focus, when it closes, to whatever held it when it OPENED
	 * (react-native-web's `ModalFocusTrap`: "refocus element that triggered opening
	 * modal after closing it"). A sheet the reader opened has that: they pressed the
	 * bar. An auto-open has no press, so the thing focused at that moment was the
	 * document body, and every close dropped focus there - the next Tab started from
	 * the top of the page, which is what a keyboard or screen-reader reader hits.
	 *
	 * The fix is to give the auto-open the opener it lacks rather than to chase focus
	 * after the fact: an earlier attempt focused the bar once the sheet had closed
	 * and lost twice (measured) - the sheet was still mounted and its trap pulled
	 * focus straight back, and the platform's own restore to the body then landed
	 * after. So the bar takes focus at the instant the POLICY raises the sheet, from
	 * the controller's synchronous notification (which runs before React renders the
	 * `Modal`, so its mount-time snapshot sees the bar), and the platform does the
	 * restore on every way out - Close, scrim, Escape, back - with no close-side code.
	 *
	 * This is not focus theft: `readerEngaged` has already established the composer
	 * does not hold focus, and the sheet moves focus into itself on mount anyway.
	 * `focus` is optional-chained: a platform whose handle has none keeps the old
	 * behaviour rather than throwing. Native focus behaviour is NOT verified here
	 * (no simulator on the build host). */
	const barRef = useRef<View | null>(null);
	useEffect(
		() =>
			controller.subscribe(() => {
				if (
					controller.isOpenFor(sessionId) &&
					controller.openOrigin() === "policy"
				) {
					barRef.current?.focus?.();
				}
			}),
		[controller, sessionId],
	);

	useEffect(() => {
		/* The verdict is applied INSIDE the controller (`openFor`), so the return
		 * value is not needed here: an open reaches the screen through the store. */
		controller.observe({
			sessionId,
			entry,
			draftKnown: draftReady,
			screenFocused,
			engagement: {
				/* A focus read must never break the screen: on a platform where the
				 * handle has not attached yet, or has no `isFocused`, "not focused" is
				 * the honest reading of "nothing says it is". */
				focused: fieldRef.current?.isFocused?.() ?? false,
				draft,
				attachments,
				dictating,
				otherSheetOpen,
				approvalOpen,
			},
		});
	}, [
		controller,
		sessionId,
		entry,
		draftReady,
		screenFocused,
		draft,
		attachments,
		dictating,
		otherSheetOpen,
		approvalOpen,
		fieldRef,
	]);

	const open = useCallback(() => {
		controller.opened({ sessionId });
	}, [controller, sessionId]);

	const close = useCallback(() => {
		/* A close of a sheet that is not showing is no decision: nothing was
		 * refused, so nothing is remembered. */
		if (!controller.isOpenFor(sessionId)) return;
		/* The FRESHEST frame the app holds, read at the moment of the close rather
		 * than captured at the last render: a reader who answers the last ask and
		 * closes in the same breath has refused nothing, and a closure over the
		 * previous render's frame would remember a dismissal for a queue that is
		 * already empty. It also keeps this callback's identity stable, so the
		 * Sheet's `onClose` is not a new function on every projection frame. */
		const latest = readEntry(sessions.getState(), sessionId);
		controller.closed({
			sessionId,
			asksRemain: outstandingAsks(latest.projection?.asks).length > 0,
		});
	}, [controller, sessionId]);

	const readFailed = useCallback(() => {
		/* Not a close by the reader: no focus to restore (nothing had it) and
		 * nothing to remember. The controller owns whether it applies. */
		controller.readFailed({ sessionId });
	}, [controller, sessionId]);

	const leave = useCallback(
		(target: string) => {
			controller.navigated({ to: target });
		},
		[controller],
	);

	return {
		visible,
		initialOpenAsk,
		seedRows,
		barRef,
		readFailed,
		open,
		close,
		leave,
	};
};
