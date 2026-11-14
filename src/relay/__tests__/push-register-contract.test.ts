/**
 * THE REGISTER CONTRACT, PINNED TO THE DAEMON'S OWN RULES AND BYTES.
 *
 * Captured 2026-11-13 from local-operator v0.102.4 (the release on the
 * operator's Mac when session pushes were found never to fire), by driving the
 * real `build_app(MobileDaemon(port=0, password=…))` through a cookie login
 * under an isolated `LOCAL_OPERATOR_CONFIG_DIR`, with a synthetic token and
 * install id:
 *
 *  - `local_operator/mobile/push_devices.py`:326 `_REGISTER_FIELDS` =
 *    {platform, token, environment, app_version, install_id, name}; :154
 *    `PLATFORMS` = (ios, android); :155 `ENVIRONMENTS` = (sandbox, production);
 *    :1129 `_checked_registration` refuses an unknown key and a bad enum with
 *    `422 {"error": …}`, requires a non-blank `token` and `app_version`, and a
 *    UUID `install_id`.
 *  - `local_operator/mobile/daemon.py`:11759 routes `POST /api/push/register`
 *    (there is NO `POST /api/push/devices`; that path is GET-only) to
 *    `api_push_register` (:10995), which answers
 *    `200 {"ok", "device_id", "device_key", "registered_at"}` (seconds) and then
 *    forwards platform/environment/app_version/token to the cloud lane
 *    (`_forward_registration`, :11046).
 *  - a revoked row answers `403 {"code": "device_revoked", "error": …}`.
 *
 * WHY A LOOPBACK DAEMON AND NOT A MOCK OF `registerDevice`. The defect this
 * pins was a request the app never sent; the opposite defect — a request the
 * daemon refuses — is just as silent on a phone (no row, no push, no error a
 * reader sees). So the app's REAL register module builds the body, the app's
 * REAL `RelayEndpoints`/`RelayHttpClient` put it on a socket, and the server
 * applies the daemon's validation rules above before answering with the
 * daemon's captured bytes. A field the daemon does not accept fails here
 * exactly as it would on the Mac.
 */
import { createServer } from "node:http";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

vi.mock("expo-constants", () => ({
	default: { expoConfig: { version: "1.4.0" } },
}));
vi.mock("@/notifications/native", () => ({
	notificationsSupported: () => true,
	loadNotifications: async () => ({
		getPermissionsAsync: async () => ({ status: "granted" }),
	}),
	devicePushToken: async () => ({
		token: "synthetic-apns-token-0001",
		platform: "ios",
	}),
}));
const recorded = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/notifications/install-id", () => ({
	ensureInstallRecord: async () => ({
		v: 1,
		install_id: "5a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
	}),
	recordRegistration: recorded,
}));

import {
	registerSessionPushDevice,
	resetSessionPushRegistrationMemory,
} from "@/notifications/session-push-registration";
import { RelayEndpoints } from "../endpoints";
import { RelayHttpClient } from "../http";

/** The daemon's constants, as captured (see the header). */
const DAEMON = {
	registerFields: [
		"app_version",
		"environment",
		"install_id",
		"name",
		"platform",
		"token",
	],
	required: ["app_version", "environment", "install_id", "platform", "token"],
	platforms: ["ios", "android"],
	environments: ["sandbox", "production"],
};

