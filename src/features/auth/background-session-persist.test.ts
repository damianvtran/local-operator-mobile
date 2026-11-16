import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
const persist = vi.hoisted(() =>
	vi.fn(async () => {
		throw Error("keychain locked");
	}),
);
vi.mock("@/connection", async (importActual) => {
	const actual = await importActual<typeof import("@/connection")>();
	return {
		...actual,
		SecureStorage: class extends actual.SecureStorage {
			override writeTunnelSession = persist;
		},
	};
});

import { type TunnelSession, TunnelSessionManager } from "@/connection";
import { writeStoredTunnelSession } from "./tunnel-storage";

describe("warm push session persistence under the unchanged keychain class", () => {
	it("the production writer tolerates a locked write; the manager keeps the refreshed session", async () => {
		const now = Date.now();
		const session: TunnelSession = {
			grant: "synthetic-refreshed-grant",
			refreshHandle: "synthetic-handle",
			grantExpiresAt: now + 300_000,
			refreshExpiresAt: now + 86_400_000,
			hostname: "0123456789abcdef0123456789abcdef-lop.example.com",
			tunnelId: "synthetic-tunnel",
			mintedAt: now,
		};
		const manager = new TunnelSessionManager({
			oauthAccessToken: async () => null,
			persist: writeStoredTunnelSession,
		});
		await expect(manager.adopt(session)).resolves.toBeUndefined();
		expect(persist).toHaveBeenCalledTimes(1);
		expect(manager.current).toBe(session);
		expect(await manager.usableSession()).toBe(session);
	});
});
