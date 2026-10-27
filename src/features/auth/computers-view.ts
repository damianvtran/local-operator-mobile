import type { DiscoveredComputer } from "@/connection";
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
 *  is the reader's (D2's "this will keep trying" was false: one request in 30 s). */
export function discoveryFailureMessage(
	failure: DiscoveryFailure,
	hasRows: boolean,
): string {
	if (failure === "unreachable")
		return hasRows
			? "Radient could not be reached, so this list may be out of date."
			: "Radient could not be reached to list your computers. Check this device's connection.";
	return hasRows
		? "Radient's answer could not be read, so this list may be out of date."
		: "Radient's answer could not be read, so your computers could not be listed.";
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

export type ComputersView = {
	title: "Computers" | "Set up a computer";
	/** The loading skeleton: a discovery pass is in flight and nothing is cached. */
	skeleton: boolean;
	/** The rows, which render whenever there are any — under a refusal too. */
	list: boolean;
	/** The discovery failure's banner, above the rows or alone; never over the
	 *  set-up tutorial. */
	banner: string | null;
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
}): ComputersView {
	const rows = input.computers.length > 0;
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
		title: setup ? "Set up a computer" : "Computers",
		/* Gated on the provider's `discovering` flag, which every discovery pass sets.
		 *  The store's `discovering` PHASE, which this used to read, describes a route
		 *  and is never set by a route-less discovery, so loading painted a blank
		 *  screen (D4). A failure already on screen keeps its banner instead. */
		skeleton: input.discovering && !rows && input.discoveryFailure === null,
		list: rows,
		banner:
			input.discoveryFailure === null
				? null
				: discoveryFailureMessage(input.discoveryFailure, rows),
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
