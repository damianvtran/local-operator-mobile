import { useRouter } from "expo-router";
import { Bell, BellDot, Menu, Settings } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { Pressable, Text, View } from "react-native";

import type { ModelEntry, PromptImage } from "@/contracts";
import { HeaderComputerChip } from "@/features/auth/computer-entry-points";
import {
	useConnection,
	useConnectionState,
	useListState,
} from "@/features/auth/connection-provider";
import {
	headerBellShowsCount,
	headerBellShowsDot,
} from "@/features/home/header-fit";
import {
	CONNECT_DISABLED_REASON,
	FOLDERS_READ_FAILED,
	REFUSED_START_FALLBACK,
	startupQueueState,
} from "@/features/home/home-copy";
import { HomeStateMarkers } from "@/features/home/home-markers";
import { HomeSplash } from "@/features/home/home-splash";
import { StartupTranscript } from "@/features/new-session/startup-transcript";
import { useStartup } from "@/features/new-session/use-startup";
import {
	countLabel,
	notificationsEnabled,
} from "@/features/notifications/notifications-model";
import {
	pasteImage,
	pickImageFromFiles,
	pickImageFromLibrary,
	readWebImageFile,
} from "@/features/session/attach";
import type { AttachSource } from "@/features/session/attach-rule";
import { composerChipLabels } from "@/features/session/chip-labels";
import { Composer } from "@/features/session/components/composer";
import { ConnectionBanner } from "@/features/session/components/connection-banner";
import type { ComposerControls } from "@/features/session/composer";
import { COMPOSER_COPY } from "@/features/session/composer";
import { connectionView } from "@/features/session/connection-view";
import { deviceOnline } from "@/features/session/runtime";
import { ConversationsDrawer } from "@/features/sessions/conversations-drawer";
import { ConversationsPane } from "@/features/sessions/conversations-pane";
import {
	inboxBadgeCount,
	unreadBadgeCount,
} from "@/features/sessions/session-projection";
import { homeShortened } from "@/lib/format";
import { listLabel } from "@/lib/route-label";
import { RelayError } from "@/relay";
import { useUiStore } from "@/state/ui-store";
import { CONTROL, ROLE, SCREEN, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { ReadableColumn, SplitView } from "@/ui/components/adaptive";
import { Alert } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Banner } from "@/ui/components/banner";
import { Button } from "@/ui/components/button";
import { Chip } from "@/ui/components/chip";
import { IconButton } from "@/ui/components/icon-button";
import { Input } from "@/ui/components/input";
import { NavigationMark } from "@/ui/components/navigation-mark";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { Sheet } from "@/ui/components/sheet";
import { TOUCH_FLOOR, useLayout } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";

/**
 * The composer home: `/` since the Part 2 slice, and the default destination
 * ADR 0006 § 6 records ("a new-chat composer, with conversations behind a
 * sidebar").
 *
 * What the screen is, in one sentence: a prompt field for a session that does
 * not exist yet, plus the two things a reader needs before pressing send —
 * where it will run (the folder chip) and with what (the model chip) — and the
 * conversations panel one tap away.
 *
 * The rules that carry it, each from the spec or the ADR:
 *
 *  - **The first send creates the session and delivers its first message**, in
 *    `/new`'s own order (`startSession` then a `prompt` command): the message
 *    is a second call precisely so a failed one never loses the session, and
 *    the home's draft is cleared ONLY when the text was genuinely delivered
 *    ("never both", P-4) — a failed start keeps the draft and says why.
 *  - **Navigation is a push** (`router.push`), so the back affordance returns
 *    to the composer home (the spec's § 5 contract; the § 3.5 table's
 *    `replace` predates it).
 *  - **The composer never moves.** It is the bottom sibling of the splash
 *    region; everything the splash gives up (the yield order) happens above it.
 *  - **The home persists its own draft** under `HOME_DRAFT_KEY`, the same
 *    lifetime rule as a session's (`device-storage.ts`).
 *  - **The panel is the temporary drawer on a phone and a docked pane on a
 *    tablet** (Material's own rule), and both render the SAME pane component.
 *
 * The cold-start bounce lives here because `/` is the landing: with no route
 * and no credentials the reader belongs on the welcome surface, not on a
 * composer that can never send (the old list's D3 lesson, moved verbatim).
 */
