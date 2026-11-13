import type { ComputerStatus, DiscoveredComputer } from "@/connection";
import { t } from "@/i18n";
import type {
	ConnectionPhase,
	DiscoveryFailure,
} from "@/state/connection-store";

/**
 * What the Computers screen shows, decided from state alone.
 *
 * It is a plain module because the unit suite runs in Node without a React Native
 * host (`vitest.config.ts`): the decisions that broke in PR #121's round 1 —
 * which branch renders, what the banner says, which row is connecting — are
 * asserted here, and `computers.tsx` only paints them.
 *
 * The constraint every branch below serves: **a failure never erases a list the
 * reader already has.** Picking a computer, a failed mint and a failed Refresh
 * each used to replace the rows with "Set up a computer" (review R1-M1, design
 * D1/D2), which tells someone with three computers to go and create one.
 */

/** The account-level discovery failure, in the reader's terms. The headline is
 *  about RADIENT, never a computer: discovery is a question to the control plane,
 *  and naming the first row's machine pinned an outage on a computer the probe
 *  had just reported answering (design round 1, D2; review R1-m2). Neither
 *  sentence promises an automatic retry — nothing schedules one, so the action
 *  is the reader's (D2's "this will keep trying" was false: one request in 30 s).
 *
 *  It returns a catalogue KEY, not text (M3 S2a, the `tunnel-status-key.ts`
 *  pattern): the caller's `t(key)` stays the single typed path, so a locale change
 *  re-renders the banner instead of freezing the sentence this pure module built,
 *  and the view's decision stays testable without a catalogue. */
export type DiscoveryFailureKey =
	| "mobile.computers.banner.unreachable_stale"
	| "mobile.computers.banner.unreachable_empty"
	| "mobile.computers.banner.unreadable_stale"
	| "mobile.computers.banner.unreadable_empty";

export function discoveryFailureKey(
	failure: DiscoveryFailure,
	hasRows: boolean,
): DiscoveryFailureKey {
	if (failure === "unreachable")
		return hasRows
			? "mobile.computers.banner.unreachable_stale"
			: "mobile.computers.banner.unreachable_empty";
	return hasRows
		? "mobile.computers.banner.unreadable_stale"
		: "mobile.computers.banner.unreadable_empty";
}

/** A row's own state. `connecting` is the pending state a tap needs: the row is
 *  the only thing the reader touched, so it is where the feedback belongs
 *  (design D1) — the header's Refresh spinner says nothing about a pick. */
export type RowState = "connecting" | "active" | "idle";

export function rowState(
	computer: DiscoveredComputer,
	snapshot: { tunnelId: string | null; phase: ConnectionPhase },
): RowState {
	if (computer.tunnelId !== snapshot.tunnelId) return "idle";
	if (snapshot.phase === "minting") return "connecting";
	/* `refused` is deliberately idle: the refusal above the list names the computer
	 *  and the remedy, and an "active" marker beside it would contradict it. */
	if (
		snapshot.phase === "live" ||
		snapshot.phase === "degraded" ||
		snapshot.phase === "re-minting"
	)
		return "active";
	return "idle";
}

/**
 * Where every "Add a computer" goes: the Computers route in its add mode, which
 * shows the set-up paths (Radient, or your own tunnel) even when the account
 * already lists computers. One constant so the switcher's footer and Settings
 * cannot drift into two destinations for one label (PR #122 UX round 2, U12).
 */
export const ADD_COMPUTER_HREF = {
	pathname: "/tunnels",
	params: { add: "1" },
} as const;

/** The screen title's catalogue key. A key rather than the English words because
 *  `computersHeaderStackWidth` branches on WHICH title it is; comparing the
 *  rendered text would take the wrong branch in every non-English locale. */
export type ComputersTitleKey =
	| "mobile.computers.title.list"
	| "mobile.computers.title.set_up";

export type ComputersView = {
	/** A catalogue key; the screen renders `t(title)`. */
	title: ComputersTitleKey;
	/** The loading skeleton: a discovery pass is in flight and nothing is cached. */
	skeleton: boolean;
	/** The rows, which render whenever there are any — under a refusal too. */
	list: boolean;
	/** The discovery failure's banner, above the rows or alone; never over the
	 *  set-up tutorial. A catalogue key; the screen renders `t(banner)`. */
	banner: DiscoveryFailureKey | null;
	/** The set-up path (F-2): only for an account Radient said has no computers. */
	setup: boolean;
};