/** The daemon's captured 200 (device key replaced by a same-shape synthetic). */
const REGISTERED = {
	ok: true,
	device_id: "1128cfd9b36f4899aa9ddd6b778a54e2",
	device_key: "synthetic-device-key-43-chars-xxxxxxxxxxxx",
	registered_at: 1794611530,
};
const REVOKED = {
	code: "device_revoked",
	error: "this device was revoked on this computer",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `_checked_registration`, reduced to the refusals the app could trip. */
function daemonRefusal(body: Record<string, unknown>): string | null {
	const unknown = Object.keys(body).filter(
		(key) => !DAEMON.registerFields.includes(key),
	);
	if (unknown.length > 0)
		return `unknown field(s): ${unknown.sort().join(", ")}`;
	if (!DAEMON.platforms.includes(String(body.platform)))
		return 'platform must be "ios" or "android"';
	if (!DAEMON.environments.includes(String(body.environment)))
		return 'environment must be "sandbox" or "production"';
	for (const key of ["token", "app_version"])
		if (typeof body[key] !== "string" || !(body[key] as string).trim())
			return `${key} is required`;
	if (typeof body.install_id !== "string" || !UUID.test(body.install_id))
		return "install_id must be a UUID";
	return null;
}

/** Core PR C (contract relayed by the daemon owner, 2026-11-14): a daemon that
 *  advertises `push_preferences` also accepts `preferences`, exactly
 *  `{enabled, completions, errors}` booleans; an unknown key inside it is
 *  refused like any other. */
function preferencesDaemonRefusal(
	body: Record<string, unknown>,
	withPreviews = false,
): string | null {
	const { preferences, ...rest } = body;
	if (preferences !== undefined) {
		if (typeof preferences !== "object" || preferences === null)
			return "preferences must be an object";
		const keys = Object.keys(preferences).sort();
		/* A `push_previews` daemon also accepts `previews` (optional: absent
		 * reads as true); a #3991-only daemon refuses it like any unknown key. */
		const allowed = withPreviews
			? ["completions,enabled,errors", "completions,enabled,errors,previews"]
			: ["completions,enabled,errors"];
		if (!allowed.includes(keys.join(",")))
			return `preferences: unexpected keys ${keys.join(", ")}`;
		if (Object.values(preferences).some((value) => typeof value !== "boolean"))
			return "preferences values must be booleans";
	}
	return daemonRefusal(rest);
}

let origin = "";
let mode: "ok" | "revoked" | "malformed" | "preferences" | "previews" = "ok";
const seen: { method: string; url: string; body: Record<string, unknown> }[] =
	[];
const server = createServer(async (req, res) => {
	let text = "";
	for await (const chunk of req) text += chunk;
	const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
	seen.push({ method: req.method ?? "", url: req.url ?? "", body });
	res.setHeader("Content-Type", "application/json");
	if (req.headers.cookie !== "lop_mobile=synthetic-pair") {
		res.writeHead(401).end('{"error":"authentication required"}');
		return;
	}
	if (req.url !== "/api/push/register" || req.method !== "POST") {
		res.writeHead(405).end('{"error":"method not allowed"}');
		return;
	}
	const refusal =
		mode === "preferences" || mode === "previews"
			? preferencesDaemonRefusal(body, mode === "previews")
			: daemonRefusal(body);
	if (refusal !== null) {
		res.writeHead(422).end(JSON.stringify({ error: refusal }));
		return;
	}
	if (mode === "revoked") {
		res.writeHead(403).end(JSON.stringify(REVOKED));
		return;
	}
	if (mode === "malformed") {
		res.end(JSON.stringify({ ok: true, device_id: REGISTERED.device_id }));
		return;
	}
	res.end(JSON.stringify(REGISTERED));
});

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw Error("No listener");
	origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
	seen.length = 0;
	mode = "ok";
	recorded.mockClear();
	resetSessionPushRegistrationMemory();
});

const relay = () =>
	new RelayEndpoints(
		new RelayHttpClient({
			baseUrl: origin,
			auth: () => ({
				cookie: "lop_mobile=synthetic-pair",
				origin,
				credentials: "omit",
			}),
		}),
	);
const attempt = { routeKey: "custom:loopback", force: true };

