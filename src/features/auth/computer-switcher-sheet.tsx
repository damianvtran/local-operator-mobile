import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Check, Laptop, Plus, Server } from "lucide-react-native";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { RADIENT_CONSOLE_TUNNELS_URL } from "@/connection";
import type { SavedComputer } from "@/connection/saved-computers";
import {
	healthLabel,
	type ProbeState,
	pendingKeyFor,
	pendingLanded,
	performSwitcherTap,
	type SwitcherHealth,
	type SwitcherRow,
	stableSections,
	switcherSections,
	switcherTap,
} from "@/features/auth/computer-switcher-view";
import {
	connectionStore,
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import { probeHealthAt } from "@/features/auth/connector-wait";
import {
	readSavedComputers,
	unhideRadientComputer,
	unhideSavedComputer,
} from "@/features/auth/tunnel-storage";
import { CONTROL, REGION, ROLE, SURFACE, switcherRowIds } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Button } from "@/ui/components/button";
import { SectionHeader } from "@/ui/components/section-header";
import { Sheet } from "@/ui/components/sheet";

/**
 * The computer switcher: one bottom sheet listing every computer this phone
 * knows, Radient or own-address, with an honest health word for each (ux-flows
 * F5; decisions in `computer-switcher-view.ts`).
 *
 * ONE sheet, several entry points. It is mounted once, by
 * `ComputerSwitcherProvider`, and every entry point calls `useComputerSwitcher()
 * .open()` — the Computers header and Settings in this slice, the Home chip and
 * the drawer row in the next (M2b) with one line each. A sheet per screen would
 * be two lists that could disagree about the same computer.
 */

type SwitcherContextValue = { open: () => void };

const SwitcherContext = createContext<SwitcherContextValue | null>(null);

/** Opens the computer switcher. Needs `ComputerSwitcherProvider` above it (the
 *  root layout mounts it), for the same reason `useConnection` needs its provider:
 *  a second sheet would be a second list. */
export function useComputerSwitcher(): SwitcherContextValue {
	const value = useContext(SwitcherContext);
	if (!value)
		throw new Error(
			"useComputerSwitcher needs the ComputerSwitcherProvider: it owns the one switcher sheet",
		);
	return value;
}

export function ComputerSwitcherProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [visible, setVisible] = useState(false);
	const value = useMemo(() => ({ open: () => setVisible(true) }), []);
	return (
		<SwitcherContext.Provider value={value}>
			{children}
			<ComputerSwitcherSheet
				visible={visible}
				onClose={() => setVisible(false)}
			/>
		</SwitcherContext.Provider>
	);
}

/** The dot's token per health. A token ROLE, as in `connection-pill.tsx`:
 *  "Checking…" and "Asleep" are not failures, so they get no alarm colour. */
const DOT_TOKEN: Record<
	SwitcherHealth["kind"],
	"success" | "warning" | "ink-dim"
> = {
	online: "success",
	asleep: "ink-dim",
	"sign-in": "warning",
	paused: "warning",
	checking: "ink-dim",
};

const WORD_CLASS: Record<SwitcherHealth["kind"], string> = {
	online: "text-success",
	asleep: "text-ink-muted",
	"sign-in": "text-warning",
	paused: "text-warning",
	checking: "text-ink-muted",
};

const HealthWord = ({
	row,
	now,
	testID,
}: {
	row: SwitcherRow;
	now: number;
	testID: string;
}) => {
	const dot = useTokenColor(DOT_TOKEN[row.health.kind]);
	const word = healthLabel(row.health, now);
	return (
		<View className="shrink-0 flex-row items-center gap-1" testID={testID}>
			{/* Decoration: the word beside it is the content (never colour alone). */}
			<View
				className="h-1.5 w-1.5 rounded-full"
				style={{ backgroundColor: dot }}
				aria-hidden
			/>
			<Text className={`text-meta ${WORD_CLASS[row.health.kind]}`}>{word}</Text>
		</View>
	);
};

const TransportTag = ({ row }: { row: SwitcherRow }) => (
	<View className="flex-row flex-wrap items-center gap-2">
		<View className="self-start rounded-sm border border-hairline px-2 py-0.5">
			<Text className="text-meta text-ink-muted">
				{row.transport.kind === "radient" ? "Radient" : "Your address"}
			</Text>
		</View>
		{row.transport.kind === "custom" ? (
			<Text
				className="shrink text-mono-sm text-ink-dim"
				numberOfLines={1}
				ellipsizeMode="middle"
			>
				{row.transport.host}
			</Text>
		) : null}
	</View>
);

