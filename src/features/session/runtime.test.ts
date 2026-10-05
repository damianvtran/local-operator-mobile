import { describe, expect, it } from "vitest";

import { loadAttachments } from "@/features/session/runtime";
import {
	type RelayEndpoints,
	type RelayResponseFacts,
	relayErrorFromResponse,
} from "@/relay";

/**
 * Which failure lets `loadAttachments` say "the bytes are gone".
 *
 * The one wrong answer is expensive: the relay's image route answers
 * `404 no such image` for an old generation, but the edge and the gateway
 * behind it answer `404` for "this hostname is not a tunnel" too. Both reach
 * this function as a `404`, so reading the status alone tells the reader their
 * attachment is gone when the truth is that the host was never reached — the
 * exact truth-telling failure this rule exists to prevent. Only the relay's OWN
 * 404 (`isRelayMissing`) may resolve `null`; everything else must rethrow so
 * the caller can read it as unreachable.
 *
 * The errors are built through `relayErrorFromResponse`, not the constructor, so
 * what is asserted is the real classification path rather than a hand-typed
 * `kind`.
 */

function facts(
	status: number,
	headers: Record<string, string> = {},
	defaultText = "",
): RelayResponseFacts & { text: string } {
	const lower = new Map(
		Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
	);
	return {
		status,
		header: (name: string) => lower.get(name.toLowerCase()) ?? null,
		text: defaultText,
	};
}

/** An endpoints stand-in whose one route always fails. `RelayEndpoints` is a
 *  wide interface; only `image` is reached by the function under test. */
const imageRejects = (error: unknown): RelayEndpoints =>
	({
		image: async () => {
			throw error;
		},
	}) as unknown as RelayEndpoints;

describe("loadAttachments tells a gone attachment from an unreachable host", () => {
	it("resolves to null for the relay's own `no such image` 404", async () => {
		const gone = relayErrorFromResponse(
			facts(
				404,
				{ "content-type": "application/json" },
				'{"error":"no such image"}',
			),
		);
		expect(gone.kind).toBe("rejected");
		await expect(
			loadAttachments(imageRejects(gone), "s", "e", 0),
		).resolves.toBeNull();
	});

	it("rethrows a dead tunnel's 404 instead of claiming the attachment is gone", async () => {
		const deadTunnel = relayErrorFromResponse(
			facts(404, { "content-type": "text/plain" }, "Unknown tunnel"),
		);
		expect(deadTunnel.kind).toBe("unknown-tunnel");
		await expect(
			loadAttachments(imageRejects(deadTunnel), "s", "e", 0),
		).rejects.toBe(deadTunnel);
	});

	it("rethrows any other failure, which is not absence either", async () => {
		const offline = relayErrorFromResponse(
			facts(
				503,
				{ "content-type": "text/plain" },
				"Tunnel temporarily unavailable",
			),
		);
		expect(offline.kind).toBe("computer-offline");
		await expect(
			loadAttachments(imageRejects(offline), "s", "e", 0),
		).rejects.toBe(offline);
	});
});
