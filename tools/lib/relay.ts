/**
 * The mock relay's control surface, as the harness drives it.
 *
 * ONE copy, because both tools that pin a scenario must agree on what "pinned" means:
 * the capture pins each cell before it renders it, and the audit pins the SAME cell
 * again before IT renders it — the relay holds one scenario at a time, so a re-drive
 * that skips the pin renders whatever state the previous cell left behind.
 */

/**
 * Pin the relay to the scenario that serves this cell.
 *
 * Without this the harness read `/__mock/state` and `/__mock/scenarios` and then
 * captured every cell against whatever single scenario the relay happened to be
 * started with — so a cell labelled `S8/approval` could render an unrelated state
 * and still pass. A state label is a claim about what the relay serves; this is
 * what makes it true.
 */
export async function selectScenario(
	relayUrl: string,
	scenario: string,
): Promise<void> {
	const res = await fetch(new URL("/__mock/scenario", relayUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ scenario }),
	});
	if (!res.ok) {
		throw new Error(
			`the mock relay refused to switch to scenario '${scenario}' (${res.status}): ` +
				"the cell cannot be captured in the state it declares",
		);
	}
}
