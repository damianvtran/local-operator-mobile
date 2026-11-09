import { afterEach, describe, expect, it, vi } from "vitest";

const backing = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("./device-storage", () => ({
	deviceStore: {
		get: async (key: string) => backing.values.get(key) ?? null,
		set: async (key: string, value: string) => {
			backing.values.set(key, value);
		},
		remove: async (key: string) => {
			backing.values.delete(key);
		},
		keys: async () => [...backing.values.keys()],
	},
}));
// The native UUID port, not browser globals. No Expo/native bridge is run here.
vi.mock("expo-crypto", () => ({
	randomUUID: () => "12345678-1234-4234-8234-123456789abc",
}));

import { envelopeStoreFor, forgetEnvelopeStore } from "./envelope-store";
import { reopenPrivateWrites } from "./scoped-storage";

const SCOPE = "synthetic-composer-scope";
afterEach(() => {
	vi.unstubAllGlobals();
	backing.values.clear();
	reopenPrivateWrites();
});

describe("the native envelope store UUID port", () => {
	it.each([false, true])(
		"retains an instruction without browser crypto (image: %s)",
		async (image) => {
			vi.stubGlobal("crypto", undefined);
			reopenPrivateWrites(SCOPE);
			const sid = image ? "synthetic-image" : "synthetic-text";
			forgetEnvelopeStore(sid);
			const store = envelopeStoreFor(sid, SCOPE);
			const { envelope } = await store.holdNew(
				sid,
				"prompt",
				"preserve this draft",
				image ? [{ mime_type: "image/png", data_b64: "iVBORw0KGgo=" }] : [],
			);
			expect(envelope.command_id).toBe("12345678-1234-4234-8234-123456789abc");
			expect(await store.peek(sid)).toEqual(envelope);
			expect(backing.values.size).toBeGreaterThan(0);
			forgetEnvelopeStore(sid);
		},
	);
});
/**
 * One store per session, because two is a duplicate POST.
 *
 * The store is what makes a replay reuse a `command_id`. Two instances on one
 * session would each believe they held the only envelope, so the second `holdNew`
 * would mint a new id for an instruction the first had already persisted — the
 * relay would then see two distinct commands for one thing the reader typed.
 * Sharing is therefore a correctness property, not an optimisation.
 */
describe("the envelope store's lifetime", () => {
	it("hands the same instance back for the same session", () => {
		const first = envelopeStoreFor("session-a");
		expect(envelopeStoreFor("session-a")).toBe(first);
		expect(envelopeStoreFor("session-a")).toBe(first);
	});

	it("keeps sessions apart, so one session's unresolved instruction is not another's", () => {
		const a = envelopeStoreFor("session-a");
		const b = envelopeStoreFor("session-b");
		expect(b).not.toBe(a);
	});

	it("drops the instance on request, without disturbing the other sessions", () => {
		const before = envelopeStoreFor("session-c");
		forgetEnvelopeStore("session-c");
		const after = envelopeStoreFor("session-c");
		expect(after).not.toBe(before);
		expect(envelopeStoreFor("session-a")).toBe(envelopeStoreFor("session-a"));
	});
});
