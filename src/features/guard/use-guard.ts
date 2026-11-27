import { useEffect, useMemo } from "react";
import { useStore } from "zustand";

import {
	useConnection,
	useConnectionState,
	useListState,
} from "@/features/auth/connection-provider";
import type { RelayEndpoints } from "@/relay";
import {
	createGuardController,
	type GuardController,
} from "./guard-controller";
import { guardEnabled } from "./guard-model";

/**
 * The live client a Guard surface may read through, or why it has none.
 *
 *  - `unknown`   the relay has not spoken yet (no list frame): an absent
 *                capability then means "not yet", never "no" (the same rule the
 *                inbox applies to `notifications`);
 *  - `offline`   no live route to a computer;
 *  - `unsupported` a live computer that does not advertise `features.guard`
 *                (an older Local Operator): a calm state, zero Guard requests;
 *  - `ready`     advertised and live.
 */
export type GuardAvailability =
	| { kind: "unknown" | "offline" | "unsupported" }
	| { kind: "ready"; client: RelayEndpoints };

export function useGuardAvailability(): GuardAvailability {
	const { relay, streamHealth } = useConnection();
	const phase = useConnectionState((state) => state.phase);
	const route = useConnectionState((state) => state.route);
	const capabilities = useListState((state) => state.capabilities);
	const frameCount = useListState((state) => state.frameCount);
	const live =
		phase === "live" &&
		route !== null &&
		streamHealth !== "offline" &&
		streamHealth !== "degraded";
	if (!live) return { kind: "offline" };
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
	return controller;
}

export const useGuardState = (controller: GuardController) =>
	useStore(controller);
