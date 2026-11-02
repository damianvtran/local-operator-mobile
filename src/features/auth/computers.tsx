import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import {
	type ComputerStatus,
	type DiscoveredComputer,
	RADIENT_CONSOLE_TUNNELS_URL,
} from "@/connection";
import {
	useComputerSwitcher,
	usePhoneKnowsComputers,
} from "@/features/auth/computer-switcher-sheet";
import {
	backAction,
	computersView,
	landingAfterPick,
	newlyListed,
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
	probeHealth,
	useConnectorWait,
} from "@/features/auth/connector-wait";
import { removeComputer } from "@/features/auth/saved-computers-sync";
import { SetupComputer } from "@/features/auth/setup-computer";
import { SignInPanel } from "@/features/auth/sign-in-panel";
import { TunnelPaths } from "@/features/auth/tunnel-paths";
import { t } from "@/i18n";
import { TeamBridgeEntry } from "@/team-bridge/navigation";
import { CONTROL, computerRowIds, REGION, ROLE, SCREEN } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Badge } from "@/ui/components/badge";
import { Banner } from "@/ui/components/banner";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Shimmer } from "@/ui/components/shimmer";
import { Skeleton } from "@/ui/components/skeleton";
import { computersHeaderStackWidth } from "@/ui/size-class";

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

/** The relay's own status vocabulary, in the reader's terms. */
function statusLabel(status: ComputerStatus): {
	label: string;
	tone: "neutral" | "success" | "warning" | "danger" | "info";
} {
	switch (status) {
		case "ready":
			return { label: "route ready", tone: "success" };
		case "provisioning":
			return { label: "provisioning", tone: "info" };
		case "suspended":
			return { label: "suspended", tone: "warning" };
		case "off":
			return { label: "disabled", tone: "warning" };
		case "gone":
			return { label: "revoked", tone: "danger" };
		case "unknown":
			return { label: "unknown", tone: "neutral" };
	}
}

/** The probe's own answer, kept visibly separate from the row's status. */
type Reachability = "checking" | "answered" | "silent";

function reachabilityLabel(state: Reachability): {
	label: string;
	tone: "neutral" | "success" | "warning";
} {
	switch (state) {
		case "checking":
			return { label: "checking", tone: "neutral" };
		case "answered":
			return { label: "answering", tone: "success" };
		case "silent":
			return { label: "no answer", tone: "warning" };
	}
}

