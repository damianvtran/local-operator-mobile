import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
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
	addComputerTarget,
	healthLabel,
	type ProbeState,
	pendingKeyFor,
	pendingLanded,
	performSwitcherTap,
	pickFailed,
	rowHint,
	type SwitcherHealth,
	type SwitcherRow,
	stableSections,
	switcherSections,
	switcherTap,
} from "@/features/auth/computer-switcher-view";
import { ADD_COMPUTER_HREF } from "@/features/auth/computers-view";
import {
	connectionStore,
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import { probeHealthAt } from "@/features/auth/connector-wait";
import {
	readSavedComputers,
	readStoredRadientAccount,
	unhideRadientComputer,
	unhideSavedComputer,
} from "@/features/auth/tunnel-storage";
import { t } from "@/i18n";
import { CONTROL, REGION, ROLE, SURFACE, switcherRowIds } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { SectionHeader } from "@/ui/components/section-header";
import { Sheet } from "@/ui/components/sheet";
import { TOUCH_FLOOR } from "@/ui/layout";
import { avatarClasses, cx } from "@/ui/variants";

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

type SwitcherContextValue = {
	open: (options?: { returnFocusTestID?: string | readonly string[] }) => void;
	/** Whether the sheet is up. A screen that reacts to what a pick left behind
	 *  waits for it to go down: Settings scrolls a refusal into view only after the
	 *  sheet closed, because the close returns focus to the opener, and on the web
	 *  that focus scrolls the opener back into view (PR #122 UX round 3, U16). */
	visible: boolean;
};

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
	/* Only up/down. The web dismissal this close owes (RNW's focus return to the
	 *  opener) is recorded by the kit's `Sheet` in `@/ui/modal-dismissal-ledger`,
	 *  with every other modal's, so a screen waits on all of them in one place
	 *  (PR #122 QA round 6, Q9) rather than on this provider's count alone. */
	const [visible, setVisible] = useState(false);
	const [returnFocusTestID, setReturnFocusTestID] = useState<
		string | readonly string[] | undefined
	>();
	const close = useCallback(() => setVisible(false), []);
	const value = useMemo(
		() => ({
			open: (options?: { returnFocusTestID?: string | readonly string[] }) => {
				setReturnFocusTestID(options?.returnFocusTestID);
				setVisible(true);
			},
			visible,
		}),
		[visible],
	);
	return (
		<SwitcherContext.Provider value={value}>
			{children}
			<ComputerSwitcherSheet
				visible={visible}
				onClose={close}
				returnFocusTestID={returnFocusTestID}
			/>
		</SwitcherContext.Provider>
	);
}

/**
 * Whether this phone has saved any computer it may show, for the entry points that
 * would otherwise hide the switcher with the account's list: the Computers screen
 * in its empty / set-up / signed-out states is exactly where the own-address rows
 * and the "Sign in again" rows are the way out (QA round 1, Q3; UX round 1, U5).
 * Re-read whenever the live computer or the removed set changes, like the sheet.
 */
export function usePhoneKnowsComputers(): boolean {
	const computerId = useConnectionState((state) => state.computerId);
	const hiddenTunnelIds = useConnectionState((state) => state.hiddenTunnelIds);
	const [knows, setKnows] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `computerId` and `hiddenTunnelIds` are TRIGGERS for a re-read, not reads.
	useEffect(() => {
		let live = true;
		void readSavedComputers().then((entries) => {
			if (live) setKnows(entries.some((entry) => !entry.hidden));
		});
		return () => {
			live = false;
		};
	}, [computerId, hiddenTunnelIds]);
	return knows;
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
	protected: "ink-dim",
	refused: "warning",
};

/* The word's ink. `online` is muted, not green: the dot already carries the
 *  success role, and a green word beside a green dot repeated the same signal at
 *  body weight (operator: "it looks ugly"). The warning states keep the warning
 *  ink, so a computer that needs the reader still reads apart from a resting one
 *  without the dot — never colour alone, never the dot alone. */
