/** Wiring tests for session push registration: WHEN the app registers with the
 * routed computer, and that nothing but a real change re-POSTs.
 *
 * THE HOOK RUNTIME HONOURS DEPS. Round 1 of the PR review (R1-1) found that the
 * first version of this suite mocked `useEffect` as "run once, ignore deps",
 * which hid the defect it should have caught: the effect re-ran (and
 * force-POSTed) on every Connection context recompute, because the context's
 * `relay` accessor is a fresh arrow each time. `hooks` below is a minimal
 * React-shaped runtime — effects re-run only when a dep changes by `Object.is`,
 * cleanups run before the re-run and on unmount, refs persist across renders —
 * and `useConnection` hands out a NEW `relay` arrow on every render, exactly as
 * `connection-provider.tsx`'s memo does. There is no React renderer in this
 * repository's Node test setup (ADR 0003: renderer tests belong to the native
 * E2E layer), so this is the smallest faithful stand-in.
 *
 * The register module itself runs for real; only React, the native
 * notifications module, the keystore and the connection are seams. What the
 * body must look like ON THE WIRE is pinned separately against the daemon's own
 * bytes (`relay/__tests__/push-register-contract.test.ts`). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
	type Slot = {
		deps?: readonly unknown[];
		cleanup?: (() => void) | undefined;
		ref?: { current: unknown };
	};
	let slots: Slot[] = [];
	let index = 0;
	const changed = (prev: readonly unknown[] | undefined, next?: unknown[]) =>
		prev === undefined ||
		next === undefined ||
		prev.length !== next.length ||
		next.some((dep, i) => !Object.is(dep, prev[i]));
	return {
		/** One render of `component`, then its changed effects, in order. */
		render(component: () => void): void {
			index = 0;
			const queued: (() => void)[] = [];
			const previous = this.useEffect;
			this.useEffect = (
				effect: () => (() => void) | undefined,
				deps?: unknown[],
			) => {
				const slot = slots[index++] ?? {};
				slots[index - 1] = slot;
				if (!changed(slot.deps, deps)) return;
				slot.deps = deps;
				queued.push(() => {
					slot.cleanup?.();
					slot.cleanup = effect() ?? undefined;
				});
			};
			try {
				component();
			} finally {
				this.useEffect = previous;
			}
			for (const run of queued) run();
		},
		unmount(): void {
			for (const slot of slots) slot.cleanup?.();
			slots = [];
		},
		useEffect: (
			_effect: () => (() => void) | undefined,
			_deps?: unknown[],
		): void => {
			throw new Error("useEffect outside render");
		},
		useRef<T>(initial: T): { current: T } {
			const slot = slots[index++] ?? {};
			slots[index - 1] = slot;
			slot.ref ??= { current: initial };
			return slot.ref as { current: T };
		},
	};
});

const seam = vi.hoisted(() => ({
	foreground: undefined as ((state: string) => void) | undefined,
	rotate: undefined as (() => void) | undefined,
	platform: "ios" as "ios" | "android",
	phase: "live",
	revision: 1,
	route: { mode: "radient", tunnelId: "synthetic-tunnel" } as
		| { mode: "radient"; tunnelId: string }
		| { mode: "custom"; baseUrl: string }
		| null,
	permission: "granted",
	token: "synthetic-token-1" as string | null,
	register: vi.fn(),
	recorded: vi.fn(async (_id: string, _key: string) => {}),
	requestPermission: vi.fn(),
	removeForeground: vi.fn(),
	removeToken: vi.fn(),
	relayIdentities: new Set<unknown>(),
	capabilities: {} as Record<string, unknown>,
}));

