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
}): ComputersView {
	const rows = input.computers.length > 0;
	/* "Set up a computer" is an ANSWER — Radient listed none — so it needs a
	 *  discovery that finished and did not fail. Stacking it under an error showed
	 *  a reader on a flaky connection "create a tunnel" instructions (D3). */
	const setup = !rows && !input.discovering && input.discoveryFailure === null;
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
