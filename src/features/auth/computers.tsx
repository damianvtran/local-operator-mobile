import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Check, ChevronLeft, ChevronRight, Laptop } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import {
	computerDisplayName,
	type DiscoveredComputer,
	RADIENT_CONSOLE_TUNNELS_URL,
} from "@/connection";
import {
	useComputerSwitcher,
	usePhoneKnowsComputers,
} from "@/features/auth/computer-switcher-sheet";
import {
	backAction,
	type ComputerFactTone,
	computerReachabilityLabel,
	computerRowTrailing,
	computerStatusLabel,
	computersView,
	FACT_DOT_TOKEN,
	landingAfterPick,
	newlyListed,
	type Reachability,
	type RowState,
	rowState,
} from "@/features/auth/computers-view";
import {
	connectionStore,
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import {
	type ConnectorWaitState,
	useConnectorWait,
} from "@/features/auth/connector-wait";
import { removeComputer } from "@/features/auth/saved-computers-sync";
import { SetupComputer } from "@/features/auth/setup-computer";
import { SignInPanel } from "@/features/auth/sign-in-panel";
import { TunnelPaths } from "@/features/auth/tunnel-paths";
import { activeLocale, t } from "@/i18n";
import { TeamBridgeEntry } from "@/team-bridge/navigation";
import { CONTROL, computerRowIds, REGION, ROLE, SCREEN } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { BackButton } from "@/ui/components/back-button";
import { Banner } from "@/ui/components/banner";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Shimmer } from "@/ui/components/shimmer";
import { Skeleton } from "@/ui/components/skeleton";
import { useComposedDir, useIsRTL } from "@/ui/direction";
import { computersHeaderStackWidth, rowTitleLinesFor } from "@/ui/size-class";
import {
	avatarClasses,
	NAV_CARD_MIN_HEIGHT,
	navCardClasses,
} from "@/ui/variants";
import { tunnelStatusKey } from "./tunnel-status-key";

/**
 * Computers: discovery, the picker, and the set-up path (docs/ux/flows.md § 2 and
 * § 4, F-2/F-4).
 *
 * The one thing this screen must never do is present the control plane's opinion
 * as the machine's state. `status: active` means the CLOUD ROUTE IS PROVISIONED;
 * `radient-ml`'s API cannot say whether the connector is running, and
 * `docs/relay/tunnel-edge.md` § 4 states that a phone learns "the computer is
 * offline" only by failing to reach it. So a row shows two facts separately and
 * with two identifiers — `status` from the control plane, `reachability` from a
 * probe this device made — and `e2e/maestro/flows/02-tunnel-pick.yaml` asserts
 * both because a screen that shows one as the other is the defect the split
 * exists to prevent.
 */

/** The facts line's box (design round 1, D11): wraps between facts, never
 *  inside one, on the 4 pt scale. Exported so the row test pins it. */
export const COMPUTER_FACTS_CLASS =
	"flex-row flex-wrap items-center gap-x-3 gap-y-1";

/** One fact on line 3: a 6 pt tone dot, then the word (never colour alone). */
const Fact = ({
	label,
	tone,
	testID,
}: {
	label: string;
	tone: ComputerFactTone;
	testID: string;
}) => {
	const dot = useTokenColor(FACT_DOT_TOKEN[tone]);
	return (
		<View className="flex-row items-center gap-1" testID={testID}>
			<View
				className="rounded-full"
				style={{ width: 6, height: 6, backgroundColor: dot }}
				aria-hidden
			/>
			<Text className="text-meta text-ink-muted">{label}</Text>
		</View>
	);
};

/**
 * A computer, as a card in the switcher sheet's row language (design D1): glyph,
 * name, host, the two facts as text, and a reserved trailing slot with a chevron
 * so the row reads as something to press. TestFlight 883 (Ola): the old row was
 * text under a hairline whose pressed fill measured 1.01:1, and the only bordered
 * shapes on the screen were the two inert status chips.
 */
