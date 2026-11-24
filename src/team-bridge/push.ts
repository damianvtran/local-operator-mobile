/**
 * Team Bridge push, on the device: hub registration, sign-out deregistration,
 * the foreground rule, and the tap.
 *
 * WHY REGISTRATION GOES TO THE HUB, NOT THE RELAY. Team Bridge messages are
 * created on the Radient hub and the hub's fan-out worker sends them
 * (agent-server push slice), so the hub must hold this phone's token. The relay
 * registry (`POST /api/push/register`, ADR 0006 S3) addresses ONE computer's
 * pushes and only works while that computer is awake. Registering with the hub
 * is what makes a teammate's message reach a phone whose owner's laptop is
 * closed.
 *
 * WHEN IT REGISTERS. Only while signed in to Radient, only once the OS
 * permission is ALREADY granted (the prompt is an in-context press — the
 * first-run primer or Settings, ADR 0006 §5 as amended: never from a mount),
 * only while the reader's "Team Bridge messages" preference is on (the
 * provider's gate; `notification-preferences.ts`), and only on a native build
 * that carries the module.
 * The call is idempotent on the install id, so re-registering on every launch is
 * how a rotated APNs/FCM token replaces the old one.
 *
 * SIGN-OUT. `unregisterTeamBridgeDevice` is called BEFORE the Radient grant is
 * forgotten, so the hub stops pushing to a phone nobody is signed in to. A
 * failure there is not fatal (the hub also drops a device unseen for 60 days)
 * and never blocks a sign-out.
 *
 * FOREGROUND. expo-notifications' own default, with NO handler installed, is to
 * not present a notification that arrives while the app is open
 * (`NotificationsHandler.ts`: "The default behavior when the handler is not set
 * or does not respond in time is not to show the notification"). This module is
 * the first to install a handler, so it keeps that exact behaviour for every push
 * that is NOT Team Bridge (the relay's completion pushes and their S9 rule are
 * untouched). A Team Bridge push DOES show in the foreground, because a
 * teammate's message on another thread is news, except while the reader is
 * looking at that very thread, where the message is already on screen.
 */

import Constants from "expo-constants";
import {
	ensureInstallRecord,
	nextBridgePushGeneration,
} from "@/notifications/install-id";
import {
	loadNotifications,
	notificationsSupported,
} from "@/notifications/native";
import { notePushToken } from "@/notifications/push-token-changes";
import { ensureAndroidTeamBridgePresentation } from "@/team-bridge/android-presentation";
import { type HubClient, isHubError } from "@/team-bridge/client";
import {
	type TeamBridgePush,
	teamBridgePushFromResponse,
} from "@/team-bridge/push-payload";

export { TEAM_BRIDGE_CHANNEL_ID } from "@/team-bridge/android-presentation";

export type RegistrationOutcome =
	| "registered"
	/** The same registration succeeded recently; no PUT was sent. */
	| "unchanged"
	/** A previous failure's backoff (or the hub's Retry-After) has not elapsed. */
	| "backoff"
	| "unsupported"
	| "permission"
	| "no-token"
	| "failed";

/*
 * RATE DISCIPLINE (the 2026-11-17 incident). Builds 1139/1157 PUT
 * `/v1/messaging/push/devices` up to ~20 times a second: a token-listener echo
 * loop (`notifications/push-token-changes.ts`) re-ran this function on every
 * token read, and nothing here stopped a repeat. The hub's per-account
 * `push-register` bucket (30/min) answered 429 with Retry-After; the app
 * retried at once, and the edge WAF (2000 requests / 5 min per source address)
 * then blocked the owner's whole network — desktop, agents and phone together.
 * So, independently of what triggers a call:
 *  - DEDUPE: a registration whose body (install, token, environment, version)
 *    succeeded within `REREGISTER_MS` is not re-sent. The PUT is idempotent,
 *    so skipping a repeat loses nothing; a rotated token or a new build changes
 *    the key and registers at once. 12 h matches the session-push refresh and
 *    stays far inside the hub's 60-day unseen-device drop.
 *  - BACKOFF: after a failed PUT no new one is sent until a wait has passed —
 *    the server's own figure for a 429 (`HubError.retryAfterMs`), else
 *    exponential with FULL jitter, so a fleet of phones that failed together
 *    does not retry together.
 *  - WALL CLOCK (reviewer m3): `notBefore` is epoch ms, so a device clock set
 *    backwards after a failure would stretch the wait by the jump. A remaining
 *    wait longer than the longest wait this code can set — max(BACKOFF_MAX_MS,
 *    the last Retry-After) plus 10 % of that Retry-After, kept as `maxWaitMs`
 *    — cannot be real and is treated as elapsed (`backoffRemainingMs`).
 *  - ONE RETRY AFTER A BACKOFF (reviewer m1): a trigger that lands inside a
 *    backoff (a token rotation, say) would otherwise be dropped until the next
 *    foreground, leaving the hub on a dead token. The provider arms ONE timer
 *    for the end of the wait (`createBackoffRetry`); it never shortens the wait
 *    and is cleared on withdraw, sign-out and account switch.
 * Coalescing concurrent callers is `push-lifecycle.ts`'s single-flight; the
 * memory here outlives one call and is held per signed-in account (the
 * provider creates one per account value), because the hub's bucket is.
 */
