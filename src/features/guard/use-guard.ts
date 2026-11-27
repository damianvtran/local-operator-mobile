import { useIsFocused } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import { useStore } from "zustand";

import {
	useConnection,
	useConnectionState,
	useListState,
} from "@/features/auth/connection-provider";
import type { RelayEndpoints } from "@/relay";
import {
	createGuardController,
	GUARD_REFRESH_MS,
	type GuardController,
} from "./guard-controller";
import { guardEnabled } from "./guard-model";
import { startGuardRefresh } from "./guard-refresh";

/**
 * The live client a Guard surface may read through, or why it has none.
 *
 *  - `unknown`   the relay has not spoken yet (no list frame): an absent
 *                capability then means "not yet", never "no" (the same rule the
 *                inbox applies to `notifications`);
 *  - `offline`   no live route to a computer;
 *  - `degraded`  a route exists but the live stream is unhealthy: no Guard
 *                request is made (an answer sent over it could be lost), and the
 *                section says it is reconnecting rather than "connect a computer";
 *  - `unsupported` a live computer that does not advertise `features.guard`
 *                (an older Local Operator): a calm state, zero Guard requests;
 *  - `ready`     advertised and live.
 */
export type GuardAvailability =
	| { kind: "unknown" | "offline" | "unsupported" | "degraded" }
	| { kind: "ready"; client: RelayEndpoints };

export function useGuardAvailability(): GuardAvailability {
	const { relay, streamHealth } = useConnection();
	const phase = useConnectionState((state) => state.phase);
	const route = useConnectionState((state) => state.route);
	const capabilities = useListState((state) => state.capabilities);
	const frameCount = useListState((state) => state.frameCount);
	const connected =
		phase === "live" && route !== null && streamHealth !== "offline";
	if (!connected) return { kind: "offline" };
	if (streamHealth === "degraded") return { kind: "degraded" };
	if (!guardEnabled(capabilities)) {
		return { kind: frameCount > 0 ? "unsupported" : "unknown" };
	}
	const client = relay();
	return client === null ? { kind: "offline" } : { kind: "ready", client };
}

/**
 * One controller per immutable client, activated for the life of the mounting
 * component and torn down with it (a late answer can then never paint after the
 * screen is gone). Created at render time, not in an effect, so a new client
 * never briefly shows the old computer's answer (the account-routing rule).
 */
export function useGuardController(
	client: RelayEndpoints,
	options: { readCard?: boolean } = {},
): GuardController {
	const { readCard = true } = options;
	const controller = useMemo(
		() => createGuardController(client, undefined, { readCard }),
		[client, readCard],
	);
	useEffect(() => {
		void controller.activate();
		return () => controller.deactivate();
	}, [controller]);
	// Live refresh (R1-5): foreground + a bounded interval, only while this
	// screen is focused (a screen kept mounted under a detail route must not poll)
	// and, by construction, only where a Guard body is mounted — i.e. only after
	// `useGuardAvailability` saw `features.guard`. Re-focus re-reads once now; the
	// first start does not, since `activate()` above is already reading.
	const focused = useIsFocused();
	const startedFor = useRef<GuardController | null>(null);
	useEffect(() => {
		if (!focused) return;
		const immediate = startedFor.current === controller;
		startedFor.current = controller;
		return startGuardRefresh(() => controller.refresh(), {
			appState: AppState,
			intervalMs: GUARD_REFRESH_MS,
			immediate,
		});
	}, [controller, focused]);
	return controller;
}

export const useGuardState = (controller: GuardController) =>
	useStore(controller);