const WORD_CLASS: Record<SwitcherHealth["kind"], string> = {
	online: "text-ink-muted",
	asleep: "text-ink-muted",
	"sign-in": "text-warning",
	paused: "text-warning",
	checking: "text-ink-muted",
	protected: "text-ink-muted",
	refused: "text-warning",
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

/* The row's geometry, shared by the computer rows and the add row so the add
 *  row's label starts on the names' x. A grouped list, not a ruled one: rounded
 *  `md` rows (the drawer computer row's radius) inside the sheet's own `px-4`
 *  gutter, so both edges carry the same inset — the old row ran edge to edge
 *  with a leading accent bar and its status word touched the trailing edge. No
 *  hairlines inside the group: the rows' own fill and spacing separate them. */
const ROW_CLASS = "flex-row items-center gap-3 rounded-md px-3";

/** The leading glyph's soft circle: the kit's small avatar (`radius.full` on
 *  `accent-muted`), so a computer reads as the same kind of object it is in the
 *  drawer and the pickers' list rows rather than as a bare icon. */
const GLYPH_CIRCLE = avatarClasses("sm");

/* An own address saved without a name is titled by its host (the add flow's
 *  default), so line 2 repeating the host said the same string twice (design
 *  round 1, D1). Such a title is an address, not a label: it truncates in the
 *  middle so the port — the only part telling two local addresses apart — stays
 *  visible, as the header pill does, and line 2 names the transport instead. */
const titledByHost = (row: SwitcherRow): boolean =>
	row.transport.kind === "custom" && row.name === row.transport.host;

/* `·` joins the second line's facts the way the drawer row's `Mac mini · Online`
 *  does — one list language across the drawer, the pickers and this sheet. The
 *  health dot is itself a separator, so `·` goes only where no dot follows (the
 *  connecting word); `· ●` read as two dots side by side (design round 1, D2). */
const TransportLine = ({
	row,
	now,
	healthTestID,
}: {
	row: SwitcherRow;
	now: number;
	healthTestID: string;
}) => (
	<View className="min-w-0 flex-row items-center gap-1">
		{row.transport.kind === "radient" ? (
			<Text className="shrink-0 text-meta text-ink-muted">
				{t("mobile.computers.transport.radient")}
			</Text>
		) : titledByHost(row) ? (
			<Text className="shrink-0 text-meta text-ink-muted">
				{t("mobile.computers.transport.custom")}
			</Text>
		) : (
			<Text
				className="shrink text-mono-sm text-ink-muted"
				numberOfLines={1}
				ellipsizeMode="middle"
			>
				{row.transport.host}
			</Text>
		)}
		{row.connecting ? (
			<>
				<Text className="shrink-0 text-meta text-ink-dim" aria-hidden>
					·
				</Text>
				<Text className="shrink-0 text-meta text-ink-muted">
					{t("mobile.computers.connecting")}
				</Text>
			</>
		) : (
			<HealthWord row={row} now={now} testID={healthTestID} />
		)}
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
	const glyphInk = useTokenColor("ink");
	const Glyph = row.transport.kind === "custom" ? Server : Laptop;
	const word = healthLabel(row.health, now);
	const hint = rowHint(row, section);
	/* Spoken in full: the host is said even when line 2 shows only "Your
	 *  address", because a screen reader cannot see the title's truncation. */
	const transportLabel =
		row.transport.kind === "radient"
			? t("mobile.computers.transport.radient")
			: `${t("mobile.computers.transport.custom")}, ${row.transport.host}`;
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
					/* 56 pt (`min-h-14`) with a two-line body: above the 44/48 touch
					 *  floor on every platform, and the pickers' 2-line row height. */
					className={cx(
						ROW_CLASS,
						"min-h-14 py-2",
						row.active
							? "bg-row-selected"
							: pressed
								? "bg-row-hover"
								: "bg-transparent",
					)}
				>
					<View className={GLYPH_CIRCLE} aria-hidden>
						<Glyph size={16} color={glyphInk} />
					</View>
					<View className="min-w-0 flex-1 gap-0.5">
						<Text
							className="text-body-sm font-medium text-ink"
							numberOfLines={1}
							ellipsizeMode={titledByHost(row) ? "middle" : "tail"}
						>
							{row.name}
						</Text>
						<TransportLine row={row} now={now} healthTestID={ids.health} />
						{hint !== null ? (
							<Text className="text-meta text-ink-dim">{hint}</Text>
						) : null}
					</View>
					{/* ONE selection signal: the trailing check, as in the pickers'
					 *  `ModelOptionRow`. `row-selected` is only a subtle ground — it
					 *  measured 1.16:1 light / 1.0:1 dark against the sheet (design round
					 *  1, D2), so it cannot carry selection alone; the `accent` check
					 *  (5.5:1 light / 6.3:1 dark on `elevated`, 4.5:1 / 6.1:1 on
					 *  `row-selected`) clears the 3:1 non-text floor, and ", in use" says
					 *  it to a screen reader. The slot is reserved in every state so the
					 *  health line never shifts when a row becomes active; a connecting
					 *  row shows its spinner in the same slot. */}
					<View className="w-5 shrink-0 items-center">
						{row.connecting ? (
							<ActivityIndicator
								size="small"
								color={muted}
								accessibilityElementsHidden
								importantForAccessibility="no"
							/>
						) : row.active ? (
							<Check size={18} color={accent} aria-hidden />
						) : null}
					</View>
				</View>
			)}
		</Pressable>
	);
};