export const REREGISTER_MS = 12 * 60 * 60 * 1000;
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 15 * 60 * 1000;
/**
 * A 429 that named no wait. agent-server's limiter always sends Retry-After,
 * so a bare 429 is almost certainly the edge WAF, whose block lasts its full
 * 300 s window and whose body carries the seconds only in prose (this file
 * reads `HubError.retryAfterMs` and does not parse bodies; PR #297 teaches the
 * client to read the WAF's figure). Waiting the whole window is the honest
 * default: retrying sooner only extends the owner's block.
 */
export const RATE_LIMITED_FLOOR_MS = 300_000;

export interface RegistrationMemory {
	/** Key of the last ACCEPTED registration and when; `null` after a DELETE. */
	accepted: { key: string; at: number } | null;
	/** Consecutive failed PUTs, for the exponential step. */
	failures: number;
	/** No PUT before this epoch-ms. */
	notBefore: number;
	/** The longest wait the last failure could have set (see WALL CLOCK). */
	maxWaitMs: number;
}

export function createRegistrationMemory(): RegistrationMemory {
	return { accepted: null, failures: 0, notBefore: 0, maxWaitMs: 0 };
}

/** The deps that make the timing testable; production uses the real clock. */
export interface RegistrationClock {
	now: () => number;
	random: () => number;
}
const realClock: RegistrationClock = {
	now: () => Date.now(),
	random: () => Math.random(),
};

/**
 * The wait after the `failures`-th consecutive failure. Full jitter (uniform in
 * [0, cap]) per the AWS Architecture Blog's "Exponential Backoff And Jitter";
 * a server-named wait is honoured in full, plus up to 10 % so every client the
 * same limit refused does not come back in the same second.
 */
export function registrationBackoffMs(
	failures: number,
	error: unknown,
	random: () => number,
): number {
	const cap = Math.min(
		BACKOFF_MAX_MS,
		BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1),
	);
	const jittered = Math.floor(random() * cap);
	if (isHubError(error) && error.kind === "rate_limited") {
		const asked = error.retryAfterMs ?? RATE_LIMITED_FLOOR_MS;
		return Math.max(asked, jittered) + Math.floor(random() * asked * 0.1);
	}
	return jittered;
}

/**
 * The ceiling on any wait `registrationBackoffMs` returns for this error: the
 * exponential cap, or a server-named wait plus its 10 % jitter. Anything longer
 * still to go can only be a clock that moved backwards.
 *
 * It must be an EXACT upper bound of `registrationBackoffMs`, term by term, or
 * the guard cancels genuine waits (reviewer round 2, R2-M1): for a 429 the
 * wait is max(asked, jittered) + floor(r·asked·0.1) with jittered <
 * BACKOFF_MAX_MS, so its bound is max(BACKOFF_MAX_MS, asked) +
 * ceil(asked·0.1). The earlier max(BACKOFF_MAX_MS, asked·1.1) dropped the
 * 10 % whenever the exponential cap dominated (failures >= 9), and a 300 s
 * WAF 429 then read as a clock jump in ~1.7 % of backoffs. Change both
 * functions together.
 */
