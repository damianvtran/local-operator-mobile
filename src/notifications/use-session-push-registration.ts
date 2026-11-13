/**
 * When session push registration runs: for the ROUTED computer, whenever the
 * route is live, on every event that can change what the daemon should hold.
 *
 * TRIGGERS, and why each one:
 *  - effect start: cold start AND route change (the effect re-runs when the
 *    route or its client changes). The new computer must learn this phone; the
 *    PREVIOUS computer's registration is deliberately left alone (no DELETE on a
 *    route switch), so switching back and forth keeps both computers pushing.
 *    The only DELETE is sign-out's revoke, which already exists.
 *  - app foreground: the daemon's register is the act that clears an `expired`
 *    lapse and refreshes the presented cookie's expiry, so a foreground re-POSTs
 *    (idempotent upsert on install id) rather than skipping.
 *  - token rotation (`addPushTokenListener`): APNs/FCM may rotate while the app
 *    runs; the stale token would silently stop delivery.
 *  - `requestSessionPushRegistration()`: Settings calls it right after the
 *    reader grants permission, so the first registration does not wait for the
 *    next foreground.
 *
 * Gated on a LIVE route the same way `use-custom-sound-prefetch` is (`live`,
 * `degraded`, `re-minting`): a POST to a route that is still connecting would
 * fail and log for nothing. Native only; web has no device token.
 *
 * Attempts are single-flight with one queued re-run, so a foreground and a
 * token rotation landing together produce at most two POSTs, never a pile-up.
 */
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import {
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import { loadNotifications } from "@/notifications/native";
import {
	registerSessionPushDevice,
	sessionPushRegistrationStore,
	sessionPushRouteKey,
} from "@/notifications/session-push-registration";

const LIVE_PHASES = ["live", "degraded", "re-minting"];

/** The mounted hook's trigger; `null` while no live route is mounted. */
let activeTrigger: (() => void) | null = null;

/** Ask the mounted hook to register now (Settings, after a permission grant).
 *  A no-op without a live route: the next route start registers anyway. */
export const requestSessionPushRegistration = (): void => {
	activeTrigger?.();
};

export const useSessionPushRegistration = (): void => {
	const { relay } = useConnection();
	const route = useConnectionState((s) => s.route);
	const phase = useConnectionState((s) => s.phase);
	useEffect(() => {
		if (Platform.OS !== "ios" && Platform.OS !== "android") return;
		if (!route || !LIVE_PHASES.includes(phase)) return;
		const routeKey = sessionPushRouteKey(route);
		let stopped = false;
		let pending = false;
		let again = false;
		const isCurrent = () => !stopped;
		const trigger = (): void => {
			if (stopped) return;
			if (pending) {
				again = true;
				return;
			}
			const client = relay();
			if (client === null) return;
			pending = true;
			const previous = sessionPushRegistrationStore.getState();
			sessionPushRegistrationStore.setState({
				routeKey,
				status: "registering",
				code: null,
				// Keep the last success for THIS computer visible while re-registering.
				registeredAt:
					previous.routeKey === routeKey ? previous.registeredAt : null,
			});
			void registerSessionPushDevice(client, isCurrent)
				.then(({ outcome, code }) => {
					if (stopped || outcome === "stale") return;
					const state = sessionPushRegistrationStore.getState();
					sessionPushRegistrationStore.setState({
						routeKey,
						status: outcome,
						code,
						registeredAt:
							outcome === "registered" ? Date.now() : state.registeredAt,
					});
				})
				.finally(() => {
					pending = false;
					if (again && !stopped) {
						again = false;
						trigger();
					}
				});
		};
		activeTrigger = trigger;
		trigger();
		const foreground = AppState.addEventListener("change", (state) => {
			if (state === "active") trigger();
		});
		let tokenSubscription: { remove: () => void } | undefined;
		void loadNotifications()
			.then((module) => {
				if (module === null || stopped) return;
				tokenSubscription = module.addPushTokenListener(() => trigger());
			})
			.catch(() => undefined);
		return () => {
			stopped = true;
			if (activeTrigger === trigger) activeTrigger = null;
			foreground.remove();
			tokenSubscription?.remove();
		};
	}, [relay, route, phase]);
};