describe("POST /api/push/register against the daemon contract", () => {
	it("the app's body is accepted by the daemon's validation, on the daemon's route", async () => {
		const result = await registerSessionPushDevice(relay(), attempt);
		expect(result.outcome).toBe("registered");
		expect(seen).toHaveLength(1);
		expect(seen[0]?.method).toBe("POST");
		expect(seen[0]?.url).toBe("/api/push/register");
		const sent = seen[0]?.body ?? {};
		// Every required daemon field, and nothing the daemon would refuse.
		expect(Object.keys(sent).sort()).toEqual(DAEMON.required);
		expect(daemonRefusal(sent)).toBeNull();
		expect(sent).toMatchObject({
			platform: "ios",
			environment: "production",
			app_version: "1.4.0",
			install_id: "5a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
		});
		// The minted id and key are what the keystore keeps.
		expect(recorded).toHaveBeenCalledWith(
			REGISTERED.device_id,
			REGISTERED.device_key,
		);
	});

	it("validates the response: a 200 without device_key is a failure, not a registration", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mode = "malformed";
		const result = await registerSessionPushDevice(relay(), attempt);
		expect(result.outcome).toBe("failed");
		expect(recorded).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("the endpoint parses the daemon's captured 200 through its schema", async () => {
		const answer = await relay().registerDevice({
			platform: "android",
			token: "synthetic-fcm-token-0001",
			environment: "production",
			app_version: "1.4.0",
			install_id: "5a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
		});
		expect(answer).toEqual(REGISTERED);
	});

	it("the daemon's own refusal surfaces as `refused` with its typed code", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mode = "revoked";
		const result = await registerSessionPushDevice(relay(), attempt);
		expect(result).toMatchObject({
			outcome: "refused",
			code: "device_revoked",
		});
		expect(recorded).not.toHaveBeenCalled();
		// The device log line carries the code and status, never the token.
		const logged = JSON.stringify(warn.mock.calls);
		expect(logged).toContain("device_revoked");
		expect(logged).not.toContain("synthetic-apns-token");
		warn.mockRestore();
	});

	it("the loopback daemon really refuses what the real daemon refuses", async () => {
		// Guards the guard: a refusal rule that never fired would make the
		// acceptance test above meaningless.
		expect(daemonRefusal({ installId: "x" })).toContain("unknown field");
		expect(
			daemonRefusal({
				platform: "ios",
				token: "t",
				environment: "development",
				app_version: "1",
				install_id: "5a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
			}),
		).toContain("environment must be");
	});

	it("an older daemon (no push_preferences): the body carries no `preferences`, and is accepted", async () => {
		const result = await registerSessionPushDevice(relay(), {
			...attempt,
			preferences: async () => undefined,
		});
		expect(result.outcome).toBe("registered");
		expect(Object.keys(seen[0]?.body ?? {}).sort()).toEqual(DAEMON.required);
	});

	it("an older daemon refuses `preferences` outright — why the capability gate exists", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await registerSessionPushDevice(relay(), {
			...attempt,
			preferences: async () => ({
				enabled: true,
				completions: true,
				errors: true,
			}),
		});
		expect(result.outcome).toBe("failed");
		expect(recorded).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("a push_preferences daemon accepts exactly {enabled, completions, errors}", async () => {
		mode = "preferences";
		const result = await registerSessionPushDevice(relay(), {
			...attempt,
			preferences: async () => ({
				enabled: false,
				completions: true,
				errors: false,
			}),
		});
		expect(result.outcome).toBe("registered");
		expect(seen[0]?.body.preferences).toEqual({
			enabled: false,
			completions: true,
			errors: false,
		});
		expect(
			preferencesDaemonRefusal({
				...(seen[0]?.body ?? {}),
				preferences: {
					enabled: true,
					completions: true,
					errors: true,
					attention: true,
				},
			}),
		).toContain("unexpected keys");
	});

	it("a #3991-only daemon refuses `previews` — why push_previews is a separate gate", async () => {
		mode = "preferences";
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await registerSessionPushDevice(relay(), {
			...attempt,
			preferences: async () => ({
				enabled: true,
				completions: true,
				errors: true,
				previews: true,
			}),
		});
		expect(result.outcome).toBe("failed");
		warn.mockRestore();
	});

	it("a push_previews daemon accepts `previews` beside the three", async () => {
		mode = "previews";
		const result = await registerSessionPushDevice(relay(), {
			...attempt,
			preferences: async () => ({
				enabled: true,
				completions: true,
				errors: true,
				previews: false,
			}),
		});
		expect(result.outcome).toBe("registered");
		expect(seen[0]?.body.preferences).toEqual({
			enabled: true,
			completions: true,
			errors: true,
			previews: false,
		});
	});
});