const ComputerRow = ({
	computer,
	state,
	reachability,
	onPress,
	onRemove,
}: {
	computer: DiscoveredComputer;
	state: RowState;
	reachability: Reachability;
	onPress: () => void;
	onRemove: () => void;
}) => {
	const ids = computerRowIds(computer.hostname);
	const status = computerStatusLabel(computer.status);
	const reach = computerReachabilityLabel(reachability);

	const spinnerColor = useTokenColor("ink-muted");
	const accent = useTokenColor("accent");
	const glyphInk = useTokenColor("ink");
	const chevronInk = useTokenColor("ink-dim");
	const rtl = useIsRTL();
	const selected = state === "active";
	const connecting = state === "connecting";
	const trailing = computerRowTrailing(state);

	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityState={{ selected, busy: connecting }}
			/* The RAW name: the title may be shortened for display (D4), and a screen
			 *  reader cannot see that it was. */
			accessibilityLabel={t(
				selected
					? "mobile.computers.row.a11y_active"
					: connecting
						? "mobile.computers.row.a11y_connecting"
						: "mobile.computers.row.a11y",
				{ name: computer.name, status: status.label, reach: reach.label },
			)}
			testID={ids.row}
			/* A second tap while this row is minting would start a second route and
			 *  retire the first mid-flight; the row says it is busy instead. */
			disabled={connecting}
			onPress={onPress}
			onLongPress={onRemove}
		>
			{({ pressed }) => (
				<View
					className={navCardClasses({ pressed, selected })}
					style={{ minHeight: NAV_CARD_MIN_HEIGHT }}
				>
					<View className={avatarClasses("sm")} aria-hidden>
						<Laptop size={16} color={glyphInk} />
					</View>
					<View className="min-w-0 flex-1 gap-0.5">
						<View className="flex-row items-center gap-2">
							<Text
								className="min-w-0 flex-1 text-label text-ink"
								numberOfLines={1}
							>
								{computerDisplayName(computer.name)}
							</Text>
							{/* Selection is never colour alone: the marker is a word. */}
							{selected ? (
								<Text
									className="shrink-0 text-meta text-accent"
									testID={CONTROL.computerSelectedMarker}
								>
									{t("mobile.computers.badge.active")}
								</Text>
							) : null}
						</View>
						<Text
							className="text-mono-sm text-ink-dim"
							numberOfLines={1}
							ellipsizeMode="head"
						>
							{computer.hostname}
						</Text>
						{/* The pending state a pick needs (design round 1, D1): the word
						 *  takes line 3 while the session is minted, beside the trailing
						 *  spinner. */}
						{connecting ? (
							<View testID={CONTROL.computerConnectingMarker}>
								<Text className="text-meta text-ink-muted">
									{t("mobile.computers.connecting")}
								</Text>
							</View>
						) : (
							/* The two facts as text, not bordered pills (D1: the pills read
							 *  as buttons and are not), each with its own identifier so
							 *  neither can be asserted in place of the other.
							 *
							 *  NO separator glyph between them (design round 1, D11): each fact
							 *  already opens with its own tone dot, so a `·` added nothing and,
							 *  at 320 pt, the line wrapped as "● Route ready ·" / "● Sign-in
							 *  protected" with the separator dangling. Each `Fact` now wraps as
							 *  a unit; the 12 pt `gap-x-3` alone parts them. `gap-y-1`, not the
							 *  2 pt `gap-y-0.5`, keeps the wrap on the 4 pt scale (U-42). */
							<View className={COMPUTER_FACTS_CLASS}>
								<Fact
									label={status.label}
									tone={status.tone}
									testID={ids.status}
								/>
								<Fact
									label={reach.label}
									tone={reach.tone}
									testID={ids.reachability}
								/>
							</View>
						)}
						{!computer.supportsLocalOperator ? (
							<Text className="text-body-sm text-ink-muted">
								{t("mobile.computers.not_harness")}
							</Text>
						) : null}
						{computer.billing.eligible === false ? (
							<Text className="text-body-sm text-warning">
								{computer.billing.message ??
									t("mobile.computers.billing_inactive")}
							</Text>
						) : null}
					</View>
					{/* Reserved in every state, as in the switcher, so line 1 never
					 *  shifts when a row starts connecting or becomes active. */}
					<View className="w-5 shrink-0 items-center">
						{trailing === "spinner" ? (
							<ActivityIndicator
								size="small"
								color={spinnerColor}
								accessibilityElementsHidden
								importantForAccessibility="no"
							/>
						) : trailing === "check" ? (
							<Check size={18} color={accent} aria-hidden />
						) : rtl ? (
							<ChevronLeft size={18} color={chevronInk} aria-hidden />
						) : (
							<ChevronRight size={18} color={chevronInk} aria-hidden />
						)}
					</View>
				</View>
			)}
		</Pressable>
	);
};