export function computersView(input: {
	computers: readonly DiscoveredComputer[];
	discovering: boolean;
	discoveryFailure: DiscoveryFailure | null;
	/** The `sign-in` refusal is on screen: Radient refused the grant. The rows went
	 *  with it (R1-m1), so an empty list here means "signed out", not "empty
	 *  account". */
	signedOut?: boolean;
	/** The reader asked to ADD a computer (`ADD_COMPUTER_HREF`): the set-up paths,
	 *  whatever the account already lists. */
	adding?: boolean;
}): ComputersView {
	const rows = input.computers.length > 0;
	/* An explicit "Add a computer" is the set-up path even over a populated list:
	 *  that list offers no way to add one, so the switcher's and Settings' "Add a
	 *  computer" landed on rows with nothing to add (PR #122 UX round 2, U12). The
	 *  rows are one Back away, on the screen the reader came from. Signed out still
	 *  wins — an add with a refused grant would only be refused again. */
	if (input.adding && !input.signedOut)
		return {
			title: "mobile.computers.title.set_up",
			skeleton: false,
			list: false,
			banner: null,
			setup: true,
		};
	/* "Set up a computer" is an ANSWER — Radient listed none — so it needs a
	 *  discovery that finished, did not fail, and was asked with a grant Radient
	 *  still accepts. Stacking it under an error showed a reader on a flaky
	 *  connection "create a tunnel" instructions (D3); a 401 on Refresh empties the
	 *  rows and records a refusal, not a discovery failure, so without the last term
	 *  a signed-out reader got the tutorial under "Sign in again" (PR #121 QA
	 *  round 2, Q-r2-1). */
	const setup =
		!rows &&
		!input.discovering &&
		input.discoveryFailure === null &&
		!input.signedOut;
	return {
		title: setup
			? "mobile.computers.title.set_up"
			: "mobile.computers.title.list",
		/* Gated on the provider's `discovering` flag, which every discovery pass sets.
		 *  The store's `discovering` PHASE, which this used to read, describes a route
		 *  and is never set by a route-less discovery, so loading painted a blank
		 *  screen (D4). A failure already on screen keeps its banner instead. */
		skeleton: input.discovering && !rows && input.discoveryFailure === null,
		list: rows,
		banner:
			input.discoveryFailure === null
				? null
				: discoveryFailureKey(input.discoveryFailure, rows),
		setup,
	};
}

/**
 * Where a pick made on this screen lands once its route is usable (PR #121 UX
 * round 1, U1).
 *
 * The cold start REPLACES Home with Computers (`home.tsx`: a restored account
 * with no route goes to `/tunnels`), so Computers is the root of its stack there:
 * nothing to pop, a Back that did nothing, and a browser or Android back that
 * left the app. Before this PR that screen listed no rows on that path, so the
 * dead end was unreachable; now a pick goes live in ~100 ms and strands the
 * reader on the list. Home is where a connected reader works, and `own-tunnel`'s
 * `saveAndConnect` already does `router.replace("/")` once connected.
 *
 * Opened FROM somewhere (Home, Settings, a refusal), the stack has a way back and
 * the screen keeps today's behaviour: the reader stays, sees the row turn active,
 * and pops back themselves — an automatic pop would yank a Settings reader to a
 * screen they did not come from.
 *
 * `picked` is the tunnel tapped on THIS screen: a route that was already live
 * when the screen opened is not a reason to leave it.
 */
export function landingAfterPick(input: {
	picked: string | null;
	tunnelId: string | null;
	phase: ConnectionPhase;
	canGoBack: boolean;
}): "home" | "stay" {
	if (input.canGoBack) return "stay";
	if (input.picked === null || input.picked !== input.tunnelId) return "stay";
	return input.phase === "live" ? "home" : "stay";
}

