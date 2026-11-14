/**
 * When session push registration runs: for the ROUTED computer, whenever the
 * route is live, on every event that can change what the daemon should hold.
 *
 * TRIGGERS, and why each one:
 *  - effect start — FORCED: cold start, route change, and a reconnect, once
 *    this route generation's FIRST LIST FRAME has applied (see below). The new
 *    computer must learn this phone, and a re-established route may follow a
 *    fresh sign-in whose register is what clears the daemon's `expired` lapse.
 *    The PREVIOUS computer's registration is deliberately left alone (no DELETE
 *    on a route switch), so switching back and forth keeps both computers
 *    pushing.
 *  - app foreground — NOT forced: re-POSTs only if what would be sent changed
 *    or the last acceptance is older than `REFRESH_MS`. Every register re-mints
 *    the device key and forwards to the cloud, so a foreground must not.
 *  - token rotation (`addPushTokenListener`) — not forced, but the token is in
 *    the fingerprint, so a rotated token always re-POSTs: APNs/FCM may rotate
 *    while the app runs, and the stale token would silently stop delivery.
 *  - `requestSessionPushRegistration()` — FORCED: Settings calls it right after
 *    the reader grants permission, so the first registration does not wait for
 *    the next foreground.
 *
 * WHAT THE EFFECT IS KEYED ON, AND WHAT IT IS NOT (PR #259 R1-1). The deps are
 * three explicit facts: the computer (`routeKey`), whether its route is usable
 * (`live`), and the connection store's `revision` — bumped by `startRoute` /
 * `endRoute` only, i.e. a route (re)start or a sign-out. A reconnect after a
 * refusal or a re-mint of the route goes through a non-live phase, so `live`
 * flips false → true once and the effect forces exactly one registration.
 * The context's `relay` accessor is deliberately NOT a dep: the provider's
 * `useMemo` builds a fresh arrow whenever any of its ~20 inputs changes
 * (stream health, busy, the computer list, errors), so keying on it force-
 * POSTed on every UI recompute — several times per cold start — re-minting the
 * key and hitting the cloud each time. It is read through a ref instead, which
 * always holds the latest accessor. `degraded` and `re-minting` stay inside
 * `live` for the same reason: a stream stall and resume is churn, not a new
 * credential the daemon needs to see.
 *
 * HELD FOR THE FIRST LIST FRAME (PR #264 R1 M1). Whether the daemon accepts
 * `preferences` is only known from the list frame's `capabilities`, and
 * `listStore.reset()` (run before every `startRoute`) nulls `lastFrameAt` and
 * empties `capabilities`. A register sent before the frame would omit
 * `preferences`, and on a `push_preferences` daemon (core #3991) a body
 * without them is declarative: it RESETS the device to all-on — the reader's
 * mute lost on every cold start and computer switch, with pushes leaking in
 * the gap. So the effect does not start (no forced POST, no foreground or
 * token trigger, no `activeTrigger`) until `lastFrameAt !== null`, then POSTs
 * ONCE with the capability it now knows; an older daemon's first frame simply
 * lacks it and the POST omits the field. A Settings press before the frame is
 * a no-op: the held effect-start registers with the stored choice anyway.
 *
 * Gated on a LIVE route the same way `use-custom-sound-prefetch` is (`live`,
 * `degraded`, `re-minting`): a POST to a route that is still connecting would
 * fail and log for nothing. Native only; web has no device token.
 *
 * SIGN-OUT. When the route goes away the Settings state and the accepted-
 * registration memory are reset (R1-6), so signing back in shows no stale
 * "registered" sentence and registers afresh. Sign-out sends no daemon DELETE:
 * the daemon's only removal verb is a sticky revoke tombstone that would refuse
 * this install's next sign-in (`install-id.ts` explains; deferred in R1-3).
 *
 * Attempts are single-flight with one queued re-run (which keeps the stronger
 * `force` of the requests it absorbed), so a foreground and a token rotation
 * landing together produce at most two attempts, never a pile-up; across
 * effect instances, `registerSessionPushDevice` serialises per computer (R1-2).
 */
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import {
	useConnection,
	useConnectionState,
	useListState,
} from "@/features/auth/connection-provider";
import { loadNotifications } from "@/notifications/native";
import {
	loadNotificationPreferences,
	type PushCapabilities,
	preferencesForRegistration,
	pushCapabilities,
} from "@/notifications/notification-preferences";
import {
	registerSessionPushDevice,
	resetSessionPushRegistrationMemory,
	sessionPushRegistrationStore,
	sessionPushRouteKey,
} from "@/notifications/session-push-registration";

/** The connection phases in which a route is usable. Exported so the
 *  notification primer reads "a live computer" by the same rule. */
export const LIVE_PHASES: readonly string[] = [
	"live",
	"degraded",
	"re-minting",
];

/** The mounted hook's trigger; `null` while no live route is mounted. */
let activeTrigger: ((force: boolean) => void) | null = null;

/** Ask the mounted hook to register now (a permission grant, or a changed
 *  notification preference). A no-op without a live route: the next route
 *  start registers anyway, with the stored preferences. */
