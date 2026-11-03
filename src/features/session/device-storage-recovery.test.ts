import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("@/connection/startup-authorization", () => ({
	getStartupAuthorization: () => ({
		scope: "ordinary-native-policy",
		revision: 1,
	}),
}));
const mirror = vi.hoisted(() => ({
	write: vi.fn(async () => {
		throw new Error("recovery unavailable");
	}),
	discard: vi.fn(async () => {
		throw new Error("recovery unavailable");
	}),
}));
vi.mock("./draft-recovery", () => ({
	writeRecoveryDraft: mirror.write,
	discardRecoveryDraft: mirror.discard,
}));

import {
	clearDraft,
	readDraft,
	readHomeDraft,
	writeDraft,
	writeHomeDraft,
} from "./device-storage";

afterEach(() => vi.unstubAllGlobals());
describe("optional recovery mirror failures", () => {
	it("does not reject successful ordinary session/home saves or discard", async () => {
		const disk = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => disk.get(key) ?? null,
			setItem: (key: string, value: string) => disk.set(key, value),
			removeItem: (key: string) => disk.delete(key),
		});
		await writeDraft("synthetic-session", "ordinary session text");
		await writeHomeDraft("ordinary home text");
		expect(await readDraft("synthetic-session")).toBe("ordinary session text");
		expect(await readHomeDraft()).toBe("ordinary home text");
		await clearDraft("synthetic-session");
		expect(await readDraft("synthetic-session")).toBe("");
		expect(mirror.write).toHaveBeenCalled();
		expect(mirror.discard).toHaveBeenCalled();
	});
});