/**
 * The computer the set-up wait is waiting FOR: the first Local Operator computer
 * listed now that was not listed when the wait started, or `null`.
 *
 * One function for both readers on the Computers screen — the wait's `acquire`,
 * which hands it to `useConnectorWait` so W2/W3 can happen, and the panel's "Use
 * this computer", which picks it — so the computer probed is the computer offered.
 * `acquire` used to answer `null` unconditionally, and the hook reads `null` as "no
 * row yet": in add mode over a populated list the wait never left W1 and ended on
 * "no tunnel listed" with the new tunnel on the list (PR #122 review round 3,
 * R3-M1; UX U17). On an empty account `listedAtStart` is empty, so the first
 * listed computer is the answer, as before.
 */
export function newlyListed(
	computers: readonly DiscoveredComputer[],
	listedAtStart: ReadonlySet<string>,
): DiscoveredComputer | null {
	return (
		computers.find(
			(computer) =>
				computer.supportsLocalOperator && !listedAtStart.has(computer.tunnelId),
		) ?? null
	);
}

/**
 * What the header's Back does (U1). With a screen underneath, it pops. As the
 * stack's root it goes Home — but only once a route exists: with none, Home's
 * landing effect sends a restored account straight back here, so the control
 * would bounce, and it is hidden (`null`) instead of offering a way out that is
 * not one. During a mint the route already exists, so Back on the cold-start path
 * lands on Home, which shows the connection coming up or its refusal.
 */
export function backAction(input: {
	canGoBack: boolean;
	routed: boolean;
}): "pop" | "home" | null {
	if (input.canGoBack) return "pop";
	return input.routed ? "home" : null;
}

/**
 * The control plane's status, in the reader's terms, through #243's catalogue keys.
 *
 * Design D5 (TestFlight 883) asked for sentence case beside "Sign-in protected".
 * The `status.*` keys cannot carry that: they are ALSO the `{status}` predicate
 * of the wait panel's "Radient has the tunnel — {status}." (`tunnelStatusKey`),
 * where a capital would be wrong, and every locale's audited translation was
 * written to the context note "keep lower case". Capitalising in code is not an
 * answer either (no case in most shipped scripts, locale-specific rules in the
 * rest). So the row shows the catalogue's words as they are; sentence case needs
 * row-only keys translated in every locale, which is its own change.
 */
export function computerStatusLabel(status: ComputerStatus): {
	label: string;
	tone: ComputerFactTone;
} {
	switch (status) {
		case "ready":
			return {
				label: t("mobile.computers.status.route_ready"),
				tone: "success",
			};
		case "provisioning":
			return { label: t("mobile.computers.status.provisioning"), tone: "info" };
		case "suspended":
			return { label: t("mobile.computers.status.suspended"), tone: "warning" };
		case "off":
			return { label: t("mobile.computers.status.disabled"), tone: "warning" };
		case "gone":
			return { label: t("mobile.computers.status.revoked"), tone: "danger" };
		case "unknown":
			return { label: t("mobile.computers.status.unknown"), tone: "neutral" };
	}
}

/** The probe's own answer, kept visibly separate from the row's status. */
export type Reachability = "protected" | "answered";

export function computerReachabilityLabel(state: Reachability): {
	label: string;
	tone: ComputerFactTone;
} {
	switch (state) {
		case "protected":
			return { label: t("mobile.computers.protected"), tone: "neutral" };
		case "answered":
			return { label: t("mobile.computers.reach.answering"), tone: "success" };
	}
}

export type ComputerFactTone =
	| "neutral"
	| "success"
	| "warning"
	| "danger"
	| "info";

/** The token a fact's 6 pt dot is painted in: the tone's own ink, and the dim
 *  ink for a neutral fact (a dot is never the only signal — the word is). */
export const FACT_DOT_TOKEN: Record<
	ComputerFactTone,
	"success" | "warning" | "danger" | "info" | "ink-dim"
> = {
	neutral: "ink-dim",
	success: "success",
	warning: "warning",
	danger: "danger",
	info: "info",
};

/**
 * What a computer row's reserved trailing slot shows (design D1). The slot is
 * there in every state so line 1 never shifts: a spinner while this row mints,
 * the accent check when it is the computer in use, and otherwise a chevron —
 * the "this goes somewhere" mark the row was missing (TestFlight 883, Ola: "It
 * was not obvious that this was clickable").
 */
export function computerRowTrailing(
	state: RowState,
): "spinner" | "check" | "chevron" {
	if (state === "connecting") return "spinner";
	if (state === "active") return "check";
	return "chevron";
}
