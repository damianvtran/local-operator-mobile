import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { ComputerStatus, DiscoveredComputer } from "@/connection";
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
import { SetupComputer } from "@/features/auth/setup-computer";
import { TunnelPaths } from "@/features/auth/tunnel-paths";
import { CONTROL, computerRowIds, REGION, ROLE, SCREEN } from "@/ui/a11y";
import { Badge } from "@/ui/components/badge";
import { Banner } from "@/ui/components/banner";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Shimmer } from "@/ui/components/shimmer";
import { Skeleton } from "@/ui/components/skeleton";

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
	selected,
	reachability,
	onPress,
	onRemove,
}: {
	computer: DiscoveredComputer;
	selected: boolean;
	reachability: Reachability;
	onPress: () => void;
	onRemove: () => void;
}) => {
	const ids = computerRowIds(computer.hostname);
	const status = statusLabel(computer.status);
	const reach = reachabilityLabel(reachability);
	const seen = lastSeen(computer);

	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityState={{ selected }}
			accessibilityLabel={`${computer.name}, ${status.label}, ${reach.label}${
				selected ? ", active" : ""
			}`}
			testID={ids.row}
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
				<>
					<Text className="text-body text-ink">Your computer answered.</Text>
					<Text className="text-body-sm text-ink-muted">
						Its relay reports protocol version {state.version ?? "unknown"}
						{state.sessions !== null
							? ` and ${state.sessions} running session${state.sessions === 1 ? "" : "s"}`
							: ""}
						.
					</Text>
				</>
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
		busy,
		refusal,
	} = useConnection();

	const computers = useConnectionState((state) => state.computers);
	const phase = useConnectionState((state) => state.phase);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const detail = useConnectionState((state) => state.detail);

	/* Nothing to list and nothing in flight: the set-up path (F-2). The in-flight
	 *  signal is the provider's `discovering` flag, not a store phase — listing an
	 *  account's computers happens before any route exists. */
	const empty = computers.length === 0 && !discovering;
	const [waiting, setWaiting] = useState(false);
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

	const acquire = useCallback(async () => {
		await refreshComputers();
		return null;
	}, [refreshComputers]);

	const wait = useConnectorWait({ acquire, enabled: waiting });
	const appeared = useMemo(
		() => computers.find((computer) => computer.supportsLocalOperator) ?? null,
		[computers],
	);

	return (
		<Screen
			title={empty ? "Set up a computer" : "Computers"}
			testID={SCREEN.computers}
			headerAction={
				!empty ? (
					<Button
						testID={CONTROL.computersRefresh}
						label="Refresh"
						onPress={() => void refreshComputers()}
						variant="quiet"
						size="sm"
						loading={busy}
					/>
				) : null
			}
		>
			{refusal ? (
				<RefusalSurface
					kind={refusal.kind}
					subject={refusal.subject}
					detail={refusal.detail}
					remedy={refusal.remedy}
					retryAfterMs={refusal.retryAfterMs}
					onRetry={() => void retry()}
					onUseAnotherAddress={() => router.push("/custom")}
				/>
			) : null}

			{/* A failure that kept the list on screen says so in a banner and leaves
			 *  the cached rows below it: the cold-start rule, and the difference
			 *  between stale and blank. */}
			{!refusal && computers.length > 0 && detail ? (
				<Banner
					testID={CONTROL.computersBanner}
					tone="warning"
					message={detail}
					action={{
						label: "Retry",
						onPress: () => void refreshComputers(),
						testID: CONTROL.computersRetryAction,
					}}
				/>
			) : null}

			{phase === "discovering" && computers.length === 0 ? (
				<View className="gap-3 pt-4">
					<Skeleton lines={1} />
					<Skeleton lines={1} />
				</View>
			) : null}

			{!refusal && computers.length > 0 ? (
				<View testID={REGION.computersList}>
					<SectionHeader label="Your computers" />
					{computers.map((computer) => (
						<ComputerRow
							key={computer.tunnelId}
							computer={computer}
							selected={computer.tunnelId === tunnelId}
							reachability={reachability[computer.hostname] ?? "checking"}
							onPress={() => void selectComputer(computer)}
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
								onWaitForConnector={() => setWaiting(true)}
								waiting={false}
							/>
						</TunnelPaths>
					)}
					{waiting ? (
						<View className="gap-3 pt-2">
							<WaitPanel
								state={wait.state}
								appeared={appeared}
								onUse={() => appeared && void selectComputer(appeared)}
								onStop={() => setWaiting(false)}
							/>
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
						// The store owns the list; the screen owns only the confirmation.
						/* Forgetting is local to this phone, and the store's
						 *  `setComputers` is the one list it keeps: filtering here rather
						 *  than adding a second mutation API for one screen. */
						connectionStore
							.getState()
							.setComputers(
								computers.filter(
									(candidate) => candidate.tunnelId !== removeTarget.tunnelId,
								),
							);
					}
					setRemoveTarget(null);
				}}
				onCancel={() => setRemoveTarget(null)}
				destructive
			/>
		</Screen>
	);
}
