/**
 * Session push registration: tells the ROUTED computer's daemon where this
 * phone's pushes go (`POST /api/push/register`, ADR 0006 §3.1).
 *
 * WHY THIS EXISTS. Session pushes (an agent turn finished, a conversation needs
 * attention) are emitted by the desktop daemon and forwarded to the cloud push
 * lane (local-operator `mobile/daemon.py` `_forward_registration`, S7). The
 * daemon can only push to devices in its registry, and the registry is created
 * by this call alone. Before this module the app registered its token with
 * Team Bridge's hub only (`team-bridge/push.ts`), so the daemon's registry
 * (`~/.local-operator/mobile-push-devices.json`) was never created and no
 * session push ever fired, even though the same phone received Team Bridge
 * pushes. `RelayEndpoints.registerDevice` was built and tested but left
 * uncalled until the cloud forward existed; it does now.
 *
 * WHAT IT SENDS, AND WHY THOSE FIELDS. Exactly the register contract's keys
 * (local-operator `mobile/push_devices.py` `_REGISTER_FIELDS`): `platform`,
 * `token`, `environment`, `app_version`, `install_id`. The daemon REFUSES an
 * unknown key, so nothing else may ride along. `name` is optional and omitted:
 * the daemon treats an omitted name as "clear the label", and this build has
 * no label to own.
 *
 * SAME TOKEN, SAME IDENTITY AS TEAM BRIDGE. The token is the OS device token
 * (`getDevicePushTokenAsync`), the install id is the keystore install record
 * (`install-id.ts`), and the APNs environment follows the same `__DEV__` rule
 * `registerTeamBridgeDevice` uses. Two registrations that disagreed about any
 * of these would address two different phones.
 *
 * NEVER PROMPTS. Permission is only read here; the prompt stays the Settings
 * press (ADR 0006 §5). A phone that has not granted permission is not
 * registered, and the Settings "Allow" press re-triggers this once granted.
 *
 * IDEMPOTENT BY CONTRACT. The daemon upserts on `(install_id, platform)` and
 * keeps the `device_id`, so re-registering on every launch, foreground, route
 * change and token rotation cannot grow its registry; it is also what clears an
 * `expired` lapse and refreshes the presented cookie's expiry, which is why a
 * foreground re-POSTs rather than skipping.
 *
 * NEVER LOGS THE TOKEN. Failures are logged with the outcome, HTTP status and
 * typed refusal code only — never the token, the device key, or a transport
 * error's message (which may echo a URL or header).
 */

import Constants from "expo-constants";
import { createStore } from "zustand/vanilla";

import {
	devicePushToken,
	loadNotifications,
	notificationsSupported,
} from "@/notifications/native";
import {
	ensureInstallRecord,
	recordRegistration,
} from "@/notifications/install-id";
import type { RouteProfile } from "@/connection/profile";
import type { RegisterDeviceRequest } from "@/relay/endpoints";
import { isRelayError, isRelayMissing } from "@/relay/errors";

/** The one endpoint this module needs; a narrow seam so tests can supply it. */
export type RegisterClient = {
	registerDevice: (
		request: RegisterDeviceRequest,
	) => Promise<{ device_id: string; device_key: string }>;
};

export type SessionPushOutcome =
	/** The daemon recorded this phone; its device id and key are in the keystore. */
	| "registered"
	/** No native notifications module (web, Expo Go, a build without it). */
	| "unsupported"
	/** OS permission is not granted. Not an error: the reader has not opted in. */
	| "permission"
	/** Permission granted but the OS gave no token. */
	| "no-token"
	/** The daemon refused this device (`device_revoked` / `device_unpaired`). */
	| "refused"
	/** The relay predates the register route (its own 404). */
	| "relay-missing"
	/** Any other failure: transport, 5xx, malformed response, keystore. */
	| "failed"
	/** The route changed or retired while this attempt was in flight. */
	| "stale";

/**
 * What Settings renders, per routed computer. `routeKey` names the computer the
 * outcome belongs to so a screen never shows computer A's result while routed
 * to computer B.
 */
export type SessionPushRegistrationState = {
	routeKey: string | null;
	status: SessionPushOutcome | "registering" | "idle";
	/** The typed refusal code, when `status` is `refused`. */
	code: string | null;
	/** Wall-clock ms of the last successful registration for `routeKey`. */
	registeredAt: number | null;
};

/** The computer identity a registration outcome belongs to: the same identity
 *  `use-custom-sound-prefetch` scopes by. Never a secret (a tunnel id, or the
 *  custom base URL the reader typed). */