function lastSeen(computer: DiscoveredComputer): string | null {
	if (!computer.updatedAt) return null;
	const minutes = Math.round((Date.now() - computer.updatedAt) / 60_000);
	if (minutes < 1) return "seen just now";
	if (minutes < 60) return `last seen ${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `last seen ${hours} h ago`;
	return `last seen ${Math.round(hours / 24)} d ago`;
}

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
	const status = statusLabel(computer.status);
	const reach = reachabilityLabel(reachability);
	const seen = lastSeen(computer);
	const spinnerColor = useTokenColor("ink-muted");
	const selected = state === "active";
	const connecting = state === "connecting";

	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityState={{ selected, busy: connecting }}
			accessibilityLabel={`${computer.name}, ${status.label}, ${reach.label}${
				selected ? ", active" : connecting ? ", connecting" : ""
			}`}
			testID={ids.row}
			/* A second tap while this row is minting would start a second route and
			 *  retire the first mid-flight; the row says it is busy instead. */
			disabled={connecting}
			onPress={onPress}
			onLongPress={onRemove}
		>
			{({ pressed }) => (
				<View
					className={`gap-1 border-b border-hairline py-3 ${
						pressed ? "bg-row-hover" : ""
					}`}
				>
					<View className="flex-row items-center gap-2">
						<Text className="flex-1 text-body text-ink" numberOfLines={1}>
							{computer.name}
						</Text>
						{/* Selection is never colour alone: the marker is a word. */}
						{selected ? (
							<Text
								className="shrink-0 text-meta text-accent"
								testID={CONTROL.computerSelectedMarker}
							>
								active
							</Text>
						) : null}
						{/* The pending state a pick needs (design round 1, D1): the list stays
						 *  and the tapped row says what it is doing, in a word as well as the
						 *  kit's spinner, while the session is minted. */}
						{connecting ? (
							<View
								className="shrink-0 flex-row items-center gap-1"
								testID={CONTROL.computerConnectingMarker}
							>
								{/* The quiet Button's own spinner: same token, hidden from
								 *  assistive tech because the word beside it is the content. */}
								<ActivityIndicator
									size="small"
									color={spinnerColor}
									accessibilityElementsHidden
									importantForAccessibility="no"
								/>
								<Text className="text-meta text-ink-muted">
									{t("mobile.computers.connecting")}
								</Text>
							</View>
						) : null}
					</View>
					<Text
						className="text-mono-sm text-ink-dim"
						numberOfLines={1}
						ellipsizeMode="head"
					>
						{computer.hostname}
					</Text>
					{/* The two facts, each with its own identifier, so neither can be
					 *  asserted in place of the other. */}
					<View className="flex-row items-center gap-2 pt-1">
						<View testID={ids.status}>
							<Badge label={status.label} tone={status.tone} mono />
						</View>
						<View testID={ids.reachability}>
							<View className="flex-row items-center gap-1">
								<Badge label={reach.label} tone={reach.tone} mono />
							</View>
						</View>
						{seen && !selected ? (
							<Text className="shrink-0 text-meta text-ink-dim">{seen}</Text>
						) : null}
					</View>
					{!computer.supportsLocalOperator ? (
						<Text className="text-body-sm text-ink-muted">
							This computer is not running the Local Operator harness.
						</Text>
					) : null}
					{computer.billing.eligible === false ? (
						<Text className="text-body-sm text-warning">
							{computer.billing.message ??
								"Billing for this tunnel is inactive, so remote access will be refused."}
						</Text>
					) : null}
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
	return (
		<View className="gap-3 rounded-sm border border-hairline bg-surface p-4">
			{state.kind === "w1" ? (
				<Shimmer active>
					<Text className="text-body text-ink">
						Waiting for Radient to list your computer…
					</Text>
				</Shimmer>
			) : null}
			{state.kind === "w2" ? (
				<>
					<Text className="text-body text-ink">
						Radient has the tunnel — {state.tunnelStatus}.
					</Text>
					<Text className="text-body-sm text-ink-muted">
						{host
							? `Waiting for your computer at ${host} to answer. A provisioned route is not the same as a machine that is up.`
							: "Waiting for your computer to answer."}
					</Text>
				</>
			) : null}
			{state.kind === "w3" ? (
				<Text className="text-body text-ink">Your computer answered.</Text>
			) : null}
			{state.kind === "w3" &&
			(state.version !== null || state.sessions !== null) ? (
				<Text className="text-body-sm text-ink-muted">
					{state.version !== null
						? `Its relay reports protocol version ${state.version}`
						: "Its relay reports"}
					{state.sessions !== null
						? `${state.version !== null ? " and" : ""} ${state.sessions} running session${state.sessions === 1 ? "" : "s"}`
						: ""}
					.
				</Text>
			) : null}
			{state.kind === "w4" ? (
				<>
					<Text className="text-body text-ink">Nothing answered.</Text>
					<Text className="text-body-sm text-ink-muted">
						Three minutes with no tunnel listed and no host answering. Check the
						command ran on the computer, then start again.
					</Text>
				</>
			) : null}
			{state.kind === "w5" ? (
				<Text className="text-body text-ink-muted">
					Paused while the app is in the background. Reopen it to keep watching.
				</Text>
			) : null}

			<View className="gap-2">
				{state.kind === "w3" ? (
					<Button
						label="Use this computer"
						onPress={onUse}
						testID={CONTROL.computersUseThisComputer}
					/>
				) : null}
				<Button
					label="Start again"
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
	} = useConnection();

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
	const [reachability, setReachability] = useState<
		Record<string, Reachability>
	>({});
	const [removeTarget, setRemoveTarget] = useState<DiscoveredComputer | null>(
		null,
	);

	/** The probe, once per computer on view. It is the ONLY way a phone learns
	 *  whether a machine is up (`docs/relay/tunnel-edge.md` § 4). */
	useEffect(() => {
		let live = true;
		for (const computer of computers) {
			if (!computer.supportsLocalOperator) continue;
			if (
				reachability[computer.hostname] &&
				reachability[computer.hostname] !== "checking"
			)
				continue;
			void probeHealth(computer.hostname).then((health) => {
				if (!live) return;
				setReachability((current) => ({
					...current,
					[computer.hostname]: health ? "answered" : "silent",
				}));
			});
		}
		return () => {
			live = false;
		};
	}, [computers, reachability]);

	/* The computers listed when the wait started. "Add a computer" opens the set-up
	 *  path over an account that already has some (U12), and the wait is for the
	 *  NEW one: the first listed computer would otherwise be offered as the one that
	 *  just appeared. Empty for an empty account, so that path is unchanged. */
	const listedAtWait = useRef<ReadonlySet<string>>(new Set());
	/* Lists again, then answers with the computer that appeared since the wait
	 *  started — the hook's only way past W1 (R3-M1/U17, `newlyListed`). Read from
	 *  the store, not the render's `computers`: the refresh has just written it, and
	 *  this closure predates that render. `rawStatus` is Radient's own word, which
	 *  W2 shows verbatim. */
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
			title={view.title}
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
			/* The way back. Every sibling screen in this flow has one (`own-tunnel`,
			 *  `sign-in`, `settings`), and "Set up a computer" is reachable from the list,
			 *  from Settings and from a refusal surface — arriving from any of them with
			 *  no back control leaves the platform gesture as the only exit (D7). */
			headerLeading={
				/* As the cold-start root with no route there is nowhere to go back to
				 *  (Home's landing effect returns a restored account here), so the
				 *  control is absent rather than inert (U1, `backAction`). */
				back ? (
					<Button
						testID={CONTROL.computersBack}
						label="Back"
						onPress={() =>
							back === "pop" ? router.back() : router.replace("/")
						}
						variant="quiet"
						size="sm"
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
								variant="quiet"
								size="sm"
							/>
						) : null}
						{showRefresh ? (
							<Button
								testID={CONTROL.computersRefresh}
								label="Refresh"
								onPress={() => void refreshComputers()}
								variant="quiet"
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
					message={view.banner}
					action={{
						label: "Try now",
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
				<View testID={REGION.computersList}>
					<SectionHeader label="Your computers" />
					{computers.map((computer) => (
						<ComputerRow
							key={computer.tunnelId}
							computer={computer}
							state={rowState(computer, { tunnelId, phase })}
							reachability={reachability[computer.hostname] ?? "checking"}
							onPress={() => pick(computer)}
							onRemove={() => setRemoveTarget(computer)}
						/>
					))}
				</View>
			) : null}

			{!empty && !waiting ? (
				<Button
					label="Use my own tunnel instead"
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
							<Text className="text-body text-ink">
								Connected to {appeared?.name ?? "your computer"}.
							</Text>
							<Text className="text-body-sm text-ink-muted">
								{t("mobile.computers.added.stays_listed")}
							</Text>
						</View>
					) : null}
				</>
			) : null}

			<Dialog
				visible={removeTarget !== null}
				title="Remove this computer?"
				body="This removes it from the list on this phone. It does not touch the computer, its tunnel, or your account."
				confirmLabel="Remove"
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
