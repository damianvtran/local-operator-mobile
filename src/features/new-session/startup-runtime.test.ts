import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayEndpoints } from "@/relay/endpoints";

/* The real runtime module owns module-level maps and platform storage, so the
 * only seams replaced here are the ones it cannot run without in Node: the
 * device store, the authorization owner, UUID minting and the relay's persisted
 * command path. The coordinator itself is the production class. */

const records = new Map<string, string>();
const recoveryRecords = new Map<string, string>();
let authorization: { scope: string; revision: number } | null = null;
let counter = 0;
let scopeCounter = 0;
let scope = "scope-u1-0";

vi.mock("expo-crypto", () => ({
	randomUUID: () =>
		`00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
}));
vi.mock("./startup-device-store", () => ({
	STARTUP_PREFIX: "test-startup:",
	startupDeviceStore: {
		get: async (key: string) => records.get(key) ?? null,
		set: async (key: string, value: string) => {
			records.set(key, value);
		},
		clear: async () => {
			records.clear();
		},
	},
}));
vi.mock("@/connection/startup-authorization", () => ({
	getStartupAuthorization: () => authorization,
	registerStartupAuthorizationCleanup: () => () => undefined,
}));
vi.mock("@/features/session/draft-recovery", () => ({
	readRecoveryDraft: async (key: string, scope: string) =>
		authorization?.scope === scope ? (recoveryRecords.get(key) ?? null) : null,
	writeRecoveryDraft: async (key: string, value: string, scope: string) => {
		if (authorization?.scope === scope) recoveryRecords.set(key, value);
	},
}));
vi.mock("@/features/session/envelope-store", () => ({
	envelopeStoreFor: () => ({}),
}));
vi.mock("@/relay/send-command", () => ({
	sendPersistedCommand: async () => undefined,
}));

const { openStartup } = await import("./startup-runtime");

const auth = () => {
	if (authorization === null) throw new Error("missing authorization");
	return authorization;
};
const activeKey = (forScope: string) => JSON.stringify([forScope, "active"]);

/* A create that can never be confirmed: no RelayError, so the coordinator
 * classifies it `ambiguous` — the state UX U1 trapped Home in. */
const client = {
	startSession: async () => {
		throw new Error("network unreachable");
	},
} as unknown as RelayEndpoints;

describe("an unconfirmed start does not own the next draft", () => {
	beforeEach(() => {
		records.clear();
		recoveryRecords.clear();
		/* The runtime's maps and this file's storage both outlive a test, so the
		 * scope must not repeat: a second `scope-u1-1` would hand test two the
		 * first test's coordinator, which is how this fixture itself went wrong. */
		scope = `scope-u1-${++scopeCounter}`;
		authorization = { scope, revision: 1 };
	});

	it("New opens a fresh editor and keeps the old record and queue private", async () => {
		const first = await openStartup(auth(), client);
		first.resume();
		first.edit("held message", []);
		await first.enqueue();
		await first.configure({ cwd: "/home/fixture" });
		await first.quiesce();

		// RED on the old runtime: openStartup(fresh) only rotated when a session id
		// existed, so this state kept the same coordinator and New did nothing.
		expect(first.snapshot().phase).toBe("unconfirmed");
		expect(first.snapshot().queue).toHaveLength(1);

		const oldKey = records.get(activeKey(scope));
		expect(oldKey).not.toBeNull();

		const next = await openStartup(auth(), client, true);

		expect(next).not.toBe(first);
		expect(next.snapshot()).toMatchObject({
			phase: "draft",
			sessionId: null,
			queue: [],
			draft: { text: "", images: [] },
		});

		// The old work is not lost, moved, or faked: still in memory and on disk
		// under its own provisional identity, with no invented session id.
		const old = first.snapshot();
		expect(old.phase).toBe("unconfirmed");
		expect(old.sessionId).toBeNull();
		expect(old.queue).toHaveLength(1);
		const stored = records.get(JSON.stringify([scope, oldKey ?? ""]));
		if (stored === null || stored === undefined)
			throw new Error("old record vanished");
		const parsed = JSON.parse(stored) as {
			phase: string;
			sessionId: string | null;
			queue: unknown[];
		};
		expect(parsed.phase).toBe("unconfirmed");
		expect(parsed.sessionId).toBeNull();
		expect(parsed.queue).toHaveLength(1);

		// The active pointer moved to a different local identity.
		expect(records.get(activeKey(scope))).not.toBe(oldKey);
	});

	it("checkpoints the editor before delayed persistence and recovers no dispatch rights", async () => {
		const first = await openStartup(auth(), client);
		const image = { mime_type: "image/png", data_b64: "aW1hZ2U=" };
		first.edit("unsent private text", [image]);
		// Synchronous checkpoint acceptance matters: auth can withdraw before the
		// ordinary coordinator persistence tail gets its next turn.
		expect(JSON.parse(recoveryRecords.get("startup:active") ?? "null")).toEqual(
			{ text: "unsent private text", images: [image] },
		);
		await first.flush();
		authorization = null;
		first.revoke();
		records.clear();
		authorization = { scope: `scope-recovered-${++scopeCounter}`, revision: 2 };
		const start = vi.fn(async () => ({
			ok: true as const,
			pid: 1,
			session_id: "never-created",
		}));
		const restored = await openStartup(auth(), {
			startSession: start,
		} as unknown as RelayEndpoints);
		restored.resume();
		await restored.quiesce();
		expect(restored.snapshot()).toMatchObject({
			phase: "draft",
			sessionId: null,
			selection: null,
			queue: [],
			draft: { text: "unsent private text", images: [image] },
		});
		expect(start).not.toHaveBeenCalled();
	});

	it("does not reintroduce a discarded editor from a sealed checkpoint", async () => {
		const first = await openStartup(auth(), client);
		first.edit("discard me", []);
		await first.flush();
		first.edit("", []);
		await first.flush();
		authorization = null;
		first.revoke();
		records.clear();
		authorization = { scope: `scope-discarded-${++scopeCounter}`, revision: 2 };
		const restored = await openStartup(auth(), client);
		expect(restored.snapshot().draft).toEqual({ text: "", images: [] });
	});

	it("New on an untouched empty draft reuses the same owner instead of leaking ids", async () => {
		const first = await openStartup(auth(), client);
		first.resume();
		const pointer = records.get(activeKey(scope));

		const again = await openStartup(auth(), client, true);

		expect(again).toBe(first);
		expect(records.get(activeKey(scope))).toBe(pointer);
	});
});