/**
 * The live wait for a connector (`W1`—`W5`), rendering only what has been
 * OBSERVED.
 *
 * "Setting up…" is banned here, and the reason is not style: a reader watching an
 * unqualified spinner cannot tell a slow install from a command that never ran,
 * and those two have completely different fixes. Each line below names a thing
 * that either happened or did not — Radient listing the tunnel, the machine
 * answering its health check.
 */
const WaitPanel = ({
	state,
	appeared,
	onUse,
	onStop,
}: {
	state: ConnectorWaitState;
	appeared: DiscoveredComputer | null;
	onUse: () => void;
	onStop: () => void;
}) => {
	const host = appeared?.hostname ?? null;
	/* "Radient has the tunnel — {status}." starts with the Latin product name in Urdu,
	 * so `dir="auto"` would lay it out left-to-right on an RTL page (M3 S1 design
	 * D2); the page's base is stated instead. */
	const composedDir = useComposedDir();
	return (
		<View className="gap-3 rounded-sm border border-hairline bg-surface p-4">
			{state.kind === "w1" ? (
				<Shimmer active>
					<Text className="text-body text-ink">
						{t("mobile.computers.wait.listing")}
					</Text>
				</Shimmer>
			) : null}
			{state.kind === "w2" ? (
				<>
					<Text {...composedDir} className="text-body text-ink">
						{t("mobile.computers.wait.tunnel_status", {
							status: t(tunnelStatusKey(state.tunnelStatus)),
						})}
					</Text>
					<Text className="text-body-sm text-ink-muted">
						{host
							? t("mobile.computers.wait.host_answering", { host })
							: t("mobile.computers.wait.answering")}
					</Text>
				</>
			) : null}
			{state.kind === "w3" ? (
				<Text className="text-body text-ink">
					{t("mobile.computers.wait.answered")}
				</Text>
			) : null}
			{state.kind === "w3" &&
			(state.version !== null || state.sessions !== null) ? (
				<Text className="text-body-sm text-ink-muted">
					{state.version !== null && state.sessions !== null
						? t("mobile.computers.wait.relay_version_sessions", {
								version: state.version,
								sessions: state.sessions,
							})
						: state.version !== null
							? t("mobile.computers.wait.relay_version", {
									version: state.version,
								})
							: t("mobile.computers.wait.relay_sessions", {
									// Unreachable (outer guard needs version or sessions non-null); `?? 0` only narrows number|null for the type.
									sessions: state.sessions ?? 0,
								})}
				</Text>
			) : null}
			{state.kind === "w4" ? (
				<>
					<Text className="text-body text-ink">
						{t("mobile.computers.wait.nothing_answered")}
					</Text>
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.computers.wait.nothing_answered_help")}
					</Text>
				</>
			) : null}
			{state.kind === "w5" ? (
				<Text className="text-body text-ink-muted">
					{t("mobile.computers.wait.paused")}
				</Text>
			) : null}

			<View className="gap-2">
				{state.kind === "w3" ? (
					<Button
						label={t("mobile.computers.wait.use_computer")}
						onPress={onUse}
						testID={CONTROL.computersUseThisComputer}
					/>
				) : null}
				<Button
					label={t("mobile.computers.wait.start_again")}
					onPress={onStop}
					variant="quiet"
					testID={CONTROL.computersStartAgain}
				/>
			</View>
		</View>
	);
};

