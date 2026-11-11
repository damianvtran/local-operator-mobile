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
import { DURATIONS } from "@/ui/tokens.gen";
import {
	ANCHOR_HIGHLIGHT_MS,
	ANCHOR_VIEW_POSITION,
	anchorPlacement,
	anchorStep,
	type MissingReason,
	type ThreadAnchor,
} from "./thread-anchor";
import type { ThreadViewport } from "./thread-viewport";

export { ANCHOR_VIEW_POSITION };

/** The FlatList methods the anchor uses; a test passes a fake. */
export interface AnchorList {
	scrollToIndex(params: {
		index: number;
		viewPosition?: number;
		viewOffset?: number;
		animated?: boolean;
	}): void;
	scrollToOffset(params: { offset: number; animated?: boolean }): void;
}

export type AnchorPhase = "pending" | "landed" | "none";

/**
 * Bounds on the older-page walk (round-1 U1-2). The thread normally ends the
 * walk itself; these only stop a very deep anchor from holding the reader on
 * a loading block. There is no measured walk-latency distribution to size
 * them from (the fixture's deepest walk is one page), so they are the UX
 * review's patience bounds, and crossing one is harmless: the reader gets
 * #208's open-at-newest, silently (absence is not proven), and Load older
 * still reaches the message. 20 pages = 1,000 messages at the hub's page of
 * 50; 8 s is counted from the first older page requested.
 */
