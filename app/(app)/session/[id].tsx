import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Search } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Platform,
	Pressable,
	ScrollView,
	Text,
	type TextInput,
	useWindowDimensions,
	View,
} from "react-native";
import type { PromptImage } from "@/contracts";
import { useListState } from "@/features/auth/connection-provider";
import { useStartup } from "@/features/new-session/use-startup";
import { blockingPending } from "@/features/session/asks";
import { composerChipLabels } from "@/features/session/chip-labels";
import {
	attentionRecord,
	overlaysBlocked,
} from "@/features/session/completion-ack";
import { AskBar } from "@/features/session/components/ask-bar";
import { AsksSheet } from "@/features/session/components/asks-sheet";
import { CheckpointRail } from "@/features/session/components/checkpoint-rail";
import { Composer } from "@/features/session/components/composer";
import { ConnectionBanner } from "@/features/session/components/connection-banner";
import { FindBar } from "@/features/session/components/find-bar";
import { FindSheet } from "@/features/session/components/find-sheet";
import {
	EffortSheet,
	ModelSheet,
} from "@/features/session/components/model-sheet";
import { PendingCard } from "@/features/session/components/pending-card";
import {
	HealthAnnouncer,
	ResumeBlock,
	SessionHeaderActions,
	SessionHealthControl,
	useResume,
} from "@/features/session/components/session-health";
import { SlashSheet } from "@/features/session/components/slash-sheet";
import {
	FindStateMarkers,
	SessionStateMarkers,
} from "@/features/session/components/state-markers";
import {
	StatusTray,
	type StatusTrayFacts,
} from "@/features/session/components/status-tray";
import { SubagentsPanel } from "@/features/session/components/subagents-panel";
import type { SupplementClient } from "@/features/session/components/supplement-block";
import { TodosPanel } from "@/features/session/components/todos-panel";
import { TranscriptList } from "@/features/session/components/transcript-list";
import { WorkingLine } from "@/features/session/components/working-line";
import { isRouteRefused } from "@/features/session/connection-view";
import { compactTitleChars, headerTitleChars } from "@/features/session/header";
import { headerHealth } from "@/features/session/health";
import { rosterNeedsAttention } from "@/features/session/panels";
import { pendingView } from "@/features/session/pending";
import { collapsePendingTranscript } from "@/features/session/pending-layout";
import {
	middleTruncate,
	projectSubagents,
	projectTodos,
	workingLine,
} from "@/features/session/projection";
import {
	type RecoveryFacts,
	recoveryBudget,
} from "@/features/session/recovery-budget";
import { sessionFactsFrom } from "@/features/session/state-marker";
import { useAsksSheet } from "@/features/session/use-asks-sheet";
import { useCheckpoints } from "@/features/session/use-checkpoints";
import { useCompletionAck } from "@/features/session/use-completion-ack";
import { draftSlashQuery, useComposer } from "@/features/session/use-composer";
import { useFind } from "@/features/session/use-find";
import { useSessionRuntime } from "@/features/session/use-session";
import { isRemoteRow } from "@/features/sessions/session-projection";
import { SessionTagLine } from "@/features/sessions/tag-line";
import { canAssignSessionTags } from "@/features/sessions/tags";
import { SessionTagsSheet } from "@/features/sessions/tags-sheet";
import {
	CONTROL,
	EMPTY,
	ROLE,
	SCREEN,
	SURFACE,
	sessionHeaderTagLineId,
} from "@/ui/a11y";
import {
	Chip,
	EmptyState,
	IconButton,
	Screen,
	Skeleton,
} from "@/ui/components";
import { NavigationMark } from "@/ui/components/navigation-mark";
import { Sheet } from "@/ui/components/sheet";
import { useCompactChrome } from "@/ui/layout";
import {
	COMPACT_COMPOSER_SHARE,
	COMPACT_OPEN_PANEL_SHARE,
	COMPACT_PENDING_SHARE,
	compactChromeShare,
	composerLimit,
	headerStacks,
	type RegionKey,
	regionOrder,
	sessionStatusLayout,
	snapRegion,
	statusTrayVisible,
} from "@/ui/size-class";
import { useTextScale } from "@/ui/text-scale-provider";

/**
 * The session view (`docs/ux/flows.md` F-6): the product's core screen.
 *
 * The column, top to bottom, is the spec's composition — header · status strip ·
 * transcript · todos · subagents · pending card · composer — and the ORDER is
 * load-bearing rather than incidental:
 *
 *  - The transcript takes the remaining space (`flex-1`) and the panels take what
 *    they need, because the transcript is the thing being read and a panel that
 *    grew would push it off screen.
 *  - The pending card sits directly above the composer and below the panels: it is
 *    the most prominent object on the screen because a question for the reader is
 *    the only thing that needs a decision, and it must be adjacent to the control
 *    that sends an answer.
 *  - The working line sits between the panels and the card, which is where the
 *    spec puts it ("a working line above the composer") and where it is legible
 *    whether or not the panels are open.
 *
 * **At most one panel is expanded**, held by one piece of state rather than by two
 * booleans: the v1 rule is that an expanded todos list AND an expanded subagent
 * roster together push the conversation off a phone screen, and two booleans can
 * express a state the rule forbids.
 */