/**
 * "Add a computer", as a quiet row under the group rather than a full-width
 * outlined footer button: the action is secondary to picking one of the listed
 * computers, and the outlined footer (with the pinned footer's hairline above
 * it) was visually heavier than the list it served. It takes the rows' own
 * geometry, so its `+` circle and label line up with the glyphs and names
 * above, at the platform touch floor.
 */
const AddComputerRow = ({ onPress }: { onPress: () => void }) => {
	const muted = useTokenColor("ink-muted");
	const label = t("mobile.computers.add");
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={label}
			testID={CONTROL.switcherAddComputer}
			onPress={onPress}
		>
			{({ pressed }) => (
				<View
					className={cx(ROW_CLASS, pressed ? "bg-row-hover" : "bg-transparent")}
					style={{ minHeight: TOUCH_FLOOR }}
				>
					<View
						className="h-8 w-8 items-center justify-center rounded-full border border-border-control"
						aria-hidden
					>
						<Plus size={16} color={muted} />
					</View>
					<Text className="min-w-0 flex-1 text-body-sm font-medium text-ink-muted">
						{label}
					</Text>
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
	returnFocusTestID,
}: {
	visible: boolean;
	onClose: () => void;
	returnFocusTestID?: string | readonly string[];
}) {
	const router = useRouter();
	const pathname = usePathname();
	const { add: addParam } = useGlobalSearchParams<{ add?: string }>();
	const {
		selectComputer,
		connectCustom,
		signInWithRadient,
		savedTunnel,
		refusal,
		discovering,
		signInState,
	} = useConnection();
	const discovered = useConnectionState((state) => state.discoveredComputers);
	const routeProfile = useConnectionState((state) => state.route);
	const surface = useConnectionState((state) => state.surface);
	const phase = useConnectionState((state) => state.phase);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const computerId = useConnectionState((state) => state.computerId);
	const hiddenTunnelIds = useConnectionState((state) => state.hiddenTunnelIds);

	const [saved, setSaved] = useState<SavedComputer[]>([]);
	/* The Radient account signed in on this phone, read with the registry: it scopes
	 *  the saved Radient computers (`radientEntryBelongs`, review round 1 M2). Read
	 *  from the stored grant rather than the provider's memory because a cold start on
	 *  an own address never loads the grant into memory (UX round 1, U3). */
	const [radientAccount, setRadientAccount] = useState<string | null>(null);
	/* The order is frozen only once the registry has answered: freezing on the first
	 *  render would freeze a discovery-only list, and every saved computer would then
	 *  be appended below it as "new" — the wrong order, held for the whole open. */
	const [loaded, setLoaded] = useState(false);
	const [probes, setProbes] = useState<Record<string, ProbeState>>({});
	const [answeredAt, setAnsweredAt] = useState<Record<string, number>>({});
	const [pendingKey, setPendingKey] = useState<string | null>(null);
	/* The same key, readable from a settled tap's continuation without a stale
	 *  closure: only the tap that is still pending may close the sheet on failure. */
	const pendingRef = useRef<string | null>(null);
	/* The order the sheet opened with (`stableSections`): rows must not move under
	 *  the finger as probes answer. A ref, not state: it changes only at open. */
	const order = useRef<string[] | null>(null);
	const [now, setNow] = useState(() => Date.now());
	/* The account the cached probe answers were gathered under (see the read). */
	const probedForAccount = useRef<string | null>(null);

	/* Re-read on every open: the registry changes behind the sheet (a route went
	 *  live, a Remove on the Computers screen), and the switcher is opened rarely
	 *  enough that a keystore read per open costs nothing. `computerId` and the
	 *  hidden set are dependencies so a reconnect made FROM the sheet shows up. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: see the comment above — `computerId` and `hiddenTunnelIds` are TRIGGERS for a re-read, not reads.
	useEffect(() => {
		if (!visible) {
			order.current = null;
			setLoaded(false);
			pendingRef.current = null;
			setPendingKey(null);
			/* The registry snapshot and its account are this OPEN's. Kept across a
			 *  close, the next open painted them for a frame — and probed them — before
			 *  its own read landed, so after an A→B sign-in one of A's computers
			 *  flashed and had its `/healthz` hit (PR #122 review round 2, m1). */
			setSaved([]);
			setRadientAccount(null);
			return;
		}
		setNow(Date.now());
		let live = true;
		void Promise.all([readSavedComputers(), readStoredRadientAccount()]).then(
			([entries, account]) => {
				if (!live) return;
				/* Another account's answers are not this one's: a host that answered
				 *  for A says nothing about B, so the cached words go with the account. */
				if (account !== probedForAccount.current) {
					probedForAccount.current = account;
					setProbes({});
					setAnsweredAt({});
				}
				setSaved(entries);
				setRadientAccount(account);
				setLoaded(true);
			},
		);
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
		routeProfile,
		surface,
		activeComputerId: computerId,
		pendingKey,
		radientSignedOut,
		radientAccount,
	});
	const { sections, order: nextOrder } = stableSections(
		computed,
		order.current,
	);
	if (visible && loaded) order.current = nextOrder;

	/* One probe per origin per open: the phone's own `/healthz`, the only signal
	 *  that may say "Online". Results stay for the sheet's life so reopening within
	 *  a run starts from the last answer instead of "Checking…" on every row.
	 *
	 *  The effect is keyed on the origins as a STRING and its answers are fenced on
	 *  the OPEN, not on the effect run. `sections` is rebuilt on every render, so an
	 *  effect keyed on an array derived from it re-ran on every render: the first
	 *  `setProbes("checking")` re-rendered, the cleanup marked that run dead, the
	 *  `probedThisOpen` guard stopped a re-probe, and every answer was thrown away —
	 *  the sheet said "Checking…" forever (PR #122 round 1: review B1, design D1, QA
	 *  Q1, UX U1). `computer-switcher-sheet.test.ts` renders the sheet to hold it. */
	const originsKey = [...sections.onPhone, ...sections.notConnected]
		.filter(
			(row) => row.transport.kind === "custom" && row.health.kind !== "sign-in",
		)
		.map((row) => row.origin)
		.join("\n");
	const probedThisOpen = useRef(new Set<string>());
	/* Bumped when an open ENDS (close or unmount): an answer that arrives after it
	 *  belongs to an open nobody is looking at, and is dropped. */
	const openGeneration = useRef(0);
	useEffect(() => {
		if (!visible) return;
		probedThisOpen.current = new Set();
		return () => {
			openGeneration.current += 1;
		};
	}, [visible]);
	/* Not before this open's registry read has landed: until then the rows are the
	 *  account's discovery alone, and probing waits for the scoped list (m1). */
	useEffect(() => {
		if (!visible || !loaded || originsKey.length === 0) return;
		const open = openGeneration.current;
		for (const origin of originsKey.split("\n")) {
			if (probedThisOpen.current.has(origin)) continue;
			probedThisOpen.current.add(origin);
			setProbes((current) =>
				current[origin] ? current : { ...current, [origin]: "checking" },
			);
			void probeHealthAt(origin).then((health) => {
				if (openGeneration.current !== open) return;
				setProbes((current) => ({
					...current,
					[origin]: health ? "answered" : "silent",
				}));
				if (health)
					setAnsweredAt((current) => ({ ...current, [origin]: Date.now() }));
			});
		}
	}, [visible, loaded, originsKey]);

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
			if (pending !== null) {
				pendingRef.current = pending;
				setPendingKey(pending);
			}
			void performSwitcherTap(action, {
				selectComputer,
				connectCustom,
				signInWithRadient,
				close: onClose,
				openSettings: () => {
					// Settings already paints this refusal; do not stack a duplicate
					// screen when the picker was opened from its own Switch control.
					if (pathname !== "/settings") router.push("/settings");
				},
				unhide: ({ savedId, tunnelId: hiddenTunnel }) => {
					/* The store first, so the computer is back in every list at once;
					 *  the registry write is best effort (see `unhideSavedComputer`). */
					connectionStore.getState().unhideComputer(hiddenTunnel);
					void (savedId
						? unhideSavedComputer(savedId)
						: unhideRadientComputer(hiddenTunnel));
				},
				/* The registry id only: the screen reads the address and the plain-http
				 *  opt-in from the registry, never from a URL a link could set (review
				 *  round 1, m1). */
				enterPassword: (computerId) =>
					router.push({
						pathname: "/own-tunnel",
						params: { computer: computerId },
					}),
				openConsole: () =>
					void WebBrowser.openBrowserAsync(RADIENT_CONSOLE_TUNNELS_URL),
			}).then(() => {
				/* A pick that FAILED closes the sheet: the refusal (and "Sign in again")
				 *  is painted on the screen behind the scrim, and a row held on
				 *  "Connecting…" over it hid the only explanation (review M1, UX U2).
				 *  Only this tap's own outcome: a newer tap owns the sheet otherwise. */
				if (
					pending === null ||
					pendingRef.current !== pending ||
					!pickFailed(connectionStore.getState().phase)
				)
					return;
				pendingRef.current = null;
				setPendingKey(null);
				onClose();
			});
		},
		[
			connectCustom,
			onClose,
			pathname,
			router,
			selectComputer,
			signInWithRadient,
			slot,
		],
	);

	/* Closes once the tapped computer is in use: the reader picked it, and the
	 *  sheet staying up over a live route is a step they would have to undo. */
	const landed = pendingLanded(sections, pendingKey);
	useEffect(() => {
		if (visible && landed) onClose();
	}, [visible, landed, onClose]);

	/* "No computers" is an answer, so it waits for the read (m1: the cleared
	 *  snapshot would otherwise say it for a frame on every open). */
	const empty =
		loaded &&
		sections.onPhone.length === 0 &&
		sections.notConnected.length === 0;

	const addComputer = () => {
		onClose();
		/* The existing set-up paths (Radient, or your own tunnel), in the
		 *  Computers route's add mode: a populated list there has no add
		 *  path, so landing on it was a dead end (UX round 2, U12). Over a
		 *  Computers screen that ALREADY shows those paths — an empty
		 *  account, or the add mode itself — closing is the whole step:
		 *  pushing it again stacked an identical screen (UX round 1, U6). */
		/* The screen behind's own `computersView` input, read the way
		 *  `computers.tsx` reads it, so the sheet and that screen agree on
		 *  whether the set-up paths are showing (R3-n1). */
		const now = connectionStore.getState();
		if (
			addComputerTarget({
				pathname,
				view: {
					computers: now.computers,
					discovering,
					discoveryFailure: now.discoveryFailure,
					signedOut: refusal?.kind === "sign-in" || signInState.kind !== "idle",
					adding: addParam === "1",
				},
			}) === "push"
		)
			router.push(ADD_COMPUTER_HREF);
	};

	return (
		<Sheet
			focusTitle
			returnFocusTestID={returnFocusTestID}
			visible={visible}
			onClose={onClose}
			/* Echoes the control that opened it ("Switch computer"); "Computers" sat
			 *  over the Computers screen's own title (design round 1, D6). */
			title={t("mobile.computers.switch")}
			testID={SURFACE.computerSwitcherSheet}
		>
			{empty ? (
				<Text className="py-4 text-body text-ink-muted">
					{t("mobile.computers.none_on_phone")}
				</Text>
			) : null}
			{sections.onPhone.length > 0 ? (
				/* The header sits on the rows' `px-3` content edge, as the pickers' group
				 *  labels do, so the label, glyphs and names share one leading line. */
				<View testID={REGION.switcherOnPhone}>
					<View className="px-3">
						<SectionHeader label={t("mobile.computers.section.on_phone")} />
					</View>
					<View className="gap-1">
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
				</View>
			) : null}
			{sections.notConnected.length > 0 ? (
				<View testID={REGION.switcherNotConnected}>
					<View className="px-3">
						<SectionHeader
							label={t("mobile.computers.section.not_connected")}
						/>
					</View>
					<View className="gap-1">
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
				</View>
			) : null}
			{/* Below the groups with a section's worth of space (`mt-4`, the section
			 *  header's own `pt-4`), in the scrolling body rather than the pinned
			 *  footer: the footer's divider was the second hairline the operator saw. */}
			<View className="mt-4">
				<AddComputerRow onPress={addComputer} />
			</View>
		</Sheet>
	);
}