export const ANCHOR_WALK_MAX_PAGES = 20;
export const ANCHOR_WALK_BUDGET_MS = 8_000;

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
	/** History proved the anchored message is gone (`MissingReason` "gone"):
	 *  the screen tells the reader once. Never called for "unloaded". */
	onGone?: () => void;
	/** The highlight's fade after its hold: `DURATIONS.draw`, capped by the
	 *  screen under reduced motion (`effectiveDuration`). */
	fadeMs?: number;
	/** Defaults to the next animation frame: after the rows commit. */
	schedule?: (run: () => void) => () => void;
}) {
	const { anchor, conversationId, thread, items, list, viewport } = input;
	const schedule = input.schedule ?? nextFrame;
	const fadeMs = input.fadeMs ?? DURATIONS.draw;
	const [phaseState, setPhase] = useState<AnchorPhase>(
		anchor ? "pending" : "none",
	);
	const [highlight, setHighlight] = useState<{
		id: string;
		fading: boolean;
	} | null>(null);
	const [following, setFollowing] = useState(true);
	const [jumpRetired, setJumpRetired] = useState(false);
	const step =
		anchor && phaseState === "pending" && conversationId
			? anchorStep(anchor, thread)
			: null;
	/* A "missing" step ends the hold in the SAME render that brought the data
	 *  deciding it, not one effect later. The viewport reads `pending` through
	 *  the screen's `dataReady`, so the layout event those rows raise is then
	 *  measured as admitted data and lands them at the newest edge (Q1-1). */
	const phase: AnchorPhase =
		phaseState === "pending" && step?.kind === "missing" ? "none" : phaseState;
	const stepKey = step
		? `${step.kind}:${step.kind === "found" ? step.messageId : ""}:${thread?.messages.length ?? 0}`
		: null;
	const itemsRef = useRef(items);
	itemsRef.current = items;
	const phaseRef = useRef(phase);
	phaseRef.current = phase;
	const rowHeights = useRef(new Map<string, number>());
	/** The landing whose placement a row measurement may still correct. */
	const refining = useRef<string | null>(null);
	const scrollTo = useCallback(
		(index: number, messageId: string) => {
			const { viewPosition, viewOffset } = anchorPlacement(
				rowHeights.current.get(messageId) ?? null,
				viewport.current?.viewportHeight ?? 0,
			);
			list.current?.scrollToIndex({
				index,
				viewPosition,
				...(viewOffset ? { viewOffset } : {}),
				animated: false,
			});
		},
		[list, viewport],
	);
	const land = useCallback(
		(messageId: string) => {
			const index = itemsRef.current.findIndex(
				(item) => item.key === messageId,
			);
			if (index < 0) {
				setPhase("none");
				return;
			}
			scrollTo(index, messageId);
			refining.current = messageId;
			viewport.current?.anchored();
			setPhase("landed");
			setHighlight({ id: messageId, fading: false });
		},
		[scrollTo, viewport],
	);
	/**
	 * The landed row's height arrived (its `onLayout`). The first scroll could
	 * only use the default placement when the row had never rendered; correct
	 * it once, so a tall row at 200 % text is not left under "Jump to newest"
	 * (`anchorPlacement`). Later re-measures are the reader's business.
	 */
	const measureRow = useCallback(
		(messageId: string, height: number) => {
			const before = anchorPlacement(
				rowHeights.current.get(messageId) ?? null,
				viewport.current?.viewportHeight ?? 0,
			);
			rowHeights.current.set(messageId, height);
			if (refining.current !== messageId) return;
			refining.current = null;
			const after = anchorPlacement(
				height,
				viewport.current?.viewportHeight ?? 0,
			);
			if (
				before.viewPosition === after.viewPosition &&
				before.viewOffset === after.viewOffset
			)
				return;
			const index = itemsRef.current.findIndex(
				(item) => item.key === messageId,
			);
			if (index >= 0) scrollTo(index, messageId);
		},
		[scrollTo, viewport],
	);
	const loadOlder = useRef(input.loadOlder);
	loadOlder.current = input.loadOlder;
	const onGone = useRef(input.onGone);
	onGone.current = input.onGone;
	const pages = useRef(0);
	const [walkStarted, setWalkStarted] = useState(false);
	const fallBack = useCallback((reason: MissingReason) => {
		setPhase("none");
		if (reason === "gone") onGone.current?.();
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `stepKey` is the step's identity; `step` is rebuilt every render.
	useEffect(() => {
		if (!step) return;
		if (step.kind === "older") {
			if (pages.current >= ANCHOR_WALK_MAX_PAGES) {
				fallBack("unloaded");
				return;
			}
			pages.current += 1;
			setWalkStarted(true);
			/* While the initial phase holds, the viewport is not following
			 *  anything yet and the prepend is hidden; releasing follow here
			 *  left the fallback with following off, so no later layout
			 *  re-targeted the newest edge (Q1-1). Only a reader who already took
			 *  control (a gesture ended the initial phase) must not be pulled
			 *  down by the prepend. */
			if (viewport.current && !viewport.current.pending)
				viewport.current.releaseFollow();
			loadOlder.current();
		} else if (step.kind === "missing") {
			fallBack(step.reason);
		} else if (step.kind === "found") {
			return schedule(() => land(step.messageId));
		}
	}, [stepKey]);
	useEffect(() => {
		if (!walkStarted || phaseState !== "pending") return;
		const timer = setTimeout(() => fallBack("unloaded"), ANCHOR_WALK_BUDGET_MS);
		return () => clearTimeout(timer);
	}, [walkStarted, phaseState, fallBack]);
	/* Resolved to "not here": hand back to open-at-newest. Nothing re-measures
	 *  on a state change alone, so the viewport is told explicitly. */
	useEffect(() => {
		if (phase === "none" && anchor) viewport.current?.dataChanged();
	}, [phase, anchor, viewport]);
	/* Hold, then fade (round-1 D2): the band eases out over `fadeMs` instead
	 *  of vanishing in one frame. The row animates; this owns the timing. */
	useEffect(() => {
		if (!highlight) return;
		const timer = highlight.fading
			? setTimeout(() => setHighlight(null), fadeMs)
			: setTimeout(
					() => setHighlight({ id: highlight.id, fading: true }),
					ANCHOR_HIGHLIGHT_MS,
				);
		return () => clearTimeout(timer);
	}, [highlight, fadeMs]);
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
	const clearHighlight = useCallback(() => setHighlight(null), []);
	/**
	 * Wire as the viewport's `followChanged`. "Jump to newest" is the exit from
	 * an anchored landing, not a general scroll-to-bottom control (#208's
	 * ordinary reader never sees one), so once the reader reaches the newest
	 * edge after landing — by scrolling or by the pill — it is retired for
	 * this visit (round-1 R1-3 / D4).
	 */
	const followChanged = useCallback((next: boolean) => {
		setFollowing(next);
		if (next && phaseRef.current === "landed") setJumpRetired(true);
	}, []);
	return {
		phase,
		/** Hold open-at-newest while this is true. */
		pending: phase === "pending",
		highlightId: highlight?.id ?? null,
		/** The hold is over; the highlighted row fades out over `fadeMs`. */
		highlightFading: highlight?.fading ?? false,
		fadeMs,
		showJump: phase === "landed" && !following && !jumpRetired,
		followChanged,
		clearHighlight,
		measureRow,
		onScrollToIndexFailed,
	};
}

const nextFrame = (run: () => void) => {
	const frame = requestAnimationFrame(run);
	return () => cancelAnimationFrame(frame);
};
