/**
 * The session push registration's shared state: its outcome vocabulary, the
 * per-computer store Settings renders, and the computer identity both are
 * keyed by.
 *
 * WHY A SEPARATE MODULE. `session-push-registration.ts` reaches the native
 * notifications module, the keystore and `expo-constants`; Settings' sentence
 * mapping (`session-push-status.ts`) needs none of that, and keeping the state
 * here lets it — and its test — import the vocabulary without a native seam.
 */
import { createStore } from "zustand/vanilla";

import type { RouteProfile } from "@/connection/profile";

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
	status: Exclude<SessionPushOutcome, "stale"> | "registering" | "idle";
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
