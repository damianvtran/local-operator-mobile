import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	FlatList,
	type LayoutChangeEvent,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	View,
} from "react-native";

import type { TranscriptEntry } from "@/contracts";
import { anchorBottomVisible } from "@/features/session/completion-visibility";
import { QuietGroupBar } from "@/features/session/components/quiet-group-bar";
import { TranscriptRow } from "@/features/session/components/transcript-row";
import { TurnBar } from "@/features/session/components/turn-bar";
import { type RevealSubject, revealTarget } from "@/features/session/find";
import { scrollAnchorFromHook } from "@/features/session/scroll-hook";
import {
	condensePlan,
	groupPlan,
	type LatchedTurn,
	parseExpandHook,
	type QuietGroup,
	type TranscriptItem,
} from "@/features/session/turn-condensing";
import {
	rowLayout,
	rowOffsets,
	TAIL_CLAMP_OFFSET_PT,
	tailStartIndex,
	windowPolicy,
} from "@/features/session/windowing";
import { completionAnchorId, transcriptRowId } from "@/ui/a11y";
import { cx } from "@/ui/variants";

/**
 * The transcript: virtualised, tail-following, and never blank.
 *
 * **Virtualised for the long case, not the common one.** The relay's own
 * `long-transcript` scenario is 520 rows and every row can change height while it
 * streams, so the list is a `FlatList` with a window derived from the viewport
 * (`windowing.ts`) rather than a plain scroller. `getItemLayout` answers from the
 * MEASURED height cache (`windowing.ts`'s layout facts): a row that has laid out
 * once keeps the height it laid out with, so the list can place itself and jump
 * to an index without the virtualiser guessing, and a row nobody has seen yet
 * falls back to the estimate.
 *
 * **The first frame is the tail.** The list OPENS at the last screenful
 * (`initialScrollIndex`, `tailStartIndex`) instead of rendering from the top and
 * being scrolled down afterwards by `onContentSizeChange`. That mattered because
 * the old path's first frame was the top of the conversation at estimated
 * heights, and every later frame was a correction the reader watched: the tail
 * pin is now a clamp to the content's end (`TAIL_CLAMP_OFFSET_PT`) that only
 * runs while the reader is already at the tail — the auto-follow below, not the
 * thing that decides where the list starts. `initialScrollIndex` is deliberately
 * NOT passed when this session has a saved offset to restore or a capture hook
 * asked for the top: those are the two cases where the reader is not going to
 * the tail, and opening there first would be a jump they see.
 *
 * **Auto-follow only at the tail.** The view follows new content while the reader
 * is already at the bottom, and stops the moment they scroll up — the web client
 * learned this the hard way (PR #1784's U27/U28): a repaint that yanks the reader
 * back to the bottom while they are reading is worse than missing the newest line,
 * because the thing they were reading moves. The band is measured in points rather
 * than pixels so it means the same thing on every density.
 *
 * **The last-good rows stay on screen through a connection loss** — that is the
 * projection store's `stale beats blank` rule, and this component inherits it by
 * simply rendering whatever rows it is given. It never clears on its own.
 *
 * **Completed turns condense; the active one never does.** Which turns collapse
 * into a summary bar, and what the bar says, is `turn-condensing.ts`'s decision
 * (pure, and pinned by its no-un-condense-jitter test). It is APPLIED here
 * because the list is where the rendered rows and their measured heights live:
 * the collapse and the anchor geometry must agree about what occupies the
 * screen, or one of them is lying.
 */
export type TranscriptListProps = {
	sessionId: string;
	entries: TranscriptEntry[];
	/** The row that carries `transcript-streaming`, or `null` when settled. */
	streamingRowId: string | null;
	/** Resolves an attachment's bytes. */
	loadImage?: (entryId: string, index: number) => Promise<string | null>;
	/** Opens a subagent's own view. */
	onOpenAgent?: (jobId: string) => void;
	/** The turn interrupt, threaded to image-gen cards (the composer's Stop
	 *  path). `undefined` while no turn is live; resolves whether the request
	 *  reached the relay (review round 1, F2). */
	onCancelTurn?: () => Promise<boolean>;
	/** Rendered when there are no rows at all (a seeded but empty session). An
	 *  ELEMENT rather than arbitrary nodes, because `ListEmptyComponent` takes a
	 *  component or an element and not a node list. */
	empty?: React.ReactElement | null;
	/** Rendered above the rows, inside the scroller: the status strip. */
	header?: React.ReactNode;
	/** The entry id whose BOTTOM the ack gate watches — the completion
	 *  attention's `anchor_id` (ADR 0006 §3.1). `null` when nothing is being
	 *  watched. */
	anchorId?: string | null;
	/** Fired when "the anchor row's bottom is inside this list's viewport"
	 *  flips. The list owns the measurements; the screen owns the meaning. */
	onAnchorVisible?: (visible: boolean) => void;
	/** The landed find hit: its row wears the selection wash while it is the
	 *  current hit, and nothing otherwise. A colour wash alone is never the
	 *  only signal — the find bar's `n of m` and the results list's selected
	 *  row state the same fact in words. */
	highlightId?: string | null;
	/** A jump request from the find session: reveal this entry — open the
	 *  condensed turn that hides it (the desktop's expand-first walk), scroll
	 *  to it, and let the wash say where it is. `nonce` distinguishes two
	 *  landings on the same id (stepping wraps), so a repeat still re-runs. */
	reveal?: { id: string; nonce: number } | null;
	testID: string;
};

