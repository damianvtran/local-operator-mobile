/** Wiring tests only: foreground/config/registration triggers and retirement.
 * Cache correctness is exercised separately through the real coordinator and
 * loopback HTTP. These mocks are NOT native execution or audibility evidence. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
	effect: undefined as (() => (() => void) | undefined) | undefined,
	foreground: undefined as ((state: string) => void) | undefined,
	config: undefined as
		| ((
				next: { frameCount: number; changedKeys: string[] },
				prev: { frameCount: number },
		  ) => void)
		| undefined,
	registered: undefined as (() => void) | undefined,
	key: "synthetic-key" as string | undefined,
	sync: vi.fn(async () => {}),
	report: vi.fn(async () => {}),
	claim: vi.fn(async () => {}),
	remove: vi.fn(),
	unsubscribe: vi.fn(),
}));
vi.mock("react", () => ({
	useEffect: (effect: typeof seam.effect) => {
		seam.effect = effect;
	},
}));
vi.mock("react-native", () => ({
	Platform: { OS: "ios" },
	AppState: {
		addEventListener: (_name: string, callback: typeof seam.foreground) => {
			seam.foreground = callback;
			return { remove: seam.remove };
		},
	},
}));
vi.mock("@/features/auth/connection-provider", () => ({
	useConnection: () => ({
		relay: () => ({ noteNotificationSoundCache: seam.report }),
	}),
	useConnectionState: (select: (s: object) => unknown) =>
		select({
			route: { mode: "radient", tunnelId: "synthetic-tunnel" },
			phase: "live",
		}),
	configStore: {
		subscribe: (callback: typeof seam.config) => {
			seam.config = callback;
			return seam.unsubscribe;
		},
	},
}));
vi.mock("./install-id", () => ({
	readInstallRecord: async () => ({
		install_id: "synthetic-install",
		device_key: seam.key,
	}),
	onPushRegistration: (callback: typeof seam.registered) => {
		seam.registered = callback;
		return seam.unsubscribe;
	},
}));
vi.mock("./custom-sound-native", () => ({
	openSoundDisk: async () => ({ claim: seam.claim }),
}));
vi.mock("./custom-sound-cache", () => ({
	CustomSoundCache: class {
		sync = seam.sync;
	},
}));
vi.mock("expo-crypto", () => ({
	CryptoDigestAlgorithm: { SHA256: "sha256" },
	digestStringAsync: async () => "synthetic-scope",
}));

import { useCustomSoundPrefetch } from "./use-custom-sound-prefetch";

let stop: (() => void) | undefined;
beforeEach(() => {
	vi.clearAllMocks();
	seam.key = "synthetic-key";
});
function PrefetchHarness() {
	useCustomSoundPrefetch();
	stop = seam.effect?.();
}
afterEach(async () => {
	stop?.();
	await new Promise((resolve) => setImmediate(resolve));
});

describe("prefetch lifecycle", () => {
	it("prefetches on app/route start and foreground, not background", async () => {
		PrefetchHarness();
		await vi.waitFor(() => expect(seam.sync).toHaveBeenCalledTimes(1));
		seam.foreground?.("background");
		await new Promise((resolve) => setImmediate(resolve));
		expect(seam.sync).toHaveBeenCalledTimes(1);
		seam.foreground?.("active");
		await vi.waitFor(() => expect(seam.sync).toHaveBeenCalledTimes(2));
	});
	it("consumes only notification sound invalidations on the existing config stream", async () => {
		PrefetchHarness();
		await vi.waitFor(() => expect(seam.sync).toHaveBeenCalledTimes(1));
		seam.config?.(
			{ frameCount: 2, changedKeys: ["language"] },
			{ frameCount: 1 },
		);
		await new Promise((resolve) => setImmediate(resolve));
		expect(seam.sync).toHaveBeenCalledTimes(1);
		seam.config?.(
			{ frameCount: 3, changedKeys: ["notifications.sound.id"] },
			{ frameCount: 2 },
		);
		await vi.waitFor(() => expect(seam.sync).toHaveBeenCalledTimes(2));
	});
	it("retries after successful push registration, without starting a registration", async () => {
		PrefetchHarness();
		await vi.waitFor(() => expect(seam.sync).toHaveBeenCalledTimes(1));
		seam.registered?.();
		await vi.waitFor(() => expect(seam.sync).toHaveBeenCalledTimes(2));
	});
	it("withdraws readiness before releasing the previous route's disk claim", async () => {
		PrefetchHarness();
		await vi.waitFor(() => expect(seam.sync).toHaveBeenCalledTimes(1));
		stop?.();
		stop = undefined;
		await vi.waitFor(() =>
			expect(seam.claim).toHaveBeenCalledWith("synthetic-scope", []),
		);
		expect(seam.report).toHaveBeenCalledWith(
			"synthetic-install",
			"synthetic-key",
			[],
		);
		expect(seam.report.mock.invocationCallOrder[0]).toBeLessThan(
			seam.claim.mock.invocationCallOrder[0] ?? 0,
		);
	});
	it("does not fetch or claim readiness before the S7 device key exists", async () => {
		seam.key = undefined;
		PrefetchHarness();
		await new Promise((resolve) => setImmediate(resolve));
		expect(seam.sync).not.toHaveBeenCalled();
	});
	it("removes listeners and stops retired triggers", async () => {
		PrefetchHarness();
		await vi.waitFor(() => expect(seam.sync).toHaveBeenCalledTimes(1));
		stop?.();
		stop = undefined;
		seam.foreground?.("active");
		seam.registered?.();
		await new Promise((resolve) => setImmediate(resolve));
		expect(seam.sync).toHaveBeenCalledTimes(1);
		expect(seam.remove).toHaveBeenCalled();
		expect(seam.unsubscribe).toHaveBeenCalledTimes(2);
	});
});
