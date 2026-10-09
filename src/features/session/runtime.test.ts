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
	 * The find sheet's caveat gate: "older messages aren't searched" may be
	 * SILENT only when a successful history read backs the silence and no fact
	 * shows a row the reader cannot search — a page row the window slid out
	 * from under, `has_more` with nothing held past the page, or a watched
	 * slide. A failed or unsettled read cannot know, so it fires (reviewer
	 * MAJOR-2 residual / QA Q63-7). The cases are the wire's own shapes — both
	 * the page and the projection are contiguous tails of one append-only
	 * conversation.
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
	const rows = (...ids: string[]) => ids.map(row);

	it("fires when the read failed or never settled — completeness needs the read", () => {
		// Reviewer MAJOR-2 residual / QA Q63-7, at its smallest reproduction: a
		// cold open past the cap whose first `/history` read fails, with no slide
		// ever watched. `history = []` and `pageHasMore = false` (set only by a
		// successful read), `entries` = the capped projection — the old gate went
		// SILENT here, reading as completeness while 80 of a 520-row journal sat
		// unsearchable.
		expect(
			olderThanLoaded({
				hasMore: false,
				read: "failed",
				page: [],
				entries: rows("a"),
				slid: false,
			}),
		).toBe(true);
		// No attempt has settled either (in flight, or no endpoints to read
		// from): the app cannot know, so it must not read as completeness.
		expect(
			olderThanLoaded({
				hasMore: false,
				read: "unknown",
				page: [],
				entries: rows("a"),
				slid: false,
			}),
		).toBe(true);
		// A successful read of a conversation with nothing in it: the one state
		// an empty page may read as complete in.
		expect(
			olderThanLoaded({
				hasMore: false,
				read: "ok",
				page: [],
				entries: [],
				slid: false,
			}),
		).toBe(false);
	});

	it("claims nothing when the page is the whole story", () => {
		// The page was complete and every row it carried is still held.
		expect(
			olderThanLoaded({
				hasMore: false,
				read: "ok",
				page: rows("a"),
				entries: rows("a", "b"),
				slid: false,
			}),
		).toBe(false);
	});

	it("claims when the page's oldest row is the oldest thing held — or is not held at all", () => {
		// The history-only shape (a reopened conversation): entries ARE the page,
		// so its oldest row heads them and there is nothing older on the device.
		expect(
			olderThanLoaded({
				hasMore: true,
				read: "ok",
				page: rows("p1", "p2"),
				entries: rows("p1", "p2"),
				slid: false,
			}),
		).toBe(true);
		// A projection tail shorter than the page: the page's oldest row never
		// made it to the device, so rows older than it certainly did not.
		expect(
			olderThanLoaded({
				hasMore: true,
				read: "ok",
				page: rows("p1"),
				entries: rows("p40", "p41"),
				slid: false,
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
				read: "ok",
				page: rows("p10"),
				entries: rows("p1", "p5", "p10", "p11"),
				slid: false,
			}),
		).toBe(false);
	});

	it("fires for the grow-in-place window: a complete-at-fetch page the cap slides under", () => {
		// QA Q63-1's F1, at its smallest reproduction: mounted at three rows with
		// a complete page (`has_more=false`); the conversation grows in place and
		// the relay's `_cap_tail` drops a row per append, so the page's own rows
		// are the witness that something it carried is no longer searchable — the
		// stale `has_more=false` must not silence it.
		const page = rows("r0", "r1", "r2");
		const slid = rows("r0", "r3", "r4", "r5"); // pinned opener + newest tail
		expect(
			olderThanLoaded({
				hasMore: false,
				read: "ok",
				page,
				entries: slid,
				slid: false,
			}),
		).toBe(true);
	});

	it("fires on an observed slide even with no page at all — the frames are the proof", () => {
		expect(
			olderThanLoaded({
				hasMore: false,
				read: "ok",
				page: [],
				entries: rows("r9"),
				slid: true,
			}),
		).toBe(true);
	});
});