export const requestSessionPushRegistration = (): void => {
	activeTrigger?.(true);
};

export const useSessionPushRegistration = (): void => {
	const { relay } = useConnection();
	// The latest accessor, without making its identity an effect dep (R1-1).
	const relayRef = useRef(relay);
	relayRef.current = relay;
	const route = useConnectionState((s) => s.route);
	const live = useConnectionState((s) => LIVE_PHASES.includes(s.phase));
	/* What this computer's daemon accepts in the body (`push_preferences`,
	 * `push_previews`), as one primitive key so a re-render with the same
	 * answer is not a change. Read through a ref at body-build time, so a
	 * capability frame never restarts the registration effect; its own edge,
	 * below, forces one re-POST. */
	const capabilityKey = useListState((s) => {
		const caps = pushCapabilities(s.capabilities);
		return `${caps.preferences ? 1 : 0}${caps.previews ? 1 : 0}`;
	});
	const capabilitiesRef = useRef<PushCapabilities>({
		preferences: false,
		previews: false,
	});
	capabilitiesRef.current = {
		preferences: capabilityKey[0] === "1",
		previews: capabilityKey[1] === "1",
	};
	/** The capability key the running effect last registered with. */
	const registeredKey = useRef<string | null>(null);
	// This route generation's first list frame has applied (M1, header).
	const framed = useListState((s) => s.lastFrameAt !== null);
	const revision = useConnectionState((s) => s.revision);
	const routeKey = route ? sessionPushRouteKey(route) : null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: capabilityKey is recorded at start only; a later change is the edge effect's re-POST, not a restart
	useEffect(() => {
		// `revision` is read so the effect re-runs on a route (re)start; see header.
		void revision;
		if (routeKey === null) {
			resetSessionPushRegistrationMemory();
			return;
		}
		if (Platform.OS !== "ios" && Platform.OS !== "android") return;
		if (!live || !framed) return;
		let stopped = false;
		let pending = false;
		/** The queued re-run: `null` none, else whether it must be forced. */
		let again: boolean | null = null;
		const isCurrent = () => !stopped;
		const trigger = (force: boolean): void => {
			if (stopped) return;
			if (pending) {
				again = (again ?? false) || force;
				return;
			}
			const client = relayRef.current();
			if (client === null) {
				/* An explicit skip, logged (R1-4). `relay()` answers null only when
				 * the store is not usable — the same predicate as `live` — so this is
				 * not expected while the effect runs; if it ever is, the route has
				 * just left a live phase and the `live` false → true edge that
				 * follows forces a fresh registration, so nothing is lost. */
				console.warn("[push] session push registration skipped", {
					reason: "no-client",
					force,
				});
				return;
			}
			pending = true;
			void registerSessionPushDevice(client, {
				routeKey,
				force,
				isCurrent,
				// Rejects when the stored choice cannot be read: the attempt
				// fails rather than sending defaults (R1 m-read); next trigger retries.
				preferences: () =>
					preferencesForRegistration(
						capabilitiesRef.current,
						loadNotificationPreferences,
					),
				onPosting: () => {
					if (stopped) return;
					const previous = sessionPushRegistrationStore.getState();
					sessionPushRegistrationStore.setState({
						routeKey,
						status: "registering",
						code: null,
						// Keep THIS computer's last success visible while re-registering.
						registeredAt:
							previous.routeKey === routeKey ? previous.registeredAt : null,
					});
				},
			})
				.then(({ outcome, code, registeredAt }) => {
					if (stopped || outcome === "stale") return;
					const previous = sessionPushRegistrationStore.getState();
					sessionPushRegistrationStore.setState({
						routeKey,
						status: outcome,
						code,
						registeredAt:
							registeredAt ??
							(previous.routeKey === routeKey ? previous.registeredAt : null),
					});
				})
				.finally(() => {
					pending = false;
					const queued = again;
					again = null;
					if (queued !== null && !stopped) trigger(queued);
				});
		};
		activeTrigger = trigger;
		registeredKey.current = capabilityKey;
		trigger(true);
		const foreground = AppState.addEventListener("change", (state) => {
			if (state === "active") trigger(false);
		});
		let tokenSubscription: { remove: () => void } | undefined;
		void loadNotifications()
			.then((module) => {
				if (module === null || stopped) return;
				tokenSubscription = module.addPushTokenListener(() => trigger(false));
			})
			.catch(() => undefined);
		return () => {
			stopped = true;
			if (activeTrigger === trigger) activeTrigger = null;
			foreground.remove();
			tokenSubscription?.remove();
		};
	}, [routeKey, live, revision, framed]);

	/* A LATER frame that changes what the daemon accepts (it gained
	 * `push_previews`, say, after an update while connected) changes the body,
	 * so register once more. Not on the first frame: the effect above started
	 * on it with this very key, so a cold start stays one POST. */
	useEffect(() => {
		if (activeTrigger === null || registeredKey.current === null) return;
		if (registeredKey.current === capabilityKey) return;
		registeredKey.current = capabilityKey;
		activeTrigger(true);
	}, [capabilityKey]);
};
