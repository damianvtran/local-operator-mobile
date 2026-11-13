/**
 * When session push registration runs: for the ROUTED computer, whenever the
 * route is live, on every event that can change what the daemon should hold.
 *
 * TRIGGERS, and why each one:
 *  - effect start — FORCED: cold start, route change, and a reconnect (the
 *    effect re-runs when the route, its client or its phase changes). The new
 *    computer must learn this phone, and a re-established route may follow a
 *    fresh sign-in whose register is what clears the daemon's `expired` lapse.
 *    The PREVIOUS computer's registration is deliberately left alone (no DELETE
 *    on a route switch), so switching back and forth keeps both computers
 *    pushing. The only DELETE paths are the existing sign-out retirements.
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
 * Gated on a LIVE route the same way `use-custom-sound-prefetch` is (`live`,
 * `degraded`, `re-minting`): a POST to a route that is still connecting would
 * fail and log for nothing. Native only; web has no device token.
 *
 * Attempts are single-flight with one queued re-run (which keeps the stronger
 * `force` of the requests it absorbed), so a foreground and a token rotation
 * landing together produce at most two attempts, never a pile-up.
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
let activeTrigger: ((force: boolean) => void) | null = null;

/** Ask the mounted hook to register now (Settings, after a permission grant).
 *  A no-op without a live route: the next route start registers anyway. */
export const requestSessionPushRegistration = (): void => {
	activeTrigger?.(true);
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
		/** The queued re-run: `null` none, else whether it must be forced. */
		let again: boolean | null = null;
		const isCurrent = () => !stopped;
		const trigger = (force: boolean): void => {
			if (stopped) return;
			if (pending) {
				again = (again ?? false) || force;
				return;
			}
			const client = relay();
			if (client === null) return;
			pending = true;
			void registerSessionPushDevice(client, {
				routeKey,
				force,
				isCurrent,
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
	}, [relay, route, phase]);
};
