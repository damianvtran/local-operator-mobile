/**
 * React glue for `UnderflowFill` (issue #322): the decision and its
 * bookkeeping live in `underflow-fill.ts`; this only feeds them the list's
 * facts at the two moments they can change — the rendered rows or the
 * reader's state (an effect), and a fresh content height (the stable callback
 * it returns, called from `TranscriptList`'s `onContentSizeChange`).
 *
 * The page is requested through `loadOlder` directly, not the list's
 * `requestOlder`: that path is for a reader scrolling UP, so it holds the web
 * anchor on the row in view and stops following the tail. A fill happens to a
 * reader at the newest edge, who should stay there while history arrives
 * above.
 */

import { useCallback, useEffect, useRef } from "react";

import type { TranscriptItem } from "@/features/session/turn-condensing";
import { UnderflowFill } from "@/features/session/underflow-fill";

export interface UnderflowFillInput {
	sessionId: string;
	items: readonly TranscriptItem[];
	/** `olderFillReady`; false where the caller never fills (the default). */
	olderReady: boolean;
	hasError: boolean;
	loadOlder: (() => Promise<void>) | undefined;
	/** Read at decision time: the list's initial placement is spent. */
	positioned: () => boolean;
	/** Read at decision time: the transcript viewport's height. */
	viewportPt: () => number;
}

export const useUnderflowFill = (
	input: UnderflowFillInput,
): ((contentPt: number) => void) => {
	const fill = useRef(new UnderflowFill());
	const live = useRef(input);
	live.current = input;

	const check = useCallback(() => {
		const now = live.current;
		if (!now.loadOlder) return;
		if (
			fill.current.next({
				sessionId: now.sessionId,
				items: now.items,
				positioned: now.positioned(),
				olderReady: now.olderReady,
				hasError: now.hasError,
				viewportPt: now.viewportPt(),
			})
		)
			void now.loadOlder();
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers (new rows, the reader settling); `check` reads them through `live`.
	useEffect(() => {
		check();
	}, [check, input.sessionId, input.items, input.olderReady, input.hasError]);

	const contentMeasured = useCallback(
		(contentPt: number) => {
			fill.current.measured(live.current.items, contentPt);
			check();
		},
		[check],
	);
	return contentMeasured;
};
