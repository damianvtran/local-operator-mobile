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
 * unknown key (`422 unknown field(s)`), so nothing else may ride along. `name`
 * is optional and omitted: the daemon treats an omitted name as "clear the
 * label", and this build has no label to own.
 *
 * SAME TOKEN, SAME IDENTITY AS TEAM BRIDGE. The token is the OS device token
 * (`getDevicePushTokenAsync`), the install id is the keystore install record
 * (`install-id.ts`), and the APNs environment follows the same `__DEV__` rule
 * `registerTeamBridgeDevice` uses (`pushEnvironment` below). Two registrations
 * that disagreed about any of these would address two different phones.
 *
 * NEVER PROMPTS. Permission is only read here; the prompt stays the Settings
 * press (ADR 0006 §5). A phone that has not granted permission is not
 * registered, and the Settings "Allow" press re-triggers this once granted.
 *
 * IDEMPOTENT TWICE. The daemon upserts on `(install_id, platform)` and keeps
 * the `device_id`, so no number of POSTs can grow its registry. The client is
 * idempotent as well: an identical registration this computer already accepted
 * within `REFRESH_MS` is not re-sent on a mere foreground. That matters beyond
 * traffic — every register RE-MINTS the device key (and forwards to the cloud),
 * so re-POSTing on every foreground would rotate the key the sound prefetch
 * presents and hit the cloud for nothing. A forced attempt (cold start, route
 * change, reconnect, a Settings grant) always POSTs: that is the act that clears
 * an `expired` lapse after a fresh sign-in and records the presented cookie's
 * expiry, and nothing on the client can see either of those facts.
 *
 * NEVER LOGS THE TOKEN. Failures go to the device log (`console.warn` with a
 * `[push]` tag, the app's diagnostics channel — see `use-completion-ack.ts`)
 * with the outcome, HTTP status and typed refusal code only: never the token,
 * the device key, or a transport error's message (which may echo a URL or
 * header).
 */

import Constants from "expo-constants";
import {
	ensureInstallRecord,
	recordRegistration,
} from "@/notifications/install-id";
import {
	devicePushToken,
	loadNotifications,
	notificationsSupported,
} from "@/notifications/native";
import type { RegisterDeviceRequest } from "@/relay/endpoints";
import { isRelayError, isRelayMissing } from "@/relay/errors";

import {
	type SessionPushOutcome,
	sessionPushRegistrationStore,
} from "./session-push-registration-state";

export {
	type SessionPushOutcome,
	type SessionPushRegistrationState,
	sessionPushRegistrationStore,
	sessionPushRouteKey,
} from "./session-push-registration-state";

/** The one endpoint this module needs; a narrow seam so tests can supply it. */
export type RegisterClient = {
	registerDevice: (
		request: RegisterDeviceRequest,
	) => Promise<{ device_id: string; device_key: string }>;
};

/**
 * How long an accepted registration counts as current for a NON-forced attempt
 * (a foreground). Long enough that a phone opened fifty times a day POSTs about
 * twice; short enough that the daemon's `last_seen_at` — which its bounded
 * registry prunes by — keeps moving for a phone that is used but never
 * restarted.
 */
export const REFRESH_MS = 12 * 60 * 60 * 1000;

/** The last registration each computer accepted, this app run. In memory on
 *  purpose: a cold start must POST (the daemon may have restarted, been
 *  re-paired, or marked the row expired while the app was gone), and the token
 *  never belongs in the keystore. */
const accepted = new Map<string, { fingerprint: string; at: number }>();

/** Test seam: forget every accepted registration, as a cold start does. */
export const resetSessionPushRegistrationMemory = (): void => {
	accepted.clear();
	sessionPushRegistrationStore.setState({
		routeKey: null,
		status: "idle",
		code: null,
		registeredAt: null,
	});
};

/**
 * The APNs environment the daemon's cloud forward must use for this token.
 *
 * iOS: a development build (`__DEV__`: a Debug configuration, Metro bundle,
 * development signing) carries `aps-environment=development`, so its token is a
 * SANDBOX token; every archived build — internal, TestFlight, App Store — is
 * signed with `aps-environment=production` (the expo-notifications plugin
 * writes `development` and Xcode flips it in an archive, see
 * `docs/publishing/push-setup.md`). Sending the wrong one is APNs
 * `BadDeviceToken`/`BadEnvironmentKeyInToken`: a silent non-delivery. This is
 * the rule `registerTeamBridgeDevice` uses; the two must not diverge.
 *
 * Android: FCM has no sandbox, but the daemon REQUIRES the field to be one of
 * `sandbox`/`production`, so Android always says `production`.
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

/** The device log line. Only the outcome and the relay's typed facts: never
 *  the token, the device key or an error message. */
