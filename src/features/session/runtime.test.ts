import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import { loadAttachments, olderThanLoaded } from "@/features/session/runtime";
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

describe("olderThanLoaded", () => {
	/**
	 * The find sheet's caveat gate: "older messages aren't loaded here" may only
	 * be said when the page is incomplete AND nothing held extends past it. The
	 * cases are the wire's own shapes — both the page and the projection are
	 * contiguous tails, so the page's oldest row is either absent from the held
	 * rows, at their head, or somewhere down their middle.
	 */
	const row = (id: string): TranscriptEntry => ({
		id,
		kind: "user",
		text: "",
		tool_call_id: "",
		tool_name: "",
		tool_state: "done",
		summary: "",
		intent: "",
		diff_added: 0,
		diff_removed: 0,
		elapsed_s: 0,
		error: "",
		details: {},
		images: [],
		final: true,
		text_complete: true,
	});

	it("claims nothing without a page fact, or when the page is the whole story", () => {
		expect(
			olderThanLoaded({
				hasMore: false,
				pageOldestId: "a",
				entries: [row("a")],
			}),
		).toBe(false);
		expect(
			olderThanLoaded({
				hasMore: true,
				pageOldestId: null,
				entries: [row("a")],
			}),
		).toBe(false);
	});

	it("claims when the page's oldest row is the oldest thing held — or is not held at all", () => {
		// The history-only shape (a reopened conversation): entries ARE the page,
		// so its oldest row heads them and there is nothing older on the device.
		expect(
			olderThanLoaded({
				hasMore: true,
				pageOldestId: "p1",
				entries: [row("p1"), row("p2")],
			}),
		).toBe(true);
		// A projection tail shorter than the page: the page's oldest row never
		// made it to the device, so rows older than it certainly did not.
		expect(
			olderThanLoaded({
				hasMore: true,
				pageOldestId: "p1",
				entries: [row("p40"), row("p41")],
			}),
		).toBe(true);
	});

	it("stays quiet when the held rows already reach past the page — the claim would be false", () => {
		// The capture mock's shape: the projection serves the whole conversation,
		// so rows older than the page's oldest sit in `entries` and the caveat
		// would describe rows the reader can search.
		expect(
			olderThanLoaded({
				hasMore: true,
				pageOldestId: "p10",
				entries: [row("p1"), row("p5"), row("p10"), row("p11")],
			}),
		).toBe(false);
	});
});