export function registrationWaitCeilingMs(error: unknown): number {
	if (isHubError(error) && error.kind === "rate_limited") {
		const asked = error.retryAfterMs ?? RATE_LIMITED_FLOOR_MS;
		return Math.max(BACKOFF_MAX_MS, asked) + Math.ceil(asked * 0.1);
	}
	return BACKOFF_MAX_MS;
}

/** Milliseconds of backoff still to go; 0 when none (or the clock jumped back). */
export function backoffRemainingMs(
	memory: RegistrationMemory,
	now: number,
): number {
	const remaining = memory.notBefore - now;
	if (remaining <= 0) return 0;
	if (remaining > Math.max(BACKOFF_MAX_MS, memory.maxWaitMs)) return 0;
	return remaining;
}

/** Timer seam, so the retry is testable without fake timers. */
export interface RetryTimers {
	set: (run: () => void, ms: number) => unknown;
	clear: (handle: unknown) => void;
}
const realTimers: RetryTimers = {
	set: (run, ms) => setTimeout(run, ms),
	clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * At most ONE pending retry at the end of the current backoff (see ONE RETRY
 * AFTER A BACKOFF). `arm` is a no-op while a retry is already pending or when no
 * backoff remains; `cancel` must run when the registration's owner retires
 * (withdraw, sign-out, account switch) so a retired account never PUTs and no
 * timer outlives its provider.
 */
export function createBackoffRetry(
	memory: RegistrationMemory,
	retry: () => void,
	clock: Pick<RegistrationClock, "now"> = realClock,
	timers: RetryTimers = realTimers,
) {
	let handle: unknown = null;
	return {
		arm(): void {
			if (handle !== null) return;
			const wait = backoffRemainingMs(memory, clock.now());
			if (wait <= 0) return;
			handle = timers.set(() => {
				handle = null;
				retry();
			}, wait);
		},
		cancel(): void {
			if (handle === null) return;
			timers.clear(handle);
			handle = null;
		},
		pending: () => handle !== null,
	};
}

/**
 * Register this phone with the hub when everything it needs is already true.
 * Never prompts and never throws: the outcome is for diagnostics only.
 * `memory` carries dedupe and backoff across calls (see RATE DISCIPLINE);
 * without one each call stands alone, as before.
 */
export async function registerTeamBridgeDevice(
	hub: HubClient,
	isCurrent: () => boolean = () => true,
	memory: RegistrationMemory = createRegistrationMemory(),
	clock: RegistrationClock = realClock,
): Promise<RegistrationOutcome> {
	if (!notificationsSupported()) return "unsupported";
	// Before any read: a token read is itself a native round trip and an event.
	if (backoffRemainingMs(memory, clock.now()) > 0) return "backoff";
	const module = await loadNotifications();
	if (module === null) return "unsupported";
	try {
		const permission = await module.getPermissionsAsync();
		if (permission.status !== "granted") return "permission";
		const token = await module.getDevicePushTokenAsync();
		notePushToken(token.data);
		if (typeof token.data !== "string" || token.data.length === 0)
			return "no-token";
		const install = await ensureInstallRecord();
		const platform = token.type === "ios" ? "ios" : "android";
		/* A development build talks to the APNs sandbox; a release build to
		 *  production. `__DEV__` is the build's own word for which it is. */
		const environment =
			token.type === "ios"
				? __DEV__
					? ("sandbox" as const)
					: ("production" as const)
				: undefined;
		const appVersion = Constants.expoConfig?.version ?? undefined;
		// In memory only and never logged: it holds the token, because a
		// rotated token is exactly the change that must re-register.
		const key = JSON.stringify([
			install.install_id,
			platform,
			token.data,
			environment ?? null,
			appVersion ?? null,
		]);
		if (
			memory.accepted?.key === key &&
			clock.now() - memory.accepted.at < REREGISTER_MS
		)
			return "unchanged";
		// Permission/token/keystore reads may outlive sign-out. Do not start a
		// new authenticated PUT once this account's registration lease retired.
		if (!isCurrent()) return "failed";
		const generation = await nextBridgePushGeneration();
		if (!isCurrent()) return "failed";
		try {
			await hub.registerDevice({
				installId: install.install_id,
				generation,
				platform,
				token: token.data,
				...(environment ? { environment } : {}),
				appVersion,
			});
		} catch (error) {
			memory.failures += 1;
			memory.notBefore =
				clock.now() +
				registrationBackoffMs(memory.failures, error, clock.random);
			memory.maxWaitMs = registrationWaitCeilingMs(error);
			return "failed";
		}
		memory.accepted = { key, at: clock.now() };
		memory.failures = 0;
		memory.notBefore = 0;
		memory.maxWaitMs = 0;
		return "registered";
	} catch {
		return "failed";
	}
}

/** Remove this phone from the hub's registry. Best effort; never throws. */
export async function unregisterTeamBridgeDevice(
	hub: HubClient,
): Promise<void> {
	if (!notificationsSupported()) return;
	try {
		const install = await ensureInstallRecord();
		const generation = await nextBridgePushGeneration();
		await hub.unregisterDevice(install.install_id, generation);
	} catch {
		/* The hub's 60-day unseen drop is the backstop; a sign-out never waits on it. */
	}
}

/** The thread the reader is looking at, set by the thread screen while focused. */
let watched: { tenantId: string; conversationId: string } | null = null;

export const setWatchedThread = (
	thread: { tenantId: string; conversationId: string } | null,
): void => {
	watched = thread;
};

/** Pure: whether a foreground push should stay silent. */
export function quietWhileWatching(
	push: TeamBridgePush | null,
	current: { tenantId: string; conversationId: string } | null,
): boolean {
	return (
		push !== null &&
		current !== null &&
		push.tenantId === current.tenantId &&
		push.conversationId === current.conversationId
	);
}

let handlerInstalled = false;

/** Pure: the foreground presentation for one arriving notification. */
export function foregroundBehaviour(
	push: TeamBridgePush | null,
	current: { tenantId: string; conversationId: string } | null,
): {
	shouldShowBanner: boolean;
	shouldShowList: boolean;
	shouldPlaySound: boolean;
	shouldSetBadge: boolean;
} {
	/* Not ours: expo's no-handler default (nothing shown), byte for byte. */
	const show = push !== null && !quietWhileWatching(push, current);
	return {
		shouldShowBanner: show,
		shouldShowList: show,
		shouldPlaySound: show,
		/* The icon badge stays app-managed (ADR 0006 §1.5). */
		shouldSetBadge: false,
	};
}

/** Install the foreground handler and the Android channel once per process. */
export async function installTeamBridgeNotifications(): Promise<void> {
	if (handlerInstalled || !notificationsSupported()) return;
	const module = await loadNotifications();
	if (module === null) return;
	handlerInstalled = true;
	try {
		module.setNotificationHandler({
			handleNotification: async (notification) =>
				foregroundBehaviour(
					teamBridgePushFromResponse({ notification }),
					watched,
				),
		});
	} catch {
		handlerInstalled = false;
	}
	/* The channel (localised, lock-screen PRIVATE) and the native delegate's
	 * copy. Also re-run on every language change (`use-notification-categories.ts`). */
	await ensureAndroidTeamBridgePresentation();
}

/**
 * Team Bridge pushes delivered while JS runs (not taps). Used only to re-read
 * unread for the icon badge; other push types are left alone. Never throws.
 */
export async function subscribeTeamBridgeReceived(
	onPush: (push: TeamBridgePush) => void,
): Promise<() => void> {
	const module = await loadNotifications();
	if (module === null) return () => {};
	try {
		const subscription = module.addNotificationReceivedListener(
			(notification) => {
				const push = teamBridgePushFromResponse({ notification });
				if (push !== null) onPush(push);
			},
		);
		return () => subscription.remove();
	} catch {
		return () => {};
	}
}

/**
 * Route Team Bridge notification taps, cold and warm. A response that is not a
 * Team Bridge push is left alone: the relay's tap router owns it.
 */
export async function subscribeTeamBridgeTaps(
	onPush: (push: TeamBridgePush) => void,
): Promise<() => void> {
	const module = await loadNotifications();
	if (module === null) return () => {};
	const deliver = (response: unknown): void => {
		const push = teamBridgePushFromResponse(response);
		if (push !== null) onPush(push);
	};
	try {
		const cold = await module.getLastNotificationResponseAsync();
		if (cold !== null && cold !== undefined) deliver(cold);
	} catch {
		/* No last response is a normal cold start. */
	}
	try {
		const subscription =
			module.addNotificationResponseReceivedListener(deliver);
		return () => subscription.remove();
	} catch {
		return () => {};
	}
}