vi.mock("react", () => ({
	useEffect: (effect: () => (() => void) | undefined, deps?: unknown[]) =>
		hooks.useEffect(effect, deps),
	useRef: <T>(initial: T) => hooks.useRef(initial),
}));
vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return seam.platform;
		},
	},
	AppState: {
		addEventListener: (_name: string, callback: typeof seam.foreground) => {
			seam.foreground = callback;
			return { remove: seam.removeForeground };
		},
	},
}));
vi.mock("expo-constants", () => ({
	// An internal build: the placeholder version CI writes for an untagged ref,
	// plus the build number that actually tells two TestFlight builds apart.
	default: {
		expoConfig: {
			version: "0.0.0",
			ios: { buildNumber: "953" },
			android: { versionCode: 953 },
		},
	},
}));
vi.mock("@/features/auth/connection-provider", () => ({
	// A NEW accessor on every render, as the provider's `useMemo` produces on
	// every recompute (streamHealth, busy, computers, …).
	useConnection: () => {
		const relay = () => ({ registerDevice: seam.register });
		seam.relayIdentities.add(relay);
		return { relay };
	},
	useConnectionState: (select: (s: object) => unknown) =>
		select({ route: seam.route, phase: seam.phase, revision: seam.revision }),
	useListState: (select: (s: object) => unknown) =>
		select({ capabilities: seam.capabilities }),
}));
// The real gate and wire shape; only the keystore read is a seam.
vi.mock("@/notifications/notification-preferences", async (importActual) => {
	const actual =
		await importActual<
			typeof import("@/notifications/notification-preferences")
		>();
	return {
		...actual,
		loadNotificationPreferences: async () =>
			actual.notificationPreferencesStore.getState().preferences,
	};
});
const notificationsModule = {
	getPermissionsAsync: async () => ({ status: seam.permission }),
	requestPermissionsAsync: seam.requestPermission,
	addPushTokenListener: (listener: () => void) => {
		seam.rotate = listener;
		return { remove: seam.removeToken };
	},
};
vi.mock("@/notifications/native", () => ({
	notificationsSupported: () => true,
	loadNotifications: async () => notificationsModule,
	devicePushToken: async () =>
		seam.token === null ? null : { token: seam.token, platform: seam.platform },
}));
vi.mock("@/notifications/install-id", () => ({
	ensureInstallRecord: async () => ({
		v: 1,
		install_id: "5a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
	}),
	recordRegistration: seam.recorded,
}));

import {
	appVersionFrom,
	pushEnvironment,
	resetSessionPushRegistrationMemory,
	sessionPushRegistrationStore,
} from "./session-push-registration";
import {
	requestSessionPushRegistration,
	useSessionPushRegistration,
} from "./use-session-push-registration";

/** One render of the app root's use of the hook (a Connection recompute). */
const render = () => hooks.render(() => useSessionPushRegistration());
const settle = async () => {
	for (let i = 0; i < 4; i++)
		await new Promise((resolve) => setImmediate(resolve));
};

/** The default daemon: accepts every register. Re-installed per test because
 *  `clearAllMocks` keeps a test's own `mockImplementation`. */
const accept = async (_body: Record<string, unknown>) => ({
	device_id: "synthetic-device",
	device_key: "synthetic-device-key",
});

beforeEach(() => {
	vi.clearAllMocks();
	seam.register.mockImplementation(accept);
	resetSessionPushRegistrationMemory();
	seam.platform = "ios";
	seam.phase = "live";
	seam.revision = 1;
	seam.route = { mode: "radient", tunnelId: "synthetic-tunnel" };
	seam.permission = "granted";
	seam.token = "synthetic-token-1";
	seam.foreground = undefined;
	seam.rotate = undefined;
	seam.relayIdentities.clear();
	seam.capabilities = {};
});
afterEach(async () => {
	hooks.unmount();
	await settle();
});

