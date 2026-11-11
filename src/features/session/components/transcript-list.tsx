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
	Platform,
	Text,
	View,
	type ViewStyle,
} from "react-native";

import type { TranscriptEntry } from "@/contracts";
import { anchorBottomVisible } from "@/features/session/completion-visibility";
import { FoldBar } from "@/features/session/components/fold-bar";
import { GroupGuides } from "@/features/session/components/group-guides";
import { QuietGroupBar } from "@/features/session/components/quiet-group-bar";
import {
	SupplementBlock,
	type SupplementClient,
} from "@/features/session/components/supplement-block";
import {
	GROUP_INSET_CLASS,
	GROUP_STEP_PT,
	GroupInsetContext,
	groupDepth,
	SPACING_TIER_CLASS,
	spacingTiersOf,
} from "@/features/session/components/trace-rail";
import {
	TranscriptEdgeFades,
	type TranscriptEdgeFadesHandle,
} from "@/features/session/components/transcript-edge-fades";
import { TranscriptRow } from "@/features/session/components/transcript-row";
import { TurnBar } from "@/features/session/components/turn-bar";
import { type RevealSubject, revealTarget } from "@/features/session/find";
import { groupContainment } from "@/features/session/group-containment";
import {
	anchoredScrollTop,
	historyTopReached,
} from "@/features/session/history-scroll";
import {
	canonicalRowKey,
	visibleTranscriptEntries,
} from "@/features/session/projection";
import { reuseRows } from "@/features/session/row-identity";
import { scrollAnchorFromHook } from "@/features/session/scroll-hook";
import { beatLive, type SupplementBeat } from "@/features/session/supplements";
import {
	edgeFadeLevels,
	type ScrollPresence,
	TRANSCRIPT_FADE_PT,
} from "@/features/session/transcript-presence";
import {
	condensePlan,
	foldPlan,
	groupPlan,
	type LatchedTurn,
	parseExpandHook,
	type QuietGroup,
	type TranscriptItem,
} from "@/features/session/turn-condensing";
import {
	nextAtTail,
	rowLayout,
	rowOffsets,
	TAIL_CLAMP_OFFSET_PT,
	tailStartIndex,
	windowPolicy,
} from "@/features/session/windowing";
import { t } from "@/i18n";
import {
	CONTROL,
	completionAnchorId,
	REGION,
	transcriptRowId,
} from "@/ui/a11y";
import { Button } from "@/ui/components/button";
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
	loadOlder?: () => Promise<void>;
	/** Continues filling the newest disconnected gap (`HistoryWindow.heal`):
	 *  the quiet gap row's Load action. Never jumps or clears loaded pages. */
	healHistory?: () => Promise<void>;
	/** Repeats the history read that failed; see `historyErrorScope`. */
	retryHistory?: () => Promise<void>;
	/** Which read failed: a newest-page refresh retries as a refresh and says so;
	 *  an older page retries that page. */
	historyErrorScope?: "newest" | "older" | null;
	loadingOlder?: boolean;
	hasOlder?: boolean;
	historyGap?: boolean;
	/** Entry id of the first row after the newest hole; the gap marker sits there. */
	historyGapBefore?: string | null;
	historyError?: string | null;
	/** The row that carries `transcript-streaming`, or `null` when settled. */
	streamingRowId: string | null;
	/** Whether a turn is running in this transcript right now. Decides whether
	 *  the NEWEST turn may condense: an idle session condenses its finished last
	 *  turn immediately (the relay's `!live` rule), a live one never touches it.
	 *  When omitted it is read off the props that already mean "a turn is
	 *  running" — a streaming row, or the turn interrupt the screen threads only
	 *  while the composer's Stop is visible. Callers that have neither signal but
	 *  know the run state (a subagent view, the startup transcript) pass it. */
	turnLive?: boolean;
	/** Resolves an attachment's bytes. */
	loadImage?: (entryId: string, index: number) => Promise<string | null>;
	/** Opens a subagent's own view. */
	onOpenAgent?: (jobId: string) => void;
	/** Opens the full-screen player for a video artifact a generation row
	 *  carries (threaded to the card; the screen owns the route push). */
	onOpenVideo?: (entryId: string, index: number) => void;
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
	/** Complete status/recovery content after the actual rows. An element, not a
	 * component factory: changing notice props must not remount the list or input. */
	footer?: React.ReactElement | null;
	/** The pending rows for what the reader just sent (`pending-echo.ts`),
	 *  painted after the last real row and BEFORE the status footer: they are
	 *  the transcript's next rows, not a notice about it. Separate from `footer`
	 *  so the footer stays the notice alone, and outside `data` so a send leaves
	 *  every memoised row untouched. An element so the screen can memoise it. */
	pending?: React.ReactElement | null;
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
	/** Turn supplements (memo §2.4/§3.1 row 18): the projection's newest beat
	 *  per ANCHOR — `{anchor: beat}`, read once by the screen. The block renders
	 *  under the assistant row whose `id` the beat names; absent map (an older
	 *  relay) renders exactly today's transcript. */
	supplements?: Record<string, SupplementBeat>;
	/** The projection's own process identity, for the stale-row rule's
	 *  `job_live` (`beatLive`): 0 is a disk rebuild. */
	projectionPid?: number;
	/** The block's host calls (documents, callouts, the three ops) — threaded
	 *  from the screen; absent on a route-less screen, where a beat still
	 *  renders its files and lines but no frame can fetch. */
	supplementClient?: SupplementClient;
	/** The transcript's scroll signal, owned by the screen and shared with the
	 *  checkpoint rail (`transcript-presence.ts`). Optional: a host with no rail
	 *  to drive simply keeps its marks static. */
	presence?: ScrollPresence;
	testID: string;
};

/** How close to the bottom still counts as "at the tail", in points. A finger
 *  leaves the viewport within a few points of the end; demanding exact equality
 *  would silently stop following on almost every device. */
const TAIL_BAND_PT = 48;

/** No turns open — a shared empty so a session-switch reset bails out of a
 *  render instead of committing an equal-but-new set. */
const NO_TURNS: ReadonlySet<string> = new Set();
/** No row overrides: every row shows its own default (closed, or open for a
 *  bang-mode `user_run` tool row — see `ToolRow`). */
const NO_ROW_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

/** The list's key function, hoisted: an inline arrow is a NEW prop on every
 *  render, which is a fresh reason for the virtualiser to re-run its cells. */
const keyOfItem = (item: TranscriptItem): string => item.id;

/** The transcript's own bottom breathing room: the 16 pt between-sections floor
 *  PLUS the fade band, so no row's chevron — a collapsed row's, or the last
 *  row's own disclosure — ever rests inside the bottom fade at rest (design item
 *  8's acceptance rule). Hoisted for the same reason as the key function: an
 *  object literal in the JSX is a new style on every render. */
