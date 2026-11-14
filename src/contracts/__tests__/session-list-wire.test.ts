/**
 * The `/api/sessions` body exactly as local-operator v0.101.19 (origin/main
 * 8046ac7) builds it — `SessionTable._merge_summaries` (`daemon.py:1578-1717`)
 * for each row, `_list_frame` (`daemon.py:6355-6452`) for the envelope.
 *
 * WHY THIS FILE EXISTS (TestFlight build 628): `effort` was declared
 * `z.string().optional()` while the daemon sends `"effort": null` for every row
 * with no recorded rung (`daemon.py:1609`). One `null` failed the whole
 * `sessionListFrame` parse, so neither the REST read nor the stream's seed ever
 * reached the list store: the drawer sat on skeletons forever, and because
 * `capabilities` rides the SAME frame the store kept its initial `{}` and
 * `notificationsEnabled({})` hid the bell. The older captures under
 * `fixtures/relay` predate the nullable keys, which is how the drift shipped.
 *
 * Every key here is one the daemon emits on a row it has NO live projection for
 * (the durable rebuild every phone sees first after a daemon restart), so each
 * nullable member is at its `None` reading. Keep this payload in step with the
 * daemon: it is the regression net for "a field the daemon nulls".
 */
import { describe, expect, it, vi } from "vitest";
import { safeParsePayload } from "../parse";

/** One durable-only row: no projection (`p is None`), no live entry. */
function durableRow(id: string, overrides: Record<string, unknown> = {}) {
	return {
		session_id: id,
		section: "previous",
		pinned: false,
		tags: [],
		primary: null,
		conversation_name: "Fix the relay",
		cwd: "/Users/someone/project",
		model_label: "anthropic/claude-opus-5-5",
		/* `identity.effort` for a journal with no rung — the field that broke 628. */
		effort: null,
		streaming: false,
		leaving: "",
		updating: "",
		needs_attention: false,
		pending_kind: "",
		subagents_running: null,
		subagents_queued: null,
		ended: false,
		degraded: false,
		opened_by: null,
		agent_id: null,
		avatar_sha256: null,
		todos_open: 0,
		mtime: 1_762_500_000.25,
		created_at: 1_762_400_000.5,
		completion_kind: "",
		unseen: false,
		/* `asks_open` is POPPED when None (`daemon.py:1725-1727`), never null. */
		...overrides,
	};
}

function liveFrame(sessions: unknown[]) {
	return {
		sessions,
		degraded: [],
		/* `_unread_aggregate` minus `conversations` (`daemon.py:1372-1377`). */
		unread: { count: 0, revision: [3, 1, 0], degraded: [] },
		notifications: { unread_count: 2, waiting_count: 1 },
		capabilities: {
			features: { notifications: 1, session_tags: 1 },
			i18n: { catalogues: 1 },
			stt: { available: false, path: null, reason: "no key" },
			session_tags: { available: true },
			skill_invocation: { available: true },
			notification_sounds: { available: true },
			session_start: {
				version: 1,
				durable_idempotency: true,
				receipt_capacity: 256,
				effort: true,
			},
		},
	};
}