/** How close to the bottom still counts as "at the tail", in points. A finger
 *  leaves the viewport within a few points of the end; demanding exact equality
 *  would silently stop following on almost every device. */
const TAIL_BAND_PT = 48;

/** No turns open — a shared empty so a session-switch reset bails out of a
 *  render instead of committing an equal-but-new set. */
const NO_TURNS: ReadonlySet<string> = new Set();

/**
 * The capture hook's turn keys: `lo-expand` on the page's query string names
 * turn keys to render expanded. `parseExpandHook` owns the parse (and why a
 * harness page may ask at all — the audit rig drives no taps); this reads it
 * off `globalThis`, guarded the way `src/stt/recorder.ts` reads `lo-recorder`, so
 * the module stays importable off-web.
 */
const expandHookKeys = (): ReadonlySet<string> => {
	const locationLike = (globalThis as { location?: { search?: string } })
		.location;
	if (locationLike?.search === undefined) return NO_TURNS;
	return parseExpandHook(
		new URLSearchParams(locationLike.search).get("lo-expand"),
	);
};

/**
 * Where the reader left each conversation, for the life of the process: the
 * offset they were at, and whether they were close enough to the end to call it
 * the tail.
 *
 * WHY THE TAIL IS A FLAG AND NOT A NUMBER (review round 1 MINOR-1; QA round 1 Q2).
 * An absolute `contentOffset.y` means "this far down the CONTENT", and the list
 * the reader comes back to is not the list they left: the first paint merges the
 * relay's page with the live frame and holds both, so the merged list carries
 * rows theirs did not, and the remembered offset points at a different row —
 * thousands of points above the newest message (QA measured S2/S4/S5 at
 * 7 722 / 2 404 / 4 387 px off on the ordinary "go back into the conversation I
 * was reading" path). For a reader who was following the end, the end itself is
 * the exact answer and needs no number at all.
 *
 * The two ways of making the ELSEWHERE case survive the merge were both tried and
 * both measured worse than the plain offset here: a row anchor (the top row's id
 * plus how far above the edge it sat) double-counts the estimate for the rows
 * nobody has measured — QA's S2 Back scenario landed 2 209 px past the position
 * it saved — and a distance-from-the-end reserve lands +438 px off on the same
 * scenario, because the unmeasured mass above the reader is estimated at 44 pt
 * when they return and was measured when they left. That residual is the estimate
 * error MAJOR-1/Q1 names; it closes when the relay can state real heights (audit
 * C1), not with a better guess here. The offset is clamped to the content that
 * exists, so a list that shrank cannot leave the reader past its end.
 *
 * In memory rather than in device storage on purpose: this is a navigational
 * convenience, and making it durable would put a write on the scroll path — the
 * one path on this screen that runs at frame rate.
 */
interface ScrollPlace {
	/** The offset they were scrolled to, as the platform reported it. */
	offset: number;
	/** Within the follow band of the end: reopen at the tail, not at a position. */
	atTail: boolean;
}

const scrollPlaces = new Map<string, ScrollPlace>();

