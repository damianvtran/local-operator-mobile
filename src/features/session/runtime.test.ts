import { describe, expect, it } from "vitest";

import type { SessionProjection, TranscriptEntry } from "@/contracts";
import {
	loadAttachments,
	mergeTranscript,
	olderThanLoaded,
} from "@/features/session/runtime";
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
				holeBelowPage: false,
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
				holeBelowPage: false,
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
				holeBelowPage: false,
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
				holeBelowPage: false,
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
				holeBelowPage: false,
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
				holeBelowPage: false,
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
				holeBelowPage: false,
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
				holeBelowPage: false,
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
				holeBelowPage: false,
			}),
		).toBe(true);
	});

	it("fires on the pinned opener: a row held below the page with a hole under it", () => {
		/* The merged list's steady state on a capped frame: every page row is held
		 * (so the "a page row left the window" clause is silent), nothing slid, and
		 * the frame's opener sits above the page's oldest row — with the rows between
		 * them held by nobody. `has_more` says older rows exist, and the id walk's own
		 * clause cannot see the hole (the opener is a held row below the page, which
		 * it reads as "rows past the page, nothing to claim"), so without this fact
		 * the caveat went silent on exactly the shape the merge creates. */
		expect(
			olderThanLoaded({
				hasMore: true,
				read: "ok",
				page: rows("p0", "p1"),
				entries: rows("open", "p0", "p1"),
				slid: false,
				holeBelowPage: true,
			}),
		).toBe(true);
		// And the fact alone is not the claim: a complete conversation still says
		// nothing, and a contiguous older run (a second page's rows, which ARE
		// searchable) is what the id walk exists for.
		expect(
			olderThanLoaded({
				hasMore: false,
				read: "ok",
				page: rows("p0", "p1"),
				entries: rows("open", "p0", "p1"),
				slid: false,
				holeBelowPage: true,
			}),
		).toBe(false);
	});
});

/**
 * The open's rows, from the two sources the screen holds.
 *
 * This pins the CONTRACT that made the first paint flip: the list the screen
 * renders must be the same list before and after the live frame lands — the
 * page's rows stay, in order, and the frame's rows join it instead of replacing
 * it. Every assertion here fails against the shape this replaced, where the
 * frame's transcript was returned whole (dropping the page's oldest row, moving
 * every remaining row's index and re-emitting it from a different array, which
 * is what made rows remount and condensation re-run over a different head).
 */
describe("mergeTranscript: one list from the page and the frame", () => {
	const rowAt = (id: string, text = ""): TranscriptEntry => ({
		id,
		kind: "user",
		text,
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
	const listOf = (...ids: string[]) => ids.map((id) => rowAt(id));
	/** Only `transcript` is read by the merge; the rest of the frame's shape is
	 *  irrelevant to it, so the stand-in is cast rather than filled in. */
	const frameOf = (...rows: TranscriptEntry[]) =>
		({ transcript: rows }) as unknown as SessionProjection;
	const idsOf = (rows: readonly TranscriptEntry[]) =>
		rows.map((entry) => entry.id);

	it("keeps every page row, in order, when the capped frame lands", () => {
		// The wire's real shape (`_cap_tail`): the frame carries the conversation's
		// opening user row pinned at the head plus the newest tail rows, and the
		// page carries the newest 80 of the fold — so the two windows overlap by all
		// but one row per side.
		const page = listOf("p0", "p1", "p2", "p3");
		const merged = mergeTranscript(
			frameOf(rowAt("open"), ...listOf("p1", "p2", "p3")),
			page,
		);
		expect(idsOf(merged.rows)).toEqual(["open", "p0", "p1", "p2", "p3"]);
		expect(merged.holeBelowPage).toBe(true);
	});

	it("takes the frame's copy of a shared row — the live version, in place", () => {
		const page = listOf("p0", "p1", "p2", "p3");
		const live = rowAt("p3", "streamed so far");
		const merged = mergeTranscript(
			frameOf(listOf("p1")[0] as TranscriptEntry, live),
			page,
		);
		expect(idsOf(merged.rows)).toEqual(["p0", "p1", "p2", "p3"]);
		expect(merged.rows.at(-1)).toBe(live);
		// The row that is NOT in the frame keeps the page's own copy rather than
		// vanishing or being re-created.
		expect(merged.rows[0]).toBe(page[0]);
		expect(merged.holeBelowPage).toBe(false);
	});

	it("appends a row that arrived while the page was in flight", () => {
		const merged = mergeTranscript(
			frameOf(rowAt("open"), ...listOf("p3", "p4")),
			listOf("p2", "p3"),
		);
		expect(idsOf(merged.rows)).toEqual(["open", "p2", "p3", "p4"]);
	});

	it("appends a frame that shares no row with the page — the windows moved past each other", () => {
		/* The frame is the newer window: both are tails of one append-only fold, and
		 * a page that were newer would carry the frame's rows above its own oldest.
		 * So the frame's rows go AFTER the page, which keeps the list's tail the
		 * newest row — the end the reader is looking at. */
		const merged = mergeTranscript(
			frameOf(rowAt("open"), ...listOf("p5", "p6")),
			listOf("p2", "p3", "p4"),
		);
		expect(idsOf(merged.rows)).toEqual(["p2", "p3", "p4", "open", "p5", "p6"]);
		expect(merged.holeBelowPage).toBe(true);
		// The hole is claimed: the two windows did not meet, so the rows between
		// them are held by nobody and the caveat must not go silent on it.
	});

	it("keeps a page row the frame no longer carries — the cap slid, the row did not go", () => {
		// The frame's window has slid one row past the page's oldest: p2 is on the
		// page and not in the frame, and a list built from the frame alone would
		// have dropped it.
		const merged = mergeTranscript(
			frameOf(rowAt("open"), ...listOf("p4", "p5")),
			listOf("p2", "p3", "p4"),
		);
		expect(idsOf(merged.rows)).toEqual(["open", "p2", "p3", "p4", "p5"]);
	});

	it("leaves the page alone for a seed frame with no rows — the reopened shape", () => {
		const page = listOf("p0", "p1");
		const merged = mergeTranscript(frameOf(), page);
		expect(idsOf(merged.rows)).toEqual(["p0", "p1"]);
		expect(merged.holeBelowPage).toBe(false);
	});

	it("is the frame when there is no page yet", () => {
		const merged = mergeTranscript(frameOf(...listOf("a", "b")), []);
		expect(idsOf(merged.rows)).toEqual(["a", "b"]);
	});

	it("holds the same rows across a reconnect — stale beats blank", () => {
		// A stream cut and reopened: the same frame lands again, and the merge must
		// produce the same list rather than a shorter one (the store keeps the last
		// projection through the cut for exactly this reason).
		const page = listOf("p0", "p1");
		const frame = frameOf(rowAt("open"), ...listOf("p1"));
		const before = idsOf(mergeTranscript(frame, page).rows);
		const after = idsOf(mergeTranscript(frame, page).rows);
		expect(after).toEqual(before);
		expect(before).toEqual(["open", "p0", "p1"]);
	});
});