describe("the v0.101.19 session list (TestFlight 628)", () => {
	it("parses rows whose effort is null and reads the null as no claim", () => {
		const result = safeParsePayload(
			"sessionListFrame",
			liveFrame([
				durableRow("a1"),
				durableRow("b2", { effort: "high", section: "active", asks_open: 0 }),
			]),
		);
		/* The failing paths, not a bare boolean, so a regression names its field. */
		expect(result.ok ? [] : result.error.issues.map((i) => i.path)).toEqual([]);
		if (!result.ok) return;
		/* No real-shaped row may be dropped by the per-row tolerance below. */
		expect(result.data.sessions).toHaveLength(2);
		/* Consumers read `string | undefined` (`session-chips.ts` `firstOf`): the
		 *  wire's `null` must not reach them as a third state. */
		expect(result.data.sessions[0]?.effort).toBeUndefined();
		expect(result.data.sessions[1]?.effort).toBe("high");
		/* The bell's gate rides the same frame: a parsed frame carries it. */
		expect(result.data.capabilities.features?.notifications).toBe(1);
	});

	it("parses a remote mesh row with its null placement/origin/sync stamp", () => {
		/* `mesh.remote_session_rows` (`mesh.py:195-240`) plus the `_list_frame`
		 *  tag pair (`daemon.py:6421-6423`). */
		const remote = {
			session_id: "r9",
			section: "active",
			pinned: false,
			conversation_name: "On the laptop",
			mtime: 1_762_500_000,
			created_at: 0,
			live_state: "idle",
			pending: null,
			locality: "remote",
			owner_device: "dev-0123456789abcdef",
			owner_device_name: "",
			reachable: false,
			unreachable_reason: "The other device is offline.",
			placement: null,
			origin: null,
			last_synced_at: null,
			tags: [],
			primary: null,
		};
		const result = safeParsePayload(
			"sessionListFrame",
			liveFrame([durableRow("a1"), remote]),
		);
		expect(result.ok ? [] : result.error.issues.map((i) => i.path)).toEqual([]);
		if (result.ok) expect(result.data.sessions).toHaveLength(2);
	});

	it("reads the degraded unread block, which carries no revision or count", () => {
		/* `SessionTable._unread_aggregate` (`daemon.py:1321-1327`): a degraded
		 *  listing or a store with no revision answers `{"degraded": [...]}` only. */
		const frame = {
			...liveFrame([durableRow("a1")]),
			degraded: ["sessions"],
			unread: { degraded: ["sessions"] },
		};
		const result = safeParsePayload("sessionListFrame", frame);
		expect(result.ok ? [] : result.error.issues.map((i) => i.path)).toEqual([]);
		if (!result.ok) return;
		expect(result.data.unread?.count).toBeUndefined();
		expect(result.data.unread?.revision).toBeUndefined();
		expect(result.data.capabilities.features?.notifications).toBe(1);
	});

	it("drops one malformed row and keeps the rest of the list and the bell's gate", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			const result = safeParsePayload(
				"sessionListFrame",
				liveFrame([
					durableRow("a1"),
					/* A future drift: a field this build cannot read. */
					durableRow("b2", { pinned: "yes", conversation_name: "secret name" }),
					durableRow("c3"),
				]),
			);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.data.sessions.map((row) => row.session_id)).toEqual([
				"a1",
				"c3",
			]);
			expect(result.data.capabilities.features?.notifications).toBe(1);
			expect(result.data.notifications?.unread_count).toBe(2);
			/* Logged with the PATH, never the row's content. */
			expect(warn).toHaveBeenCalledTimes(1);
			const line = String(warn.mock.calls[0]?.[0]);
			expect(line).toContain("row 1");
			expect(line).toContain("pinned");
			expect(line).not.toContain("secret name");
		} finally {
			warn.mockRestore();
		}
	});

	it("still rejects a malformed envelope: tolerance is per row only", () => {
		const result = safeParsePayload("sessionListFrame", {
			...liveFrame([durableRow("a1")]),
			degraded: null,
		});
		expect(result.ok).toBe(false);
	});
});

/*
 * local-operator #3923 (v0.102.5) adds `last_user_at` to every `/api/sessions`
 * row: epoch SECONDS of the person's last message, possibly fractional, `null`
 * when unknown (and on every non-running row). Older daemons omit it.
 */
describe("the v0.102.5 last_user_at field", () => {
	it("keeps a fractional value, a null and an absence distinct", () => {
		const result = safeParsePayload(
			"sessionListFrame",
			liveFrame([
				durableRow("run", {
					section: "active",
					streaming: true,
					last_user_at: 1_762_500_100.375,
				}),
				durableRow("unknown", { last_user_at: null }),
				durableRow("older-daemon"),
			]),
		);
		expect(result.ok ? [] : result.error.issues.map((i) => i.path)).toEqual([]);
		if (!result.ok) return;
		const [run, unknown, older] = result.data.sessions;
		expect(run?.last_user_at).toBe(1_762_500_100.375);
		expect(unknown?.last_user_at).toBeNull();
		expect(older?.last_user_at).toBeUndefined();
	});

	it("rejects a non-numeric last_user_at rather than minting a clock", () => {
		const result = safeParsePayload(
			"sessionListFrame",
			liveFrame([
				durableRow("bad", { last_user_at: "yesterday" }),
				durableRow("ok"),
			]),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// Per-row tolerance drops the malformed row, keeps the rest.
		expect(result.data.sessions.map((s) => s.session_id)).toEqual(["ok"]);
	});
});
