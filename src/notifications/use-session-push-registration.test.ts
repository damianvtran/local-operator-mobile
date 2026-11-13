/** Wiring tests for session push registration: WHEN the app registers with the
 * routed computer, and that a foreground does not re-POST what the computer
 * already holds. The register module itself runs for real; only React, the
 * native notifications module, the keystore and the connection are seams.
 * What the body must look like ON THE WIRE is pinned separately against the
 * daemon's own bytes (`relay/__tests__/push-register-contract.test.ts`). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
	effects: [] as (() => (() => void) | undefined)[],
	foreground: undefined as ((state: string) => void) | undefined,
	rotate: undefined as (() => void) | undefined,
	platform: "ios" as "ios" | "android",
	phase: "live",
	route: { mode: "radient", tunnelId: "synthetic-tunnel" } as
		| { mode: "radient"; tunnelId: string }
		| { mode: "custom"; baseUrl: string }
		| null,
	permission: "granted",
	token: "synthetic-token-1" as string | null,
	register: vi.fn(async (_body: Record<string, unknown>) => ({
		device_id: "synthetic-device",
		device_key: "synthetic-device-key",
	})),
	recorded: vi.fn(async (_id: string, _key: string) => {}),
	requestPermission: vi.fn(),
	removeForeground: vi.fn(),
	removeToken: vi.fn(),
}));

vi.mock("react", () => ({
	useEffect: (effect: () => (() => void) | undefined) => {
		seam.effects.push(effect);
	},
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
	default: { expoConfig: { version: "1.4.0" } },
}));
vi.mock("@/features/auth/connection-provider", () => ({
	useConnection: () => ({
		relay: () => ({ registerDevice: seam.register }),
	}),
	useConnectionState: (select: (s: object) => unknown) =>
		select({ route: seam.route, phase: seam.phase }),
}));
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
	pushEnvironment,
	resetSessionPushRegistrationMemory,
	sessionPushRegistrationStore,
} from "./session-push-registration";
import {
	requestSessionPushRegistration,
	useSessionPushRegistration,
} from "./use-session-push-registration";

let stops: ((() => void) | undefined)[] = [];
/** The harness = render the hook once and run the effect it registered. */
function RegistrationHarness(): void {
	seam.effects = [];
	useSessionPushRegistration();
	stops.push(seam.effects.at(-1)?.());
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
	vi.clearAllMocks();
	resetSessionPushRegistrationMemory();
	seam.platform = "ios";
	seam.phase = "live";
	seam.route = { mode: "radient", tunnelId: "synthetic-tunnel" };
	seam.permission = "granted";
	seam.token = "synthetic-token-1";
	seam.foreground = undefined;
	seam.rotate = undefined;
});
afterEach(async () => {
	for (const stop of stops) stop?.();
	stops = [];
	await settle();
});

describe("session push registration lifecycle", () => {
	it("granted + live route: exactly one POST, with the daemon's fields only", async () => {
		RegistrationHarness();
		await vi.waitFor(() => expect(seam.recorded).toHaveBeenCalledTimes(1));
		expect(seam.register).toHaveBeenCalledTimes(1);
		expect(seam.register.mock.calls[0]?.[0]).toEqual({
			platform: "ios",
			token: "synthetic-token-1",
			// Node has no `__DEV__`: a release build, so APNs production.
			environment: "production",
			app_version: "1.4.0",
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

	it("foreground is idempotent: the same registration is not re-sent", async () => {
		RegistrationHarness();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(1));
		await vi.waitFor(() =>
			expect(sessionPushRegistrationStore.getState().status).toBe("registered"),
		);
		seam.foreground?.("active");
		seam.foreground?.("background");
		seam.foreground?.("active");
		await settle();
		await settle();
		expect(seam.register).toHaveBeenCalledTimes(1);
		expect(sessionPushRegistrationStore.getState().status).toBe("registered");
	});

	it("token rotation re-POSTs the new token for the same install", async () => {
		RegistrationHarness();
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
		await settle();
		expect(seam.register).toHaveBeenCalledTimes(2);
	});

	it("permission denied: no POST and no prompt", async () => {
		seam.permission = "denied";
		RegistrationHarness();
		await vi.waitFor(() =>
			expect(sessionPushRegistrationStore.getState().status).toBe("permission"),
		);
		seam.foreground?.("active");
		await settle();
		await settle();
		expect(seam.register).not.toHaveBeenCalled();
		expect(seam.requestPermission).not.toHaveBeenCalled();
	});

	it("a route that is not live yet does not POST", async () => {
		seam.phase = "connecting";
		RegistrationHarness();
		await settle();
		expect(seam.register).not.toHaveBeenCalled();
	});

	it("a route change (re-mount) and a Settings grant are forced re-registrations", async () => {
		RegistrationHarness();
		await vi.waitFor(() => expect(seam.register).toHaveBeenCalledTimes(1));
		// Another computer: the effect re-runs, and the new computer must learn
		// this phone even though nothing about the phone changed.
		for (const stop of stops) stop?.();
		stops = [];
		seam.route = { mode: "custom", baseUrl: "https://relay.example.invalid" };
		RegistrationHarness();
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

	it("Android sends the FCM token as platform android, environment production", async () => {
		seam.platform = "android";
		seam.token = "synthetic-fcm-token";
		RegistrationHarness();
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
		RegistrationHarness();
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
		RegistrationHarness();
		await vi.waitFor(() => expect(seam.rotate).toBeDefined());
		for (const stop of stops) stop?.();
		stops = [];
		expect(seam.removeForeground).toHaveBeenCalledTimes(1);
		expect(seam.removeToken).toHaveBeenCalledTimes(1);
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