const SwitcherRowView = ({
	row,
	now,
	onPress,
	section,
}: {
	row: SwitcherRow;
	now: number;
	onPress: () => void;
	section: "on-phone" | "not-connected";
}) => {
	const ids = switcherRowIds(row.key);
	const accent = useTokenColor("accent");
	const muted = useTokenColor("ink-muted");
	const Glyph = row.transport.kind === "custom" ? Server : Laptop;
	const word = healthLabel(row.health, now);
	const transportLabel =
		row.transport.kind === "radient"
			? "Radient"
			: `Your address, ${row.transport.host}`;
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityState={{ selected: row.active, busy: row.connecting }}
			accessibilityLabel={`${row.name}, ${transportLabel}, ${word}${
				row.active ? ", in use" : row.connecting ? ", connecting" : ""
			}`}
			testID={ids.row}
			/* A second tap while this row connects would start a second route and
			 *  retire the first mid-flight; the row says it is busy instead. */
			disabled={row.connecting}
			onPress={onPress}
		>
			{({ pressed }) => (
				<View
					className={`flex-row items-center gap-3 border-b border-hairline py-3 ${
						row.active ? "bg-row-hover" : pressed ? "bg-row-hover" : ""
					}`}
				>
					{/* The check sits in its own column so names line up whether or not
					 *  a row is active (frame p5-switcher-sheet). */}
					<View className="w-5 items-center">
						{row.active ? <Check size={18} color={accent} /> : null}
					</View>
					<Glyph size={20} color={muted} />
					<View className="min-w-0 flex-1 gap-1">
						<View className="flex-row items-center gap-2">
							<Text className="flex-1 text-body text-ink" numberOfLines={1}>
								{row.name}
							</Text>
							{row.connecting ? (
								<View className="shrink-0 flex-row items-center gap-1">
									<ActivityIndicator
										size="small"
										color={muted}
										accessibilityElementsHidden
										importantForAccessibility="no"
									/>
									<Text className="text-meta text-ink-muted">Connecting…</Text>
								</View>
							) : (
								<HealthWord row={row} now={now} testID={ids.health} />
							)}
						</View>
						<TransportTag row={row} />
						{section === "not-connected" ? (
							<Text className="text-meta text-ink-dim">
								{row.hidden
									? "Removed from this phone. Tap to bring it back."
									: "Tap to connect"}
							</Text>
						) : null}
					</View>
				</View>
			)}
		</Pressable>
	);
};

/**
 * The sheet. Exported for a test host; the app reaches it only through
 * `useComputerSwitcher().open()`.
 */
