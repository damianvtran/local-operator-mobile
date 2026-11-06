import { useRouter } from "expo-router";
import { Bell, BellDot, Menu } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ModelEntry } from "@/contracts";
import { HeaderComputerChip } from "@/features/auth/computer-entry-points";
import {
	useConnection,
	useConnectionState,
	useListState,
	useLocaleFrame,
} from "@/features/auth/connection-provider";
import {
	connectDisabledReason,
	foldersReadFailed,
	foldersReadSignInRequired,
	modelsReadFailed,
	startupQueueState,
} from "@/features/home/home-copy";
import {
	type CatalogueRead,
	foldersApplied,
	foldersFailure,
	foldersFrom,
	type HomeFolders,
	homeModelReading,
	homeStartSelection,
	isAuthFailure,
	restoredSupersede,
} from "@/features/home/home-defaults";
import { HomeStateMarkers } from "@/features/home/home-markers";
import { HomeRecovery, HomeSplash } from "@/features/home/home-splash";
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
import type { ComposerControls } from "@/features/session/composer";
import { composerCopy } from "@/features/session/composer";
import { deviceOnline } from "@/features/session/runtime";
import { ConversationsDrawer } from "@/features/sessions/conversations-drawer";
import { ConversationsPane } from "@/features/sessions/conversations-pane";
import {
	inboxBadgeCount,
	unreadBadgeCount,
} from "@/features/sessions/session-projection";
import { t } from "@/i18n";
import { homeShortened } from "@/lib/format";
import { listLabel } from "@/lib/route-label";
import type { RelayError } from "@/relay/errors";
import { useUiStore } from "@/state/ui-store";
import { CONTROL, homeRecentFolderId, ROLE, SCREEN, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { ReadableColumn, SplitView } from "@/ui/components/adaptive";
import { Alert } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Banner } from "@/ui/components/banner";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
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
	/* The resolved language, subscribed so a config frame re-renders this screen.
	 * It is not read here as a string — `t()` resolves the locale itself — but it is
	 * a DEPENDENCY of every memo below that caches rendered copy (review M3): a memo
	 * whose list omits it keeps the previous language's sentences for as long as the
	 * language is the only thing that changed. */
	const language = useLocaleFrame();
	const inboxEnabled = notificationsEnabled(
		useListState((state) => state.capabilities),
	);
	const _showToast = useUiStore((state) => state.showToast);

	const [panelOpen, setPanelOpen] = useState(forcePanelOpen);
	const [optionsOpen, setOptionsOpen] = useState(false);
	const [queueOpen, setQueueOpen] = useState(false);
	const [optionPath, setOptionPath] = useState("");
	const [optionModel, setOptionModel] = useState<ModelEntry | null>(null);
	const [running, setRunning] = useState(false);
	const [models, setModels] = useState<ModelEntry[]>([]);
	const [attaching, setAttaching] = useState(false);
	const [editing, setEditing] = useState(false);
	const [composerError, setComposerError] = useState<string | null>(null);
	/** The folder the next start names: the reader's pick in the sheet, else the
	 *  computer's OWN default. `null` until a read resolves one — nothing here
	 *  invents a directory to start in. */
	const [homeDirectory, setHomeDirectory] = useState<string | null>(null);
	/** The computer's answer to "where do I start", with the folders it offers. */
	const [folders, setFolders] = useState<HomeFolders | null>(null);
	/** The folders read's failure, KIND KEPT: the banner names the cause it really
	 *  was, and an auth kind is owed one automatic re-ask once the route is live. */
	const [directoriesError, setDirectoriesError] = useState<RelayError | null>(
		null,
	);
	const [directoriesAttempt, setDirectoriesAttempt] = useState(0);
	const [modelsAttempt, setModelsAttempt] = useState(0);
	const [modelsRead, setModelsRead] = useState<CatalogueRead>("loading");
	/** The model the reader picked in the sheet, and NOTHING ELSE. `null` is the
	 *  default state rather than a gap to fill: with nothing chosen the start body
	 *  names no model and the computer applies its own configured default. */
	const [chosenModel, setChosenModel] = useState<ModelEntry | null>(null);
	const selection = useMemo(
		() => homeStartSelection({ cwd: homeDirectory, chosenModel }),
		[homeDirectory, chosenModel],
	);
	const startup = useStartup(selection);

	/* A record written by a build that invented a model still names it, and the
	 * coordinator deliberately KEEPS a restored selection rather than replacing it —
	 * so the invented model would keep reaching the start body. The app cannot tell an
	 * invented model from a chosen one on disk, so the record is no evidence of
	 * choice: it is corrected in place (`restoredSupersede` holds the rules, and why
	 * the folder read must not gate them). The comparison returns `null` when the
	 * record already agrees, so an agreeing record is left alone and an uneditable
	 * phase answers the write with a no-op rather than a loop. */
	useEffect(() => {
		const next = restoredSupersede({
			stored: startup.snapshot.selection,
			folders,
			chosenModel,
		});
		if (next === null) return;
		void startup.configure(next);
	}, [startup, startup.snapshot.selection, folders, chosenModel]);
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
	/* The composer owns the bottom edge and pays this inset itself (record §2.2);
	 *  `Screen` therefore pays none here (`bottomInset="child"`, its default for a
	 *  non-scrolling screen). */
	const insets = useSafeAreaInsets();
	const menuInk = useTokenColor("ink-muted");
	/* The folder/model/options controls are the reader's while the request is still
	 * theirs to change. A `refused` create never happened, so it belongs in that set
	 * with `draft` — the copy already asks them to check the folder, and QA found the
	 * controls disabled at exactly that moment (a dead end: retry re-posted the same
	 * invalid selection). */
	const selectionEditable =
		startup.snapshot.phase === "draft" || startup.snapshot.phase === "refused";
	const [problem, _setProblem] = useState<string | null>(null);
	/** The composer's field, for the New chat affordance: only the home can
	 *  focus it, and only after the drawer is gone. */
	const fieldRef = useRef<TextInput | null>(null);

	const client = relay();
	const routed = route !== null;
	const connected = routed && client !== null;
	const offline = deviceOnline() === false;
	const viewport = useWindowDimensions();
	const homeRecovery =
		busy || !coldStartSettled
			? "restoring"
			: refusal?.kind === "sign-in" || refusal?.kind === "account-mismatch"
				? "auth"
				: offline
					? "offline"
					: refusal !== null
						? "error"
						: !connected
							? "no-host"
							: null;

	/* The computer's two reads, each kept as the state it really is.
	 *
	 * THE FOLDER READ names where the next start goes. The computer resolves `default`
	 * from the same function its start route uses — the first recent directory its
	 * spawn gate admits — so a start that names nothing else lands where the reader
	 * has actually been working; `home` is the fallback only for a computer old enough
	 * not to publish `default`, and it is the one path the gate always admits. A
	 * failure keeps its KIND (never a bare flag) so the banner can say whether the
	 * credential moved or the read failed, and so the auth case can be re-asked.
	 *
	 * THE MODEL READ BUILDS A MENU, NOT A DEFAULT. This screen used to take the
	 * catalogue's FIRST entry as "the default model" and put it in every start body,
	 * which overrode the operator's configured model with whatever sorted first. The
	 * catalogue decides what the SHEET offers and nothing else; a reader who chooses
	 * nothing sends no model at all. A failed read stays a FAILURE — not an empty
	 * catalogue reported as connected — so the chip can say the list was unread and
	 * the banner can offer the retry the read never had.
	 *
	 * ONE EFFECT PER READ (review R2). Both reads used to share one effect keyed on
	 * both attempt counters, so the model banner's Retry re-read the FOLDERS as well
	 * and its success path put the computer's default back over a folder the reader
	 * had applied in the sheet — silently, and in the state this screen creates
	 * whenever the model list fails. Each read now re-runs only its own retry.
	 *
	 * `directoriesAttempt` and `modelsAttempt` are dependencies the exhaustive-deps
	 * rule cannot justify from the body: they are RE-RUN TRIGGERS (the two retries),
	 * and without them a failed read would never be re-asked. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: directoriesAttempt is the re-run trigger (see above)
	useEffect(() => {
		const active = relay();
		if (!active) return;
		let live = true;
		void active
			.directories()
			.then((payload) => {
				if (!live) return;
				const read = foldersFrom(payload);
				setFolders(read);
				/* THE READER'S FOLDER WINS over a later read (review R2): the success path
				 *  fills the default only into a slot nobody has filled, so a folder applied
				 *  in the sheet survives a re-read of any kind — this read's own retry
				 *  included. */
				setHomeDirectory((held) => foldersApplied(held, read));
				setDirectoriesError(null);
			})
			.catch((cause: unknown) => {
				if (live) setDirectoriesError(foldersFailure(cause));
			});
		return () => {
			live = false;
		};
	}, [relay, directoriesAttempt]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: modelsAttempt is the re-run trigger (see above)
	useEffect(() => {
		const active = relay();
		if (!active) return;
		let live = true;
		void active
			.models()
			.then((catalogue) => {
				if (!live) return;
				setModels(catalogue.models);
				setModelsRead("ready");
			})
			.catch(() => {
				if (live) setModelsRead("failed");
			});
		return () => {
			live = false;
		};
	}, [relay, modelsAttempt]);

	const retryDirectories = useCallback(() => {
		setDirectoriesAttempt((attempt) => attempt + 1);
	}, []);

	const retryModels = useCallback(() => {
		setModelsAttempt((attempt) => attempt + 1);
	}, []);

	/* ONE automatic re-ask after a credential failure, and only once the route is
	 * live again: the first read of a mount can race the token renewal the connection
	 * layer performs behind the reader. Once per mount, never a loop — a failure that
	 * survives a live route is an ANSWER, and re-asking it would only repeat it. */
	const autoRetried = useRef(false);
	useEffect(() => {
		if (autoRetried.current) return;
		if (!isAuthFailure(directoriesError)) return;
		if (phase !== "live") return;
		autoRetried.current = true;
		setDirectoriesAttempt((attempt) => attempt + 1);
	}, [directoriesError, phase]);

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
						setComposerError(composerCopy().pasteEmpty);
					}
				} catch {
					/* Said, never swallowed — the composer's own error line. */
					setComposerError(composerCopy().attachError);
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
					setComposerError(composerCopy().attachError);
				} finally {
					setAttaching(false);
				}
			})();
		},
		[setImages],
	);

	/* `language` is a dependency here because this memo holds RENDERED COPY: the
	 * disabled sentence is a `t()` reading, resolved at call time. Without it a
	 * language frame repaints this screen and the memo hands back the sentence of
	 * the locale it was last computed in (review M3).
	 *
	 * The lint rule cannot see that link: `t()` reads the preference from the
	 * module-level source in `src/i18n/locale.ts`, so the body never MENTIONS
	 * `language` and biome calls the dependency unnecessary. It is a TRIGGER — the
	 * same shape as `use-refusal-reveal.ts`'s `owed` — so the rule is silenced with
	 * the reason here rather than satisfied by deleting a dependency that matters. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `language` is a TRIGGER: the copy readers read the locale live, so it must re-run the memo (see above)
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
			disabledReason: connected ? null : connectDisabledReason(),
			/* The home has no session and no health dot, so it can never be ended:
			 *  the placeholder never switches to the reopen hint here. */
			ended: false,
		}),
		/* See the trigger note above: `t()` reads the locale live, so the rendered
		 * sentence must be recomputed when `language` changes. */
		[connected, draft, images.length, starting, running, language],
	);

	/* `language` IS a dependency now: the two "nothing chosen" states show a catalogue
	 * word (the computer's default is in effect, or the list could not be read), so a
	 * language frame must repaint this memo — the note that used to sit here said this
	 * list gains `language` the day those labels were keyed. The reading is DERIVED
	 * (`homeModelReading`) rather than an expression, so "nothing chosen" and "the
	 * catalogue could not be read" cannot collapse into the one `n/a` that reported a
	 * silent failure as a connected session. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `language` is a TRIGGER: `t()` reads the locale live, so the memo must re-run (see above)
	const chips = useMemo(
		() =>
			composerChipLabels({
				model: homeModelReading({ chosenModel, catalogue: modelsRead }),
				effort: null,
				connection: !connected
					? "unreachable"
					: modelsRead === "loading"
						? "loading"
						: "connected",
			}),
		[chosenModel, modelsRead, connected, language],
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
			{/* One exclusive recovery story; a cached transcript is not an empty home.
			 * Restoring is not evidence of expiry. No token/provider decisions here. */}
			<View className="flex-1">
				{homeRecovery ? (
					<HomeRecovery
						kind={homeRecovery}
						host={listLabel(computers, tunnelId, route)}
						detail={refusal?.detail ?? undefined}
						onRetry={() => void retry()}
						onSignIn={() => router.push("/welcome")}
						onConnect={() => router.push("/tunnels")}
					/>
				) : null}
				{startup.snapshot.sessionId ? (
					<StartupTranscript
						sessionId={startup.snapshot.sessionId}
						onStreaming={setRunning}
					/>
				) : homeRecovery === null ? (
					<HomeSplash
						draft={draft}
						editing={editing}
						connected={connected}
						onPick={setDraft}
						onConnect={() => router.push("/tunnels")}
						starting={starting}
					/>
				) : null}
			</View>

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
							label={t("mobile.home.queue.view")}
							variant="quiet"
							size="sm"
							testID={CONTROL.startupViewQueue}
							onPress={() => setQueueOpen(true)}
						/>
					) : null}
				</View>
			) : null}

			{/* The folders read failed. The KIND decides the sentence AND the remedy — a
			 *  credential refusal is not a transient read failure, and offering Retry for it
			 *  pointed the reader at a button that would be refused again: `relay-unauthorized`
			 *  retries `never` and its surface is a password (review R4). The auth branch
			 *  therefore offers the sign-in handoff the splash already uses; every other kind
			 *  keeps the retry, which is a real answer for a read that only raced something.
			 *  A successful read clears the row; a retry that fails again keeps it, which is
			 *  the honest state. */}
			{directoriesError !== null ? (
				<Banner
					tone="warning"
					message={
						isAuthFailure(directoriesError)
							? foldersReadSignInRequired()
							: foldersReadFailed()
					}
					action={
						isAuthFailure(directoriesError)
							? {
									label: t("mobile.chrome.home.sign_in"),
									onPress: () => router.push("/welcome"),
									testID: CONTROL.homeFoldersSignIn,
								}
							: {
									label: t("mobile.computers.retry"),
									onPress: retryDirectories,
									testID: CONTROL.homeFoldersRetry,
								}
					}
					testID={CONTROL.homeFoldersBanner}
				/>
			) : null}

			{/* The model list could not be read: its own failure, with the retry the
			 *  read never had. The chip says the same in one word ("Unknown"); this row is
			 *  where the reader can act on it, rather than a chip that declared itself
			 *  connected while reporting no model. */}
			{modelsRead === "failed" ? (
				<Banner
					tone="warning"
					message={modelsReadFailed()}
					action={{
						label: t("mobile.computers.retry"),
						onPress: retryModels,
						testID: CONTROL.homeModelsRetry,
					}}
					testID={CONTROL.homeModelsBanner}
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
					onEditingChange={setEditing}
					onOpenQueue={() => setQueueOpen(true)}
					suppressDisabledHint={homeRecovery !== null}
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
					/* The folder is data, not an element: the composer's meta line
					 *  decides whether it paints the path or only the folder glyph
					 *  (record §2.2 yield order). Paint, target, hint and the options
					 *  sheet behind it are unchanged (final audit, D2). */
					folderChip={
						homeDirectory !== null
							? {
									label: homeShortened(
										startup.snapshot.selection?.cwd ?? homeDirectory,
										homeDirectory,
									),
									onPress: () => {
										/* The sheet opens on what will actually be sent: the folder the
										 *  start names, and the model THE READER chose — `null` when they
										 *  chose none, so no row is painted as selected on their behalf. */
										setOptionPath(
											startup.snapshot.selection?.cwd ?? homeDirectory ?? "",
										);
										setOptionModel(chosenModel);
										setOptionsOpen(true);
									},
									accessibilityLabel: `Working in ${homeDirectory}`,
									accessibilityHint: "Choose another folder",
									testID: CONTROL.homeTargetFolder,
								}
							: null
					}
					bottomInset={insets.bottom}
					modelChip={chips.model}
					effortChip={null}
					onOpenModels={() => {
						setOptionPath(
							startup.snapshot.selection?.cwd ?? homeDirectory ?? "",
						);
						setOptionModel(chosenModel);
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
				headerDensity="home"
				/* The cap comes off only when the split is real — the list pane then
				 *  owns its own width and the measure belongs to the composer column
				 *  (the old list screen's rule, kept: a cap on the whole screen squeezed
				 *  a tablet into a phone layout stretched). */
				capColumn={!split}
				headerLeading={
					split ? undefined : (
						/* ☰ with the unread count as a CORNER badge on the button itself
						 *  (record §2.4, D-H2): the red "21" was a sibling of the brand
						 *  mark, attached to no control. Inside the one 44 pt pressable it
						 *  reads as "this opens what is new" and adds no width. The brand
						 *  mark left the header (D-H3): three identity marks on one screen,
						 *  and its 29 pt were what starved the computer chip (D-H1). */
						<Pressable
							accessibilityRole={ROLE.button}
							accessibilityLabel={
								badgeCount !== null && badgeCount > 0
									? `Open conversations, ${badgeCount} new conversation${badgeCount === 1 ? "" : "s"}`
									: "Open conversations"
							}
							onPress={() => setPanelOpen(true)}
							testID={CONTROL.homeSidebar}
							className="items-center justify-center"
							style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
						>
							<Menu color={menuInk} size={22} />
							{badgeCount !== null && badgeCount > 0 ? (
								<View
									pointerEvents="none"
									className="absolute"
									style={{ top: 2, end: 0 }}
								>
									<Badge
										label={countLabel(badgeCount)}
										tone="danger"
										mono
										scale={effectiveScale}
									/>
								</View>
							) : null}
						</Pressable>
					)
				}
				headerAction={
					<View className="min-w-0 flex-1 flex-row items-center gap-1">
						{/* The computer this will run on, and the switcher's primary entry
						 *  point. It takes ALL the width the ☰ and the bell leave — about
						 *  281 pt on a 393 pt phone — so "Mac – Local Operator" reads whole
						 *  (record §2.4: it read "M… Operator" beside the mark, the badge
						 *  and the gear). The bell still yields its pill at large text
						 *  (D24), so nothing overflows the 320 pt row. */}
						<HeaderComputerChip testID={CONTROL.computersButton} />
						{/* THE COUNT BELONGS TO THE BELL, and it is INSIDE the control.
						 *  As a sibling chip it measured 25.3 × 22 pt, 8 pt from the
						 *  button's box — an inert fifth control the reader tries to tap
						 *  (design review round 2 D10). An absolutely-positioned badge
						 *  fixed the distance but OVERLAPPED the pressable's own box by
						 *  94 pt² (audit U-08 on S4/idle), so the count is a trailing
						 *  accessory INSIDE one pressable: a single 44 pt target, no
						 *  overlap, and the number reads as part of the bell. */}
						{inboxEnabled && viewport.width >= 360 && effectiveScale < 1.5 ? (
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
								className="items-center justify-center"
							>
								<BellIcon waiting={inboxCount !== null && inboxCount > 0} />
							</Pressable>
						) : null}
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
				title={t("mobile.home.options.title")}
				testID={CONTROL.startupOptions}
			>
				<View className="gap-3 py-2">
					<Input
						label={t("mobile.home.options.folder")}
						value={optionPath}
						onChangeText={setOptionPath}
						disabled={!selectionEditable}
						testID={CONTROL.newSessionCwd}
					/>
					{/* The way BACK to the computer's own answer (reviews R5 and the folder half of
					 *  the same gap): without these rows the only way out of a mis-tap is picking
					 *  a different entry, or a remount. Like every other row here they FILL the
					 *  sheet rather than sending — the Apply button commits — so a reader who
					 *  changes their mind twice is never on a wire they did not confirm. The
					 *  folder row needs the read's `default` to name, so it waits for the read. */}
					{folders !== null ? (
						<Button
							label={t("mobile.home.options.default_folder")}
							variant="quiet"
							onPress={() => setOptionPath(folders.default)}
							disabled={!selectionEditable}
							testID={CONTROL.homeDefaultFolder}
						/>
					) : null}
					{/* The computer's recent directories, one tap each: every row is a directory
					 *  its spawn gate admits, so no row is a suggestion that 400s. They fill the
					 *  field rather than sending, so the reader can still change their mind; the
					 *  free-text field above stays the escape hatch for a path no row names. Each
					 *  row carries its index in the id (review R8): one shared id made no
					 *  specific row addressable, so a flow could only press whichever row the
					 *  matcher happened to see. */}
					{folders !== null && folders.recent.length > 0 ? (
						<View className="gap-2">
							{folders.recent.map((directory, index) => (
								<Button
									key={directory}
									label={homeShortened(directory, folders.home)}
									variant="quiet"
									onPress={() => setOptionPath(directory)}
									disabled={!selectionEditable}
									testID={homeRecentFolderId(index)}
								/>
							))}
						</View>
					) : null}
					{/* The model half of the same way back (review R5): `chosenModel` only ever
					 *  moved null → entry, so a mis-tap on an entry was correctable only by
					 *  picking a different one. Shown only when the sheet holds a model, because
					 *  "use the default" over a default is a row about nothing. */}
					{optionModel !== null ? (
						<Button
							label={t("mobile.home.options.default_model")}
							variant="quiet"
							onPress={() => setOptionModel(null)}
							disabled={!selectionEditable}
							testID={CONTROL.homeDefaultModel}
						/>
					) : null}
					{models.map((model) => (
						<Button
							key={model.selector}
							label={model.label ?? model.name ?? model.selector}
							/* NO ROW IS PAINTED AS SELECTED UNLESS THE READER PICKED IT: `optionModel`
							 *  starts as their own choice (`null` when they made none), so the sheet never
							 *  shows an entry the app merely guessed at. */
							variant={
								optionModel?.selector === model.selector ? "primary" : "quiet"
							}
							onPress={() => setOptionModel(model)}
							disabled={!selectionEditable}
							testID={CONTROL.startupModelOption}
						/>
					))}
					<Button
						label={t("mobile.home.options.apply")}
						disabled={!selectionEditable || optionPath.trim() === ""}
						onPress={() => {
							setHomeDirectory(optionPath.trim());
							setChosenModel(optionModel);
							setOptionsOpen(false);
							/* The model fields ride along ONLY when the sheet holds a chosen
							 *  model: applying a folder must not resurrect a model nobody picked. */
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
							{t("mobile.home.options.fixed")}
						</Text>
					) : null}
				</View>
			</Sheet>

			<Sheet
				visible={queueOpen}
				onClose={() => setQueueOpen(false)}
				title={t("mobile.home.queue.sheet_title")}
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
							label={t("mobile.home.queue.restore")}
							variant="quiet"
							testID={CONTROL.startupQueueRestore}
							onPress={() => {
								void startup.restoreQueueToDraft().then((done) => {
									if (done) setQueueOpen(false);
								});
							}}
						/>
						<Button
							label={t("mobile.home.queue.discard")}
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
