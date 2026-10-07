/**
 * The mock relay's control surface, as the harness drives it.
 *
 * ONE copy, because both tools that pin a scenario must agree on what "pinned" means:
 * the capture pins each cell before it renders it, and the audit pins the SAME cell
 * again before IT renders it — the relay holds one scenario at a time, so a re-drive
 * that skips the pin renders whatever state the previous cell left behind.
 */

import { randomBytes } from "node:crypto";

/**
 * Pin the relay to the scenario that serves this cell.
 *
 * Without this the harness read `/__mock/state` and `/__mock/scenarios` and then
 * captured every cell against whatever single scenario the relay happened to be
 * started with — so a cell labelled `S8/approval` could render an unrelated state
 * and still pass. A state label is a claim about what the relay serves; this is
 * what makes it true.
 */
/**
 * Tell the relay this process has finished with it, so the next rig in the same
 * shell is not refused as a second driver.
 *
 * BEST-EFFORT AND NEVER THROWING: this runs in a teardown path, and a relay that
 * has already gone (or was never ours) must not turn a finished run into a failed
 * one. The claim's 60 s expiry is the backstop for a rig that died instead of
 * exiting.
 */
export async function releaseScenarioClaim(relayUrl: string): Promise<void> {
	try {
		await fetch(new URL("/__mock/release", relayUrl), {
			method: "POST",
			headers: { "x-lo-harness": HARNESS_CLIENT },
		});
	} catch {
		// A relay that is not there has nothing to release.
	}
}

/**
 * This harness PROCESS's client id, sent with every scenario pin.
 *
 * The mock relay's scenario pin reloads its world, so two rigs driving one relay
 * interleave states and produce flaky cells that look like app defects (review
 * round 3, Q7: 1/10 contended against 0/10 isolated). The relay refuses a pin from
 * a second client while the first is still talking; this is what tells it which
 * client is talking. Randomised per process rather than derived from the pid, so a
 * reused pid cannot inherit an ownership that has nothing to do with it.
 */
export const HARNESS_CLIENT = `h-${process.pid}-${randomBytes(4).toString("hex")}`;

export async function selectScenario(
	relayUrl: string,
	scenario: string,
): Promise<void> {
	const res = await fetch(new URL("/__mock/scenario", relayUrl), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-lo-harness": HARNESS_CLIENT,
		},
		body: JSON.stringify({ scenario }),
	});
	if (!res.ok) {
		throw new Error(
			`the mock relay refused to switch to scenario '${scenario}' (${res.status}): ` +
				"the cell cannot be captured in the state it declares. A 409 here means " +
				"another harness process is driving this relay (its world is shared); " +
				"start your own with `--port 0` and point `--relay` at it.",
		);
	}
}