describe("session push registration lifecycle", () => {
	it("granted + live route: exactly one POST, with the daemon's fields only", async () => {
		render();
		await vi.waitFor(() => expect(seam.recorded).toHaveBeenCalledTimes(1));
		expect(seam.register).toHaveBeenCalledTimes(1);
		expect(seam.register.mock.calls[0]?.[0]).toEqual({
			platform: "ios",
			token: "synthetic-token-1",
			// Node has no `__DEV__`: a release build, so APNs production.
			environment: "production",
			app_version: "0.0.0 (953)",
			install_id: "5a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
		});
		expect(seam.recorded).toHaveBeenCalledWith(
			"synthetic-device",
			"synthetic-device-key",
		);
		expect(sessionPushRegistrationStore.getState()).toMatchObject({
			routeKey: "radient:synthetic-tunnel",
			status: "registered",
		});
		// Registration only ever READS permission; the prompt stays in Settings.
		expect(seam.requestPermission).not.toHaveBeenCalled();
	});

	it("R1-1: N Connection recomputes with the same route cause ONE POST", async () => {
		render();
		// The cold-start churn the review traced: stream idle → connecting → live,
		// busy, the computers refresh — every one a new `relay` identity — and a
		// stall/resume that moves the phase between live-like phases.
		for (const phase of ["live", "live", "degraded", "live", "re-minting"]) {
			seam.phase = phase;
			render();
			await settle();
		}
		seam.phase = "live";
		for (let i = 0; i < 5; i++) render();
		await settle();
		expect(seam.relayIdentities.size).toBeGreaterThanOrEqual(10);
		expect(seam.register).toHaveBeenCalledTimes(1);
		expect(seam.recorded).toHaveBeenCalledTimes(1);
	});

	it("R1-1: a simulated cold start (signed-out → minting → live, with churn) POSTs once", async () => {
		seam.route = null;
		seam.phase = "signed-out";
		render();
		seam.route = { mode: "radient", tunnelId: "synthetic-tunnel" };
		seam.revision = 2;
		seam.phase = "minting";
		render();
		render();
		seam.phase = "live";
		render();
		// The provider's post-admission churn lands asynchronously, while the
		// first registration is in flight: streamHealth idle → connecting → live,
		// busy → false, the computers refresh. Each is a new `relay` identity.
		for (let i = 0; i < 4; i++) {
			await new Promise((resolve) => setImmediate(resolve));
			render();
		}
		await settle();
		expect(seam.register).toHaveBeenCalledTimes(1);
		expect(sessionPushRegistrationStore.getState().status).toBe("registered");
	});

	it("R1-1: a reconnect (live → not live → live) re-POSTs exactly once", async () => {
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(1));
		seam.phase = "refused";
		render();
		await settle();
		seam.phase = "minting";
		render();
		seam.phase = "live";
		render();
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(2));
		await settle();
		expect(seam.register).toHaveBeenCalledTimes(2);
	});

	it("R1-1: a re-admission that bumps the route revision re-POSTs exactly once", async () => {
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(1));
		seam.revision = 2;
		render();
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(2));
		await settle();
		expect(seam.register).toHaveBeenCalledTimes(2);
	});

	it("R1-2: an overlapping re-run waits for the in-flight POST, so the keystore keeps the daemon's last key", async () => {
		// A fake daemon that mints key-N in the order it PROCESSES requests, and
		// lets the test choose that order.
		let daemonKey = "";
		const answers: (() => void)[] = [];
		let minted = 0;
		seam.register.mockImplementation(
			() =>
				new Promise((resolve) => {
					answers.push(() => {
						minted += 1;
						daemonKey = `key-${minted}`;
						resolve({ device_id: "synthetic-device", device_key: daemonKey });
					});
				}),
		);
		render();
		await vi.waitFor(() => expect(answers).toHaveLength(1));
		// A reconnect while the first POST is still on the wire.
		seam.revision = 2;
		render();
		await settle();
		// Single-flight across effect instances: no parallel POST.
		expect(seam.register).toHaveBeenCalledTimes(1);
		answers[0]?.();
		await vi.waitFor(() => expect(answers).toHaveLength(2));
		answers[1]?.();
		await vi.waitFor(() => expect(seam.recorded).toHaveBeenCalled());
		await settle();
		expect(seam.register).toHaveBeenCalledTimes(2);
		expect(seam.recorded.mock.calls.at(-1)?.[1]).toBe(daemonKey);
	});

	it("foreground is idempotent: the same registration is not re-sent", async () => {
		render();
		await vi.waitFor(() =>
			expect(sessionPushRegistrationStore.getState().status).toBe("registered"),
		);
		seam.foreground?.("active");
		seam.foreground?.("background");
		seam.foreground?.("active");
		await settle();
		expect(seam.register).toHaveBeenCalledTimes(1);
		expect(sessionPushRegistrationStore.getState().status).toBe("registered");
	});

	it("token rotation re-POSTs the new token for the same install", async () => {
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(seam.rotate).toBeDefined());
		seam.token = "synthetic-token-2";
		seam.rotate?.();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(2));
		const second = seam.register.mock.calls[1]?.[0];
		expect(second?.token).toBe("synthetic-token-2");
		expect(second?.install_id).toBe("5a1b2c3d-4e5f-4061-8273-8495a6b7c8d9");
		// …and the rotated registration is itself idempotent on foreground.
		seam.foreground?.("active");
		await settle();
		expect(seam.register).toHaveBeenCalledTimes(2);
	});

	it("permission denied: no POST and no prompt", async () => {
		seam.permission = "denied";
		render();
		await vi.waitFor(() =>
			expect(sessionPushRegistrationStore.getState().status).toBe("permission"),
		);
		seam.foreground?.("active");
		await settle();
		expect(seam.register).not.toHaveBeenCalled();
		expect(seam.requestPermission).not.toHaveBeenCalled();
	});

	it("a route that is not live yet does not POST", async () => {
		seam.phase = "connecting";
		render();
		await settle();
		expect(seam.register).not.toHaveBeenCalled();
	});

	it("a route change and a Settings grant are forced re-registrations", async () => {
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(1));
		// Another computer: the new computer must learn this phone even though
		// nothing about the phone changed.
		seam.route = { mode: "custom", baseUrl: "https://relay.example.invalid" };
		seam.revision = 2;
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(2));
		await vi.waitFor(() =>
			expect(sessionPushRegistrationStore.getState()).toMatchObject({
				routeKey: "custom:https://relay.example.invalid",
				status: "registered",
			}),
		);
		requestSessionPushRegistration();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(3));
	});

	it("sign-out (no route) clears the Settings registration state", async () => {
		render();
		await vi.waitFor(() =>
			expect(sessionPushRegistrationStore.getState().status).toBe("registered"),
		);
		seam.route = null;
		seam.phase = "signed-out";
		seam.revision = 2;
		render();
		await settle();
		expect(sessionPushRegistrationStore.getState()).toEqual({
			routeKey: null,
			status: "idle",
			code: null,
			registeredAt: null,
		});
		// Signing back in to the same computer registers again (no stale cache).
		seam.route = { mode: "radient", tunnelId: "synthetic-tunnel" };
		seam.phase = "live";
		seam.revision = 3;
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(2));
	});

	it("Android sends the FCM token as platform android, environment production", async () => {
		seam.platform = "android";
		seam.token = "synthetic-fcm-token";
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(1));
		expect(seam.register.mock.calls[0]?.[0]).toMatchObject({
			platform: "android",
			token: "synthetic-fcm-token",
			environment: "production",
		});
	});

	it("a failed POST is reported without the token, and the next foreground retries", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		seam.register.mockRejectedValueOnce(new Error("boom synthetic-token-1"));
		render();
		await vi.waitFor(() =>
			expect(sessionPushRegistrationStore.getState().status).toBe("failed"),
		);
		expect(JSON.stringify(warn.mock.calls)).not.toContain("synthetic-token");
		expect(warn.mock.calls[0]?.[0]).toContain("[push]");
		seam.foreground?.("active");
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(2));
		await vi.waitFor(() =>
			expect(sessionPushRegistrationStore.getState().status).toBe("registered"),
		);
		warn.mockRestore();
	});

	it("tears down its foreground and token subscriptions", async () => {
		render();
		await vi.waitFor(() => expect(seam.rotate).toBeDefined());
		hooks.unmount();
		expect(seam.removeForeground).toHaveBeenCalledTimes(1);
		expect(seam.removeToken).toHaveBeenCalledTimes(1);
	});
});

