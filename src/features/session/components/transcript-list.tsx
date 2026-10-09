import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	FlatList,
	type LayoutChangeEvent,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	View,
} from "react-native";

import type { TranscriptEntry } from "@/contracts";
import { anchorBottomVisible } from "@/features/session/completion-visibility";
import { TranscriptRow } from "@/features/session/components/transcript-row";
import { TurnBar } from "@/features/session/components/turn-bar";
import { revealTarget } from "@/features/session/find";
import { scrollAnchorFromHook } from "@/features/session/scroll-hook";
import {
	condensePlan,
	type LatchedTurn,
	parseExpandHook,
	type TranscriptItem,
} from "@/features/session/turn-condensing";
import { windowPolicy } from "@/features/session/windowing";
import { completionAnchorId, transcriptRowId } from "@/ui/a11y";
import { cx } from "@/ui/variants";

/**
 * The transcript: virtualised, tail-following, and never blank.
 *
 * **Virtualised for the long case, not the common one.** The relay's own
 * `long-transcript` scenario is 520 rows and every row can change height while it
 * streams, so the list is a `FlatList` with a window derived from the viewport
 * (`windowing.ts`) rather than a plain scroller. `getItemLayout` is deliberately
 * NOT used: it requires a fixed row height, and lying about it to the virtualiser
 * is how a streaming transcript jumps under the reader's finger.
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
 * Scroll offsets, per session, for the life of the process.
 *
 * In memory rather than in device storage on purpose: this is a navigational
 * convenience, and making it durable would put a write on the scroll path — the
 * one path on this screen that runs at frame rate.
 */