export default function Session() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const sessionId = typeof id === "string" ? id : "";
	/* The header's tags come from the LIST frame, not the projection: the tag pair
	 *  is the listing's own field (`SessionSummary.tags`), and the projection
	 *  contract does not repeat it. The list stream carries it for every row the
	 *  relay knows, so a deep link settles as soon as its first frame arrives. */
	const listRow = useListState((state) =>
		state.sessions.find((row) => row.session_id === sessionId),
	);
	const router = useRouter();
	/* The header's tag line is a DISCLOSURE when this conversation is the local
	 *  one and the relay offers the routes: it opens the same sheet the list
	 *  row's menu does, fed by this same list frame. A remote row keeps the line
	 *  read-only — its store is another device's, and this phone has no route to
	 *  write it. One sheet, one write path; the alternative was a second state to
	 *  reconcile against the same SSE frame. */
	const [tagsOpen, setTagsOpen] = useState(false);

	const runtime = useSessionRuntime(sessionId);
	const provisional = useStartup(null, sessionId);
	const provisionalEditor =
		provisional.coordinator === null
			? undefined
			: {
					draft: provisional.snapshot.draft.text,
					images: provisional.snapshot.draft.images,
					setDraft: (text: string) => provisional.setText(text),
					setImages: (
						next: PromptImage[] | ((current: PromptImage[]) => PromptImage[]),
					) => provisional.setImages(next),
				};
	/* The relay's capability block, off the same list frame the screen already reads
	 * below. Declared before the composer because the composer's mic gate needs it. */
	const capabilities = useListState((state) => state.capabilities);
	/* Whether the header may offer the assignment sheet at all: a LOCAL
	 *  conversation whose relay advertises the routes. It is computed once so the
	 *  header's presence and its press cannot disagree (review round 2, U8). The
	 *  capability test is the tested helper, never a second comparison; a remote
	 *  row stays read-only even when the relay offers the routes. */
	const tagsAssignable =
		listRow !== undefined &&
		!isRemoteRow(listRow) &&
		canAssignSessionTags(capabilities);
	const composer = useComposer({
		sessionId,
		source: runtime.source,
		streaming: runtime.streaming,
		/* The ended verdict comes FROM THE DOT (`headerHealth`), not
		 *  `projection.ended` alone: a history-only conversation (pid 0) is ended
		 *  too, and a send to either REOPENS it. */
		ended: headerHealth(runtime.projection, runtime.link) === "ended",
		capabilities,
		editor: provisionalEditor,
	});

	/* The supplement block's host calls: one session-scoped client, built here
	 *  from the runtime so the list and the block never hold a relay client.
	 *  The ops are the relay's own command route (see `supplementCommand`). */
	const supplementClient = useMemo<SupplementClient>(
		() => ({
			loadDocument: runtime.loadSupplementDocument,
			loadFile: runtime.loadSupplementFile,
			command: runtime.supplementCommand,
		}),
		[
			runtime.loadSupplementDocument,
			runtime.loadSupplementFile,
			runtime.supplementCommand,
		],
	);

	/** `null`, `"todos"` or `"subagents"`: one open panel at most. */
	const [openPanel, setOpenPanel] = useState<null | "todos" | "subagents">(
		null,
	);
	/** The compact status sheet. The tray's one row opens it; on a wide column
	 *  the panels stay inline, so this is never true there. */
	const [statusSheetOpen, setStatusSheetOpen] = useState(false);

	const [modelsOpen, setModelsOpen] = useState(false);
	const [effortOpen, setEffortOpen] = useState(false);
	/** The composer's field, so the asks sheet's auto-open can READ focus at the
	 *  moment it decides (focus is not React state). */
	const composerFieldRef = useRef<TextInput | null>(null);
	/** The asks sheet's visibility. Opened by the reader from the bar, and ALSO by
	 *  default when the conversation is opened with questions already waiting
	 *  (`asks-open-policy.ts` — §5.0 narrowed: an ask ARRIVING still never forces
	 *  it, a conversation being OPENED does). */
	const asksSheet = useAsksSheet({
		sessionId,
		fieldRef: composerFieldRef,
		draft: composer.draft,
		draftReady: composer.draftReady,
		attachments: composer.images.length,
		dictating: composer.voice.phase !== "idle",
		otherSheetOpen: modelsOpen || effortOpen,
	});
	const asksOpen = asksSheet.visible;

	/* The list frame's rows: names for the sheet's foreign-ask rows, which the
	 *  aggregate route deliberately does not carry. */
	const listSessions = useListState((state) => state.sessions);

	/* The in-conversation find: its own session of state (which mode, query,
	 *  landed hit), over the frames this device holds. Declared here because the
	 *  header lever, the sheet, the bar, the transcript's wash/reveal and the
	 *  ack gate all read it. */
	const find = useFind({ sessionId, entries: runtime.entries });

	/* The transcript's checkpoint rail: one manifest read per conversation
	 *  (`GET /api/sessions/{id}/checkpoints`), polled while the relay says
	 *  `building`. The rail's marks come from the journal-derived manifest —
	 *  NEVER from `runtime.entries`, whose projection is a bounded tail window
	 *  and would silently mark only the tail. `loadedIds` is the one thing the
	 *  rail reads from the frames: it is how a frame can prove a mark is for a
	 *  row this device does NOT hold (`rail-deep`). */
	const checkpoints = useCheckpoints({
		sessionId,
		endpoints: runtime.source.endpoints,
	});
	const loadedIds = useMemo(
		() => new Set(runtime.entries.map((entry) => entry.id)),
		[runtime.entries],
	);

	/** Whether the completion's anchor row bottom is inside the transcript's
	 *  viewport — measured by `TranscriptList` (the list owns the geometry; this
	 *  screen only carries the answer to the ack gate). */
	const [completionVisible, setCompletionVisible] = useState(false);

	/* The slash sheet's visibility — read by the ack gate (an open slash sheet
	 *  holds the screen, R2-2) as well as by the sheet itself, so it is
	 *  declared above both readers. */
	const slash = draftSlashQuery(composer.draft);

	/* The read receipt: fires only when the completion's END is genuinely on
	 *  screen while the app is foregrounded on this session (ADR 0006 §1.3).
	 *  A sheet (models, effort, asks, slash) or either panel counts as
	 *  `blocked`, exactly like the web's gate list — a completion behind an
	 *  overlay has not been read. This build measures no DOM, so the overlay set
	 *  is its ONLY occlusion channel; it lives in `overlaysBlocked`, and a test
	 *  walks it (review round 2, R2-2). */
	useCompletionAck({
		sessionId,
		endpoints: runtime.source.endpoints,
		projection: runtime.projection,
		anchorVisible: completionVisible,
		blocked: overlaysBlocked({
			models: modelsOpen,
			effort: effortOpen,
			panel: openPanel !== null,
			asks: asksOpen,
			slash: slash !== null,
			find: find.sheetOpen,
			findBar: find.barVisible,
		}),
	});

	const projection = runtime.projection;

	/* The effort ladder, read once: the chip's availability and the sheet's rows are
	 * the same fact, and an empty ladder means the selected model has no effort
	 * control — a sheet with no rows and nothing to press is the dead-end modal the
	 * QA round found (Q3). */
	const effortLadder = useMemo(
		() => projection?.effort_ladder ?? [],
		[projection?.effort_ladder],
	);

	const todos = useMemo(
		() => projectTodos(projection?.todos ?? []),
		[projection?.todos],
	);
	const subagents = useMemo(
		() => projectSubagents(projection?.subagents ?? []),
		[projection?.subagents],
	);
	// `null` in, `null` out: the working line exists only while the runtime names an
	// activity, and a placeholder projection would be this screen inventing one.
	const working = projection === null ? null : workingLine(projection);

	/* What the composer's chips can say, and whether they are still waiting.
	 *
	 * `connected` is deliberately first: a projection that HAS arrived is the truth
	 * about the session even if the stream later drops (stale beats blank), so a
	 * value is never replaced by `n/a` because the route failed afterwards. Only
	 * with nothing to show does the connection state decide, and `refused` means
	 * nothing is coming — a route with no origin, or a stream that never opened
	 * (review round 4, R8: the chips used to pulse "loading" for the life of the
	 * screen beside an empty state that said the session was not connected). */
	const chipConnection =
		projection !== null
			? ("connected" as const)
			: isRouteRefused({
						noRoute: runtime.source.reason === "no-route",
						error: runtime.error,
					})
				? ("unreachable" as const)
				: ("loading" as const);
	const chipLabels = composerChipLabels({
		model: projection?.model_label ?? null,
		effort: projection?.effort ?? null,
		connection: chipConnection,
	});

	/* The strip exists when it has something true to say: a context read, or a
	 * roster. Not before — an empty band on every session is noise, and a band
	 * showing `—` for an unknown number is worse than the noise. */
	const hasStatus =
		(projection?.context_tokens != null &&
			projection?.context_window != null) ||
		subagents.total > 0;

	/* The legacy ask-mirror rule (design §4, client rule N3): once `asks` is
	 *  present, a `pending` card of `kind == "ask"` is one of those rows mirrored
	 *  for old clients and must be IGNORED here — rendering both would draw the
	 *  same ask twice and collect a second answer. Approvals are unaffected. */
	const pending = blockingPending(
		projection?.pending ?? null,
		projection?.asks,
	);

	/* The header dot's sheet + the session menu, held here (not in the control) so
	 *  the acceptance line survives the sheet closing, and so the `S5/health-sheet`
	 *  marker and the sheet it claims cannot disagree. */
	const [healthSheetOpen, setHealthSheetOpen] = useState(false);
	const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
	/* Focus goes back to the header control when its sheet closes (UX U10). */
	const healthControlRef = useRef<View | null>(null);

	/* The state markers the design audit reads, from the same facts the screen renders
	 *  from — a marker is a claim about the state the reader is in, so it may only be
	 *  emitted for a fact that is TRUE. Memoised because this is the route a reader
	 *  types into: the facts walk the transcript to find a fenced row, and re-walking
	 *  it on every keystroke is work the composer's re-render would pay for. */
	const stateFacts = useMemo(
		() =>
			sessionFactsFrom({
				projection,
				streaming: runtime.streaming,
				error: runtime.error !== null,
				entries: runtime.entries,
				subagents: subagents.total,
				/* The composer's own gate, not a second reading of
				 * `capabilities.stt`: a marker may only claim what the control
				 * actually rendered, so both must come from one decision. */
				micVisible: composer.voice.micVisible,
				/* The supplement facts the markers affirm (`S5/supplement-*` cells):
				 * the same reader the list renders from, so a marker can never claim a
				 * state the visible block does not show. */
				supplements: runtime.supplements,
				supplementPid: runtime.projectionPid,
				/* The dot's verdict, from the same call the dot renders — so the
				 * `S5/health-quiet` marker cannot claim a yellow the header is not
				 * showing. */
				health: headerHealth(projection, runtime.link),
				healthSheetOpen,
			}),
		[
			projection,
			runtime.streaming,
			runtime.error,
			runtime.entries,
			runtime.supplements,
			runtime.projectionPid,
			subagents.total,
			composer.voice.micVisible,
			runtime.link,
			healthSheetOpen,
		],
	);
	/* One definition of `aborted`, used by the marker and by the resume affordance.
	 *  Two copies of this predicate is how the copy a reader sees and the copy a cell
	 *  is measured by drift apart (`state-marker.ts` § `sessionFactsFrom`). */
	const aborted = stateFacts.aborted;

	/* The header's status dot: ONE verdict, read by the dot, the composer's
	 *  placeholder and the ended send-failure sentence. From runtime signals the
	 *  relay publishes (ended / degraded / heartbeat_stale / pid) plus the phone's
	 *  own link, never from the last message — `health.ts` owns the ladder.
	 *  `null` before the first frame and after the client stops retrying: no
	 *  dot, no announcement (review M3, UX U4/U5). */
	const health = headerHealth(projection, runtime.link);
	const ended = health === "ended";
	const resume = useResume(sessionId, ended);

	const pendingViewProps = useMemo(
		() =>
			pending === null
				? null
				: pendingView({
						pending,
						sessionKind: projection?.kind ?? "",
						ended: projection?.ended === true,
						pendingCount: projection?.pending_count ?? 1,
						// The computer's name is not known on this route (the route profile is
						// the connection layer's, and a hostname is not a name a reader uses), so
						// the risk sentence falls back to the working directory, which is the
						// more useful of the two for "where will this run".
						computerLabel: "",
						cwd: projection?.cwd ?? "",
					}),
		[
			pending,
			projection?.kind,
			projection?.ended,
			projection?.pending_count,
			projection?.cwd,
		],
	);

	const openAgent = useCallback(
		(jobId: string) => {
			router.push(`/session/${sessionId}/agent/${jobId}`);
		},
		[router, sessionId],
	);

	/* The video player is a PUSHED ROUTE, never an inline player: the
	 * transcript recycles rows (FlatList) and playback must outlive a recycle —
	 * the design's own flow, "receipt row → tap → player screen". The route
	 * takes the entry id and the artifact's video index; the bytes resolve
	 * there, so a recycled row costs nothing and no loop lives in the list. */
	const openVideo = useCallback(
		(entryId: string, index: number) => {
			router.push({
				pathname: "/session/[id]/video",
				params: { id: sessionId, entry: entryId, i: String(index) },
			});
		},
		[router, sessionId],
	);

	const title = projection?.conversation_name ?? "";
	/* The header name is MIDDLE-truncated with a floor, because the shipped web
	 * client collapsed it to a single glyph at 200 % text (`R14`) — the two ends of
	 * a session name are what distinguish it, so a truncation has to keep both.
	 *
	 * The budget is the ROW's width, not a fixed 40 characters: at a fixed 40 the
	 * truncation never ran for a real name, so a 25-character name reached the
	 * layout whole and the platform clipped its tail (`Refactor th…` at 390,
	 * `Refact…` at 320 — design round 1, D2). `headerTitleChars` derives it from
	 * the viewport and the same column cap this screen renders inside, and the
	 * header no longer carries a status chip for the name to compete with. */
	const { width: viewportWidth, height: viewportHeight } =
		useWindowDimensions();
	/* Short landscape only, and decided from the SCREEN's orientation so a keyboard-
	 *  shortened portrait window never takes this branch (`compactChromeFor`). */
	const compact = useCompactChrome();
	/* ONE decision, three consumers (tray, sheet, inline region), so the surfaces
	 * cannot disagree — see `sessionStatusLayout`. `phone` is a WIDTH question, not
	 * `compact`: gating on `compact` left the old task/subagent bands on portrait
	 * phones, which is exactly what D2 fixed. */
	const { tray, inlineSecondary, statusSheet } = sessionStatusLayout(
		viewportWidth,
		compact,
	);
	const { effectiveScale } = useTextScale();
	/* The secondary region's own scroller, and what it needs to behave: each child's
	 *  measured height and offset (so the closed region can be cut on a ROW boundary and
	 *  an opened panel can be scrolled to its header). `null` heights mean "not measured
	 *  yet", and the region then uses its plain cap for one frame. */
	const regionRef = useRef<ScrollView | null>(null);
	/* The composer's top in WINDOW coordinates, for `composerLimit`: portrait has no
	 *  short-landscape budget, and this is the only honest ceiling for a long draft at
	 *  large text (design recheck D-c). The COMPOSER measures itself — wrapping it
	 *  would reparent the field, which the footer contract forbids. */
	const [composerBox, setComposerBox] = useState<{
		top: number;
		height: number;
	} | null>(null);
	const regionLayout = useRef<
		Partial<Record<RegionKey, { y: number; h: number }>>
	>({});
	/* Whether the region is scrolled to its end: the cue below it says there is MORE
	 *  and must go away once there is not. */
	/* The cue's own height, reserved out of the closed cap. Its slot and the Close bar
	 * stay constant while open, so the strict bottom test is safe: neither showing nor
	 * hiding a cue changes the viewport we are comparing to the content. */
	const cueReserve = Math.round(19 * effectiveScale);
	const [regionAtBottom, setRegionAtBottom] = useState(false);
	const [recoveryFacts, setRecoveryFacts] = useState<RecoveryFacts>({});
	const measureRecovery = useCallback(
		(key: keyof RecoveryFacts, value: number) => {
			if (!Number.isFinite(value) || value < 0) return;
			setRecoveryFacts((previous) =>
				previous[key] === value ? previous : { ...previous, [key]: value },
			);
		},
		[],
	);
	const pendingRecovery =
		pendingViewProps !== null && runtime.connection.id !== null;
	const recoveryAllocation = recoveryBudget(recoveryFacts);
	const [pendingAvailableHeight, setPendingAvailableHeight] =
		useState<number>();
	/* The region's last scroll offset and viewport, kept in refs so a CONTENT change
	 *  (a row appears, a roster changes) can re-derive "at the bottom" without waiting
	 *  for a scroll that never comes (reviewer m3: the flag went stale and hid the cue
	 *  while rows were below). */
	const regionScrollRef = useRef({ y: 0, viewport: 0 });
	const [regionHeights, setRegionHeights] = useState<
		Partial<Record<RegionKey, number>>
	>({});
	/* The same predicate `Screen` stacks on (it passes no `stackBelowWidth`
	 *  here), so the title's line clamp and its budget agree: stacked, the
	 *  budget assumes TWO lines (`headerTitleChars`' stacked branch) and the
	 *  control draws two (review M1 — a one-line clamp under a two-line budget
	 *  cut every stacked name twice). Compact never stacks. */
	const headerStacked = !compact && headerStacks(effectiveScale, viewportWidth);
	const headerTitle =
		title.length > 0
			? middleTruncate(
					title,
					compact
						? compactTitleChars(
								{ width: viewportWidth, height: viewportHeight },
								effectiveScale,
								/* The word rides this row in compact and takes width from
								 *  the title, so it is charged — in EVERY state, live
								 *  included, so the name's shape does not change when the
								 *  dot changes colour (review round 4, D15 / QA N3). */
								{ menu: ended, word: true },
								Platform.OS !== "web",
							)
						: headerTitleChars(
								{ width: viewportWidth, height: viewportHeight },
								/* The dot now holds ONE slot before the name in EVERY state
								 *  (round 2 D11), so it is charged in every state rather than
								 *  only on live — and the ⋮ only while it has an item (ended).
								 *  Review M1, and round 2's D11 layout unification. */
								{ dot: true, menu: ended },
								effectiveScale,
								Platform.OS !== "web",
							),
				)
			: "session";

	/* The panels, in one place: they sit between the transcript and the composer.
	 * One panel at a time, because a phone's column has room for one and a tablet's is
	 * still one column (`src/ui/column.ts`). */
	const todosPanel = (
		<TodosPanel
			testID={SURFACE.todosPanel}
			todos={todos}
			open={statusSheet ? statusSheetOpen : openPanel === "todos"}
			onToggle={() =>
				statusSheet || openPanel !== "todos" ? undefined : setOpenPanel(null)
			}
			heldShut={pending !== null}
			compact={compact}
		/>
	);
	const subagentsPanel = (
		<SubagentsPanel
			testID={SURFACE.subagentsPanel}
			subagents={subagents}
			viewportHeight={viewportHeight}
			compact={compact}
			open={statusSheet ? statusSheetOpen : openPanel === "subagents"}
			onToggle={() =>
				statusSheet || openPanel !== "subagents"
					? undefined
					: setOpenPanel(null)
			}
			onOpenAgent={openAgent}
		/>
	);
	const workingLineView =
		working !== null ? (
			<WorkingLine
				activity={working.activity}
				startedS={working.startedS}
				compact={compact}
				testID={SURFACE.sessionWorkingLine}
			/>
		) : null;

	const connectionBanner = (
		<ConnectionBanner
			view={runtime.connection}
			onAction={(action) => {
				if (action.kind === "retry") runtime.reload();
				// A sign-in and a console link are the route screens' work; this
				// screen has nowhere to put a credential field, so it sends the
				// reader to the screen that owns it rather than failing silently.
				if (action.kind === "sign-in") router.push("/welcome");
				if (action.kind === "console") router.push("/tunnels");
			}}
		/>
	);

	// One notice owner: pending bodies already have a readable floor, whereas
	// another list viewport cannot fit beside the pinned decision/composer.
	const transcriptNotice = pendingRecovery ? undefined : connectionBanner;
	const transcript =
		runtime.content === "disconnected" ? (
			<ScrollView
				className="flex-1 min-h-0"
				contentContainerStyle={{ flexGrow: 1 }}
			>
				<EmptyState
					headline="This session is not connected yet."
					next="Open it from the session list once a computer is connected."
					testID={EMPTY.session}
				/>
				{transcriptNotice}
			</ScrollView>
		) : runtime.content === "recovery" ? (
			// With no owned frame, recovery is the content, not a fake empty chat.
			// Its entire notice and action scroll together at enlarged text sizes;
			// the pinned composer cannot paint over required recovery guidance.
			<ScrollView
				className="flex-1 min-h-0"
				contentContainerStyle={{ flexGrow: 1 }}
			>
				{transcriptNotice}
			</ScrollView>
		) : runtime.content === "loading" ? (
			// Loading is a skeleton, never a spinner over a blank column: the three bars
			// reserve the shape the transcript will take. `flex-1` is load-bearing and not
			// cosmetic (design round D18): the transcript branch is a `FlatList`, which
			// fills the column, and a plain wrapper let the column's surplus land BELOW the
			// loading bars — measured at 200 % text, the composer's content ended 39 % of
			// the way down the screen here against 99 % in `empty`/`populated`. A composer
			// floating mid-screen is the first thing a reader notices.
			runtime.connection.id === null ? (
				<View className="flex-1 px-4 pt-3">
					<Skeleton lines={3} testID={SURFACE.sessionLoading} />
				</View>
			) : (
				<ScrollView
					className="flex-1 min-h-0"
					contentContainerStyle={{ flexGrow: 1 }}
				>
					<View className="px-4 pt-3">
						<Skeleton lines={3} testID={SURFACE.sessionLoading} />
					</View>
					{transcriptNotice}
				</ScrollView>
			)
		) : (
			/* The rail overlays the transcript's own area — its `flex-1` wrapper
			 *  is what bounds the column to the transcript (the parent spans the
			 *  panels and composer too), and the rail itself is ABSOLUTE, so it
			 *  takes no layout width from the rows (the defect the web client's
			 *  two-pane rail once was). */
			<View
				className="flex-1 min-h-0"
				// Keep the list mounted (and its historical offset), but do not show a 17 pt
				// message sliver above an ask. The decision owns this short window (D22).
				// During recovery the one notice is in PendingCard's existing body,
				// so this list can yield in every orientation without hiding recovery.
				style={
					collapsePendingTranscript(
						compact || pendingRecovery,
						pendingViewProps !== null,
						pendingRecovery ? null : runtime.connection.id,
					)
						? { height: 0, flex: 0, overflow: "hidden" }
						: undefined
				}
			>
				<TranscriptList
					testID={SURFACE.sessionTranscript}
					sessionId={sessionId}
					entries={runtime.entries}
					footer={transcriptNotice}
					streamingRowId={runtime.streamingRowId}
					loadImage={runtime.loadImage}
					onOpenAgent={openAgent}
					supplements={runtime.supplements}
					projectionPid={runtime.projectionPid}
					supplementClient={supplementClient}
					onOpenVideo={openVideo}
					/* The image-gen card's Cancel is the composer's OWN stop path (the
					   one turn-interrupt — no second mechanism). The gate is the
					   composer's own (`stopVisible` = a turn is running), so the two
					   controls cannot diverge about when a cancel is real: while the
					   gate is closed the card hides the control rather than offering
					   a dead one. */
					onCancelTurn={
						composer.controls.stopVisible ? composer.stop : undefined
					}
					anchorId={attentionRecord(runtime.projection)?.anchor_id ?? null}
					onAnchorVisible={setCompletionVisible}
					// The find session's two outputs into the list: the wash on the current
					// hit, and the jump to reveal it (opening a condensed turn on the way
					// when one hides it).
					highlightId={find.activeHit?.id ?? null}
					reveal={find.reveal}
					empty={
						<EmptyState
							headline="Nothing here yet."
							next="Send the first message below."
							testID={SURFACE.sessionTranscriptEmpty}
						/>
					}
				/>
				<CheckpointRail
					manifest={checkpoints.manifest}
					readFailed={checkpoints.readFailed}
					loadedIds={loadedIds}
				/>
			</View>
		);

	/* The status strip: every number the reader needs while reading, in one
			    band. Only rendered when the wire reports something — a strip that showed
			    `—` for unknown would be a row of noise on every session. `min-h-11` is
			    the chip's own touch floor, so moving the chip in here costs no target
			    size and the band is one row instead of two.

			    deferred — the chip's own breathing room (design round 2 D15): the chip is
			    44 pt in a 44 pt band, so its edges touch the header and the hairline.
			    Padding the band costs 8 pt of a phone's height at exactly the moment the
			    composer is being pushed off a 568 pt screen (D11), and a 36 pt visual pill
			    inside a 44 pt target changes `Chip`'s shape for every chip in the app — a
			    kit decision, recorded here for the kit rather than taken in this screen. */
	/* COMPACT: the context read and the cost stay (they are information, not a
	 *  control), on a one-line band; the subagents CHIP is dropped because the roster
	 *  panel directly below carries the same lever and the same counts in its own
	 *  header, so nothing becomes unreachable — it is one control, not two. */
	const showChip = !compact && subagents.total > 0;
	/* The compact tray's facts, taken from the SAME projections the panels read:
	 *  a row that counted its own way would be able to disagree with the sheet it
	 *  opens. `null` means "nothing to say", never zero. */
	const trayFacts: StatusTrayFacts = {
		working: working === null ? null : working.activity,
		tasks: todos.empty
			? null
			: { open: todos.total - todos.done, total: todos.total },
		agents:
			subagents.total > 0
				? { running: subagents.running, total: subagents.total }
				: null,
		context:
			projection?.context_tokens != null && projection?.context_window != null
				? `${Math.round((projection.context_tokens / projection.context_window) * 100)}${viewportWidth < 340 ? "% ctx" : "% context"}${projection.context_is_estimate === true ? " (est.)" : ""}`
				: null,
	};

	const statusStrip =
		hasStatus && (!compact || projection?.context_tokens != null) ? (
			<View
				className={
					compact
						? "min-h-8 flex-row flex-wrap items-center gap-2 border-b border-hairline px-4 py-1"
						: "min-h-11 flex-row flex-wrap items-center gap-2 border-b border-hairline px-4"
				}
			>
				{projection?.context_tokens != null &&
				projection?.context_window != null ? (
					<>
						<Text
							className="text-mono-sm text-ink-dim"
							testID={SURFACE.sessionContext}
						>
							{Math.round(
								(projection.context_tokens / projection.context_window) * 100,
							)}
							{/* `ctx` under 340 pt: `21% context (est.)` beside the cost and the
						    subagents chip wraps to two lines inside the band, and the cost
						    then floats between them (design round 2, D17). The abbreviation
						    is the standard one and loses nothing; above 340 pt the word
						    stays whole. */}
							{viewportWidth < 340 ? "% ctx" : "% context"}
							{projection.context_is_estimate === true ? " (est.)" : ""}
						</Text>
						{projection.cumulative_parent_cost != null ? (
							<Text className="text-mono-sm text-ink-dim">
								${projection.cumulative_parent_cost.toFixed(2)}
							</Text>
						) : null}
					</>
				) : null}
				<View className="flex-1" />
				{showChip ? (
					<Chip
						// Names the unit it counts, in the panel's own words, so the chip
						// and the panel header cannot disagree: "1/6 agents" read as a
						// fraction of something the reader could not see.
						label={`${subagents.running} of ${subagents.total} running`}
						onPress={() =>
							setOpenPanel(openPanel === "subagents" ? null : "subagents")
						}
						accessibilityHint="Show the subagents"
						// The panel lever. Its id is the contract's
						// (`CONTROL.sessionSubagents`), like every other anchor on this
						// screen: the drill-down flow addresses them by name, so a name
						// that lives in the contract cannot drift from the flow.
						testID={CONTROL.sessionSubagents}
					/>
				) : null}
			</View>
		) : null;

	/* THE SECONDARY REGION, derived once. Order is urgency-first in compact (a roster
	 *  with a failed or parked child leads). Heights come from `onLayout`, so the closed
	 *  cap lands BETWEEN rows (`snapRegion`); while a panel is open the cap is lifted to
	 *  `COMPACT_OPEN_PANEL_SHARE` so the opened rows are actually on screen — the
	 *  transcript yields because the reader chose the panel, and closing it restores the
	 *  reading. The cap is a share of the window and falls with text size
	 *  (`compactChromeShare`), because the fixed chrome grows with it. */
	const regionNodes: Record<RegionKey, React.ReactNode> = {
		working: workingLineView,
		subagents: subagentsPanel,
		todos: todosPanel,
		strip: compact ? statusStrip : null,
	};
	/* Compact: the tray is the whole of the secondary status, so the clipped stack
	 *  (and the cue that explained the cut) is not rendered at all. Wide keeps the
	 *  inline panels — a tablet column has the room, and a reader there can see the
	 *  list and the roster at once. */
	const regionItems = !inlineSecondary
		? []
		: regionOrder(compact, rosterNeedsAttention(subagents.clauses))
				.map((key) => ({ key, node: regionNodes[key] }))
				.filter((item) => item.node !== null);
	const panelOpen = openPanel !== null;
	const regionCap = compact
		? Math.round(
				viewportHeight *
					(panelOpen
						? COMPACT_OPEN_PANEL_SHARE
						: compactChromeShare(effectiveScale)),
			)
		: 0;
	const regionSnap = compact
		? snapRegion(
				regionItems.map((item) => regionHeights[item.key] ?? 0),
				regionCap,
				// The cue is a meta-size line that grows with the reader's text (measured 37.6 pt
				// at 200 %), so its reserve scales: 19 pt per unit of scale.
				panelOpen ? 0 : cueReserve,
			)
		: { height: 0, hidden: 0 };
	// Wide: pinned to its content (`flexGrow/flexShrink: 0`) so the always-rendered
	// ScrollView stays exactly the plain siblings this column has always been; the
	// web default (`flexShrink: 1`) would let it shrink below its content.
	/* Content taller than the region's cap, by the measured row heights: true both
	 *  when the closed cut hides whole rows and when an opened panel is taller than the
	 *  lifted cap. */
	const regionContent = regionItems.reduce(
		(sum, item) => sum + (regionHeights[item.key] ?? 0),
		0,
	);
	const regionOverflows =
		compact &&
		// A region snapRegion dropped (too short for a line plus its cue) has no cue either.
		(panelOpen || regionSnap.height > 0) &&
		regionContent > (panelOpen ? regionCap : regionSnap.height) + 1;
	/* What the closed cut hides, by name. The shown rows are the longest prefix whose
	 *  measured heights fit `regionSnap.height`. */
	const REGION_LABEL: Record<RegionKey, string> = {
		working: "activity",
		subagents: "agents",
		todos: "tasks",
		strip: "status",
	};
	const hiddenRegionLabels = (() => {
		if (!compact || panelOpen) return [];
		let used = 0;
		const hidden: string[] = [];
		for (const item of regionItems) {
			const h = regionHeights[item.key] ?? 0;
			if (hidden.length === 0 && used + h <= regionSnap.height + 1) used += h;
			else hidden.push(REGION_LABEL[item.key]);
		}
		return hidden;
	})();
	const regionStyle = compact
		? {
				// Before the first measure every height is 0 and snapRegion reports height 0
				// with nothing hidden: the region must stay laid out then (`|| regionCap`) or
				// it would never measure its rows and never appear.
				maxHeight: panelOpen ? regionCap : regionSnap.height || regionCap,
				// Hidden ONLY when rows are measured and the cap cannot hold a readable line
				// (snapRegion: height 0 with rows hidden). The scroller is kept in the tree so
				// rotating or a keyboard going away does not unmount the panels.
				// ALSO hidden while a pending approval/ask owns the screen (UX U12): the card,
				// the composer and the header already fill a 390 pt window, so flex shrank the
				// region to a 17 pt strip cut through the middle of its text, with no cue and no
				// conversation above it. A whole region or none: the roster comes back the moment
				// the decision is made, and the header's roster lever is still there.
				display: ((!panelOpen &&
					regionSnap.height === 0 &&
					regionSnap.hidden > 0) ||
				pendingViewProps !== null
					? "none"
					: "flex") as "none" | "flex",
			}
		: ({
				flexGrow: 0,
				flexShrink: 0,
				/* A portrait phone shows the tray instead, so the old stack keeps its place in
				 *  the tree (rotation must not remount the panels) but is not painted. */
				...(inlineSecondary ? {} : { display: "none" as const }),
			} as const);

	/* Opening a panel scrolls the region to that panel's header, so the rows the
	 *  reader asked for are the thing on screen — before this, the roster opened below
	 *  the fold and the only change was the caret glyph (design D1, UX U2). */
	// biome-ignore lint/correctness/useExhaustiveDependencies: a change of panel or mode is the trigger
	useEffect(() => {
		setRegionAtBottom(false);
	}, [compact, openPanel]);

	useEffect(() => {
		if (!compact || openPanel === null) return;
		const key: RegionKey = openPanel === "todos" ? "todos" : "subagents";
		const at = regionLayout.current[key];
		if (at !== undefined)
			regionRef.current?.scrollTo({ y: Math.max(0, at.y), animated: false });
	}, [compact, openPanel]);

	return (
		<Screen
			title={headerTitle}
			compact={compact}
			// The transcript owns its own scrolling, so the screen must not add a
			// second scroller around it.
			scroll={false}
			testID={SCREEN.session}
			headerLeading={
				<View className="flex-row items-center gap-1">
					<IconButton
						accessibilityLabel="Back to sessions"
						testID={CONTROL.sessionBack}
						onPress={() => router.back()}
						icon={({ color, size }) => <ArrowLeft color={color} size={size} />}
					/>
					<NavigationMark />
				</View>
			}
			/* The title block is a CONTROL inside the h1: the conversation name
			 *  plus the status dot (and, when not live, the state word), a tap on
			 *  which opens the health sheet. Before the first frame `health` is
			 *  null and the title renders bare. The action cluster goes through
			 *  `headerAction` like every other screen's, so a tag line under the
			 *  title cannot pull it into the title column (review M2), and stacked
			 *  it sits on the back row rather than a third one (QA Q2, design D8). */
			titleNode={
				<SessionHealthControl
					health={health}
					projection={projection}
					title={headerTitle}
					compact={compact}
					stacked={headerStacked}
					sheetOpen={healthSheetOpen}
					onSheetOpenChange={setHealthSheetOpen}
					controlRef={healthControlRef}
				>
					{ended ? <ResumeBlock resume={resume} /> : null}
				</SessionHealthControl>
			}
			stackedActionsBeside
			headerAction={
				<SessionHeaderActions
					ended={ended}
					menuOpen={sessionMenuOpen}
					onMenuOpenChange={setSessionMenuOpen}
					resumeBusy={resume.busy}
					resumeGone={resume.gone}
					onResume={() => {
						setSessionMenuOpen(false);
						setHealthSheetOpen(true);
						void resume.resume();
					}}
					findAction={
						/* The find lever. It is the kit's own header control (`IconButton`) —
						   48 pt on the web/audit build, 44 on iOS — and it IS header chrome:
						   `header.ts` counts it and its gap in the title budget. */
						<IconButton
							accessibilityLabel="Search this conversation"
							accessibilityHint="Finds messages in the transcript loaded on this device"
							size={22}
							testID={CONTROL.sessionFind}
							onPress={find.open}
							icon={({ color, size }) => <Search color={color} size={size} />}
						/>
					}
				/>
			}
			/* The conversation's tags, in the header's own column. The line is a
			 *  disclosure on a LOCAL conversation whose relay advertises the routes
			 *  (review round 1, U1): the tags are already the subject, so the line is
			 *  the control that opens their sheet. A remote row (or an older relay)
			 *  keeps it read-only. The LIST frame carries the pair on every relay that
			 *  has the field; an older relay defaults to `[]`, which paints no line.
			 *
			 *  The disclosure is present even when the assignment is EMPTY (review
			 *  round 2, U8): gating the whole line on `tags.length` left an untagged
			 *  local conversation with no visible route at all, and the long-press
			 *  menu is not a route a reader can see. A read-only line keeps the old
			 *  rule — badges with no assignment are a blank gap, not a fact. */
			headerDetail={
				tagsAssignable || (listRow?.tags?.length ?? 0) > 0 ? (
					<SessionTagLine
						tags={listRow?.tags ?? []}
						testID={sessionHeaderTagLineId(sessionId)}
						onPress={tagsAssignable ? () => setTagsOpen(true) : undefined}
						actionTestID={CONTROL.sessionHeaderTagsAction}
						accessibilityHint="Shows the tag choices for this conversation"
					/>
				) : undefined
			}
		>
			<SessionStateMarkers facts={stateFacts} />
			<HealthAnnouncer health={health} />
			{/* The find states, asserted by the capture cells that declare them
			    (`S5/find-results`, `S5/find-empty`, `S5/find-hit`, `S5/find-caveat`):
			    each marker is present ONLY in the state it names, so a frame that
			    stops showing one fails that cell by name. */}
			<FindStateMarkers
				sheetOpen={find.sheetOpen}
				settled={find.query.trim().length > 0}
				hits={find.hits.length}
				soft={find.hits.some((hit) => hit.tier === "soft")}
				barVisible={find.barVisible}
				caveat={runtime.olderThanLoaded}
			/>
			{tray ? (
				/* Short landscape: a pending decision owns the column, so the tray's 48 pt
				 *  row yields (`statusTrayVisible`) — otherwise the pinned Approve/Deny sit
				 *  under the composer at 135-200 % text. */
				statusTrayVisible(tray, compact, pendingViewProps !== null) ? (
					<StatusTray
						facts={trayFacts}
						onOpen={() => setStatusSheetOpen(true)}
					/>
				) : null
			) : (
				statusStrip
			)}

			{/* The transcript, the panels and the composer, in one measure-capped
			    column. `Screen` applies the cap (`src/ui/column.ts`): a 1366 pt tablet
			    showing a paragraph 1366 px wide is unreadable, and the fix is a
			    constrained measure rather than a stretched one. The panels therefore
			    STACK inside the measure instead of taking a rail beside it — at 640 pt
			    a rail would leave ~280 pt of transcript, which is the squeezed column
			    the cap exists to prevent. */}
			<View className="flex-1 min-h-0">
				<View
					className="flex-1 min-h-0"
					/* Short landscape: a pending decision collapses the transcript and hides the
					 * secondary region, so the column's remaining children no longer fill it.
					 * Anchor that cluster to the BOTTOM rather than letting the slack fall
					 * below the composer: otherwise the composer jumps up when a decision
					 * arrives and drops back after it is answered (the floating-composer
					 * defect design D18 fixed for the loading state). Portrait and tablet
					 * keep the normal column flow. */
					style={
						compact && pendingViewProps !== null
							? { justifyContent: "flex-end" as const }
							: undefined
					}
					testID={SURFACE.sessionColumn}
					onLayout={(event) =>
						measureRecovery("column", event.nativeEvent.layout.height)
					}
				>
					{transcript}
					{/* SECONDARY CHROME. Wide: the panels and the working line are plain
					    siblings, exactly the column this screen has always had. Short
					    landscape: the SAME children go into ONE scroller — the status strip,
					    the roster and the tasks panel, the working line — cut on a ROW
					    boundary (never through a line of text) with a `+N more` cue when
					    something is below, ordered urgent-first, and lifted while a panel is
					    open so the reader sees what they opened. This is the only scroller in
					    the region (the panels' bodies stop scrolling themselves in compact),
					    so a thumb never has to pick between two. The ScrollView is rendered
					    in BOTH modes with only its style and `scrollEnabled` changing, so
					    rotating does not unmount the panels or the composer below. */}
					<ScrollView
						ref={regionRef}
						style={regionStyle}
						scrollEnabled={compact}
						scrollEventThrottle={64}
						onScroll={(event) => {
							const { contentOffset, contentSize, layoutMeasurement } =
								event.nativeEvent;
							regionScrollRef.current = {
								y: contentOffset.y,
								viewport: layoutMeasurement.height,
							};
							setRegionAtBottom(
								contentOffset.y + layoutMeasurement.height >=
									contentSize.height - 2,
							);
						}}
						onContentSizeChange={(_width, height) => {
							const { y, viewport } = regionScrollRef.current;
							setRegionAtBottom(viewport > 0 && y + viewport >= height - 2);
						}}
						nestedScrollEnabled
						testID={compact ? SURFACE.sessionSecondaryChrome : undefined}
					>
						{regionItems.map(({ key, node }) => (
							<View
								key={key}
								onLayout={(event) => {
									const { y, height } = event.nativeEvent.layout;
									/* A row laid out inside a `display: none` region reports 0. Taking
									 *  that as its height would flip the region back on, re-measure it
									 *  and hide it again: a loop. The last real measurement stands. */
									if (height <= 0) return;
									regionLayout.current[key] = { y, h: height };
									setRegionHeights((prev) =>
										prev[key] === Math.round(height)
											? prev
											: { ...prev, [key]: Math.round(height) },
									);
								}}
							>
								{node}
							</View>
						))}
					</ScrollView>
					{/* THE CUE, honest about what it is. It is not a tally (`hidden` counts the
					    region's ROWS, which a reader cannot map to "agents": a number read as
					    a miscount) — it NAMES what the cut hides ("tasks · status below"),
					    because with the working line, context/cost and Tasks all behind it a
					    bare "more below" told a reader nothing about whether to scroll (UX U5).
					    A hairline above it separates it from a row the cut stops beside (design
					    D3). The slot is PERMANENT while the region overflows and only its text changes
					    at the end ("end · scroll ↑"): a cue that appeared and disappeared changed how
					    much room the flex column gave the region, so the end moved as the reader
					    reached it and the cue oscillated (max scroll 572 → 611). A constant slot
					    needs no tolerance, so the true last row is always reachable. While a panel is
					    open the cap may land inside an opened row, and the cue is then the
					    truthful signal that the cut is not the end. */}
					{compact && regionOverflows && pendingViewProps === null ? (
						<Text
							className="border-t border-hairline px-4 pt-1 text-meta text-ink-dim"
							testID={SURFACE.sessionSecondaryMore}
						>
							{regionAtBottom
								? "end · scroll ↑"
								: hiddenRegionLabels.length > 0
									? `${hiddenRegionLabels.join(" · ")} below · scroll ↓`
									: "more below · scroll ↓"}
						</Text>
					) : null}
					{/* A way to CLOSE the open panel that is always on screen (UX U4). The panel's own
					    header scrolls out of the region with its rows, and with it the only toggle.
					    The bar is a CONSTANT slot while a panel is open, not one that appears once the
					    header has scrolled away: appearing took its 48 pt from the region, so the end
					    of the scroll moved by 48 as the reader reached it and the "end" was never
					    reached (measured gap 48.5 at the supposed end). A bar that is always there
					    costs the same 48 pt but keeps the geometry still. */}
					{compact && openPanel !== null ? (
						<Pressable
							accessibilityRole={ROLE.button}
							accessibilityLabel={`Close ${openPanel === "todos" ? "tasks" : "subagents"}`}
							onPress={() => setOpenPanel(null)}
							testID={CONTROL.sessionPanelClose}
						>
							<View className="min-h-12 justify-center border-t border-hairline px-4">
								<Text className="text-meta text-ink-muted">
									{`Close ${openPanel === "todos" ? "tasks" : "subagents"} ▴`}
								</Text>
							</View>
						</Pressable>
					) : null}
					{/* The find navigate bar. It sits directly above the composer's stack
					    (thumb reach, U-31) and BELOW the panels — and above the pending
					    card, which must stay adjacent to the control that answers it. */}
					{find.barVisible ? (
						<FindBar
							active={find.active}
							count={find.hits.length}
							onEdit={find.reopen}
							onStep={find.step}
							onExit={find.exit}
						/>
					) : null}
					{pendingViewProps !== null ? (
						<View
							className="px-4 pb-1"
							// shrinkable in compact so the card can yield to the composer below
							style={
								compact || pendingRecovery
									? { flexShrink: 1, minHeight: 0 }
									: undefined
							}
							onLayout={(event) => {
								measureRecovery("before", event.nativeEvent.layout.y);
								setPendingAvailableHeight(
									Math.max(0, event.nativeEvent.layout.height - 4),
								);
							}}
						>
							<PendingCard
								view={pendingViewProps}
								maxHeight={
									pendingRecovery
										? recoveryAllocation.card
										: compact
											? pendingAvailableHeight
											: undefined
								}
								bodyNotice={pendingRecovery ? connectionBanner : null}
								onPinnedLayout={(region, height) =>
									measureRecovery(region, height)
								}
								bodyMaxHeight={
									pendingRecovery
										? recoveryAllocation.body
										: compact
											? Math.max(
													72,
													Math.round(viewportHeight * COMPACT_PENDING_SHARE),
												)
											: undefined
								}
								busy={composer.sending}
								error={composer.error}
								onApprove={(remember) =>
									composer.answerApproval(
										pendingViewProps.requestId,
										true,
										remember,
									)
								}
								onDeny={(remember) =>
									composer.answerApproval(
										pendingViewProps.requestId,
										false,
										remember,
									)
								}
								onAnswer={(value) =>
									composer.answerAsk(
										pendingViewProps.requestId,
										value,
										projection?.pending?.question_index ?? 0,
									)
								}
							/>
						</View>
					) : null}
					{/* The banner and the composer live INSIDE the measure, not across the
					    full width: on a tablet a composer 1366 pt wide sits under a 720 pt
					    transcript and reads as a different surface (QA round 2, Q10). On a
					    phone the measure is the screen, so nothing moves. */}
					{/* The notice now occupies the transcript's permanent scroll footer,
					    not scarce fixed chrome. Keep this empty sibling slot: Composer,
					    FindBar, PendingCard and AskBar never change parents/positions on
					    expiry. Reparenting TextInput would discard native IME state. */}
					<View />

					{/* The ask bar: the MINIMIZED affordance (§5.0), directly above the
					    composer and BELOW the connection banner — when the relay is
					    unreachable the bar's data is stale and saying so matters more.
					    It renders itself away at zero outstanding, so its presence is
					    the statement. */}
					<View
						className="px-4 pb-1"
						onLayout={(event) =>
							measureRecovery("after", event.nativeEvent.layout.height)
						}
					>
						<AskBar
							asks={projection?.asks}
							onOpen={asksSheet.open}
							barRef={asksSheet.barRef}
						/>
					</View>

					<Composer
						onLayout={(event) =>
							measureRecovery("composer", event.nativeEvent.layout.height)
						}
						limit={composerLimit(
							viewportHeight,
							composerBox?.top ?? null,
							composerBox?.height ?? null,
						)}
						onMeasure={setComposerBox}
						measureKey={`${find.barVisible}|${openPanel}|${statusSheetOpen}|${pendingViewProps ? "pending" : ""}|${compact ? "compact" : "tall"}`}
						compact={
							compact
								? {
										maxHeight: Math.round(
											viewportHeight * COMPACT_COMPOSER_SHARE,
										),
									}
								: null
						}
						testID={SURFACE.sessionComposer}
						controls={composer.controls}
						draft={composer.draft}
						onDraftChange={composer.setDraft}
						images={composer.images}
						onRemoveImage={composer.removeImage}
						onAttach={composer.attach}
						onPasteFile={composer.pasteFile}
						attaching={composer.attaching}
						voice={composer.voice}
						onSend={composer.send}
						onStop={composer.stop}
						retainedMessage={
							composer.retained !== null ? COMPOSER_RETAINED : null
						}
						notice={composer.notice}
						onRetry={composer.retry}
						showResume={aborted}
						onResume={composer.send}
						ended={ended}
						error={pending === null ? composer.error : null}
						queuedCount={projection?.queued_count ?? 0}
						modelChip={chipLabels.model}
						effortChip={chipLabels.effort}
						onOpenModels={() => setModelsOpen(true)}
						onOpenEffort={() => setEffortOpen(true)}
						fieldRef={composerFieldRef}
						slashQuery={slash}
						slashSheet={
							<SlashSheet
								visible={slash !== null}
								onClose={() => undefined}
								commands={runtime.commands}
								query={slash ?? ""}
								busy={composer.sending}
								onPick={composer.slash}
							/>
						}
					/>
				</View>
			</View>

			{/* One row in the column, the same panels one tap away. The panels keep
			    their own testIDs and their own content; only the clip is gone, because
			    inside a sheet the list can be as tall as it is. */}
			<Sheet
				visible={statusSheetOpen}
				onClose={() => setStatusSheetOpen(false)}
				title="status"
				testID={SURFACE.sessionStatusSheet}
			>
				<View className="gap-2 pb-2">
					{workingLineView}
					{subagents.total > 0 ? subagentsPanel : null}
					{todos.empty ? null : todosPanel}
					{projection?.context_tokens != null ? (
						<Text className="px-4 text-mono-sm text-ink-dim">
							{trayFacts.context}
							{projection.cumulative_parent_cost != null
								? ` · $${projection.cumulative_parent_cost.toFixed(2)}`
								: ""}
						</Text>
					) : null}
				</View>
			</Sheet>

			<ModelSheet
				visible={modelsOpen}
				onClose={() => setModelsOpen(false)}
				models={runtime.models}
				selected={projection?.model_selector ?? ""}
				onPick={(model) => {
					void runtime.source.endpoints?.command(sessionId, {
						op: "set_model",
						provider: model.provider,
						model_id: model.model_id,
					});
				}}
			/>

			<EffortSheet
				visible={effortOpen && effortLadder.length > 0}
				onClose={() => setEffortOpen(false)}
				ladder={effortLadder}
				selected={projection?.effort ?? ""}
				onPick={(effort) => {
					void runtime.source.endpoints?.command(sessionId, {
						op: "set_effort",
						effort,
					});
				}}
			/>

			<FindSheet
				visible={find.sheetOpen}
				onClose={find.closeSheet}
				query={find.query}
				onQueryChange={find.setQuery}
				hits={find.hits}
				truncated={find.truncated}
				active={find.active}
				onActivate={find.activate}
				messages={find.messages}
				older={runtime.olderThanLoaded}
			/>

			{/* The header's disclosure target: the SAME sheet the list row's menu
			    opens, fed by the same list frame. One write path. */}
			<SessionTagsSheet
				visible={tagsOpen}
				sessionId={sessionId}
				tags={listRow?.tags ?? []}
				primary={listRow?.primary ?? null}
				onClose={() => setTagsOpen(false)}
			/>

			{/* The walked queue (§5.3): the aggregate route, so a sitting can clear
			    asks from several conversations. Names come from the list frame;
			    its own rows carry `session_id` + `cwd` for the foreign ones. */}
			<AsksSheet
				visible={asksOpen}
				onClose={asksSheet.close}
				initialOpenAsk={asksSheet.initialOpenAsk}
				seedRows={asksSheet.seedRows}
				onReadFailed={asksSheet.readFailed}
				client={runtime.source.endpoints}
				currentSessionId={sessionId}
				sessions={listSessions}
				onOpenConversation={(target, askIds) => {
					asksSheet.leave(target, askIds);
					router.push(`/session/${target}`);
				}}
			/>
		</Screen>
	);
}

/**
/** The composer's own sentence for a retained instruction, kept beside the screen
 *  rather than in `composer.ts` because it is passed in as a prop. */
const COMPOSER_RETAINED =
	"An earlier instruction may have been delivered. Retry that earlier instruction before sending your current draft.";