export default function Computers() {
	const router = useRouter();
	const {
		refreshComputers,
		billing,
		discovering,
		selectComputer,
		retry,
		refusal,
		signInWithRadient,
		signInState,
		signInDiagnostics,
	} = useConnection();

	/* "Connected to {name}." puts the computer's Latin name first in English; in Urdu
	 * the name still leads the sentence (`{name} سے منسلک ہو گیا۔`), so RN-web's
	 * `dir="auto"` resolves it LTR on an RTL page (design review D2). */
	const composedDir = useComposedDir();
	const switcher = useComputerSwitcher();
	const phoneKnowsComputers = usePhoneKnowsComputers();
	const computers = useConnectionState((state) => state.computers);
	const phase = useConnectionState((state) => state.phase);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const route = useConnectionState((state) => state.route);
	const discoveryFailure = useConnectionState(
		(state) => state.discoveryFailure,
	);

	/* Which branches render is decided in `computers-view.ts`, where the Node suite
	 *  can assert it: the set-up path (F-2) only for an account Radient said is
	 *  empty, the skeleton on the provider's `discovering` flag, and the rows
	 *  whenever there are any. */
	/* Signed out is the `sign-in` refusal, or the browser hand-off its button
	 *  started: `signInWithRadient` ends the route (clearing the refusal) before
	 *  the browser opens, and an empty list then read as an empty account until
	 *  the new grant's discovery answered (QA round 2, Q-r2-1/Q-r2-2). */
	const signInPending = signInState.kind !== "idle";
	const signedOut = refusal?.kind === "sign-in" || signInPending;
	const [waiting, setWaiting] = useState(false);
	/* `?add=1` is the "Add a computer" hand-off (`ADD_COMPUTER_HREF`). */
	const { add } = useLocalSearchParams<{ add?: string }>();
	const view = computersView({
		computers,
		discovering,
		discoveryFailure,
		signedOut,
		adding: add === "1",
	});
	const empty = view.setup;
	/* The tunnel tapped on THIS screen, so arriving with a route already live is
	 *  not mistaken for a pick that just landed (U1). */
	const [picked, setPicked] = useState<string | null>(null);
	const pick = useCallback(
		(computer: DiscoveredComputer) => {
			setPicked(computer.tunnelId);
			void selectComputer(computer);
		},
		[selectComputer],
	);
	/* Read per render: the stack does not change under this screen while it is
	 *  mounted, and the decision is re-taken whenever the phase moves. */
	const canGoBack = router.canGoBack();

	/* A pick made on the cold-start root lands on Home (U1, `landingAfterPick`).
	 *  `replace`, not `push`: Computers was the root, and leaving it underneath
	 *  would put the reader back on the list with the platform back. */
	useEffect(() => {
		if (landingAfterPick({ picked, tunnelId, phase, canGoBack }) === "home")
			router.replace("/");
	}, [canGoBack, phase, picked, router, tunnelId]);

	const back = backAction({ canGoBack, routed: route !== null });
	/* Named once: the header renders them AND sizes its stacking point from them. */
	const showSwitch = !empty || phoneKnowsComputers;
	const showRefresh = !empty && !signedOut;

	const [removeTarget, setRemoveTarget] = useState<DiscoveredComputer | null>(
		null,
	);

	// Radient protects health with a grant. Before a pick, absence of an
	// authenticated answer is NOT evidence that the connector is offline.

	/* The computers listed when the wait started. "Add a computer" opens the set-up
	 *  path over an account that already has some (U12), and the wait is for the
	 *  NEW one: the first listed computer would otherwise be offered as the one that
	 *  just appeared. Empty for an empty account, so that path is unchanged. */
	const listedAtWait = useRef<ReadonlySet<string>>(new Set());
	/* Lists again, then answers with the computer that appeared since the wait
	 *  started — the hook's only way past W1 (R3-M1/U17, `newlyListed`). Read from
	 *  the store, not the render's `computers`: the refresh has just written it, and
	 *  this closure predates that render. `rawStatus` is Radient's own word; W2
	 *  maps it to a translated label (`tunnelStatusKey`). */
	const acquire = useCallback(async () => {
		await refreshComputers();
		const found = newlyListed(
			connectionStore.getState().computers,
			listedAtWait.current,
		);
		return found ? { hostname: found.hostname, status: found.rawStatus } : null;
	}, [refreshComputers]);

	const wait = useConnectorWait({ acquire, enabled: waiting });
	/* Add mode has no landing navigation (it is a pushed route, `landingAfterPick`),
	 *  so once THIS pick is live the answered panel with its mint action is replaced
	 *  by a plain confirmation: leaving an actionable "Use this computer" over a live
	 *  connection invited a second mint (QA round 4 Q8, UX U19). */
	const addedComputerLive =
		add === "1" && picked !== null && tunnelId === picked && phase === "live";
	const startWaiting = useCallback(() => {
		listedAtWait.current = new Set(
			connectionStore.getState().computers.map((computer) => computer.tunnelId),
		);
		setWaiting(true);
	}, []);
	const appeared = useMemo(
		() => newlyListed(computers, listedAtWait.current),
		[computers],
	);

	return (
		<Screen
			title={t(view.title)}
			testID={SCREEN.computers}
			/* This header's own fit, from the controls it is rendering now: "Switch
			 *  computer" made the cluster heavier than the kit floor allows for, and the
			 *  title clipped to "Comp…" at 390 pt (PR #122 design round 2, D10; UX U13).
			 *  `computersHeaderStackWidth` holds the measured pieces. */
			stackBelowWidth={computersHeaderStackWidth({
				title: view.title,
				back: back !== null,
				switcher: showSwitch,
				refresh: showRefresh,
			})}
			/* That fit is English advances; a translated title wraps rather than
			 *  clipping where English fits by one pixel (PR #251 D1). */
			rowTitleLines={rowTitleLinesFor(activeLocale())}
			/* The way back. Every sibling screen in this flow has one (`own-tunnel`,
			 *  `sign-in`, `settings`), and "Set up a computer" is reachable from the list,
			 *  from Settings and from a refusal surface — arriving from any of them with
			 *  no back control leaves the platform gesture as the only exit (D7). */
			headerLeading={
				/* As the cold-start root with no route there is nowhere to go back to
				 *  (Home's landing effect returns a restored account here), so the
				 *  control is absent rather than inert (U1, `backAction`). */
				back ? (
					<BackButton
						testID={CONTROL.computersBack}
						onPress={() =>
							back === "pop" ? router.back() : router.replace("/")
						}
					/>
				) : null
			}
			headerAction={
				/* Spins for a DISCOVERY only, never for a pick: the row's own marker
				 *  carries a pick (D12), and `Button` ignores presses while `loading`,
				 *  so a slow Refresh absorbs repeat taps instead of stacking requests
				 *  (U4) — the banner's Try now already worked this way. Refresh is
				 *  hidden while signed out: a listing with no grant can only be refused
				 *  again. */
				showSwitch || showRefresh ? (
					<View className="flex-row flex-wrap items-center gap-1">
						{/* The switcher beside Refresh: this screen lists only the account's
						 *  Radient computers, and the switcher is the one place that also
						 *  holds the reader's own-address computers and the removed ones.
						 *  So it stays visible exactly where this list cannot help — an
						 *  empty or set-up list, or signed out — whenever this phone knows
						 *  a computer (PR #122 QA round 1, Q3; review n2; UX round 1, U5).
						 *  Labelled as in Settings: a bare "Switch" beside "Refresh" did
						 *  not say what it switches (U5). */}
						{showSwitch ? (
							<Button
								testID={CONTROL.computersSwitch}
								label={t("mobile.computers.switch")}
								onPress={switcher.open}
								variant="outline"
								size="sm"
							/>
						) : null}
						{showRefresh ? (
							<Button
								testID={CONTROL.computersRefresh}
								label={t("mobile.computers.refresh")}
								onPress={() => void refreshComputers()}
								variant="outline"
								size="sm"
								loading={discovering}
							/>
						) : null}
					</View>
				) : null
			}
		>
			<TeamBridgeEntry />
			{refusal ? (
				<RefusalSurface
					kind={refusal.kind}
					subject={refusal.subject}
					detail={refusal.detail}
					remedy={refusal.remedy}
					retryAfterMs={refusal.retryAfterMs}
					onRetry={() => void retry()}
					/* The existing sign-in action, in place: it ends the refused route,
					 *  hands off to the browser, and lists this account's computers when
					 *  it returns (Q-r2-2). */
					onSignIn={() => void signInWithRadient()}
					/* The console-side causes' one remedy, as Settings offers it: the
					 *  surface tells the reader to open the console, so a screen that
					 *  passes no handler printed the instruction with no way to follow it
					 *  (PR #122 QA round 3, Q7). */
					onOpenConsole={() =>
						void WebBrowser.openBrowserAsync(RADIENT_CONSOLE_TUNNELS_URL)
					}
					onUseAnotherAddress={() => router.push("/custom")}
				/>
			) : null}

			{/* The hand-off's progress, where the button that started it was. Without
			 *  it the screen went blank while the browser was open. */}
			{signInPending ? (
				<SignInPanel
					state={signInState}
					diagnostics={signInDiagnostics}
					onStart={() => void signInWithRadient()}
					onUseAddress={() => undefined}
				/>
			) : null}

			{/* A failed discovery says so in a banner and leaves the cached rows below
			 *  it: the cold-start rule, and the difference between stale and blank.
			 *  It is the store's own discovery failure, not the route's refusal, so
			 *  "Try now" re-runs discovery itself (D2/D3: it used to re-run a route
			 *  action that, with no route, did nothing). It goes away on the next
			 *  successful discovery, never on a dismiss (`banner.tsx`). */}
			{view.banner ? (
				<Banner
					testID={CONTROL.computersBanner}
					tone="warning"
					message={t(view.banner)}
					action={{
						label: t("mobile.computers.try_now"),
						onPress: () => void refreshComputers(),
						loading: discovering,
						testID: CONTROL.computersRetryAction,
					}}
				/>
			) : null}

			{view.skeleton ? (
				<View className="gap-3 pt-4">
					<Skeleton lines={1} />
					<Skeleton lines={1} />
				</View>
			) : null}

			{/* The rows stay under a refusal too. A failed mint is about ONE computer;
			 *  hiding the others left the reader nothing to pick instead (D1). */}
			{view.list ? (
				<View testID={REGION.computersList} className="gap-2">
					<SectionHeader label={t("mobile.computers.list.heading")} />
					{computers.map((computer) => (
						<ComputerRow
							key={computer.tunnelId}
							computer={computer}
							state={rowState(computer, { tunnelId, phase })}
							reachability={
								phase === "live" &&
								route?.mode === "radient" &&
								route.hostname === computer.hostname
									? "answered"
									: "protected"
							}
							onPress={() => pick(computer)}
							onRemove={() => setRemoveTarget(computer)}
						/>
					))}
				</View>
			) : null}

			{!empty && !waiting ? (
				<Button
					label={t("mobile.computers.own_tunnel_instead")}
					onPress={() => router.push("/own-tunnel")}
					variant="quiet"
					size="sm"
					testID={CONTROL.ownTunnelPathAction}
				/>
			) : null}

			{empty ? (
				<>
					{waiting ? null : (
						/* Both paths, named, on the screen where the choice is made. The
						 *  Radient half is expanded because it is recommended and needs
						 *  nothing configured; the own-tunnel half is one tap away and needs
						 *  no account at all — see `tunnel-paths.tsx` for why that is stated
						 *  here rather than hidden behind a "custom URL" field. */
						<TunnelPaths onOwnTunnel={() => router.push("/own-tunnel")}>
							<SetupComputer
								billing={billing}
								onWaitForConnector={startWaiting}
								waiting={false}
							/>
						</TunnelPaths>
					)}
					{waiting && !addedComputerLive ? (
						<View className="gap-3 pt-2">
							<WaitPanel
								state={wait.state}
								appeared={appeared}
								/* Unreachable once the pick is live, and guarded anyway: a second
								 *  mint from a stale control would retire a working route (Q8/U19). */
								onUse={() => {
									if (!addedComputerLive && appeared) pick(appeared);
								}}
								onStop={() => setWaiting(false)}
							/>
						</View>
					) : null}
					{addedComputerLive ? (
						<View className="gap-1 rounded-sm border border-hairline bg-surface p-4">
							<Text className="text-body text-ink" {...composedDir}>
								{t("mobile.computers.added.connected_to", {
									name:
										appeared?.name ?? t("mobile.computers.added.fallback_name"),
								})}
							</Text>
							<Text className="text-body-sm text-ink-muted" {...composedDir}>
								{t("mobile.computers.added.stays_listed")}
							</Text>
						</View>
					) : null}
				</>
			) : null}

			<Dialog
				visible={removeTarget !== null}
				title={t("mobile.computers.remove.title")}
				body={t("mobile.computers.remove.body")}
				confirmLabel={t("mobile.computers.remove.confirm")}
				onConfirm={() => {
					if (removeTarget) {
						/* Persisting the removal so discovery cannot undo it is
						 *  `removeComputer`'s job; the screen owns only the confirmation. */
						void removeComputer(connectionStore, removeTarget);
					}
					setRemoveTarget(null);
				}}
				onCancel={() => setRemoveTarget(null)}
				destructive
			/>
		</Screen>
	);
}