export const sessionPushRouteKey = (route: RouteProfile): string =>
	route.mode === "radient"
		? `radient:${route.tunnelId}`
		: `custom:${route.baseUrl}`;

export const sessionPushRegistrationStore =
	createStore<SessionPushRegistrationState>(() => ({
		routeKey: null,
		status: "idle",
		code: null,
		registeredAt: null,
	}));

/**
 * The APNs environment the daemon's cloud forward must use for this token.
 *
 * iOS: a development build (`__DEV__`, Metro bundle, development provisioning
 * profile) gets SANDBOX tokens; TestFlight and App Store builds are release
 * bundles with the production `aps-environment` entitlement and get PRODUCTION
 * tokens. This is the exact rule `registerTeamBridgeDevice` applies, kept the
 * same so both registrations describe one token one way.
 *
 * Android: FCM has no sandbox, but the daemon REQUIRES the field and accepts only
 * `sandbox` | `production`; `production` is the truthful value for FCM.
 */
export const pushEnvironment = (
	platform: "ios" | "android",
	isDev: boolean,
): "sandbox" | "production" =>
	platform === "ios" && isDev ? "sandbox" : "production";

/** `__DEV__` is a Metro global; it is undefined in Node (tests, scripts), which
 *  must read as a release build rather than throw. */
const isDevBuild = (): boolean =>
	typeof __DEV__ !== "undefined" && __DEV__ === true;

/** The daemon requires a non-empty `app_version`; an unreadable manifest must
 *  not cost the registration, so it says so instead of omitting the field. */
const appVersion = (): string => {
	const version = Constants.expoConfig?.version;
	return typeof version === "string" && version.trim().length > 0
		? version
		: "unknown";
};

/** Keys/fields that are safe to log: never the token, key or error message. */
const logFailure = (
	outcome: SessionPushOutcome,
	error: unknown,
): { status: number | null; code: string | null } => {
	const status = isRelayError(error) ? (error.status ?? null) : null;
	const code = isRelayError(error) ? (error.code ?? null) : null;
	console.warn("[push] session push registration did not complete", {
		outcome,
		status,
		code,
	});
	return { status, code };
};

/**
 * Register this phone with one computer. Never prompts, never throws.
 *
 * `isCurrent` is the caller's lease on the route: the keystore, permission and
 * token reads are async, and a route switch during them must neither start a
 * POST to the old computer nor overwrite the keystore's device key with a key
 * minted for a computer the app is no longer routed to.
 */
export async function registerSessionPushDevice(
	client: RegisterClient,
	isCurrent: () => boolean = () => true,
): Promise<{ outcome: SessionPushOutcome; code: string | null }> {
	if (!notificationsSupported()) return { outcome: "unsupported", code: null };
	const module = await loadNotifications();
	if (module === null) return { outcome: "unsupported", code: null };
	let granted = false;
	try {
		granted = (await module.getPermissionsAsync()).status === "granted";
	} catch (error) {
		logFailure("failed", error);
		return { outcome: "failed", code: null };
	}
	if (!granted) return { outcome: "permission", code: null };
	const device = await devicePushToken();
	if (device === null || device.token.length === 0) {
		console.warn("[push] session push registration did not complete", {
			outcome: "no-token",
		});
		return { outcome: "no-token", code: null };
	}
	try {
		const install = await ensureInstallRecord();
		if (!isCurrent()) return { outcome: "stale", code: null };
		const response = await client.registerDevice({
			platform: device.platform,
			token: device.token,
			environment: pushEnvironment(device.platform, isDevBuild()),
			app_version: appVersion(),
			install_id: install.install_id,
		});
		// The daemon has the row either way; only the keystore write is fenced,
		// because the record holds ONE device key and it must be the key of the
		// computer the app is routed to (`use-custom-sound-prefetch` presents it).
		if (!isCurrent()) return { outcome: "stale", code: null };
		await recordRegistration(response.device_id, response.device_key);
		return { outcome: "registered", code: null };
	} catch (error) {
		if (isRelayMissing(error)) {
			logFailure("relay-missing", error);
			return { outcome: "relay-missing", code: null };
		}
		const code = isRelayError(error) ? (error.code ?? null) : null;
		const outcome: SessionPushOutcome =
			code === "device_revoked" || code === "device_unpaired"
				? "refused"
				: "failed";
		logFailure(outcome, error);
		return { outcome, code };
	}
}
