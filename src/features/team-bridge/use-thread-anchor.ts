/**
 * The thread screen's message-anchor driver (`thread-anchor.ts` decides; this
 * acts). Split out of `thread-screen.tsx` so a Node test can drive it with a
 * fake list and a real viewport controller and watch where the reader lands.
 *
 * PHASES. `pending` holds #208's open-at-newest (the screen folds it into the
 * viewport's `dataReady`) while the anchored message is located, fetching
 * older pages as needed, so the reader never sees a jump to the bottom and
 * then back up. `landed`: the message is on screen, highlighted for
 * `ANCHOR_HIGHLIGHT_MS`, the reader in control (`viewport.anchored()`), and
 * "Jump to newest" offered until they reach the newest edge. `none`: an
 * ordinary open — no anchor, or the message is not in this thread — handed
 * back to open-at-newest.
 */
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { Message } from "@/team-bridge/contract";
import type { ThreadItem } from "@/team-bridge/model";
import {
	ANCHOR_HIGHLIGHT_MS,
	anchorStep,
	type ThreadAnchor,
} from "./thread-anchor";
import type { ThreadViewport } from "./thread-viewport";

/** The FlatList methods the anchor uses; a test passes a fake. */
export interface AnchorList {
	scrollToIndex(params: {
		index: number;
		viewPosition?: number;
		animated?: boolean;
	}): void;
	scrollToOffset(params: { offset: number; animated?: boolean }): void;
}

export type AnchorPhase = "pending" | "landed" | "none";

/** Upper third, not centred: the reader also sees what led up to the message. */
export const ANCHOR_VIEW_POSITION = 0.3;

export function useThreadAnchor(input: {
	anchor: ThreadAnchor | null;
	conversationId: string | null;
	thread:
		| {
				messages: readonly Message[];
				state: "idle" | "loading" | "ready" | "error";
				hasMore: boolean;
				loadingOlder: boolean;
				olderError: unknown;
		  }
		| undefined;
	items: readonly ThreadItem[];
	list: RefObject<AnchorList | null>;
	viewport: RefObject<ThreadViewport | null>;
	loadOlder: () => void;
	/** Defaults to the next animation frame: after the rows commit. */
	schedule?: (run: () => void) => () => void;
}) {
	const { anchor, conversationId, thread, items, list, viewport } = input;
	const schedule = input.schedule ?? nextFrame;
	const [phase, setPhase] = useState<AnchorPhase>(anchor ? "pending" : "none");
	const [highlightId, setHighlightId] = useState<string | null>(null);
	const step =
		anchor && phase === "pending" && conversationId
			? anchorStep(anchor, thread)
			: null;
	const stepKey = step
		? `${step.kind}:${step.kind === "found" ? step.messageId : ""}:${thread?.messages.length ?? 0}`
		: null;
	const itemsRef = useRef(items);
	itemsRef.current = items;
	const land = useCallback(
		(messageId: string) => {
			const index = itemsRef.current.findIndex(
				(item) => item.key === messageId,
			);
			if (index < 0) {
				setPhase("none");
				return;
			}
			list.current?.scrollToIndex({
				index,
				viewPosition: ANCHOR_VIEW_POSITION,
				animated: false,
			});
			viewport.current?.anchored();
			setPhase("landed");
			setHighlightId(messageId);
		},
		[list, viewport],
	);
	const loadOlder = useRef(input.loadOlder);
	loadOlder.current = input.loadOlder;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `stepKey` is the step's identity; `step` is rebuilt every render.
	useEffect(() => {
		if (!step) return;
		if (step.kind === "older") {
			// A prepend while locating must not count as the reader following.
			viewport.current?.releaseFollow();
			loadOlder.current();
		} else if (step.kind === "missing") {
			setPhase("none");
		} else if (step.kind === "found") {
			return schedule(() => land(step.messageId));
		}
	}, [stepKey]);
	/* Resolved to "not here": hand back to open-at-newest. Nothing re-measures
	 *  on a state change alone, so the viewport is told explicitly. */
	useEffect(() => {
		if (phase === "none" && anchor) viewport.current?.dataChanged();
	}, [phase, anchor, viewport]);
	useEffect(() => {
		if (!highlightId) return;
		const timer = setTimeout(() => setHighlightId(null), ANCHOR_HIGHLIGHT_MS);
		return () => clearTimeout(timer);
	}, [highlightId]);
	/* A row beyond the rendered window has no frame yet: scroll to the
	 *  estimate (which renders that region) and retry. Each retry moves the
	 *  window toward the row, so the attempts are bounded by the row count. */
	const attempts = useRef(0);
	const onScrollToIndexFailed = useCallback(
		(info: { index: number; averageItemLength: number }) => {
			list.current?.scrollToOffset({
				offset: info.averageItemLength * info.index,
				animated: false,
			});
			if (attempts.current >= itemsRef.current.length) return;
			attempts.current += 1;
			schedule(() => {
				const item = itemsRef.current[info.index];
				if (item?.type === "message") land(item.key);
			});
		},
		[list, land, schedule],
	);
	const clearHighlight = useCallback(() => setHighlightId(null), []);
	return {
		phase,
		/** Hold open-at-newest while this is true. */
		pending: phase === "pending",
		highlightId,
		clearHighlight,
		onScrollToIndexFailed,
	};
}

const nextFrame = (run: () => void) => {
	const frame = requestAnimationFrame(run);
	return () => cancelAnimationFrame(frame);
};