export function ComputerSwitcherSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const router = useRouter();
	const {
		selectComputer,
		connectCustom,
		signInWithRadient,
		savedTunnel,
		refusal,
	} = useConnection();
	const discovered = useConnectionState((state) => state.discoveredComputers);
	const phase = useConnectionState((state) => state.phase);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const computerId = useConnectionState((state) => state.computerId);
	const hiddenTunnelIds = useConnectionState((state) => state.hiddenTunnelIds);

	const [saved, setSaved] = useState<SavedComputer[]>([]);
	/* The order is frozen only once the registry has answered: freezing on the first
	 *  render would freeze a discovery-only list, and every saved computer would then
	 *  be appended below it as "new" — the wrong order, held for the whole open. */
	const [loaded, setLoaded] = useState(false);
	const [probes, setProbes] = useState<Record<string, ProbeState>>({});
	const [answeredAt, setAnsweredAt] = useState<Record<string, number>>({});
	const [pendingKey, setPendingKey] = useState<string | null>(null);
	/* The order the sheet opened with (`stableSections`): rows must not move under
	 *  the finger as probes answer. A ref, not state: it changes only at open. */
	const order = useRef<string[] | null>(null);
	const [now, setNow] = useState(() => Date.now());

	/* Re-read on every open: the registry changes behind the sheet (a route went
	 *  live, a Remove on the Computers screen), and the switcher is opened rarely
	 *  enough that a keystore read per open costs nothing. `computerId` and the
	 *  hidden set are dependencies so a reconnect made FROM the sheet shows up. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: see the comment above — `computerId` and `hiddenTunnelIds` are TRIGGERS for a re-read, not reads.
	useEffect(() => {
		if (!visible) {
			order.current = null;
			setLoaded(false);
			setPendingKey(null);
			return;
		}
		setNow(Date.now());
		let live = true;
		void readSavedComputers().then((entries) => {
			if (!live) return;
			setSaved(entries);
			setLoaded(true);
		});
		return () => {
			live = false;
		};
	}, [visible, computerId, hiddenTunnelIds]);

	const radientSignedOut = refusal?.kind === "sign-in";
	const computed = switcherSections({
		saved,
		discovered,
		probes,
		answeredAt,
		route: { phase, tunnelId },
		activeComputerId: computerId,
		pendingKey,
		radientSignedOut,
	});
	const { sections, order: nextOrder } = stableSections(
		computed,
		order.current,
	);
	if (visible && loaded) order.current = nextOrder;

	/* One probe per origin per open: the phone's own `/healthz`, the only signal
	 *  that may say "Online". Results stay for the sheet's life so reopening within
	 *  a run starts from the last answer instead of "Checking…" on every row. */
	const origins = useMemo(
		() =>
			[...sections.onPhone, ...sections.notConnected]
				.filter((row) => row.health.kind !== "sign-in")
				.map((row) => row.origin),
		[sections],
	);
	const probedThisOpen = useRef(new Set<string>());
	useEffect(() => {
		if (!visible) {
			probedThisOpen.current = new Set();
			return;
		}
		let live = true;
		for (const origin of origins) {
			if (probedThisOpen.current.has(origin)) continue;
			probedThisOpen.current.add(origin);
			setProbes((current) =>
				current[origin] ? current : { ...current, [origin]: "checking" },
			);
			void probeHealthAt(origin).then((health) => {
				if (!live) return;
				setProbes((current) => ({
					...current,
					[origin]: health ? "answered" : "silent",
				}));
				if (health)
					setAnsweredAt((current) => ({ ...current, [origin]: Date.now() }));
			});
		}
		return () => {
			live = false;
		};
	}, [visible, origins]);

	const slot = savedTunnel
		? {
				baseUrl: savedTunnel.baseUrl,
				password: savedTunnel.password,
				allowInsecure: savedTunnel.allowInsecure,
			}
		: null;

	const tap = useCallback(
		(row: SwitcherRow) => {
			const action = switcherTap(row, slot);
			const pending = pendingKeyFor(action);
			if (pending !== null) setPendingKey(pending);
			void performSwitcherTap(action, {
				selectComputer,
				connectCustom,
				signInWithRadient,
				close: onClose,
				unhide: ({ savedId, tunnelId: hiddenTunnel }) => {
					/* The store first, so the computer is back in every list at once;
					 *  the registry write is best effort (see `unhideSavedComputer`). */
					connectionStore.getState().unhideComputer(hiddenTunnel);
					void (savedId
						? unhideSavedComputer(savedId)
						: unhideRadientComputer(hiddenTunnel));
				},
				enterPassword: (url, allowInsecure) =>
					router.push({
						pathname: "/own-tunnel",
						params: allowInsecure ? { url, insecure: "1" } : { url },
					}),
				openConsole: () =>
					void WebBrowser.openBrowserAsync(RADIENT_CONSOLE_TUNNELS_URL),
			});
		},
		[connectCustom, onClose, router, selectComputer, signInWithRadient, slot],
	);

	/* Closes once the tapped computer is in use: the reader picked it, and the
	 *  sheet staying up over a live route is a step they would have to undo. */
	const landed = pendingLanded(sections, pendingKey);
	useEffect(() => {
		if (visible && landed) onClose();
	}, [visible, landed, onClose]);

	const empty =
		sections.onPhone.length === 0 && sections.notConnected.length === 0;

	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title="Computers"
			testID={SURFACE.computerSwitcherSheet}
			footer={
				<Button
					label="Add a computer"
					leadingIcon={({ color, size }) => <Plus color={color} size={size} />}
					onPress={() => {
						onClose();
						/* The existing set-up flows: the Computers screen offers both
						 *  Radient set-up and "Use my own tunnel instead", so the switcher
						 *  does not grow a second copy of that choice. */
						router.push("/tunnels");
					}}
					variant="outline"
					testID={CONTROL.switcherAddComputer}
				/>
			}
		>
			{empty ? (
				<Text className="py-4 text-body text-ink-muted">
					No computers on this phone yet.
				</Text>
			) : null}
			{sections.onPhone.length > 0 ? (
				<View testID={REGION.switcherOnPhone}>
					<SectionHeader label="On this phone" />
					{sections.onPhone.map((row) => (
						<SwitcherRowView
							key={row.key}
							row={row}
							now={now}
							section="on-phone"
							onPress={() => tap(row)}
						/>
					))}
				</View>
			) : null}
			{sections.notConnected.length > 0 ? (
				<View testID={REGION.switcherNotConnected}>
					<SectionHeader label="On your Radient account, not connected" />
					{sections.notConnected.map((row) => (
						<SwitcherRowView
							key={row.key}
							row={row}
							now={now}
							section="not-connected"
							onPress={() => tap(row)}
						/>
					))}
				</View>
			) : null}
		</Sheet>
	);
}
