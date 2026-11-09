import { afterEach, describe, expect, it, vi } from "vitest";
import { memorySecureStore } from "@/connection/storage";
import {
	reopenPrivateWrites,
	runPrivateWrite,
	withdrawPrivateWrites,
} from "@/features/session/scoped-storage";
import {
	createNoticeDismissals,
	deviceNoticeDismissals,
	noticeKey,
} from "@/team-bridge/notice-dismissals";

const SECURE_KEY = /^[A-Za-z0-9._-]+$/;
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
afterEach(() => {
	vi.unstubAllGlobals();
	reopenPrivateWrites();
});

describe("notice-only durable preferences", () => {
	it("survives relay retirement and reader recreation without reopening private writes", async () => {
		const rows = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => rows.get(key) ?? null,
			setItem: (key: string, value: string) => {
				rows.set(key, value);
			},
		});
		withdrawPrivateWrites();
		await expect(runPrivateWrite(async () => undefined)).rejects.toThrow(
			"closed",
		);
		await deviceNoticeDismissals.set("account-a", "org-a");
		// A new module instance is a reload, not the old reader's in-memory state.
		vi.resetModules();
		const reloaded = await import("@/team-bridge/notice-dismissals");
		expect(
			await reloaded.deviceNoticeDismissals.has("account-a", "org-a"),
		).toBe(true);
		expect(
			await reloaded.deviceNoticeDismissals.has("account-b", "org-a"),
		).toBe(false);
		expect(
			await reloaded.deviceNoticeDismissals.has("account-a", "org-b"),
		).toBe(false);
		await expect(runPrivateWrite(async () => undefined)).rejects.toThrow(
			"closed",
		);
		expect([...rows.values()]).toEqual(["1"]);
	});

	it("uses device-only native options and a fresh reader of the same stable record", async () => {
		const adapter = memorySecureStore();
		const write = vi.spyOn(adapter, "setItemAsync");
		const options = async () => ({ keychainAccessible: "device-only-test" });
		await createNoticeDismissals(async () => adapter, options).set(
			"account-a",
			"org-a",
		);
		expect(write).toHaveBeenCalledWith(
			noticeKey("account-a", "org-a"),
			"1",
			await options(),
		);
		expect(
			await createNoticeDismissals(async () => adapter, options).has(
				"account-a",
				"org-a",
			),
		).toBe(true);
		adapter.items.set(noticeKey("account-b", "org-a"), "unknown-version");
		expect(
			await createNoticeDismissals(async () => adapter).has(
				"account-b",
				"org-a",
			),
		).toBe(false);
	});

	it("does not alias punctuation, Unicode or account/organization boundaries", () => {
		const pairs = [
			["a:b", "c"],
			["a", "b:c"],
			["a.b", "c"],
			["a", "b.c"],
			["帳戶", "組織"],
			["%", "😀"],
		];
		const keys = pairs.map(([a = "", b = ""]) => noticeKey(a, b));
		expect(new Set(keys).size).toBe(pairs.length);
		for (const key of keys) expect(key).toMatch(SECURE_KEY);
	});

	it("does not report success when durable storage refuses a write", async () => {
		const adapter = memorySecureStore();
		vi.spyOn(adapter, "setItemAsync").mockRejectedValue(
			new Error("storage refused"),
		);
		const dismissals = createNoticeDismissals(async () => adapter);
		await expect(dismissals.set("account-a", "org-a")).rejects.toThrow(
			"storage refused",
		);
		expect(await dismissals.has("account-a", "org-a")).toBe(false);
	});
});