export type HomeProps = {
	newSession?: boolean;
	/** `/conversations` renders the home with the panel open — the programmatic
	 *  open ADR 0006 § 6.6 needs (a deep link the computer does not know lands on
	 *  the panel with one honest sentence). On a docked layout the list is always
	 *  visible and the flag is a no-op. */
	forcePanelOpen?: boolean;
	/** The one honest sentence, rendered by the pane (`SURFACE.sidebarNotice`). */
	notice?: string | null;
};

/** The bell glyph inside the header's composite notifications control. Its ink is
 *  the icon-only control's own role (`ink-muted`), read from the theme rather than
 *  inherited, because an SVG takes colour as a prop. */
function BellIcon({ waiting = false }: { waiting?: boolean }) {
	const color = useTokenColor("ink-muted");
	/* SHAPE, NOT COLOUR. Where the count pill yields (D24) a waiting inbox is
	 *  signalled by the icon set's own bell-with-dot, in the control's normal ink:
	 *  no separate painted node and no semantic colour, so the audit's U-03 rule
	 *  (status carried by colour alone) has nothing to flag — the previous 6 pt
	 *  dot was exactly that and failed 96 of 1212 cells. Size and ink are the
	 *  plain bell's, so it also scales with the type step like every other glyph. */
	const Glyph = waiting ? BellDot : Bell;
	return <Glyph color={color} size={20} />;
}