describe("notification preferences in the register body", () => {
	it("omits `preferences` for a daemon without push_preferences", async () => {
		seam.capabilities = { features: {} };
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(1));
		expect(seam.register.mock.calls[0]?.[0]).not.toHaveProperty("preferences");
	});

	it("sends {enabled, completions, errors} to a daemon that advertises it", async () => {
		seam.capabilities = { push_preferences: { available: true } };
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(1));
		expect(seam.register.mock.calls[0]?.[0].preferences).toEqual({
			enabled: true,
			completions: true,
			errors: true,
		});
	});

	it("re-registers, with preferences, when the capability arrives after the first POST", async () => {
		render();
		await vi.waitFor(() => expect(seam.recorded).toHaveBeenCalledTimes(1));
		expect(seam.register.mock.calls[0]?.[0]).not.toHaveProperty("preferences");
		seam.capabilities = { push_preferences: true };
		render();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(2));
		expect(seam.register.mock.calls[1]?.[0].preferences).toEqual({
			enabled: true,
			completions: true,
			errors: true,
		});
	});
});

describe("APNs environment rule", () => {
	it("is sandbox only for an iOS development build", () => {
		expect(pushEnvironment("ios", true)).toBe("sandbox");
		expect(pushEnvironment("ios", false)).toBe("production");
		expect(pushEnvironment("android", true)).toBe("production");
		expect(pushEnvironment("android", false)).toBe("production");
	});
});

describe("app_version", () => {
	/* TestFlight build 953 registered as "0.0.0" (the operator's
	 * mobile-push-devices.json, 2026-11-14): an internal build's version is the
	 * untagged-ref placeholder by design (docs/ci.md, "Versioning"), so only the
	 * build number identifies the binary in the daemon's device list. */
	it("carries the platform build number beside the version", () => {
		const config = {
			version: "0.0.0",
			ios: { buildNumber: "953" },
			android: { versionCode: 954 },
		};
		expect(appVersionFrom(config, "ios")).toBe("0.0.0 (953)");
		expect(appVersionFrom(config, "android")).toBe("0.0.0 (954)");
		expect(appVersionFrom({ version: "1.2.3" }, "ios")).toBe("1.2.3");
		expect(
			appVersionFrom(
				{ version: "1.2.3", android: { versionCode: 0 } },
				"android",
			),
		).toBe("1.2.3");
		expect(appVersionFrom({ version: " " }, "ios")).toBe("unknown");
		expect(appVersionFrom(null, "android")).toBe("unknown");
		expect(appVersionFrom({ ios: { buildNumber: "7" } }, "ios")).toBe(
			"unknown (7)",
		);
	});
});