const CONTENT_CONTAINER_STYLE: ViewStyle = {
	paddingBottom: TRANSCRIPT_FADE_PT + 16,
};

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

/** A mounted row converts the offset table into content coordinates: its DOM
 *  position already includes the list header, so nothing has to measure that
 *  header separately (see `anchoredScrollTop`). Null when no row is mounted. */
const mountedReference = (
	rows: ReadonlyMap<string, View>,
	table: { index: ReadonlyMap<string, number>; offsets: readonly number[] },
	scroll: HTMLElement,
): { contentTop: number; offset: number } | null => {
	const scrollerTop = scroll.getBoundingClientRect().top;
	for (const [id, mounted] of rows) {
		const element = mounted as unknown as HTMLElement;
		const index = table.index.get(id);
		if (index === undefined || !element.isConnected) continue;
		return {
			contentTop:
				element.getBoundingClientRect().top - scrollerTop + scroll.scrollTop,
			offset: table.offsets[index] ?? 0,
		};
	}
	return null;
};
const HISTORY_ANCHOR = { minIndexForVisible: 1 };

export const TranscriptList = ({
	sessionId,
	entries,
	loadOlder,
	healHistory,
	retryHistory,
	historyErrorScope = null,
	loadingOlder = false,
	hasOlder = false,
	historyGap = false,
	historyGapBefore = null,
	historyError = null,
	streamingRowId,
	turnLive,
	loadImage,
	onOpenAgent,
	onOpenVideo,
	onCancelTurn,
	supplements,
	projectionPid = 0,
	supplementClient,
	empty,
	header,
	footer,
	pending,
	anchorId = null,
	onAnchorVisible,
	highlightId = null,
	reveal = null,
	presence,
	testID,
}: TranscriptListProps) => {
	const listRef = useRef<FlatList<TranscriptItem>>(null);
	const webRows = useRef(new Map<string, View>());
	/* The row the reader was looking at when an older page was requested, held
	 * by ITEM ID rather than DOM node: react-native-web unmounts that node on the
	 * prepend (see `anchoredScrollTop`), and a held node then answered
	 * `isConnected === false` forever, so `scrollTop` never moved (PR #207 Q5/Q6).
	 * `offset` is the scrollTop this code last set, so `onScroll` can tell its
	 * own correction from a reader's scroll, which releases the anchor. */
	const webAnchor = useRef<{
		id: string;
		distance: number;
		scroll: HTMLElement;
		offset: number;
	} | null>(null);
	/** See its assignment below the offset table. */
	const captureWebAnchor = useRef<(scroll: HTMLElement) => void>(() => {});
	/* Native ScrollView preserves its visible child. RN-web lacks that prop:
	 * keep the actual mounted node's screen position, never estimated heights
	 * or total content growth (which also includes concurrent tail appends).
	 * Used by every read that inserts rows ABOVE the reader: an older page, and
	 * the gap row's Load, whose rows land between the islands (PR #217 R1-2). */
	const holdWebAnchor = useCallback(() => {
		if (Platform.OS !== "web") return;
		const scroll =
			listRef.current?.getNativeScrollRef() as unknown as HTMLElement | null;
		if (!scroll?.getBoundingClientRect) return;
		// Two anchoring mechanisms on one scroller fight: the browser's own
		// (`overflow-anchor: auto`) moves scrollTop as rows above mount, and its
		// scroll event reads as a reader's scroll in `onScroll`, which releases
		// this anchor mid-settle. While this list holds an anchor it owns
		// anchoring; releaseWebAnchor hands it back.
		scroll.style.overflowAnchor = "none";
		captureWebAnchor.current(scroll);
	}, []);
	/* The reader moved: the list's anchor is spent. Hand anchoring back to the
	 * browser rather than leaving it off for the rest of the session, so rows
	 * the automatic gap fill inserts above the viewport (no list anchor is
	 * held for those) do not push the reader down on web (PR #217 R1-2). */
	const releaseWebAnchor = useCallback(() => {
		const anchor = webAnchor.current;
		if (!anchor) return;
		anchor.scroll.style.overflowAnchor = "";
		webAnchor.current = null;
	}, []);
	const requestOlder = useCallback(() => {
		if (!loadOlder || loadingOlder || !hasOlder) return;
		holdWebAnchor();
		atTail.current = false;
		void loadOlder();
	}, [loadOlder, loadingOlder, hasOlder, holdWebAnchor]);
	/* "Try again" repeats the read that FAILED (PR #207 R2). A failed newest-page
	 * refresh (foreground return, Check again) is re-read as the newest page: it
	 * is not an older-page failure, and fetching an older page instead would
	 * neither recover it nor act at all once the beginning is reached. The button
	 * is shown only when this callback will issue a request. */
	const newestFailed = historyError !== null && historyErrorScope === "newest";
	const canRetry =
		historyError !== null && (newestFailed ? !!retryHistory : hasOlder);
	/** The header retries only older pages; a newest failure is retried from
	 *  the newest edge, where the reader is (PR #207 D1). */
	const olderRetry = canRetry && !newestFailed;
	const requestRetry = useCallback(() => {
		if (loadingOlder) return;
		if (newestFailed && retryHistory) {
			void retryHistory();
			return;
		}
		requestOlder();
	}, [loadingOlder, newestFailed, retryHistory, requestOlder]);
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

	/* ------------------------------------------------------------ row identity --
	 *
	 * A frame that did not change a row must not re-render it. The relay re-sends
	 * the whole window on every frame, so every layer between the wire and here
	 * rebuilds its objects, and `TranscriptRow`'s memo (its only bail-out inside
	 * the cell renderer) sees a fresh `entry` for a row that did not change.
	 * `reuseRows` gives the unchanged rows their previous objects back, and the
	 * whole ARRAY back when nothing changed at all — which is what lets the
	 * condense plan, the group plan and the window policy below keep their
	 * memoised results on a frame that only re-sent the same window.
	 *
	 * The previous list is held WITH the session it belongs to: a switch can reuse
	 * this mounted component (`router.navigate`), and a new conversation's rows are
	 * not the old one's however coincidentally their ids collide. */
	const previousRows = useRef<{
		session: string;
		rows: readonly TranscriptEntry[];
	} | null>(null);
	const stableEntries = useMemo(() => {
		const previous =
			previousRows.current?.session === sessionId
				? previousRows.current.rows
				: null;
		const rows = reuseRows(previous, visibleTranscriptEntries(entries));
		previousRows.current = { session: sessionId, rows };
		return rows;
	}, [entries, sessionId]);

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
	const live =
		turnLive ?? (streamingRowId !== null || onCancelTurn !== undefined);
	/* `live` only ever ADDS a condensation (the idle newest turn): once a turn
	 * has condensed it is in the latch, so the next prompt making it non-newest
	 * — or the session going live again — cannot un-condense it. */
	const plan = useMemo(
		() =>
			condensePlan({
				entries: stableEntries,
				expanded,
				latch: latchRef.current.latch,
				live,
			}),
		[stableEntries, expanded, live],
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
				// R1-2: without it `certifiedPeerCycleGroups` returns nothing, so the
				// core's `details.peer_cycle` stamp never grouped on device. The stamp
				// carries the session that ran the cycle; a subagent view's composite
				// `<parent>:<child>` id never matches it, and must not — that view
				// does not own the parent's cycles.
				sessionId,
			}),
		[plan, expanded, sessionId],
	);
	/* Idempotent like the turn plan: the latch only grows. */
	groupLatchRef.current.latch = grouped.latch;
	/*
	 * Tier A, over what the turn and group passes left visible: runs of >= 3
	 * tool calls (or a trailing stretch of >= 2 receipts) in the ACTIVE turn and
	 * inside an opened completed turn fold behind one `FoldBar`. Its latch is a
	 * set of canonical row ids already painted inside a fold while the turn is
	 * live, so a receipt landing mid-run cannot dissolve a fold the reader saw.
	 */
	const foldLatchRef = useRef<{ session: string; ids: ReadonlySet<string> }>({
		session: sessionId,
		ids: new Set(),
	});
	if (foldLatchRef.current.session !== sessionId) {
		foldLatchRef.current = { session: sessionId, ids: new Set() };
	}
	const folded = useMemo(
		() =>
			foldPlan({
				items: grouped.items,
				expanded,
				live,
				latchedFoldIds: foldLatchRef.current.ids,
			}),
		[grouped, expanded, live],
	);
	foldLatchRef.current.ids = folded.latchedFoldIds;
	/* The vertical rhythm, one tier per rendered item (`trace-rail.ts`): 16 pt
	 * before a new exchange, 8 pt at a register change (bubble ↔ trace ↔ prose),
	 * nothing between trace lines that already carry the touch floor. Applied as
	 * padding INSIDE each row's measured wrapper, so the measured heights the
	 * offset table and the ack gate read already include it. */
	const spacingTiers = useMemo(
		() => spacingTiersOf(folded.items),
		[folded.items],
	);
	/* Which rows sit inside an opened turn bar or fold, and how deep
	 * (`group-containment.ts`). Same lifetime as the tiers above: a function of
	 * the plan, never of scroll, so it costs nothing per frame and a closed
	 * bar leaves every row's wrapper byte-identical to before. */
	const containment = useMemo(
		() => groupContainment(folded.items, plan.turns, folded.folds),
		[folded.items, folded.folds, plan.turns],
	);
	const toggleExpansion = useCallback((key: string, open: boolean) => {
		setReaderExpanded((current) => {
			const next = new Set(current);
			if (open) next.add(key);
			else next.delete(key);
			return next;
		});
	}, []);

	/*
	 * ONE ROW'S FOLD (`collapsed-row.tsx`), OWNED HERE AND KEYED BY ROW ID.
	 *
	 * Kept apart from `readerExpanded` on purpose: that set feeds the condense
	 * and group plans, and a row fold changes neither — re-planning the whole
	 * transcript to open one peer message would be the per-frame cost this file
	 * exists to avoid. Held at list scope rather than in the row because
	 * windowing unmounts rows: a fold kept in the row's own state came back
	 * closed after a few screens of scrolling, and the row's height changed under
	 * the anchors (review round 1, Q5 / U6 / m4). Reset on a session switch with
	 * the turn folds.
	 */
	/* A Map of EXPLICIT overrides, not a Set of open ids (R1-1): a Set can only
	 *  say "closed" for an untouched row, which overrode `user_run` and shut every
	 *  bang-mode row the reader was waiting on. Absent = the row's own default. */
	const [rowOpen, setRowOpen] =
		useState<ReadonlyMap<string, boolean>>(NO_ROW_OVERRIDES);
	/* Set by a reader's own expand or collapse, consumed by the content-size
	 *  change that toggle causes: see `onContentSizeChange`. */
	const foldResizeRef = useRef(false);
	/* The resize mark is set ONLY when the open state really changes (round 2,
	 *  U10 / Q9 / m-r2-1). A press that asks for the state the row already has
	 *  produces no content-size change to consume it, so the mark would sit armed
	 *  until the next streamed growth — which it would then misread as the
	 *  reader's own resize and unpin the tail for. It is set inside the updater
	 *  because that is the only place the CURRENT set is known; the updater may
	 *  run twice under StrictMode, which is harmless for an idempotent flag. */
	const toggleRowOpen = useCallback((id: string, open: boolean) => {
		setRowOpen((current) => {
			// Callers request the flip of the row's EFFECTIVE state (`ToolRow`
			// toggles `!open`, `override ?? user_run`), so only a repeat of the
			// same explicit override is a no-op here.
			if (current.get(id) === open) return current;
			foldResizeRef.current = true;
			const next = new Map(current);
			next.set(id, open);
			return next;
		});
	}, []);

	const policy = useMemo(
		// The window's unit is what the FlatList MOUNTS, so it counts the plan's
		// items: a condensed turn mounts its bar, not the work behind it.
		() => windowPolicy(viewportPt > 0 ? viewportPt : 844, folded.items.length),
		[viewportPt, folded.items.length],
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
	 *  changes identity or a row has been measured since it was built. It carries
	 *  THREE facts from one pass, because they are all functions of the same row
	 *  list and rebuilding any of them separately would be the same walk again:
	 *  the prefix-summed offsets, the id→index map, and how many rows before each
	 *  index are still unmeasured. */
	const layoutTable = useRef<{
		rows: unknown;
		version: number;
		offsets: number[];
		index: Map<string, number>;
		unmeasuredPrefix: number[];
	}>({
		rows: null,
		version: -1,
		offsets: [],
		index: new Map(),
		unmeasuredPrefix: [0],
	});
	/**
	 * The geometry cache, and why the scroll path has to be O(1).
	 *
	 * `recompute` runs on EVERY scroll event — roughly every 16 ms while a finger
	 * is on the glass — and it used to answer "where is the anchor" by walking
	 * the rows after it. That is O(n) per frame for a question the offset table
	 * already knows: the anchor's index is a Map lookup, and the mass below it is
	 * one subtraction of two prefix sums. The unmeasured count is what keeps the
	 * original rule honest — a row after the anchor that has never laid out leaves
	 * the distance unknown, and unknown must never read as "visible".
	 *
	 * One walk, shared: `getItemLayout` calls this for every row of a batch and
	 * gets the cache back, and the offset table is invalidated by the measurement
	 * version (`heightsRef` is mutated in place, so it cannot be a dependency).
	 */
	const geometryFor = useCallback(
		(rows: ArrayLike<TranscriptItem> | null | undefined) => {
			const cache = layoutTable.current;
			if (cache.rows !== rows || cache.version !== heightsVersionRef.current) {
				const count = rows?.length ?? 0;
				cache.rows = rows;
				cache.version = heightsVersionRef.current;
				cache.offsets = rowOffsets(
					count,
					(at) => rows?.[at]?.id,
					heightsRef.current,
				);
				const index = new Map<string, number>();
				const unmeasuredPrefix = new Array<number>(count + 1);
				unmeasuredPrefix[0] = 0;
				for (let at = 0; at < count; at += 1) {
					const id = rows?.[at]?.id;
					if (id !== undefined && !index.has(id)) index.set(id, at);
					unmeasuredPrefix[at + 1] =
						(unmeasuredPrefix[at] ?? 0) +
						(heightsRef.current.has(id ?? "") ? 0 : 1);
				}
				cache.index = index;
				cache.unmeasuredPrefix = unmeasuredPrefix;
			}
			return cache;
		},
		[],
	);
	/** The last boolean reported upward; only flips are reported. */
	const lastAnchorVisibleRef = useRef(false);
	/* Latest props read by `recompute`, which must be stable: a re-created scroll
	 * handler is fine, but the refs keep the decision ONE function. */
	const anchorIdRef = useRef<string | null>(anchorId);
	anchorIdRef.current = anchorId;
	/* The plan's items, not the raw entries: the anchor's position is computed
	 * over what is RENDERED (see `recompute`), and this is that list. */
	const itemsRef = useRef<readonly TranscriptItem[]>(folded.items);
	itemsRef.current = folded.items;
	/* Which row the reader is looking at, captured before an older page is
	 * requested. Only rows that INTERSECT the viewport count: right after a jump
	 * to the top (a focus or click scrolling the Load earlier control into view)
	 * react-native-web has not re-rendered its window yet, the viewport sits over
	 * a spacer, and the nearest mounted row can be thousands of points below
	 * (rendered check: the anchor was taken 5893 pt down). In that state the row
	 * at the viewport's top is located from the offset table instead. Assigned
	 * every render (it reads this render's table); called through the ref by
	 * `requestOlder`, which is declared before the table exists. */
	captureWebAnchor.current = (scroll: HTMLElement) => {
		const box = scroll.getBoundingClientRect();
		let first: { id: string; top: number } | null = null;
		for (const [id, mounted] of webRows.current) {
			const element = mounted as unknown as HTMLElement;
			if (!element.isConnected) continue;
			const rect = element.getBoundingClientRect();
			if (rect.bottom <= box.top || rect.top >= box.bottom) continue;
			if (first === null || rect.top < first.top) first = { id, top: rect.top };
		}
		if (first === null) {
			const items = itemsRef.current;
			const table = geometryFor(items);
			const reference = mountedReference(webRows.current, table, scroll);
			if (reference === null) return;
			for (let at = 0; at < items.length; at += 1) {
				const contentTop =
					reference.contentTop + (table.offsets[at] ?? 0) - reference.offset;
				const height = (table.offsets[at + 1] ?? 0) - (table.offsets[at] ?? 0);
				const item = items[at];
				if (item && contentTop + height > scroll.scrollTop) {
					first = { id: item.id, top: box.top + contentTop - scroll.scrollTop };
					break;
				}
			}
		}
		if (first)
			webAnchor.current = {
				id: first.id,
				distance: first.top - box.top,
				scroll,
				offset: scroll.scrollTop,
			};
	};
	const restoreWebAnchor = useCallback(() => {
		const anchor = webAnchor.current;
		if (!anchor) return;
		const { scroll } = anchor;
		const scrollerTop = scroll.getBoundingClientRect().top;
		const node = webRows.current.get(anchor.id) as unknown as
			| HTMLElement
			| undefined;
		let next: number | null = null;
		if (node?.isConnected) {
			next = anchoredScrollTop({
				kind: "mounted",
				scrollTop: scroll.scrollTop,
				rowTop: node.getBoundingClientRect().top,
				desiredTop: scrollerTop + anchor.distance,
			});
		} else {
			const table = geometryFor(itemsRef.current);
			const at = table.index.get(anchor.id);
			if (at === undefined) return;
			next = anchoredScrollTop({
				kind: "table",
				anchorOffset: table.offsets[at] ?? 0,
				reference: mountedReference(webRows.current, table, scroll),
				distance: anchor.distance,
			});
		}
		if (Math.abs(next - scroll.scrollTop) >= 1) scroll.scrollTop = next;
		anchor.offset = scroll.scrollTop;
	}, [geometryFor]);
	const viewportRef = useRef(0);
	// Event snapshots must not be overwritten by onLayout before onScroll gets them.
	const previousScrollGeometry = useRef({ viewport: 0, content: 0 });
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
		const geometry = geometryFor(rows);
		const at = geometry.index.get(anchor) ?? -1;
		if (at < 0) {
			report(false);
			return;
		}
		const count = rows.length;
		const missing =
			(geometry.unmeasuredPrefix[count] ?? 0) -
			(geometry.unmeasuredPrefix[at + 1] ?? 0);
		const afterHeight =
			missing > 0
				? null
				: (geometry.offsets[count] ?? 0) - (geometry.offsets[at + 1] ?? 0);
		const facts = factsRef.current;
		report(
			anchorBottomVisible({
				tailDistance: facts.contentPt - facts.offsetY - viewportRef.current,
				viewportPt: viewportRef.current,
				afterHeight,
				anchorRendered: heightsRef.current.has(anchor),
			}),
		);
	}, [geometryFor]);

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
			restoreWebAnchor();
			scheduleRecompute();
		},
		[scheduleRecompute, restoreWebAnchor],
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

	/* A FIND LANDING OPENS THE ROW IT LANDS ON (UX round 1, U2): a hit on line 3
	 *  of a folded peer message landed on a one-line summary without the word.
	 *  The landing is RECORDED in the open set, and the set is the only thing
	 *  the row's `open` reads. Round 1 also OR-ed `id === highlightId` into the
	 *  render, which made the current hit impossible to close: the reader's tap
	 *  changed nothing they could see, and — worse — armed the fold-resize mark
	 *  with no resize to consume it, so the next streamed growth unpinned the
	 *  tail (round 2, U10 / Q9 / m-r2-1).
	 *
	 *  A LAYOUT effect, so the state update re-renders before the browser
	 *  paints: the hit is open on its first painted frame, as the render-time OR
	 *  used to guarantee. The session reset is a layout effect for the same
	 *  reason and is declared FIRST: layout effects run in declaration order,
	 *  and a landing that arrives with the mount must be recorded after the
	 *  clear, not wiped by it (the passive session effect above runs after every
	 *  layout effect, so it must not clear this set). */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `sessionId` is the TRIGGER for the reset, not a read.
	useLayoutEffect(() => {
		setRowOpen(NO_ROW_OVERRIDES);
	}, [sessionId]);
	/* KEYED ON THE LANDING, NOT THE HIGHLIGHT (round 3, U14 / m-r3-1). A
	 *  landing is `reveal`'s id AND nonce: the find session bumps the nonce on
	 *  every landing, including a re-landing on the hit already current. Keyed
	 *  on `highlightId` alone, a reader who closed the current hit and stepped
	 *  back onto it (one hit: Next wraps to itself) landed on a closed fold,
	 *  because the id never changed and the effect never re-ran. The two
	 *  primitives, not the object: `use-find.ts` re-memoises `reveal` whenever
	 *  `activeHit` is re-derived from a new frame, and an object key would
	 *  re-open a fold the reader closed on every streamed frame (U10). */
	const landingId = reveal?.id ?? null;
	const landingNonce = reveal?.nonce ?? null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: `landingNonce` is the TRIGGER for a re-landing on the same id, not a read.
	useLayoutEffect(() => {
		if (landingId === null) return;
		setRowOpen((current) => {
			if (current.get(landingId) === true) return current;
			const next = new Map(current);
			next.set(landingId, true);
			return next;
		});
	}, [landingId, landingNonce]);

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
		items: folded.items,
		turns: plan.turns,
		groups: grouped.groups,
		folds: folded.folds,
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
	const getItemLayout = useCallback(
		(data: ArrayLike<TranscriptItem> | null | undefined, index: number) => {
			const offsets = geometryFor(data).offsets;
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
		[geometryFor],
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
		const key =
			target.kind === "turn"
				? target.turnKey
				: target.kind === "group"
					? target.groupKey
					: target.foldKey;
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: folded is the re-plan event; the body reads the plan through planRef
	useEffect(() => {
		resolveRevealWalk();
	}, [folded, resolveRevealWalk]);

	/* Anchors and frames change outside scroll events too (a new frame appends
	 * rows; the attention moves to a new anchor). The rule reads the body —
	 * `recompute` alone — while these deps are the EVENTS that must re-ask the
	 * question; the body deliberately reads them through refs so the per-frame
	 * scroll path never re-creates this callback. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: see the comment above
	useEffect(() => {
		recompute();
	}, [recompute, anchorId, stableEntries]);

	const fadesRef = useRef<TranscriptEdgeFadesHandle>(null);
	/** Aim the two edge fades from the facts just recorded — called on every path
	 *  that moves an edge, and O(1) on each: the levels are three subtractions and
	 *  the component drops a target that has not changed. */
	const driveFades = useCallback(() => {
		const facts = factsRef.current;
		fadesRef.current?.setLevels(
			edgeFadeLevels({
				offsetY: facts.offsetY,
				contentPt: facts.contentPt,
				viewportPt: viewportRef.current,
			}),
		);
	}, []);

	const onScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const { contentOffset, contentSize, layoutMeasurement } =
				event.nativeEvent;
			const previousOffset = factsRef.current.offsetY;
			if (webAnchor.current && contentOffset.y !== webAnchor.current.offset)
				releaseWebAnchor();
			// An actual transition to the top, not mount/layout/onStartReached.
			// One edge loads one page; remaining at the top cannot drain history.
			if (
				historyTopReached(
					previousOffset,
					contentOffset.y,
					frozenInitialIndexRef.current?.session === sessionId,
					historyError !== null,
				)
			)
				requestOlder();
			const distance =
				contentSize.height - contentOffset.y - layoutMeasurement.height;
			const atEnd = nextAtTail({
				wasAtTail: atTail.current,
				distanceToEnd: distance,
				bandPt: TAIL_BAND_PT,
				offsetY: contentOffset.y,
				previousOffsetY: factsRef.current.offsetY,
				viewportPt: layoutMeasurement.height,
				previousViewportPt: previousScrollGeometry.current.viewport,
				contentPt: contentSize.height,
				previousContentPt: previousScrollGeometry.current.content,
			});
			previousScrollGeometry.current = {
				viewport: layoutMeasurement.height,
				content: contentSize.height,
			};
			atTail.current = atEnd;
			scrollPlaces.set(sessionId, {
				offset: contentOffset.y,
				atTail: atEnd,
			});
			factsRef.current = {
				contentPt: contentSize.height,
				offsetY: contentOffset.y,
			};
			/* The transient rail: this handler is the only place that knows the
			 *  offset moved, and the presence object is what the rail subscribes to
			 *  (`transcript-presence.ts`) — no state, so no re-render of this list or
			 *  the screen it lives in. Every offset is reported, the tail pin's
			 *  included; the presence itself discards the ones no reader gesture
			 *  made. */
			presence?.noteMovement(contentOffset.y);
			driveFades();
			recompute();
		},
		[
			driveFades,
			presence,
			sessionId,
			recompute,
			requestOlder,
			historyError,
			releaseWebAnchor,
		],
	);

	/* A HELD THUMB KEEPS THE RAIL UP however long the reader holds still — the
	 *  pointer analogue of a desktop scrollbar's thumb staying under the cursor,
	 *  and the "or something like that" half of the operator's request. */
	const onScrollBeginDrag = useCallback(() => {
		releaseWebAnchor();
		presence?.setHeld(true);
	}, [presence, releaseWebAnchor]);
	const onScrollEndDrag = useCallback(() => {
		presence?.setHeld(false);
	}, [presence]);
	/* The glide after a flick is still the reader's gesture: the presence counts
	 *  movement only inside a drag or its momentum, which is what keeps the tail
	 *  pin's own scrolls from raising the rail (round 1, U3). */
	const onMomentumScrollBegin = useCallback(() => {
		presence?.setCoasting(true);
	}, [presence]);
	const onMomentumScrollEnd = useCallback(() => {
		presence?.setCoasting(false);
	}, [presence]);

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
	/* The gap row's Load continues the fill where the automatic one stopped.
	 *  Unlike the reload it replaced, it keeps every loaded page and the
	 *  reader's anchor: the missing rows land between the two islands, where
	 *  native maintainVisibleContentPosition and the tail pin already hold the
	 *  viewport still; on web the list holds the row the reader sees. */
	const requestHeal = useCallback(() => {
		if (!healHistory) return;
		if (!atTail.current) holdWebAnchor();
		void healHistory();
	}, [healHistory, holdWebAnchor]);
	/* The viewport's own height changing is a reason to re-pin, but ONLY while the reader
	 *  is at the tail. The composer growing (a 7-line draft in short landscape took the
	 *  transcript from 118 to 66 pt) shrinks this viewport without any content change, and
	 *  neither the item-count nor the content-size trigger fires, so the newest row's last
	 *  38 pt slid below the fold (design D13, measured `gapToTail` 0.5 -> 38). A reader who
	 *  has scrolled up is not at the tail (`atTail` is false), so their place is kept. */
	const onLayout = useCallback(
		(event: LayoutChangeEvent) => {
			const height = event.nativeEvent.layout.height;
			const changed = Math.abs(height - viewportRef.current) > 0.5;
			setViewportPt(height);
			viewportRef.current = height;
			// The viewport is one of the two facts a fade level is made of.
			driveFades();
			recompute();
			if (changed && viewportRef.current > 0) pinTail();
		},
		[driveFades, recompute, pinTail],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `folded.items.length` is the trigger (a commit that brought rows); the body reads refs by design.
	useLayoutEffect(() => {
		if (openElsewhere) return;
		pinTail();
	}, [openElsewhere, pinTail, folded.items.length]);

	/* THE INITIAL JUMP IS SPENT ONCE, AND ONLY ONCE (QA round 3, Q-RF1).
	 *
	 * Both VirtualizedLists — react-native-web's vendored copy and
	 * `@react-native/virtualized-lists` on native, the same guard in each — jump
	 * to `initialScrollIndex` on the first content-size change that sees it
	 * `> 0`, and latch only THEN. An index that was `0` at the first layout (a
	 * conversation that fitted the 844 pt pre-layout estimate's first screenful)
	 * leaves the latch open; the viewport's real height then shrinks
	 * `initialNumToRender`, `tailStartIndex` turns positive with no content
	 * change to consume it, and the NEXT content change — the reader's first
	 * fold expand, or a streamed row — replays a `scrollToIndex` to the first
	 * row of the last screenful: on web the offset fell 625 → 496 and the row
	 * the reader had just tapped slid under the composer, before the
	 * fold-resize handling below could keep their place. Native has the same
	 * latent jump; only the trigger's timing differs.
	 *
	 * So the index handed to the list is FROZEN at the value it had when the
	 * list first laid out rows. A frozen `> 0` was consumed by that same event
	 * (the list latched); a frozen `0` can never become a jump. Frozen rather
	 * than dropped, because the index also decides which rows the list keeps
	 * mounted: an index `> 0` drops VirtualizedList's "scroll-to-top" region,
	 * so a 520-row transcript opened at its tail never holds a screenful of
	 * its top. A frozen `0` does NOT buy that — `_createRenderMask` keeps the
	 * top screenful whenever the index is `<= 0`, exactly as an absent index
	 * would — so a conversation that froze at `0` (it fitted the pre-layout
	 * estimate) keeps its first `initialNumToRender` rows mounted for the life
	 * of the mount. That is the accepted cost: those conversations were short
	 * at first layout, so the retained rows are the ones that were the whole
	 * conversation then, and the alternative is the replayed jump above.
	 *
	 * FROZEN PER SESSION, NOT PER MOUNT (review round 4, M-r4-1). A switch
	 * reuses this mounted list (`router.navigate`), and the index is a fact
	 * about the conversation it was measured on. Carried across, a long
	 * conversation's ~250 lands on a short one's first commit: react-native-web
	 * then starts the window at its last row (`_initialRenderRegion` clamps the
	 * index to the item count) and, with the index `> 0` at offset 0, refuses to
	 * recompute the cells around the viewport — the short conversation's first
	 * rows never mount. So the frozen value is keyed on the session it was
	 * frozen for and reads as unfrozen for any other: each conversation
	 * computes, and freezes, its own. The list's own one-time jump latch is
	 * per mount and not ours to reset: this key changes which rows the list
	 * renders, not whether it jumps again. Refs, because the value is
	 * consumed by the list's next commit, never rendered for its own sake —
	 * every content change that could replay the jump is caused by a render,
	 * and that render reads the frozen value. */
	const frozenInitialIndexRef = useRef<{
		session: string;
		index: number;
	} | null>(null);
	const liveInitialIndex = tailStartIndex(
		folded.items.length,
		policy.initialNumToRender,
	);
	const frozenInitial = frozenInitialIndexRef.current;
	const initialIndex =
		frozenInitial?.session === sessionId
			? frozenInitial.index
			: liveInitialIndex;
	/* What THIS commit hands the list, for `onContentSizeChange` to freeze —
	 *  with the session it was computed for, so a freeze records the pair. */
	const passedInitialIndexRef = useRef({
		session: sessionId,
		index: 0,
		items: 0,
	});
	passedInitialIndexRef.current = {
		session: sessionId,
		index: initialIndex,
		items: folded.items.length,
	};

	/* The offset is restored once, after the first content change: before that there
	 * is nothing to scroll, and a restore that ran into an empty list would silently
	 * lose the position (F-6.11 — Back preserves scroll). Keyed on the session so a
	 * session switch restores ITS offset rather than the previous one's. */ const onContentSizeChange =
		useCallback(
			(width: number, height: number) => {
				/* The list's one-time initial jump has now been decided for this
				 *  event — VirtualizedList runs its guard BEFORE calling this prop,
				 *  with the same width/height test — so the index it was handed is
				 *  frozen from here on (see `frozenInitialIndexRef`). Only once rows
				 *  exist: an empty list's first layout must not spend the tail open on
				 *  a conversation whose history has not arrived yet. */
				const passed = passedInitialIndexRef.current;
				if (
					frozenInitialIndexRef.current?.session !== passed.session &&
					width > 0 &&
					height > 0 &&
					passed.items > 0
				) {
					frozenInitialIndexRef.current = {
						session: passed.session,
						index: passed.index,
					};
				}
				factsRef.current = { ...factsRef.current, contentPt: height };
				// Content is the other fact: a list that grew past its viewport has
				// edges to fade, and one that shrank under it has none.
				driveFades();
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
				if (foldResizeRef.current) {
					/* A READER'S EXPAND IS NOT CONTENT ARRIVING (review round 1, m4 /
					 *  U4). Opening a fold at the tail grew the content, the tail pin
					 *  below followed it, and the header the reader just tapped slid
					 *  up out of view. So the resize a toggle causes keeps the
					 *  reader's offset: they stay pinned only if they were pinned AND
					 *  the end is still inside the tail band (a short body), otherwise
					 *  they have left the tail and streaming no longer drags them. A
					 *  toggle can only ever take a reader OFF the tail, never on. */
					foldResizeRef.current = false;
					const distance =
						height - factsRef.current.offsetY - viewportRef.current;
					atTail.current = atTail.current && distance <= TAIL_BAND_PT;
					scrollPlaces.set(sessionId, {
						offset: factsRef.current.offsetY,
						atTail: atTail.current,
					});
					if (atTail.current) pinTail();
					recompute();
					return;
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
			[driveFades, sessionId, recompute, scrollAnchor, pinTail],
		);

	useLayoutEffect(() => {
		restoreWebAnchor();
	});

	/* WHERE THE HOLE IS (PR #207 U2). After a disjoint reconnect the held rows and
	 * the new tail sit on either side of rows nobody holds; the marker renders
	 * INSIDE the measured wrapper of the item that shows the first row after the
	 * hole (so the offset table includes it), whichever fold currently hides
	 * that row. It carries the same Reload action as the newest-edge notice. */
	const gapItemId = useMemo(() => {
		if (!historyGap || !historyGapBefore) return null;
		// planRef carries THIS render's plan (assigned above); folded is its trigger.
		const target = revealTarget(planRef.current, expanded, historyGapBefore);
		if (target === null) return null;
		const item =
			target.kind === "item"
				? folded.items[target.index]
				: folded.items.find((candidate) =>
						target.kind === "turn"
							? candidate.kind === "bar" && candidate.turnKey === target.turnKey
							: target.kind === "group"
								? candidate.kind === "group" &&
									candidate.groupKey === target.groupKey
								: candidate.kind === "fold" &&
									candidate.foldKey === target.foldKey,
					);
		return item?.id ?? null;
	}, [historyGap, historyGapBefore, folded, expanded]);
	const gapMarker = useMemo(
		() =>
			gapItemId === null ? null : (
				<View
					className="flex-row items-center gap-2 px-4 py-1"
					testID={REGION.transcriptGap}
				>
					<Text
						accessibilityRole="text"
						className="flex-1 text-body-sm text-ink-muted"
					>
						{t("mobile.session.history.gap")}
					</Text>
					{healHistory ? (
						<Button
							label={t("mobile.session.history.gap_load")}
							accessibilityHint={t("mobile.session.history.gap_load_hint")}
							onPress={requestHeal}
							variant="quiet"
							size="sm"
							testID={CONTROL.transcriptGapLoad}
						/>
					) : null}
				</View>
			),
		[gapItemId, healHistory, requestHeal],
	);

	const renderItem = useCallback(
		({ item }: { item: TranscriptItem }) => {
			/* The supplement block's seat: under the FINAL answer, inside the row's
			 * measured wrapper — the block is the answer's supplement, and the row's
			 * measured height must include it or the ack gate's arithmetic drifts by
			 * one unknown block height. The row's own anchor element stays the
			 * answer's end (`completionAnchorId`). Only an assistant row renders a
			 * block, and only the beat that NAMES it, so a beat whose anchor is not
			 * in this transcript renders nothing at all. */
			const beat =
				item.kind === "entry" && item.entry.kind === "assistant"
					? supplements?.[item.id]
					: undefined;
			const depth = groupDepth(containment.get(item.id));
			/* The row's outer box: its rhythm tier, plus one 24 pt step per opened
			 * group around it (`GROUP_INSET_CLASS`, `trace-rail.ts`). */
			const gap = cx(
				SPACING_TIER_CLASS[spacingTiers.get(item.id) ?? "first"],
				GROUP_INSET_CLASS[depth],
			);
			const guides = depth > 0 ? <GroupGuides depth={depth} /> : null;
			return item.kind === "bar" ? (
				/* The bar is measured like any row: it stands in the list, so the
				 * anchor geometry (which walks the RENDERED items) must know its
				 * height. */
				<View
					ref={(node) => {
						if (node) webRows.current.set(item.id, node);
						else webRows.current.delete(item.id);
					}}
					onLayout={(event) =>
						measureRow(item.id, event.nativeEvent.layout.height)
					}
					className={cx(gap)}
				>
					{item.id === gapItemId ? gapMarker : null}
					{guides}
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
					ref={(node) => {
						if (node) webRows.current.set(item.id, node);
						else webRows.current.delete(item.id);
					}}
					onLayout={(event) =>
						measureRow(item.id, event.nativeEvent.layout.height)
					}
					className={cx(gap)}
				>
					{item.id === gapItemId ? gapMarker : null}
					{guides}
					<QuietGroupBar
						groupKey={item.groupKey}
						group={item.group}
						open={item.expanded}
						onToggle={(open) => toggleExpansion(item.groupKey, open)}
					/>
				</View>
			) : item.kind === "fold" ? (
				/* Measured like the other bars: the anchor geometry walks the
				 * RENDERED items, and a fold is one of them. */
				<View
					ref={(node) => {
						if (node) webRows.current.set(item.id, node);
						else webRows.current.delete(item.id);
					}}
					onLayout={(event) =>
						measureRow(item.id, event.nativeEvent.layout.height)
					}
					className={cx(gap)}
				>
					{item.id === gapItemId ? gapMarker : null}
					{guides}
					<FoldBar
						foldKey={item.foldKey}
						fold={item.fold}
						open={item.expanded}
						onToggle={(open) => toggleExpansion(item.foldKey, open)}
					/>
				</View>
			) : (
				/* The measuring wrapper: one `onLayout` per row is what makes the
				 * anchor's position knowable at all in a virtualised list that refuses
				 * fixed row heights. It adds no styling and no size of its own —
				 * except the find wash, which is a background on THIS box so it spans
				 * the row's full bleed without touching any kind's own treatment. */
				<View
					ref={(node) => {
						if (node) webRows.current.set(item.id, node);
						else webRows.current.delete(item.id);
					}}
					onLayout={(event) =>
						measureRow(item.id, event.nativeEvent.layout.height)
					}
					className={cx(
						gap,
						item.id === highlightId ? "bg-row-selected" : undefined,
					)}
				>
					{item.id === gapItemId ? gapMarker : null}
					{guides}
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
							className="absolute bottom-0 start-0 top-0 w-0.5 bg-accent"
							aria-hidden
						/>
					) : null}
					{/* Always provided (0 outside a group), so opening or closing a
					 *  bar never changes the row's element tree and never remounts it. */}
					<GroupInsetContext.Provider value={depth * GROUP_STEP_PT}>
						<TranscriptRow
							entry={item.entry}
							condensed={item.condensed === true}
							streaming={streamingRowId !== null && item.id === streamingRowId}
							loadImage={loadImage}
							onOpenAgent={onOpenAgent}
							onOpenVideo={onOpenVideo}
							onCancelTurn={onCancelTurn}
							open={rowOpen.get(canonicalRowKey(item.entry))}
							onToggleOpen={toggleRowOpen}
						/>
					</GroupInsetContext.Provider>
					{/* The completion anchor: a zero-size sibling at the row's bottom edge
					 * (an element carries one testID, so the anchor is its own element —
					 * the streaming anchor's note), named by the attention's `anchor_id`
					 * so flows and the ack gate can address the row the completion ended
					 * on. */}
					{item.id === anchorId ? (
						<View testID={completionAnchorId(item.id)} aria-hidden />
					) : null}
					{beat !== undefined && supplementClient !== undefined ? (
						/* The block's seat: the transcript's own content column (`px-4`, the
						   answer text's step — `px-3` hung it ~4 px left of the column it
						   belongs to; design round 1, D5). */
						<View className="px-4">
							<SupplementBlock
								beat={beat}
								jobLive={beatLive(beat, projectionPid)}
								client={supplementClient}
							/>
						</View>
					) : null}
				</View>
			);
		},
		[
			toggleExpansion,
			rowOpen,
			toggleRowOpen,
			streamingRowId,
			loadImage,
			onOpenAgent,
			onOpenVideo,
			onCancelTurn,
			anchorId,
			measureRow,
			highlightId,
			supplements,
			projectionPid,
			supplementClient,
			gapItemId,
			gapMarker,
			spacingTiers,
			containment,
		],
	);

	/* Hoisted for the same reason as the key function: `ListHeaderComponent` and
	 *  `ListFooterComponent` are compared by identity, so an inline element (or a
	 *  fresh fragment) tells the virtualiser its header and footer changed on every
	 *  streaming frame. */
	/* THE NEWEST EDGE, where a reader of a live conversation actually is (PR #207
	 * D1/U2): a failed newest-page refresh, and a quiet pointer to a gap above
	 * that the automatic fill could not close, with the same Load action as the
	 * row at the hole. Rendered above the
	 * pending echoes in the footer so it sits directly under the newest rows. */
	const newestEdgeNotice = useMemo(
		() =>
			loadOlder && (newestFailed || historyGap) ? (
				<View className="px-4 py-2 gap-2" testID={REGION.transcriptNewestEdge}>
					{newestFailed ? (
						<>
							<Text
								accessibilityLiveRegion="polite"
								className="text-body-sm text-ink-muted"
							>
								{t("mobile.session.history.refresh_failed")}
							</Text>
							{canRetry ? (
								<Button
									label={t("mobile.common.try_again")}
									onPress={requestRetry}
									variant="outline"
									testID={CONTROL.transcriptRetryLatest}
								/>
							) : null}
						</>
					) : null}
					{historyGap ? (
						<View className="flex-row items-center gap-2">
							<Text
								accessibilityLiveRegion="polite"
								className="flex-1 text-body-sm text-ink-muted"
							>
								{t("mobile.session.history.gap_newest")}
							</Text>
							{healHistory ? (
								<Button
									label={t("mobile.session.history.gap_load")}
									accessibilityHint={t("mobile.session.history.gap_load_hint")}
									onPress={requestHeal}
									variant="quiet"
									size="sm"
									testID={CONTROL.transcriptGapLoadNewest}
								/>
							) : null}
						</View>
					) : null}
				</View>
			) : null,
		[
			loadOlder,
			newestFailed,
			historyGap,
			canRetry,
			requestRetry,
			healHistory,
			requestHeal,
		],
	);
	const listHeader = useMemo(
		() => (
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
				{loadOlder ? (
					/* The OLDER edge only: load, loading, an older-page failure, and the
					 * beginning. A newest-page refresh and the disconnected gap are
					 * reported where the reader is — the newest edge and the hole itself
					 * (`gapNotice`, `historyGapBefore`; PR #207 D1/U2). */
					<View className="px-4 py-2 gap-2" testID={REGION.transcriptHistory}>
						{historyError && !newestFailed ? (
							<Text
								accessibilityLiveRegion="polite"
								className="text-body-sm text-ink-muted"
							>
								{t(
									historyError === "stalled"
										? "mobile.session.history.stalled"
										: "mobile.session.history.failed",
								)}
							</Text>
						) : null}
						{hasOlder || olderRetry ? (
							/* Deliberately NOT `disabled` while loading (PR #207 U1): a native
							 * `disabled` blurs the focused control, so keyboard and
							 * screen-reader readers lost their place on every page. `Button`
							 * already ignores presses while `loading` and announces busy. */
							<Button
								label={t(
									loadingOlder
										? "mobile.session.history.loading"
										: olderRetry
											? "mobile.common.try_again"
											: "mobile.session.history.load",
								)}
								onPress={olderRetry ? requestRetry : requestOlder}
								loading={loadingOlder}
								variant="outline"
								testID={CONTROL.transcriptLoadEarlier}
							/>
						) : historyGap ? null : (
							<Text className="text-body-sm text-ink-muted">
								{t(
									entries.length === 0
										? "mobile.session.history.empty"
										: "mobile.session.history.beginning",
								)}
							</Text>
						)}
					</View>
				) : null}
				{header}
			</>
		),
		[
			header,
			sessionId,
			loadOlder,
			hasOlder,
			historyError,
			historyGap,
			loadingOlder,
			requestOlder,
			olderRetry,
			newestFailed,
			requestRetry,
			entries.length,
		],
	);
	/* One shape whether or not anything is pending, so the notice keeps its
	 *  child index and is never remounted when the first echo appears. */
	const listFooter = useMemo(
		() => (
			<View>
				{newestEdgeNotice}
				{pending ?? null}
				{footer}
			</View>
		),
		[newestEdgeNotice, pending, footer],
	);

	return (
		<View className="flex-1 min-h-0">
			<FlatList
				ref={listRef}
				testID={testID}
				data={folded.items}
				keyExtractor={keyOfItem}
				renderItem={renderItem}
				onLayout={onLayout}
				maintainVisibleContentPosition={loadOlder ? HISTORY_ANCHOR : undefined}
				onScroll={onScroll}
				onScrollBeginDrag={onScrollBeginDrag}
				onScrollEndDrag={onScrollEndDrag}
				onMomentumScrollBegin={onMomentumScrollBegin}
				onMomentumScrollEnd={onMomentumScrollEnd}
				scrollEventThrottle={16}
				onContentSizeChange={onContentSizeChange}
				/* The two props that make the FIRST frame the one the reader came for.
				 *
				 * `initialScrollIndex` mounts the LAST screenful, and `getItemLayout`
				 * tells the list where that screenful sits — so the open renders its
				 * final rows and the tail `onContentSizeChange` clamp is a correction
				 * rather than the mechanism that gets there. Frozen once rows have laid
				 * out (`frozenInitialIndexRef`, Q-RF1). Omitted when this mount is
				 * headed somewhere else (`openElsewhere`): a restored offset or the
				 * capture hook's top. There is deliberately no
				 * `onScrollToIndexFailed` beside them — the list never reports a failed
				 * jump when it has metrics, so the deep-jump recovery lives in
				 * `revealToIndex`, which is the only place that knows a target is
				 * unmeasured. */
				initialScrollIndex={openElsewhereAtMount ? undefined : initialIndex}
				getItemLayout={getItemLayout}
				// Keyboard stays open while scrolling: the reader is scrolling to read the
				// answer to what they just typed.
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode="interactive"
				ListHeaderComponent={listHeader}
				// A permanent footer host lets recovery grow inside this scroller. It is
				// not a transcript row/completion anchor; existing tail-vs-away policy
				// receives the content-size change without forcing a non-tail reader down.
				ListFooterComponent={listFooter}
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
				contentContainerStyle={CONTENT_CONTAINER_STYLE}
			/>
			{/* The two edge fades: a picture of the cut edge, never a control. */}
			<TranscriptEdgeFades ref={fadesRef} />
		</View>
	);
};