export const TranscriptList = ({
	sessionId,
	entries,
	streamingRowId,
	loadImage,
	onOpenAgent,
	onCancelTurn,
	empty,
	header,
	anchorId = null,
	onAnchorVisible,
	highlightId = null,
	reveal = null,
	testID,
}: TranscriptListProps) => {
	const listRef = useRef<FlatList<TranscriptItem>>(null);
	/** The capture hook's anchor: `top` starts the list unfollowed so a still can
	 *  show the conversation's shape (see `scroll-hook.ts` for why the app exposes
	 *  one position). Read once — it is a statement about the page. */
	const [scrollAnchor] = useState(scrollAnchorFromHook);
	const atTail = useRef(scrollAnchor !== "top");
	/** Whether THIS MOUNT opens somewhere other than the tail — a saved offset to
	 *  restore (`F-6.11` — Back preserves scroll) or the capture hook's `top`.
	 *  `initialScrollIndex` is read once by the list, so the statement it feeds is
	 *  unavoidably made at mount; the conversation on screen can change afterwards
	 *  (see `openElsewhere` below). */
	const [openElsewhereAtMount] = useState(
		() =>
			scrollAnchor === "top" || scrollPlaces.get(sessionId)?.atTail === false,
	);
	/** The same question, asked again for whichever conversation is open NOW.
	 *
	 * A switch does not always remount this screen: the deep-link path is a
	 * `router.navigate`, which reuses the mounted list and swaps its props, so a
	 * mount-latched answer would speak for a conversation that is gone — the new
	 * conversation would get no `initialScrollIndex` (unavoidable) and, worse, no
	 * layout clamp either, resting at the top until the reader scrolled (review
	 * round 1, MINOR-1). The switch effect below re-answers it, and `atTail` with
	 * it: the tail is the default for a conversation this device has nowhere else
	 * to open. */
	const [openElsewhere, setOpenElsewhere] = useState(openElsewhereAtMount);
	/** Which session's offset has already been restored, held as a ref rather than
	 *  in an effect keyed on `sessionId`: the restore has to run when the list first
	 *  has content, which is an event the list emits, not a render this hook sees. */
	const restoredFor = useRef<string | null>(null);
	const [viewportPt, setViewportPt] = useState(0);

	/* ---------------------------------------------------------------- condense --
	 *
	 * The plan over the current entries, plus the two facts that are NOT derivable
	 * from the current frame:
	 *
	 *  - `latchRef` is the transcript's memory that a turn has condensed, and the
	 *    bar facts it froze with (`turn-condensing.ts`'s invariant 2: a later
	 *    frame may regress a row it already summarised, and must not be able to
	 *    re-open a bar the reader has seen). It is written during render — the
	 *    same pattern the anchor refs below use — because an effect would lag by a
	 *    frame, and the lag is visible as a bar that arrives late.
	 *  - `readerExpanded` is the reader's own open/close state; the session-switch
	 *    effect below resets it (another conversation's turns are not this one's).
	 *
	 * The capture hook joins the reader's set so a harness page can render the
	 * open state as a still. */
	const [hookExpanded] = useState(expandHookKeys);
	const [readerExpanded, setReaderExpanded] =
		useState<ReadonlySet<string>>(NO_TURNS);
	const latchRef = useRef<{
		session: string;
		latch: ReadonlyMap<string, LatchedTurn>;
	}>({ session: sessionId, latch: new Map() });
	if (latchRef.current.session !== sessionId) {
		// A session switch starts the memory over — the `heightsRef` own rule.
		latchRef.current = { session: sessionId, latch: new Map() };
	}
	const expanded = useMemo(() => {
		if (hookExpanded.size === 0) return readerExpanded;
		return new Set([...readerExpanded, ...hookExpanded]);
	}, [readerExpanded, hookExpanded]);
	const plan = useMemo(
		() => condensePlan({ entries, expanded, latch: latchRef.current.latch }),
		[entries, expanded],
	);
	/* Idempotent for a given `entries` (the latch only grows), so a
	 * double-invoked render computes the same plan. */
	latchRef.current.latch = plan.latch;
	/*
	 * The group fold, over the planned items (design §5): consecutive
	 * `peer_message` receipts become one bar wherever they are visible —
	 * including the ACTIVE turn, which turn condensing may never fold. Its own
	 * latch freezes a closed group's facts the same way (`turn-condensing.ts`'s
	 * `groupPlan`), and its keys share the reader's expansion set: the two key
	 * spaces cannot collide ("a user row id" vs "qg:<first row id>").
	 */
	const groupLatchRef = useRef<{
		session: string;
		latch: ReadonlyMap<string, QuietGroup>;
	}>({ session: sessionId, latch: new Map() });
	if (groupLatchRef.current.session !== sessionId) {
		// A session switch starts this memory over too — the `latchRef` rule.
		groupLatchRef.current = { session: sessionId, latch: new Map() };
	}
	const grouped = useMemo(
		() =>
			groupPlan({
				items: plan.items,
				expanded,
				latch: groupLatchRef.current.latch,
			}),
		[plan, expanded],
	);
	/* Idempotent like the turn plan: the latch only grows. */
	groupLatchRef.current.latch = grouped.latch;
	const toggleExpansion = useCallback((key: string, open: boolean) => {
		setReaderExpanded((current) => {
			const next = new Set(current);
			if (open) next.add(key);
			else next.delete(key);
			return next;
		});
	}, []);

	const policy = useMemo(
		// The window's unit is what the FlatList MOUNTS, so it counts the plan's
		// items: a condensed turn mounts its bar, not the work behind it.
		() => windowPolicy(viewportPt > 0 ? viewportPt : 844, grouped.items.length),
		[viewportPt, grouped.items.length],
	);

	/* ---------------------------------------------------- the anchor geometry --
	 *
	 * The ack gate needs one fact from this component — "the anchor row's bottom
	 * is inside the viewport" — and it is computed HERE because this is where
	 * the three inputs live: the scroll facts (onScroll/onContentSizeChange),
	 * the viewport height (onLayout), and every row's measured height
	 * (`measureRow`, fed by each row's onLayout). The decision itself is the
	 * pure `anchorBottomVisible`, so the arithmetic that gates a read receipt
	 * is testable without a renderer.
	 *
	 * The scroll path runs at frame rate, so NOTHING here writes state per
	 * event: facts and heights live in refs, and only a FLIP of the boolean
	 * reaches React (via `onAnchorVisible`). A flip is rare — it is what the
	 * per-frame computation exists to find. */
	/** Scroll facts, updated in place on every scroll/content event. */
	const factsRef = useRef({ contentPt: 0, offsetY: 0 });
	/** Measured row heights, keyed by entry id. Persisted across repaints so an
	 *  unmounted-then-remounted row keeps the height it laid out with. */
	const heightsRef = useRef(new Map<string, number>());
	/** Bumped by every measurement, to invalidate the cached offset table that
	 *  `getItemLayout` answers from (review round 1, NIT-2): `heightsRef` is
	 *  mutated in place and cannot be a dependency, so a version is. */
	const heightsVersionRef = useRef(0);
	/** The offset table `getItemLayout` answers from, rebuilt when the row list
	 *  changes identity or a row has been measured since it was built. */
	const layoutTable = useRef<{
		rows: unknown;
		version: number;
		offsets: number[];
	}>({ rows: null, version: -1, offsets: [] });
	/** The last boolean reported upward; only flips are reported. */
	const lastAnchorVisibleRef = useRef(false);
	/* Latest props read by `recompute`, which must be stable: a re-created scroll
	 * handler is fine, but the refs keep the decision ONE function. */
	const anchorIdRef = useRef<string | null>(anchorId);
	anchorIdRef.current = anchorId;
	/* The plan's items, not the raw entries: the anchor's position is computed
	 * over what is RENDERED (see `recompute`), and this is that list. */
	const itemsRef = useRef<readonly TranscriptItem[]>(grouped.items);
	itemsRef.current = grouped.items;
	const viewportRef = useRef(0);
	viewportRef.current = viewportPt;
	const onAnchorVisibleRef = useRef(onAnchorVisible);
	onAnchorVisibleRef.current = onAnchorVisible;

	const recompute = useCallback(() => {
		const report = (visible: boolean) => {
			if (lastAnchorVisibleRef.current === visible) return;
			lastAnchorVisibleRef.current = visible;
			onAnchorVisibleRef.current?.(visible);
		};
		const anchor = anchorIdRef.current;
		if (anchor === null) {
			report(false);
			return;
		}
		/* The walk runs over the RENDERED items, not the wire rows: a condensed
		 * turn's hidden rows take no space, so counting them (or waiting for
		 * heights they never get) would misreport where the anchor sits. Every
		 * item AFTER the anchor must have a measured height, or the anchor's
		 * position relative to the content's end is unknown — and unknown must
		 * never read as "visible" (see `anchorBottomVisible`). */
		const rows = itemsRef.current;
		const index = rows.findIndex(
			(item) => item.kind === "entry" && item.id === anchor,
		);
		if (index < 0) {
			report(false);
			return;
		}
		let afterHeight: number | null = 0;
		for (let i = index + 1; i < rows.length; i += 1) {
			const height = heightsRef.current.get(rows[i]?.id ?? "");
			if (height === undefined) {
				afterHeight = null;
				break;
			}
			afterHeight += height;
		}
		const facts = factsRef.current;
		report(
			anchorBottomVisible({
				tailDistance: facts.contentPt - facts.offsetY - viewportRef.current,
				viewportPt: viewportRef.current,
				afterHeight,
				anchorRendered: heightsRef.current.has(anchor),
			}),
		);
	}, []);

	/**
	 * The per-row `onLayout` storm, coalesced to one recompute per frame.
	 *
	 * WHY. Opening a transcript lays out every mounted row in a burst (and a
	 * streaming answer re-lays out its row every few frames). Each of those used to
	 * run the anchor walk immediately, so a window full of rows walked once per row
	 * inside one frame to answer a question whose answer cannot change before that
	 * frame is painted anyway. Every OTHER path still runs the walk synchronously —
	 * the scroll handler, a new frame's rows, the list's own layout event — so the
	 * first truthful reading is never late; only the redundant repeats inside one
	 * frame are dropped.
	 */
	const recomputeFrameRef = useRef<number | null>(null);
	const scheduleRecompute = useCallback(() => {
		if (recomputeFrameRef.current !== null) return;
		recomputeFrameRef.current = requestAnimationFrame(() => {
			recomputeFrameRef.current = null;
			recompute();
		});
	}, [recompute]);

	/** One row's laid-out height arrived. Heights change while text streams, so
	 *  a re-measure overwrites — the latest layout is the truth. The height is
	 *  written SYNCHRONOUSLY, because the layout cache `getItemLayout` answers from
	 *  must be current before the next scroll request is computed; only the
	 *  downstream recompute is deferred (see `scheduleRecompute`). */
	const measureRow = useCallback(
		(id: string, height: number) => {
			heightsRef.current.set(id, height);
			// Invalidates the cached offset table (`getItemLayout`'s, review NIT-2).
			heightsVersionRef.current += 1;
			scheduleRecompute();
		},
		[scheduleRecompute],
	);

	/* A session switch starts the geometry over: heights belong to the rows that
	 *  laid out, and the previous conversation's are not this one's; the reader's
	 *  open turns belong to the conversation that was open too, and so does the
	 *  answer to "does this conversation open at the tail" — a switch can reuse
	 *  this mounted screen (`router.navigate`), so both of those are re-answered
	 *  here rather than latched at mount (review MINOR-1, QA Q2). `sessionId` is
	 *  the trigger that matters: without it a switch would recompute against the
	 *  previous conversation's heights (the working-line precedent: `activity`'s
	 *  own note). */
	useEffect(() => {
		heightsRef.current.clear();
		setReaderExpanded(NO_TURNS);
		const elsewhere =
			scrollAnchor === "top" || scrollPlaces.get(sessionId)?.atTail === false;
		setOpenElsewhere(elsewhere);
		atTail.current = !elsewhere;
		recompute();
	}, [sessionId, recompute, scrollAnchor]);

	/* ------------------------------------------------------------ the find jump --
	 *
	 * A reveal is TWO steps when the target is inside a condensed turn: open
	 * the turn, then scroll once the plan re-emits the row. Opening changes the
	 * plan, and scrolling before that would aim at an index that is about to
	 * move — the same reason the desktop's reveal opens the collapse on the way
	 * to a hit. The pending id is a ref because it is consumed by the plan
	 * effect, not rendered.
	 *
	 * `nonce` is the caller's key, not the id: stepping wraps onto the SAME
	 * message when there is one hit, and a repeat must still re-run — the
	 * screen bumps the nonce on every landing.
	 */
	const pendingRevealRef = useRef<string | null>(null);
	const revealNonceRef = useRef(0);
	const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/* What a reveal reads: the rendered items, and every fold's hidden rows —
	 * turn bars and group bars alike (`find.ts`'s `RevealSubject`). */
	const revealSubject: RevealSubject = {
		items: grouped.items,
		turns: plan.turns,
		groups: grouped.groups,
	};
	const planRef = useRef<RevealSubject>(revealSubject);
	planRef.current = revealSubject;

	/**
	 * Where one RENDERED item sits, for the virtualiser's placement and jumps.
	 *
	 * It answers from the measured height cache, falling back to the estimate for
	 * rows nobody has laid out yet (`windowing.ts` owns both numbers and why the
	 * estimate errs small). Stable across renders on purpose: the list holds this
	 * function for the lifetime of the mount, and the data it answers about arrives
	 * as `data`/the item ref rather than as a dependency, so a frame that re-emits
	 * the same rows does not hand the virtualiser a different metric source.
	 *
	 * THE OFFSET TABLE IS CACHED (review round 1, NIT-2): `getItemLayout` is called
	 * once per row per batch, so answering each call by walking the rows above it
	 * would be quadratic in the plan's length. The table is rebuilt when the row
	 * list changes identity or when a row has been measured since it was built —
	 * `heightsRef` is mutated in place, by rows laying out, so it cannot be a
	 * dependency and `heightsVersionRef` is what makes the invalidation exact.
	 * Measurements land in the layout phase, before the next batch of calls, so a
	 * batch is one walk.
	 */
	/** The offset table `getItemLayout` and the scroll anchor both read, from the
	 *  cache `layoutTable` holds: rebuilt when the row list changes identity or a
	 *  row has measured since (`heightsVersionRef`), O(1) otherwise. */
	const offsetsFor = useCallback(
		(rows: ArrayLike<TranscriptItem> | null | undefined): number[] => {
			const cache = layoutTable.current;
			if (cache.rows !== rows || cache.version !== heightsVersionRef.current) {
				cache.rows = rows;
				cache.version = heightsVersionRef.current;
				cache.offsets = rowOffsets(
					rows?.length ?? 0,
					(at) => rows?.[at]?.id,
					heightsRef.current,
				);
			}
			return cache.offsets;
		},
		[],
	);

	const getItemLayout = useCallback(
		(data: ArrayLike<TranscriptItem> | null | undefined, index: number) => {
			const offsets = offsetsFor(data);
			// Past the table: the estimate alone, which is what a row beyond the
			// rendered plan has. `rowLayout` keeps one arithmetic for both answers.
			if (index >= offsets.length - 1)
				return rowLayout(index, (at) => data?.[at]?.id, heightsRef.current);
			return {
				length: (offsets[index + 1] ?? 0) - (offsets[index] ?? 0),
				offset: offsets[index] ?? 0,
				index,
			};
		},
		[offsetsFor],
	);

	const revealToIndex = useCallback((index: number) => {
		// A jump is the reader leaving the tail: following the next frame would
		// yank them off the message they just landed on.
		atTail.current = false;
		listRef.current?.scrollToIndex({
			index,
			viewPosition: 0.3,
			animated: false,
		});
		/* THE DEEP JUMP'S SECOND HALF, now armed here.
		 *
		 * With `getItemLayout` present the list never reports
		 * `onScrollToIndexFailed` — it trusts the metrics it was handed — so the
		 * recovery that used to arrive from that callback has to be armed on this
		 * side: a row nobody has measured is placed by the ESTIMATE, and the row's
		 * real height differs, so the landing is approximate. Re-issuing the same
		 * index after the rows around it have mounted and measured lands it
		 * exactly. 75 ms is the delay the old callback used, kept because it was
		 * measured against this list's mount batching. */
		const id = itemsRef.current[index]?.id;
		if (id === undefined || heightsRef.current.has(id)) return;
		if (revealTimerRef.current !== null) {
			clearTimeout(revealTimerRef.current);
		}
		revealTimerRef.current = setTimeout(() => {
			revealTimerRef.current = null;
			listRef.current?.scrollToIndex({
				index,
				viewPosition: 0.3,
				animated: false,
			});
		}, 75);
	}, []);

	useEffect(
		() => () => {
			if (revealTimerRef.current !== null) {
				clearTimeout(revealTimerRef.current);
			}
			if (recomputeFrameRef.current !== null) {
				cancelAnimationFrame(recomputeFrameRef.current);
			}
		},
		[],
	);

	/**
	 * One step of the expand-first walk: land on the row when the list renders
	 * it, otherwise open the fold that CURRENTLY hides it — one layer per pass,
	 * so a row behind two layers (a latched quiet group inside a condensed
	 * turn) resolves layer by layer instead of stalling on an open gate
	 * (review round 1, MAJOR-1; the desktop walk loops the same way). Each
	 * pass either lands, opens exactly one fold (and waits for the re-plan),
	 * or gives up when the frame does not carry the row at all. It converges
	 * because `revealTarget` skips folds that are already open.
	 */
	const resolveRevealWalk = useCallback(() => {
		const id = pendingRevealRef.current;
		if (id === null) return;
		const target = revealTarget(planRef.current, expanded, id);
		if (target === null) {
			// A frame slid between the search and the press: no fold leads to
			// the row, so the walk ends here rather than waiting forever.
			pendingRevealRef.current = null;
			return;
		}
		if (target.kind === "item") {
			pendingRevealRef.current = null;
			revealToIndex(target.index);
			return;
		}
		const key = target.kind === "turn" ? target.turnKey : target.groupKey;
		setReaderExpanded((current) => {
			if (current.has(key)) return current;
			const next = new Set(current);
			next.add(key);
			return next;
		});
	}, [expanded, revealToIndex]);

	useEffect(() => {
		if (reveal === null || reveal.nonce === revealNonceRef.current) return;
		revealNonceRef.current = reveal.nonce;
		pendingRevealRef.current = reveal.id;
		resolveRevealWalk();
	}, [reveal, resolveRevealWalk]);

	/* The walk's other half: every fold it opens re-plans the items, and a new
	 * frame can move the plan under a pending request — both are EVENTS that
	 * must re-ask the walk, while the body reads the plan through the ref. The
	 * same shape, and the same exemption, as the recompute effect below. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: grouped is the re-plan event; the body reads the plan through planRef
	useEffect(() => {
		resolveRevealWalk();
	}, [grouped, resolveRevealWalk]);

	/* Anchors and frames change outside scroll events too (a new frame appends
	 * rows; the attention moves to a new anchor). The rule reads the body —
	 * `recompute` alone — while these deps are the EVENTS that must re-ask the
	 * question; the body deliberately reads them through refs so the per-frame
	 * scroll path never re-creates this callback. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: see the comment above
	useEffect(() => {
		recompute();
	}, [recompute, anchorId, entries]);

	const onLayout = useCallback(
		(event: LayoutChangeEvent) => {
			const height = event.nativeEvent.layout.height;
			setViewportPt(height);
			viewportRef.current = height;
			recompute();
		},
		[recompute],
	);

	const onScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const { contentOffset, contentSize, layoutMeasurement } =
				event.nativeEvent;
			const distance =
				contentSize.height - contentOffset.y - layoutMeasurement.height;
			const atEnd = distance < TAIL_BAND_PT;
			atTail.current = atEnd;
			scrollPlaces.set(sessionId, {
				offset: contentOffset.y,
				atTail: atEnd,
			});
			factsRef.current = {
				contentPt: contentSize.height,
				offsetY: contentOffset.y,
			};
			recompute();
		},
		[sessionId, recompute],
	);

	/**
	 * Pin the list to its end, before the frame is painted.
	 *
	 * WHY A LAYOUT EFFECT AND NOT ONLY THE CONTENT-SIZE EVENT. The list's rows
	 * arrive in a commit, and on the web the browser can paint that commit before
	 * the content-size callback arrives (a resize observer callback is delivered
	 * after the mutation, and this was MEASURED: the first frame carrying rows had
	 * `scrollTop` 0 while the mounted window was already the tail, so the reader got
	 * a blank frame before the jump to the end). A layout effect runs after the DOM
	 * is committed and before paint, so the clamp lands in the same frame as the
	 * rows — the first frame that carries content is already the tail. The
	 * content-size clamp below stays for what the rows' own later layout does (a
	 * streaming answer growing its row, an image arriving), where the commit that
	 * changes the height is not a commit of this component's at all.
	 */
	const pinTail = useCallback(() => {
		if (!atTail.current) return;
		listRef.current?.scrollToOffset({
			offset: TAIL_CLAMP_OFFSET_PT,
			animated: false,
		});
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `grouped.items.length` is the trigger (a commit that brought rows); the body reads refs by design.
	useLayoutEffect(() => {
		if (openElsewhere) return;
		pinTail();
	}, [openElsewhere, pinTail, grouped.items.length]);

	/* The offset is restored once, after the first content change: before that there
	 * is nothing to scroll, and a restore that ran into an empty list would silently
	 * lose the position (F-6.11 — Back preserves scroll). Keyed on the session so a
	 * session switch restores ITS offset rather than the previous one's. */ const onContentSizeChange =
		useCallback(
			(_width: number, height: number) => {
				factsRef.current = { ...factsRef.current, contentPt: height };
				if (restoredFor.current !== sessionId) {
					restoredFor.current = sessionId;
					const saved = scrollPlaces.get(sessionId);
					// The capture hook's anchor outranks a saved position: a page that
					// asked for `top` asked for the top.
					if (scrollAnchor !== "top" && saved !== undefined) {
						if (saved.atTail) {
							/* They were following the end when they left, so the END is what
							 * to restore — not a number and not a row. This is the reopen
							 * path QA failed: a saved offset resolved against a taller
							 * merged list parked the reader thousands of points above the
							 * newest message. */
							pinTail();
							recompute();
							return;
						}
						/* Elsewhere: their offset, clamped to the content that exists now —
						 * the merge can only have made the list taller, but a reader who
						 * left near the end of a list that then shrank must not be left past
						 * it (see `ScrollPlace` for why the offset is kept for this case). */
						listRef.current?.scrollToOffset({
							offset: Math.min(
								saved.offset,
								Math.max(0, height - viewportRef.current),
							),
							animated: false,
						});
						recompute();
						return;
					}
				}
				if (atTail.current) {
					/* The tail pin, and why it is a CLAMP rather than `scrollToEnd`.
					 *
					 * `scrollToEnd` computes its destination from the row metrics, and rows
					 * nobody has measured are ESTIMATED (`windowing.ts`), so on a long
					 * conversation it stops short of the true end and the newest row sits
					 * just off screen. An offset past the content's end is clamped by every
					 * platform to the content's end, which is exactly the answer wanted and
					 * needs no height to be right. It runs ONLY while the reader is already
					 * at the tail (the auto-follow rule above): it is the correction that
					 * keeps a growing row from pushing the newest line away, not the thing
					 * that decides where the list starts — that is `initialScrollIndex`. */
					pinTail();
				}
				recompute();
			},
			[sessionId, recompute, scrollAnchor, pinTail],
		);

	const renderItem = useCallback(
		({ item }: { item: TranscriptItem }) =>
			item.kind === "bar" ? (
				/* The bar is measured like any row: it stands in the list, so the
				 * anchor geometry (which walks the RENDERED items) must know its
				 * height. */
				<View
					onLayout={(event) =>
						measureRow(item.id, event.nativeEvent.layout.height)
					}
				>
					<TurnBar
						turnKey={item.turnKey}
						facts={item.facts}
						headline={item.headline}
						open={item.expanded}
						onToggle={(open) => toggleExpansion(item.turnKey, open)}
					/>
				</View>
			) : item.kind === "group" ? (
				/* The group bar is measured like the turn bar, for the same reason:
				 * the anchor geometry walks the RENDERED items. */
				<View
					onLayout={(event) =>
						measureRow(item.id, event.nativeEvent.layout.height)
					}
				>
					<QuietGroupBar
						groupKey={item.groupKey}
						group={item.group}
						open={item.expanded}
						onToggle={(open) => toggleExpansion(item.groupKey, open)}
					/>
				</View>
			) : (
				/* The measuring wrapper: one `onLayout` per row is what makes the
				 * anchor's position knowable at all in a virtualised list that refuses
				 * fixed row heights. It adds no styling and no size of its own —
				 * except the find wash, which is a background on THIS box so it spans
				 * the row's full bleed without touching any kind's own treatment. */
				<View
					onLayout={(event) =>
						measureRow(item.id, event.nativeEvent.layout.height)
					}
					className={cx(
						item.id === highlightId ? "bg-row-selected" : undefined,
					)}
				>
					{/*
					 * The find hit's own edge. The wash alone is `row-selected` on the row's
					 * ground — a ~1.0x luminance step the kit's own contrast contract calls
					 * out, and invisible for a right-aligned bubble that paints over most of
					 * it — so the landed row also carries a 2 px accent bar at the list's
					 * left edge: the same accent-edge motif the user bubble and the
					 * subagent rows already wear, and a signal that is not colour alone.
					 * Absolutely positioned so a landing shifts no row's geometry. */}
					{item.id === highlightId ? (
						<View
							className="absolute bottom-0 left-0 top-0 w-0.5 bg-accent"
							aria-hidden
						/>
					) : null}
					<TranscriptRow
						entry={item.entry}
						streaming={streamingRowId !== null && item.id === streamingRowId}
						loadImage={loadImage}
						onOpenAgent={onOpenAgent}
						onCancelTurn={onCancelTurn}
					/>
					{/* The completion anchor: a zero-size sibling at the row's bottom edge
					 * (an element carries one testID, so the anchor is its own element —
					 * the streaming anchor's note), named by the attention's `anchor_id`
					 * so flows and the ack gate can address the row the completion ended
					 * on. */}
					{item.id === anchorId ? (
						<View testID={completionAnchorId(item.id)} aria-hidden />
					) : null}
				</View>
			),
		[
			toggleExpansion,
			streamingRowId,
			loadImage,
			onOpenAgent,
			onCancelTurn,
			anchorId,
			measureRow,
			highlightId,
		],
	);

	return (
		<FlatList
			ref={listRef}
			testID={testID}
			data={grouped.items}
			keyExtractor={(item) => item.id}
			renderItem={renderItem}
			onLayout={onLayout}
			onScroll={onScroll}
			scrollEventThrottle={16}
			onContentSizeChange={onContentSizeChange}
			/* The two props that make the FIRST frame the one the reader came for.
			 *
			 * `initialScrollIndex` mounts the LAST screenful, and `getItemLayout`
			 * tells the list where that screenful sits — so the open renders its
			 * final rows and the tail `onContentSizeChange` clamp is a correction
			 * rather than the mechanism that gets there. Omitted when this mount is
			 * headed somewhere else (`openElsewhere`): a restored offset or the
			 * capture hook's top. There is deliberately no
			 * `onScrollToIndexFailed` beside them — the list never reports a failed
			 * jump when it has metrics, so the deep-jump recovery lives in
			 * `revealToIndex`, which is the only place that knows a target is
			 * unmeasured. */
			initialScrollIndex={
				openElsewhereAtMount
					? undefined
					: tailStartIndex(grouped.items.length, policy.initialNumToRender)
			}
			getItemLayout={getItemLayout}
			// Keyboard stays open while scrolling: the reader is scrolling to read the
			// answer to what they just typed.
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="interactive"
			ListHeaderComponent={
				<>
					{/* A session-keyed anchor for the row list itself.
					 *
					 * `08-connection-loss-recovery` addresses the transcript by
					 * `transcript-row-<SESSION_ID>` while it samples across a stream cut, to prove
					 * the rows survived it — an assertion whose whole point is that a row IS still
					 * mounted, so it needs a name that is stable across the cut. Individual rows
					 * are keyed by their own entry id (`transcript-row-<entry.id>`, which is what
					 * the per-row flows address), so the session-keyed id belongs to the list
					 * that survives: it is the row CONTAINER, named by the thing that identifies
					 * the conversation.
					 *
					 * Zero-size and hidden from the accessibility tree: it is an anchor, and a
					 * screen reader should not announce it. */}
					<View testID={transcriptRowId(sessionId)} aria-hidden />
					{header}
				</>
			}
			ListEmptyComponent={empty ?? undefined}
			// `removeClippedSubviews` is left OFF deliberately: it detaches rows that
			// scroll out of view, and a detached row loses the open/closed state of its
			// tool-row disclosure — so a reader who expands a diff, scrolls away and
			// comes back finds it shut. The window already bounds what is mounted.
			initialNumToRender={policy.initialNumToRender}
			maxToRenderPerBatch={policy.maxToRenderPerBatch}
			windowSize={policy.windowSize}
			updateCellsBatchingPeriod={40}
			// 16 pt: the `between-sections` floor. 8 pt was the last prose row's bottom
			// padding with nothing on the other side of it, so the transcript met the
			// todos strip with an unmeasured gap — every other band in the column starts
			// from a 16 pt rail (§3.2 of the design pass).
			contentContainerStyle={{ paddingBottom: 16 }}
		/>
	);
};