const logFailure = (
	outcome: SessionPushOutcome,
	error: unknown,
): { code: string | null } => {
	const status = isRelayError(error) ? (error.status ?? null) : null;
	const code = isRelayError(error) ? (error.code ?? null) : null;
	console.warn("[push] session push registration did not complete", {
		outcome,
		status,
		code,
	});
	return { code };
};

export type SessionPushAttempt = {
	/** The routed computer (`sessionPushRouteKey`). */
	routeKey: string;
	/** POST even when this computer already accepted this exact registration. */
	force: boolean;
	/** The caller's lease on the route: the keystore, permission and token
	 *  reads are async, and a route switch during them must neither start a POST
	 *  to the old computer nor overwrite the keystore's device key with a key
	 *  minted for a computer the app is no longer routed to. */
	isCurrent?: () => boolean;
	/** Called just before the POST goes out, so a UI can say "registering"
	 *  only when something is actually being sent. */
	onPosting?: () => void;
	now?: () => number;
};

export type SessionPushResult = {
	outcome: SessionPushOutcome;
	code: string | null;
	/** When this computer accepted the registration that is current now. */
	registeredAt: number | null;
};

/**
 * Register this phone with one computer. Never prompts, never throws.
 */
export async function registerSessionPushDevice(
	client: RegisterClient,
	attempt: SessionPushAttempt,
): Promise<SessionPushResult> {
	const isCurrent = attempt.isCurrent ?? (() => true);
	const now = attempt.now ?? Date.now;
	const result = (
		outcome: SessionPushOutcome,
		code: string | null = null,
	): SessionPushResult => ({ outcome, code, registeredAt: null });
	if (!notificationsSupported()) return result("unsupported");
	const module = await loadNotifications();
	if (module === null) return result("unsupported");
	let granted = false;
	try {
		granted = (await module.getPermissionsAsync()).status === "granted";
	} catch (error) {
		logFailure("failed", error);
		return result("failed");
	}
	// A revoked grant must not keep reading as registered on the next foreground.
	if (!granted) {
		accepted.delete(attempt.routeKey);
		return result("permission");
	}
	const device = await devicePushToken();
	if (device === null || device.token.length === 0) {
		logFailure("no-token", null);
		return result("no-token");
	}
	try {
		const install = await ensureInstallRecord();
		if (!isCurrent()) return result("stale");
		const request: RegisterDeviceRequest = {
			platform: device.platform,
			token: device.token,
			environment: pushEnvironment(device.platform, isDevBuild()),
			app_version: appVersion(),
			install_id: install.install_id,
		};
		// In memory only and never logged: it holds the token, because a rotated
		// token is exactly the change that must re-POST.
		const fingerprint = JSON.stringify(request);
		const previous = accepted.get(attempt.routeKey);
		if (
			!attempt.force &&
			previous !== undefined &&
			previous.fingerprint === fingerprint &&
			now() - previous.at < REFRESH_MS
		) {
			return { outcome: "registered", code: null, registeredAt: previous.at };
		}
		attempt.onPosting?.();
		const response = await client.registerDevice(request);
		// The daemon has the row either way; only the keystore write is fenced,
		// because the record holds ONE device key and it must be the key of the
		// computer the app is routed to (`use-custom-sound-prefetch` presents it).
		if (!isCurrent()) return result("stale");
		await recordRegistration(response.device_id, response.device_key);
		const at = now();
		accepted.set(attempt.routeKey, { fingerprint, at });
		return { outcome: "registered", code: null, registeredAt: at };
	} catch (error) {
		accepted.delete(attempt.routeKey);
		if (isRelayMissing(error)) {
			logFailure("relay-missing", error);
			return result("relay-missing");
		}
		const code = isRelayError(error) ? (error.code ?? null) : null;
		const outcome: SessionPushOutcome =
			code === "device_revoked" || code === "device_unpaired"
				? "refused"
				: "failed";
		logFailure(outcome, error);
		return result(outcome, code);
	}
}