const scrollOffsets = new Map<string, number>();

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
	const toggleTurn = useCallback((turnKey: string, open: boolean) => {
		setReaderExpanded((current) => {
			const next = new Set(current);
			if (open) next.add(turnKey);
			else next.delete(turnKey);
			return next;
		});
	}, []);

	const policy = useMemo(
		// The window's unit is what the FlatList MOUNTS, so it counts the plan's
		// items: a condensed turn mounts its bar, not the work behind it.
		() => windowPolicy(viewportPt > 0 ? viewportPt : 844, plan.items.length),
		[viewportPt, plan.items.length],
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
	/** The last boolean reported upward; only flips are reported. */
	const lastAnchorVisibleRef = useRef(false);
	/* Latest props read by `recompute`, which must be stable: a re-created scroll
	 * handler is fine, but the refs keep the decision ONE function. */
	const anchorIdRef = useRef<string | null>(anchorId);
	anchorIdRef.current = anchorId;
	/* The plan's items, not the raw entries: the anchor's position is computed
	 * over what is RENDERED (see `recompute`), and this is that list. */
	const itemsRef = useRef<readonly TranscriptItem[]>(plan.items);
	itemsRef.current = plan.items;
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

	/** One row's laid-out height arrived. Heights change while text streams, so
	 *  a re-measure overwrites — the latest layout is the truth. */
	const measureRow = useCallback(
		(id: string, height: number) => {
			heightsRef.current.set(id, height);
			recompute();
		},
		[recompute],
	);

	/* A session switch starts the geometry over: heights belong to the rows that
	 *  laid out, and the previous conversation's are not this one's; the reader's
	 *  open turns belong to the conversation that was open too. `sessionId`
	 *  is a dependency the exhaustive-deps rule cannot justify from the body (the
	 *  refs carry the data), and it is exactly the trigger that matters: without
	 *  it a switch would recompute against the previous conversation's heights
	 *  (the working-line precedent: `activity`'s own note). */
	// biome-ignore lint/correctness/useExhaustiveDependencies: see the comment above
	useEffect(() => {
		heightsRef.current.clear();
		setReaderExpanded(NO_TURNS);
		recompute();
	}, [sessionId, recompute]);

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
	const planRef = useRef(plan);
	planRef.current = plan;

	const revealToIndex = useCallback((index: number) => {
		// A jump is the reader leaving the tail: following the next frame would
		// yank them off the message they just landed on.
		atTail.current = false;
		listRef.current?.scrollToIndex({
			index,
			viewPosition: 0.3,
			animated: false,
		});
	}, []);

	const onScrollToIndexFailed = useCallback(
		(info: { index: number; averageItemLength: number }) => {
			const list = listRef.current;
			if (list === null) return;
			// Land near the target using what the list knows (its average row),
			// then ask again for the exact index once the rows around it have
			// mounted and been measured — the documented recovery for a
			// variable-height list with no `getItemLayout`.
			list.scrollToOffset({
				offset: Math.max(0, info.averageItemLength * info.index),
				animated: false,
			});
			if (revealTimerRef.current !== null) {
				clearTimeout(revealTimerRef.current);
			}
			revealTimerRef.current = setTimeout(() => {
				revealTimerRef.current = null;
				revealToIndex(info.index);
			}, 75);
		},
		[revealToIndex],
	);

	useEffect(
		() => () => {
			if (revealTimerRef.current !== null) {
				clearTimeout(revealTimerRef.current);
			}
		},
		[],
	);

	useEffect(() => {
		if (reveal === null || reveal.nonce === revealNonceRef.current) return;
		revealNonceRef.current = reveal.nonce;
		const target = revealTarget(planRef.current, reveal.id);
		if (target === null) return;
		if (target.kind === "item") {
			revealToIndex(target.index);
			return;
		}
		pendingRevealRef.current = reveal.id;
		setReaderExpanded((current) => {
			if (current.has(target.turnKey)) return current;
			const next = new Set(current);
			next.add(target.turnKey);
			return next;
		});
	}, [reveal, revealToIndex]);

	// The second half of the expand-first walk: once the opened turn's rows are
	// back in the plan, scroll to the one the reader asked for.
	useEffect(() => {
		const id = pendingRevealRef.current;
		if (id === null) return;
		const index = plan.items.findIndex(
			(item) => item.kind === "entry" && item.id === id,
		);
		if (index < 0) return;
		pendingRevealRef.current = null;
		revealToIndex(index);
	}, [plan, revealToIndex]);

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
			atTail.current = distance < TAIL_BAND_PT;
			scrollOffsets.set(sessionId, contentOffset.y);
			factsRef.current = {
				contentPt: contentSize.height,
				offsetY: contentOffset.y,
			};
			recompute();
		},
		[sessionId, recompute],
	);

	/* The offset is restored once, after the first content change: before that there
	 * is nothing to scroll, and a restore that ran into an empty list would silently
	 * lose the position (F-6.11 — Back preserves scroll). Keyed on the session so a
	 * session switch restores ITS offset rather than the previous one's. */
	const onContentSizeChange = useCallback(
		(_width: number, height: number) => {
			factsRef.current = { ...factsRef.current, contentPt: height };
			if (restoredFor.current !== sessionId) {
				restoredFor.current = sessionId;
				const saved = scrollOffsets.get(sessionId);
				// The capture hook's anchor outranks a saved offset: a page that asked
				// for `top` asked for the top.
				if (scrollAnchor !== "top" && saved !== undefined && saved > 0) {
					listRef.current?.scrollToOffset({ offset: saved, animated: false });
					recompute();
					return;
				}
			}
			if (atTail.current) {
				listRef.current?.scrollToEnd({ animated: false });
			}
			recompute();
		},
		[sessionId, recompute, scrollAnchor],
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
						onToggle={(open) => toggleTurn(item.turnKey, open)}
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
			toggleTurn,
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
			data={plan.items}
			keyExtractor={(item) => item.id}
			renderItem={renderItem}
			onLayout={onLayout}
			onScroll={onScroll}
			scrollEventThrottle={16}
			onContentSizeChange={onContentSizeChange}
			onScrollToIndexFailed={onScrollToIndexFailed}
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
