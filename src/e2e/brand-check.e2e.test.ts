/**
 * The client, on a runtime whose `fetch` is brand-checked like a browser's.
 *
 * Regression for: `this.fetchImpl(...)` called the platform `fetch` with the
 * client as its receiver. In Chrome that throws `TypeError: Illegal invocation`
 * before any request is made, so every screen showed a plausible "can't reach the
 * relay" with nothing on the wire. Node's own `fetch` accepts any receiver, which
 * is why every Node test passed while the web target was dead.
 *
 * The check below reproduces the browser's rule on top of Node's real fetch and
 * the client is pointed at a real socket, so the assertion is on traffic: the
 * server must actually SEE the request. Nothing here passes a `fetchImpl` — the
 * client resolves the global itself, which is the path that was broken.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRelayClient } from "../connection";
import { type FixtureRelay, startFixtureRelay } from "../testing/fixture-relay";

let relay: FixtureRelay;
const realFetch = globalThis.fetch;

beforeEach(async () => {
	relay = await startFixtureRelay({
		auth: { mode: "radient", grant: "grant-jwt", origin: "http://placeholder" },
	});
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await relay.close();
});

/** Rebuilds the browser rule: a `fetch` invoked with any receiver but the global
 *  object throws, exactly as `window.fetch` does. */
function installBrandCheckedFetch(): void {
	const branded = function (
		this: unknown,
		...args: Parameters<typeof fetch>
	): ReturnType<typeof fetch> {
		if (this !== globalThis) {
			throw new TypeError(
				"Failed to execute 'fetch' on 'Window': Illegal invocation",
			);
		}
		return realFetch.apply(globalThis, args);
	};
	vi.stubGlobal("fetch", branded);
}

describe("a browser-like runtime (fetch rejects any receiver but the global)", () => {
	it("the client still reaches the relay, because it binds the global once", async () => {
		installBrandCheckedFetch();
		const client = createRelayClient({
			route: { mode: "custom", baseUrl: relay.baseUrl, allowInsecure: true },
		});
		const health = await client.healthz();

		expect(health.ok).toBe(true);
		/* The assertion that matters: bytes reached the server. Before the fix the
		 * request never left and this list was empty. */
		expect(relay.requests.map((r) => r.path)).toContain("/healthz");
	});
});