export default function Home({
	forcePanelOpen = false,
	newSession = false,
	notice = null,
}: HomeProps) {
	const router = useRouter();
	const layout = useLayout();
	const split = layout.split;

	const {
		relay,
		refusal,
		retry,
		busy,
		coldStartSettled,
		savedTunnel,
		restoredAccount,
	} = useConnection();
	const computers = useConnectionState((state) => state.computers);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const route = useConnectionState((state) => state.route);
	const phase = useConnectionState((state) => state.phase);
	const unread = useListState((state) => state.unread);
	const inbox = useListState((state) => state.notifications);
	const inboxEnabled = notificationsEnabled(
		useListState((state) => state.capabilities),
	);
	const showToast = useUiStore((state) => state.showToast);

	const [panelOpen, setPanelOpen] = useState(forcePanelOpen);
	const [optionsOpen, setOptionsOpen] = useState(false);
	const [queueOpen, setQueueOpen] = useState(false);
	const [optionPath, setOptionPath] = useState("");
	const [optionModel, setOptionModel] = useState<ModelEntry | null>(null);
	const [running, setRunning] = useState(false);
	const [models, setModels] = useState<ModelEntry[]>([]);
	const [attaching, setAttaching] = useState(false);
	const [composerError, setComposerError] = useState<string | null>(null);
	const [homeDirectory, setHomeDirectory] = useState<string | null>(null);
	const [directoriesFailed, setDirectoriesFailed] = useState(false);
	const [directoriesAttempt, setDirectoriesAttempt] = useState(0);
	const [topModel, setTopModel] = useState<ModelEntry | null>(null);
	const [modelsLoaded, setModelsLoaded] = useState(false);
	const selection = useMemo(
		() =>
			homeDirectory === null || !modelsLoaded
				? null
				: {
						cwd: homeDirectory,
						...(topModel
							? { provider: topModel.provider, model_id: topModel.model_id }
							: {}),
					},
		[homeDirectory, topModel, modelsLoaded],
	);
	const startup = useStartup(selection);
	const draft = startup.snapshot.draft.text;
	const images = startup.snapshot.draft.images;
	const setDraft = startup.setText;
	const setImages = startup.setImages;
	const starting = startup.snapshot.phase === "starting";
	const queueLine = startupQueueState(
		startup.snapshot.phase,
		startup.snapshot.sessionId,
	);
	const { effectiveScale } = useTextScale();
	/* The folder/model/options controls are the reader's while the request is still
	 * theirs to change. A `refused` create never happened, so it belongs in that set
	 * with `draft` — the copy already asks them to check the folder, and QA found the
	 * controls disabled at exactly that moment (a dead end: retry re-posted the same
	 * invalid selection). */
	const selectionEditable =
		startup.snapshot.phase === "draft" || startup.snapshot.phase === "refused";
	const [problem, setProblem] = useState<string | null>(null);
	/** The composer's field, for the New chat affordance: only the home can
	 *  focus it, and only after the drawer is gone. */
	const fieldRef = useRef<TextInput | null>(null);

	const client = relay();
	const routed = route !== null;
	const connected = routed && client !== null;
	const offline = deviceOnline() === false;

	/* The relay's home directory is the target every first send uses, until the
	 * reader goes through `/new` and picks another folder. Read once per client —
	 * and once per retry: a transient read failure must not strand the composer
	 * with no send and no sentence until a remount (review M2), so the failure is
	 * said (`FOLDERS_READ_FAILED`, `/new`'s verbatim line) and cleared only by a
	 * successful read. `directoriesAttempt` is a dependency the exhaustive-deps rule
	 * cannot justify from the body: it is a RE-RUN TRIGGER (the retry), and without
	 * it the failed read would never be re-asked. The model catalogue's FIRST entry
	 * is the default model — the relay's own ranking, never re-sorted (`/new`'s
	 * rule, verbatim). A failure leaves the chip in its loading state's successor:
	 * unavailable, said plainly. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: see the comment above
	useEffect(() => {
		const active = relay();
		if (!active) return;
		let live = true;
		void active
			.directories()
			.then((directories) => {
				if (live) {
					setHomeDirectory(directories.home);
					setDirectoriesFailed(false);
				}
			})
			.catch(() => {
				if (live) setDirectoriesFailed(true);
			});
		void active
			.models()
			.then((catalogue) => {
				if (!live) return;
				setModels(catalogue.models);
				setTopModel(catalogue.models[0] ?? null);
				setModelsLoaded(true);
			})
			.catch(() => {
				if (live) setModelsLoaded(true);
			});
		return () => {
			live = false;
		};
	}, [relay, directoriesAttempt]);

	const retryDirectories = useCallback(() => {
		setDirectoriesAttempt((attempt) => attempt + 1);
	}, []);

	/* A cold start with no route belongs on the welcome surface — the list's own
	 * effect, moved with the landing. Every term is a measured case in the old
	 * screen's comment (store docs + the harness's cells); the refusal clause is
	 * what keeps a revoked credential's surface on the screen that renders it. */
	useEffect(() => {
		if (
			coldStartSettled &&
			!busy &&
			!routed &&
			refusal === null &&
			savedTunnel === null &&
			phase === "signed-out"
		) {
			router.replace(restoredAccount ? "/tunnels" : "/welcome");
		}
	}, [
		busy,
		coldStartSettled,
		phase,
		refusal,
		restoredAccount,
		router,
		routed,
		savedTunnel,
	]);

	/* The header badge reads the machine's own unread count (ADR 0006 §1.4) —
	 * NOT a local count of rows and not `needs_attention`. `null` means the
	 * number is not readable (an older relay omits the block; a degraded one
	 * withholds `count`), and the header then shows no number at all: absence is
	 * never rendered as 0. The conversations pane's degraded banner is the
	 * "says so". */
	const badgeCount = unreadBadgeCount(unread);
	/* The inbox's own number, from the same frame (contract §5.4). Same absence
	 * rule: `null` draws no numeral, never a 0 the machine did not send. */
	const inboxCount = inboxBadgeCount(inbox);

	/* The banner: only the states the product has sentences for. A refusal renders
	 * its own fuller surface below (and nothing here duplicates it); the
	 * device-offline case is `connectionView`'s C4, built through the module that
	 * owns the state vocabulary. The home has no session stream, so the list
	 * stream's health is deliberately NOT passed: a rotation must never flash a
	 * banner over the field the reader is typing into (C1). */
	const bannerView = useMemo(
		() =>
			offline
				? connectionView({
						phase: "live",
						stream: "idle",
						lastEnd: undefined,
						reconnectExpired: false,
						online: false,
						error: null,
						entry: {
							connected: false,
							projection: null,
							awaitingSnapshot: false,
							version: null,
							droppedFrames: 0,
						},
						stale: false,
						ageS: null,
						computerLabel: listLabel(computers, tunnelId, route),
						computerLastSeenS: null,
						phaseDetail: null,
						phaseSurface: null,
						ended: false,
					})
				: null,
		[offline, computers, tunnelId, route],
	);

	const attach = useCallback(
		(source: AttachSource) => {
			void (async () => {
				setAttaching(true);
				setComposerError(null);
				try {
					const image =
						source === "library"
							? await pickImageFromLibrary()
							: source === "paste"
								? await pasteImage()
								: await pickImageFromFiles();
					if (image !== null) {
						setImages((current) => [...current, image]);
					} else if (source === "paste") {
						/* A press with no outcome reads as a broken control — the same rule
						 *  `attachError` follows in the other direction. */
						setComposerError(COMPOSER_COPY.pasteEmpty);
					}
				} catch {
					/* Said, never swallowed — the composer's own error line. */
					setComposerError(COMPOSER_COPY.attachError);
				} finally {
					setAttaching(false);
				}
			})();
		},
		[setImages],
	);

	/** The web paste event's image file: same strip, same failure line as the
	 *  sheet's own rows (`use-composer.ts`'s `pasteFile` is the session view's
	 *  copy of this handler). */
	const pasteFile = useCallback(
		(file: File) => {
			void (async () => {
				setAttaching(true);
				setComposerError(null);
				try {
					const image = await readWebImageFile(file);
					setImages((current) => [...current, image]);
				} catch {
					setComposerError(COMPOSER_COPY.attachError);
				} finally {
					setAttaching(false);
				}
			})();
		},
		[setImages],
	);

	const controls: ComposerControls = useMemo(
		() => ({
			primary: {
				kind: "send",
				/* Same morph as a session's: `…` while a send is in flight, `↑`
				 * otherwise, and the word lives in the accessible label. */
				label: "↑",
				op: "prompt",
				disabled: draft.trim() === "" && images.length === 0,
				accessibilityLabel: starting ? "Queue message" : "Send message",
			},
			stopVisible: running,
			sending: false,
			/* The one sentence the composer says when it cannot send: with nothing
			 * connected there is nothing to send to. An empty draft is disabled for
			 * the self-evident reason and says nothing. */
			disabledReason: connected ? null : CONNECT_DISABLED_REASON,
		}),
		[connected, draft, images.length, starting, running],
	);

	const chips = useMemo(
		() =>
			composerChipLabels({
				model:
					startup.snapshot.selection?.model_id ?? topModel?.selector ?? null,
				effort: null,
				connection: modelsLoaded
					? "connected"
					: connected
						? "loading"
						: "unreachable",
			}),
		[topModel, modelsLoaded, connected, startup.snapshot.selection?.model_id],
	);

	// The coordinator freezes the submitted bytes; later typing stays editable.
	const send = startup.send;

	/* A STABLE identity, with the latest coordinator behind it. The drawer carries the
	 * New-chat intent across the close and acts on it in `onDismiss` — by which time
	 * Home has already re-rendered for `setPanelOpen(false)` — and it drops that
	 * intent whenever this callback's identity changes. An inline closure is a new
	 * function on every render, so closing the drawer cancelled the request: the
	 * sheet went away and the old session (and its coordinator) stayed. `useStartup`
	 * returns fresh functions per render, so the reference is refreshed on each render
	 * and the stable callback always calls the current one. */
	const newConversationRef = useRef(startup.newConversation);
	newConversationRef.current = startup.newConversation;
	const newChat = useCallback(() => {
		setPanelOpen(false);
		void newConversationRef
			.current()
			.then(() => requestAnimationFrame(() => fieldRef.current?.focus()))
			.catch(() => setComposerError("Could not open a new draft safely."));
	}, []);

	const pane = (
		<ConversationsPane
			onClose={split ? undefined : () => setPanelOpen(false)}
			onNavigate={split ? undefined : () => setPanelOpen(false)}
			onNewChat={newChat}
			notice={notice}
			homeDirectory={homeDirectory}
		/>
	);

	const composerColumn = (
		<ReadableColumn
			/* The readable measure: on a phone the SCREEN's cap already owns it (a
			 *  second cap would be margins inside margins), and on a split the cap
			 *  belongs HERE — a composer 1,000 pt wide under a 720 pt transcript reads
			 *  as a different surface (the old list screen's QA Q10, applied to the
			 *  home). `null` leaves it off, `undefined` takes `layout.measure`. */
			measure={split ? undefined : null}
		>
			{refusal !== null ? (
				<View className="px-4">
					<RefusalSurface
						kind={refusal.kind}
						subject={refusal.subject}
						detail={refusal.detail}
						remedy={refusal.remedy}
						retryAfterMs={refusal.retryAfterMs}
						onRetry={() => void retry()}
						onUseAnotherAddress={() => router.push("/custom")}
					/>
				</View>
			) : null}

			{bannerView !== null ? (
				<ConnectionBanner
					view={bannerView}
					onAction={(action) => {
						if (action.kind === "retry") void retry();
						if (action.kind === "sign-in") router.push("/welcome");
						if (action.kind === "console") router.push("/tunnels");
					}}
				/>
			) : null}

			{startup.snapshot.sessionId ? (
				<StartupTranscript
					sessionId={startup.snapshot.sessionId}
					onStreaming={setRunning}
				/>
			) : (
				<HomeSplash
					draft={draft}
					connected={connected}
					onPick={setDraft}
					onConnect={() => router.push("/tunnels")}
					starting={starting}
				/>
			)}
			{/* State only, and only while there is something to say: the count is the
			 *  composer chip's (UX U2), an unconfirmed start is named rather than
			 *  described as "waiting" (UX U1), and the queued sheet stays one tap
			 *  away whenever it holds anything. */}
			{startup.snapshot.queue.length > 0 ||
			startup.snapshot.phase === "unconfirmed" ? (
				<View className="px-4 py-2" testID={SURFACE.startupPending}>
					{queueLine !== null ? (
						<Text
							accessibilityLiveRegion="polite"
							className="text-body-sm text-ink-muted"
						>
							{queueLine}
						</Text>
					) : null}
					{startup.snapshot.queue.length > 0 ? (
						<Button
							label="View queued messages"
							variant="quiet"
							size="sm"
							testID={CONTROL.startupViewQueue}
							onPress={() => setQueueOpen(true)}
						/>
					) : null}
				</View>
			) : null}

			{/* A folders read that failed leaves the composer unsendable; the sentence
			 *  is `/new`'s verbatim line and the retry is the path the failure never
			 *  had (review M2). The banner goes away with the condition — a successful
			 *  re-read clears it — and never over a readable folder. */}
			{directoriesFailed && homeDirectory === null ? (
				<Banner
					tone="warning"
					message={FOLDERS_READ_FAILED}
					action={{
						label: "Retry",
						onPress: retryDirectories,
						testID: CONTROL.homeFoldersRetry,
					}}
					testID={CONTROL.homeFoldersBanner}
				/>
			) : null}

			<View>
				{problem !== null ? (
					<View className="px-4 pb-2">
						<Alert severity="warning" title="Could not start">
							{problem}
						</Alert>
					</View>
				) : null}
				<Composer
					testID={SURFACE.homeComposer}
					controls={controls}
					draft={draft}
					onDraftChange={setDraft}
					images={images}
					onRemoveImage={(index) =>
						setImages((current) => current.filter((_, at) => at !== index))
					}
					onAttach={attach}
					onPasteFile={pasteFile}
					attaching={attaching}
					onSend={send}
					onStop={() => {
						const sid = startup.snapshot.sessionId;
						const active = relay();
						if (sid && active)
							void active
								.command(sid, { op: "abort" })
								.catch(() => setComposerError("Could not stop the turn."));
					}}
					retainedMessage={
						startup.snapshot.phase === "blocked"
							? "Your queued message is retained."
							: null
					}
					notice={null}
					onRetry={startup.retry}
					showResume={false}
					onResume={() => undefined}
					error={startup.snapshot.error ?? composerError}
					queuedCount={startup.snapshot.queue.length}
					leadingChip={
						homeDirectory !== null ? (
							<Chip
								label={homeShortened(
									startup.snapshot.selection?.cwd ?? homeDirectory,
									homeDirectory,
								)}
								onPress={() => {
									setOptionPath(
										startup.snapshot.selection?.cwd ?? homeDirectory ?? "",
									);
									setOptionModel(
										models.find(
											(model) =>
												model.provider ===
													startup.snapshot.selection?.provider &&
												model.model_id === startup.snapshot.selection?.model_id,
										) ?? topModel,
									);
									setOptionsOpen(true);
								}}
								/* The same quiet disclosure the model chip uses: one row of
								 *  disclosures should not mix a filled, bordered chip with flat
								 *  text (final audit, D2). Paint only — the 44 pt target, the
								 *  hint and the options sheet behind it are unchanged. */
								quiet
								accessibilityLabel={`Working in ${homeDirectory}`}
								accessibilityHint="Choose another folder"
								testID={CONTROL.homeTargetFolder}
							/>
						) : null
					}
					modelChip={chips.model}
					effortChip={null}
					onOpenModels={() => {
						setOptionPath(
							startup.snapshot.selection?.cwd ?? homeDirectory ?? "",
						);
						setOptionModel(
							models.find(
								(model) =>
									model.provider === startup.snapshot.selection?.provider &&
									model.model_id === startup.snapshot.selection?.model_id,
							) ?? topModel,
						);
						setOptionsOpen(true);
					}}
					onOpenEffort={() => undefined}
					slashQuery={null}
					slashSheet={null}
					fieldRef={fieldRef}
				/>
			</View>
		</ReadableColumn>
	);

	return (
		<>
			<Screen
				testID={newSession ? SCREEN.newSession : SCREEN.home}
				scroll={false}
				/* The cap comes off only when the split is real — the list pane then
				 *  owns its own width and the measure belongs to the composer column
				 *  (the old list screen's rule, kept: a cap on the whole screen squeezed
				 *  a tablet into a phone layout stretched). */
				capColumn={!split}
				headerLeading={
					split ? undefined : (
						<View className="flex-row items-center gap-1">
							<IconButton
								accessibilityLabel="Open conversations"
								onPress={() => setPanelOpen(true)}
								icon={({ color, size }) => <Menu color={color} size={size} />}
								size={22}
								testID={CONTROL.homeSidebar}
							/>
							<NavigationMark />
							{badgeCount !== null && badgeCount > 0 ? (
								<Badge
									label={`${badgeCount}`}
									tone="danger"
									mono
									/* Sighted readers get the numeral; assistive tech gets the sentence
									 * it stands for — the row's own state word ("new", per
									 * `rowAccessibilityLabel`) plus the count (ADR 0006 §1.4). */
									accessibilityLabel={`${badgeCount} new conversation${badgeCount === 1 ? "" : "s"}`}
								/>
							) : null}
						</View>
					)
				}
				headerAction={
					<View className="min-w-0 flex-1 flex-row items-center gap-2">
						{/* The computer this will run on, and the switcher's primary entry
						 *  point (ux-flows F5): `● Mac mini ▾`, opening the ONE sheet rather
						 *  than navigating away. It keeps this slot's `min-w-0 flex-1` and
						 *  its both-axis TOUCH_FLOOR (design round 9, D24) — see
						 *  `HeaderComputerChip`; the name comes from the same `listLabel`
						 *  ladder the panel's row uses. The width floor is only honourable
						 *  because the BELL yields its pill at large text (and the chip its
						 *  chevron at the same step), so nothing overflows the 320 pt row. */}
						<HeaderComputerChip testID={CONTROL.computersButton} />
						{/* Settings is a GEAR, not the avatar (design D2): the avatar's initials
						 *  came from the same label as the computer name beside it, and a
						 *  host-shaped label fell to the `?` floor — legible as *Help*, not as
						 *  Settings. The gear says what the control does; the accessible name
						 *  still comes from the caller's label. */}
						{/* THE COUNT BELONGS TO THE BELL, and it is INSIDE the control.
						 *  As a sibling chip it measured 25.3 × 22 pt, 8 pt from the
						 *  button's box — an inert fifth control the reader tries to tap
						 *  (design review round 2 D10). An absolutely-positioned badge
						 *  fixed the distance but OVERLAPPED the pressable's own box by
						 *  94 pt² (audit U-08 on S4/idle), so the count is a trailing
						 *  accessory INSIDE one pressable: a single 44 pt target, no
						 *  overlap, and the number reads as part of the bell. */}
						{inboxEnabled ? (
							<Pressable
								accessibilityRole={ROLE.button}
								accessibilityLabel={
									inboxCount === null
										? "Notifications"
										: `Notifications, ${inboxCount} unread`
								}
								onPress={() => router.push("/notifications")}
								testID={CONTROL.homeNotifications}
								style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
								className="flex-row items-center justify-center gap-1 px-2"
							>
								<BellIcon
									waiting={headerBellShowsDot(effectiveScale, inboxCount)}
								/>
								{/* THE PILL YIELDS FIRST, at and above 200 % text. The bell keeps
								 *  its 44 pt target and its accessible name keeps the count
								 *  ("Notifications, 120 unread"), while the ~55 pt the pill
								 *  was taking goes to the computer switcher, which otherwise
								 *  cannot hold its own floor (D24). Nothing is lost silently:
								 *  the same number is on the rail's row inside the pane. */}
								{inboxCount !== null &&
								inboxCount > 0 &&
								headerBellShowsCount(effectiveScale) ? (
									<View testID={CONTROL.homeNotificationsCount}>
										<Badge
											/* THE APP'S ONE CAP: a four-digit count would widen the pill
											 *  until it took width from the label (R7-02/D21). */
											label={countLabel(inboxCount)}
											/* The same 300 % step the rail's count passes (D25). */
											scale={effectiveScale}
											tone="warning"
											emphasis
											mono
											accessibilityLabel={`${inboxCount} unread notifications`}
										/>
									</View>
								) : null}
							</Pressable>
						) : null}
						<IconButton
							accessibilityLabel="Settings"
							onPress={() => router.push("/settings")}
							icon={({ color, size }) => <Settings color={color} size={size} />}
							testID={CONTROL.settingsButton}
						/>
					</View>
				}
			>
				{split ? (
					<SplitView
						testID={CONTROL.sessionsSplit}
						list={pane}
						detail={composerColumn}
						emptyDetail={null}
					/>
				) : (
					composerColumn
				)}
			</Screen>

			<Sheet
				visible={optionsOpen}
				onClose={() => setOptionsOpen(false)}
				title="Conversation options"
				testID={CONTROL.startupOptions}
			>
				<View className="gap-3 py-2">
					<Input
						label="Folder on this computer"
						value={optionPath}
						onChangeText={setOptionPath}
						disabled={!selectionEditable}
						testID={CONTROL.newSessionCwd}
					/>
					{models.map((model) => (
						<Button
							key={model.selector}
							label={model.label ?? model.name ?? model.selector}
							variant={
								optionModel?.selector === model.selector ? "primary" : "quiet"
							}
							onPress={() => setOptionModel(model)}
							disabled={!selectionEditable}
							testID={CONTROL.startupModelOption}
						/>
					))}
					<Button
						label="Use these options"
						disabled={!selectionEditable || optionPath.trim() === ""}
						onPress={() => {
							setHomeDirectory(optionPath.trim());
							setTopModel(optionModel);
							setOptionsOpen(false);
							void startup.configure({
								cwd: optionPath.trim(),
								...(optionModel
									? {
											provider: optionModel.provider,
											model_id: optionModel.model_id,
										}
									: {}),
							});
						}}
						testID={CONTROL.startupOptionsApply}
					/>
					{!selectionEditable ? (
						<Text className="text-body-sm text-ink-muted">
							This conversation's starting options are fixed. Use Conversation
							details for its live controls.
						</Text>
					) : null}
				</View>
			</Sheet>

			<Sheet
				visible={queueOpen}
				onClose={() => setQueueOpen(false)}
				title="Queued messages"
				testID={CONTROL.startupQueueSheet}
			>
				<View className="gap-4 py-2">
					{startup.snapshot.queue.map((message, index) => (
						<View key={message.command_id} className="gap-1">
							<Text className="text-meta text-ink-muted">
								Queued message {index + 1}
							</Text>
							<Text selectable className="text-body text-ink">
								{message.text}
							</Text>
							{message.images?.length ? (
								<Text className="text-body-sm text-ink-muted">
									{message.images.length} image attachments retained
								</Text>
							) : null}
						</View>
					))}
					{/* UX U1: a queue that cannot drain must not be a dead end. These are
					    the reader's own bytes — they can go back to the editor, or go
					    away on an explicit word, and neither happens behind their back. */}
					<View className="gap-2">
						<Button
							label="Move queued messages to draft"
							variant="quiet"
							testID={CONTROL.startupQueueRestore}
							onPress={() => {
								void startup.restoreQueueToDraft().then((done) => {
									if (done) setQueueOpen(false);
								});
							}}
						/>
						<Button
							label="Discard queued messages"
							variant="quiet"
							testID={CONTROL.startupQueueDiscard}
							onPress={() => {
								void startup.discardQueue().then((done) => {
									if (done) setQueueOpen(false);
								});
							}}
						/>
					</View>
				</View>
			</Sheet>

			<HomeStateMarkers draft={draft} offline={offline || !connected} />

			{/* The drawer exists only where the list is not docked. Both surfaces
			 *  render the SAME pane; only the wrapper differs. */}
			{split ? null : (
				<ConversationsDrawer
					visible={panelOpen}
					onClose={() => setPanelOpen(false)}
					onNewChat={newChat}
					notice={notice}
					homeDirectory={homeDirectory}
				/>
			)}
		</>
	);
}
