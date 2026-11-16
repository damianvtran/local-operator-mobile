import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import {
	getStartupAuthorization,
	subscribeStartupAuthorization,
} from "@/connection/startup-authorization";
import {
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import { deviceStore } from "@/features/session/device-storage";
import { envelopeStoreFor } from "@/features/session/envelope-store";
import {
	OUTBOX_KEY_PREFIX,
	type OutboxLedger,
	outbox,
} from "@/features/session/outbox";
import { scopedStore } from "@/features/session/scoped-storage";
import { isUsable } from "@/state/connection-store";

/**
 * Connects the process-wide outbox (`outbox.ts`) to the app's lifecycle. Root-
 * mounted beside the other headless hosts in `app/_layout.tsx`, inside
 * `ConnectionProvider`, so it outlives every screen — the property that lets a
 * send continue after the reader leaves its conversation.
 *
 * Three jobs, and only these:
 *
 * - hand the outbox the CURRENT relay client (a renewed credential or a
 *   switched route replaces it; a retry must not use a stale one);
 * - resume every send the outbox owned (its ledger, `OutboxLedger`) when a
 *   client becomes usable — the relaunch path: the envelope survived the kill
 *   in device storage, and the row is repainted from it before the attempt;
 * - on every return to the foreground, nudge waiting sends (skipping their
 *   backoff, since iOS froze the timers while suspended) and pick up any
 *   owned send not running in this process yet.
 *
 * A change of authorization scope (sign-out, account switch) abandons every
 * job without touching storage; the auth layer owns that purge.
 */
export function OutboxHost(): null {
	const connection = useConnection();
	const usable = useConnectionState((state) => isUsable(state));
	/* Subscribed so a route switch re-renders this host: `relay()` reads a ref,
	 *  and a live→live swap would otherwise leave the outbox the old client. */
	useConnectionState((state) => state.route);
	const client = usable ? connection.relay() : null;
	const scope =
		useSyncExternalStore(
			subscribeStartupAuthorization,
			getStartupAuthorization,
			getStartupAuthorization,
		)?.scope ?? null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: `scope` is a TRIGGER — the cleanup runs when the identity changes, abandoning the old identity's jobs.
	useEffect(() => {
		return () => outbox.abandonAll();
	}, [scope]);

	useEffect(() => {
		outbox.setLedger(scope === null ? null : ledgerFor(scope));
	}, [scope]);

	useEffect(() => {
		outbox.setClient(client);
		if (client !== null && scope !== null) void resumeHeld(scope);
	}, [client, scope]);

	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") return;
			outbox.onForeground();
			if (client !== null && scope !== null) void resumeHeld(scope);
		});
		return () => subscription.remove();
	}, [client, scope]);

	return null;
}

/** The outbox's ownership marks, in this identity's scoped device storage. */
function ledgerFor(scope: string): OutboxLedger {
	const store = scopedStore(deviceStore, scope);
	return {
		add: (sessionId) => store.set(`${OUTBOX_KEY_PREFIX}${sessionId}`, "1"),
		remove: (sessionId) => store.remove(`${OUTBOX_KEY_PREFIX}${sessionId}`),
	};
}

/** Every session the outbox owned under this scope (its ledger marks), handed
 *  to `resume`. Best effort: unreadable storage leaves the composer's own
 *  retained-retry path, which reads the same envelope on mount. */
async function resumeHeld(scope: string): Promise<void> {
	try {
		const keys = await scopedStore(deviceStore, scope).keys();
		const held = keys
			.filter((key) => key.startsWith(OUTBOX_KEY_PREFIX))
			.map((key) => key.slice(OUTBOX_KEY_PREFIX.length))
			.filter((id) => id !== "")
			.map((sessionId) => ({
				sessionId,
				envelopes: envelopeStoreFor(sessionId, scope),
			}));
		await outbox.resume(held);
	} catch {
		/* See the doc comment. */
	}
}
