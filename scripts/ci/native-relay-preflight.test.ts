import { describe, expect, it } from "vitest";
import { createRelay } from "../../tools/mock-relay/relay.ts";
import {
	nativeConnectionPrerequisiteFailed,
	probeNativeRelay,
} from "./native-relay-preflight.ts";

describe("native proof's authenticated handoff prerequisite (Q163-2)", () => {
	it("stops the historical setup failures, not unrelated content assertions", () => {
		expect(
			nativeConnectionPrerequisiteFailed(
				"Assertion is false: id: session-row-6714def86197 is visible",
			),
		).toBe(true);
		expect(
			nativeConnectionPrerequisiteFailed(
				'No visible element found: "Connected"',
			),
		).toBe(true);
		expect(
			nativeConnectionPrerequisiteFailed(
				"Assertion is false: id: composer-input is visible",
			),
		).toBe(false);
	});
	for (const scenario of ["idle", "subagent-running"]) {
		it(`checks ${scenario} through login, saved-route list and SSE`, async () => {
			const password = "synthetic-native-proof-password";
			const relay = createRelay({ scenario, password, quiet: true });
			const handle = await relay.listen();
			try {
				const origin = `http://127.0.0.1:${handle.port}`;
				const id = Object.keys(relay.state.world.projections ?? {})[0];
				await expect(probeNativeRelay(origin, password, id)).resolves.toEqual({
					authenticatedLists: 2,
					streamSeed: true,
				});
				// A health/auth handshake must never admit a nonexistent fixture row.
				await expect(
					probeNativeRelay(origin, password, "not-in-this-world"),
				).rejects.toThrow("expected session absent");
			} finally {
				await relay.shutdown();
			}
		});
	}
});
