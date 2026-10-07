import { randomUUID } from "expo-crypto";
import { useRouter } from "expo-router";
import { Menu, Settings } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { Pressable, Text, View } from "react-native";

import type { ModelEntry, PromptImage } from "@/contracts";
import {
	useConnection,
	useConnectionState,
	useListState,
} from "@/features/auth/connection-provider";
import {
	CONNECT_DISABLED_REASON,
	FOLDERS_READ_FAILED,
	REFUSED_START_FALLBACK,
} from "@/features/home/home-copy";
import { HomeStateMarkers } from "@/features/home/home-markers";
import { HomeSplash } from "@/features/home/home-splash";
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
import {
	clearHomeDraft,
	readHomeDraft,
	writeHomeDraft,
} from "@/features/session/device-storage";
import { deviceOnline } from "@/features/session/runtime";
import { ConversationsDrawer } from "@/features/sessions/conversations-drawer";
import { ConversationsPane } from "@/features/sessions/conversations-pane";
import { unreadBadgeCount } from "@/features/sessions/session-projection";
import { homeShortened } from "@/lib/format";
import { listLabel } from "@/lib/route-label";
import { RelayError } from "@/relay";
import { useUiStore } from "@/state/ui-store";
import { CONTROL, ROLE, SCREEN, SURFACE } from "@/ui/a11y";
import { ReadableColumn, SplitView } from "@/ui/components/adaptive";
import { Alert } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Banner } from "@/ui/components/banner";
import { Chip } from "@/ui/components/chip";
import { IconButton } from "@/ui/components/icon-button";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { TOUCH_FLOOR, useLayout } from "@/ui/layout";

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
	/** `/conversations` renders the home with the panel open — the programmatic
	 *  open ADR 0006 § 6.6 needs (a deep link the computer does not know lands on
	 *  the panel with one honest sentence). On a docked layout the list is always
	 *  visible and the flag is a no-op. */
	forcePanelOpen?: boolean;
	/** The one honest sentence, rendered by the pane (`SURFACE.sidebarNotice`). */
	notice?: string | null;
};

