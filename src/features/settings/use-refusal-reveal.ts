import { useEffect, useRef, useState } from "react";

import {
	refusalAppeared,
	refusalRevealReady,
} from "@/features/settings/refusal-in-view";
import { dismissalsOwed, useDismissalsOwed } from "@/ui/modal-dismissal-ledger";

/**
 * When Settings scrolls a refusal into view (PR #122 UX round 3, U16; review
 * round 5, R5-M1; QA round 6, Q9): once per refusal that appears, and only after
 * the switcher is down and NO modal owes its web dismissal.
 *
 * WHY A HOOK, NOT INLINE IN THE SCREEN. The arm / disarm / wait sequence is the
 * part that regressed three rounds running, and the screen reaches `uniwind`
 * through `@/ui`, which the Node suite cannot import. Kept free of React Native,
 * the hook mounts under react-dom in `modal-dismissal-ledger.test.ts` beside the
 * REAL kit `Dialog` and `Sheet`, so a test drives the sequence the screen ships
 * rather than a replay of it. `reveal` is the screen's measure-and-scroll; it runs
 * at most once per refusal.
 *
 * ORDERING. The wait reads `dismissalsOwed()` LIVE inside the effect: a modal
 * records its close in a layout effect of the same commit, after this render
 * read the subscribed value (the ledger's own comment has the full constraint).
 * The subscription is what re-runs the effect when the last debt settles.
 */
export function useRefusalReveal(
	refused: boolean,
	sheetVisible: boolean,
	reveal: () => void,
): void {
	const wasRefused = useRef(refused);
	const [armed, setArmed] = useState(false);
	const owed = useDismissalsOwed();
	const latestReveal = useRef(reveal);
	latestReveal.current = reveal;
	useEffect(() => {
		if (refusalAppeared(wasRefused.current, refused)) setArmed(true);
		/* A cleared refusal disarms its pending reveal, so nothing armed survives to
		 *  fire on a later, unrelated close (R5-M1). */
		if (!refused) setArmed(false);
		wasRefused.current = refused;
	}, [refused]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `owed` is a TRIGGER — the effect reads the ledger live (see ORDERING above).
	useEffect(() => {
		if (
			!armed ||
			!refusalRevealReady({ sheetVisible, dismissalsOwed: dismissalsOwed() })
		)
			return;
		setArmed(false);
		latestReveal.current();
	}, [armed, sheetVisible, owed]);
}