export default function Home({
	forcePanelOpen = false,
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
	const showToast = useUiStore((state) => state.showToast);

	const [panelOpen, setPanelOpen] = useState(forcePanelOpen);
	const [draft, setDraftState] = useState("");
	const [images, setImages] = useState<PromptImage[]>([]);
	const [attaching, setAttaching] = useState(false);
	const [composerError, setComposerError] = useState<string | null>(null);
	const [homeDirectory, setHomeDirectory] = useState<string | null>(null);
	const [directoriesFailed, setDirectoriesFailed] = useState(false);
	const [directoriesAttempt, setDirectoriesAttempt] = useState(0);
	const [topModel, setTopModel] = useState<ModelEntry | null>(null);
	const [modelsLoaded, setModelsLoaded] = useState(false);
	const [starting, setStarting] = useState(false);
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

	/* The home's draft, restored once. If the reader has already typed by the
	 * time the read resolves, what they have typed wins — the store is storage,
	 * not an authority over the live field. */
	useEffect(() => {
		let live = true;
		void readHomeDraft().then((text) => {
			if (live && text !== "")
				setDraftState((current) => (current === "" ? text : current));
		});
		return () => {
			live = false;
		};
	}, []);

	const setDraft = useCallback((text: string) => {
		setDraftState(text);
		void writeHomeDraft(text);
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

	const attach = useCallback((source: AttachSource) => {
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
	}, []);

	/** The web paste event's image file: same strip, same failure line as the
	 *  sheet's own rows (`use-composer.ts`'s `pasteFile` is the session view's
	 *  copy of this handler). */
	const pasteFile = useCallback((file: File) => {
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
	}, []);

	const controls: ComposerControls = useMemo(
		() => ({
			primary: {
				kind: "send",
				/* Same morph as a session's: `…` while a send is in flight, `↑`
				 * otherwise, and the word lives in the accessible label. */
				label: starting ? "…" : "↑",
				op: "prompt",
				disabled:
					starting ||
					!connected ||
					homeDirectory === null ||
					(draft.trim() === "" && images.length === 0),
				accessibilityLabel: starting ? "Sending" : "Send message",
			},
			stopVisible: false,
			sending: starting,
			/* The one sentence the composer says when it cannot send: with nothing
			 * connected there is nothing to send to. An empty draft is disabled for
			 * the self-evident reason and says nothing. */
			disabledReason: connected ? null : CONNECT_DISABLED_REASON,
		}),
		[connected, draft, homeDirectory, images.length, starting],
	);

	const chips = useMemo(
		() =>
			composerChipLabels({
				model: topModel?.selector ?? null,
				effort: null,
				connection: modelsLoaded
					? "connected"
					: connected
						? "loading"
						: "unreachable",
			}),
		[topModel, modelsLoaded, connected],
	);

	const send = useCallback(() => {
		void (async () => {
			const active = relay();
			const text = draft.trim();
			if (
				active === null ||
				!connected ||
				homeDirectory === null ||
				starting ||
				(text === "" && images.length === 0)
			) {
				return;
			}
			setStarting(true);
			setProblem(null);
			setComposerError(null);
			try {
				const started = await active.startSession({
					cwd: homeDirectory,
					...(topModel !== null
						? { provider: topModel.provider, model_id: topModel.model_id }
						: {}),
				});
				try {
					await active.command(started.session_id, {
						op: "prompt",
						command_id: randomUUID(),
						text,
						...(images.length > 0 ? { images } : {}),
					});
					/* Delivered: the draft and its attachments are cleared because
					 * the same text travelled as the first prompt — never both. */
					await clearHomeDraft();
					setDraftState("");
					setImages([]);
				} catch {
					/* The session exists either way; the reader is taken to it and
					 * the draft is KEPT (it was not delivered). */
					showToast(
						"The session started, but your first message was not sent.",
					);
				}
				setPanelOpen(false);
				router.push(`/session/${started.session_id}`);
			} catch (error) {
				/* The relay's own sentence when it has one (it names the folder or the
				 * reason), and never a runtime's prose — `/new`'s rule, verbatim. */
				setProblem(
					error instanceof RelayError
						? error.displayableMessage
						: REFUSED_START_FALLBACK,
				);
			} finally {
				setStarting(false);
			}
		})();
	}, [
		relay,
		connected,
		homeDirectory,
		starting,
		draft,
		images,
		topModel,
		router,
		showToast,
	]);

	const newChat = useCallback(() => {
		setPanelOpen(false);
		/* After the drawer's own frame: focusing a field under a modal that is
		 * still mounted is a no-op on iOS, and the reader pressed New chat to
		 * TYPE. */
		requestAnimationFrame(() => fieldRef.current?.focus());
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

			<HomeSplash
				draft={draft}
				connected={connected}
				onPick={setDraft}
				onConnect={() => router.push("/tunnels")}
				starting={starting}
			/>

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
					onStop={() => undefined}
					retainedMessage={null}
					notice={null}
					onRetry={() => undefined}
					showResume={false}
					onResume={() => undefined}
					error={composerError}
					queuedCount={0}
					leadingChip={
						homeDirectory !== null ? (
							<Chip
								label={homeShortened(homeDirectory, homeDirectory)}
								onPress={() => router.push("/new")}
								accessibilityLabel={`Working in ${homeDirectory}`}
								accessibilityHint="Choose another folder"
								testID={CONTROL.homeTargetFolder}
							/>
						) : null
					}
					modelChip={chips.model}
					effortChip={null}
					onOpenModels={() => router.push("/new")}
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
				testID={SCREEN.home}
				scroll={false}
				/* The cap comes off only when the split is real — the list pane then
				 *  owns its own width and the measure belongs to the composer column
				 *  (the old list screen's rule, kept: a cap on the whole screen squeezed
				 *  a tablet into a phone layout stretched). */
				capColumn={!split}
				headerLeading={
					split ? undefined : (
						<View className="flex-row items-center gap-1">
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
							<IconButton
								accessibilityLabel="Open conversations"
								onPress={() => setPanelOpen(true)}
								icon={({ color, size }) => <Menu color={color} size={size} />}
								testID={CONTROL.homeSidebar}
							/>
						</View>
					)
				}
				headerAction={
					<View className="min-w-0 flex-1 flex-row items-center gap-2">
						{/* The computer this will run on, and the switcher: the same
						 *  `listLabel` ladder the panel's row uses, so the two cannot
						 *  name one machine differently. */}
						<Pressable
							accessibilityRole={ROLE.button}
							accessibilityLabel={`${listLabel(computers, tunnelId, route)} — choose a computer`}
							onPress={() => router.push("/tunnels")}
							testID={CONTROL.computersButton}
							className="min-w-0 flex-1 justify-center"
							style={{ minHeight: TOUCH_FLOOR }}
						>
							<Text
								className="text-mono-sm text-ink-muted"
								numberOfLines={1}
								ellipsizeMode="tail"
							>
								{listLabel(computers, tunnelId, route)}
							</Text>
						</Pressable>
						{/* Settings is a GEAR, not the avatar (design D2): the avatar's initials
						 *  came from the same label as the computer name beside it, and a
						 *  host-shaped label fell to the `?` floor — legible as *Help*, not as
						 *  Settings. The gear says what the control does; the accessible name
						 *  still comes from the caller's label. */}
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
