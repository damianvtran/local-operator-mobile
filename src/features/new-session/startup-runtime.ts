import { randomUUID } from "expo-crypto";
import {
	getStartupAuthorization,
	registerStartupAuthorizationCleanup,
} from "@/connection/startup-authorization";
import { envelopeStoreFor } from "@/features/session/envelope-store";
import type { RelayEndpoints } from "@/relay/endpoints";
import { sendPersistedCommand } from "@/relay/send-command";
import {
	StartupCoordinator,
	type StartupDeps,
	type StartupRecord,
} from "./startup-coordinator";
import { startupDeviceStore } from "./startup-device-store";

export type StartupAuthorization = Readonly<{
	scope: string;
	revision: number;
}>;
const coordinators = new Map<string, StartupCoordinator>();
const opening = new Map<string, Promise<StartupCoordinator>>();

const current = (auth: StartupAuthorization) => {
	const admitted = getStartupAuthorization();
	return admitted?.scope === auth.scope && admitted.revision === auth.revision;
};
function dependencies(
	key: string,
	auth: StartupAuthorization,
	client: RelayEndpoints,
): StartupDeps {
	return {
		store: {
			load: async () => {
				const value = await startupDeviceStore.get(key);
				return value === null ? null : (JSON.parse(value) as StartupRecord);
			},
			save: async (value) => startupDeviceStore.set(key, JSON.stringify(value)),
		},
		uuid: randomUUID,
		isCurrent: () => current(auth),
		start: (selection) => client.startSession(selection),
		send: async (sessionId, envelope) => {
			if (!current(auth)) throw new Error("authorization changed");
			await sendPersistedCommand({
				client,
				sessionId,
				envelopes: envelopeStoreFor(sessionId, auth.scope),
				...envelope,
				envelope,
			});
		},
	};
}

/** The active pointer selects a LOCAL provisional ID, not a server identity.
 * Repeated mounts share one owner; an explicit New after SID adoption creates
 * another local ID. Older records remain private and are not silently discarded. */
export async function openStartup(
	auth: StartupAuthorization,
	client: RelayEndpoints,
	fresh = false,
): Promise<StartupCoordinator> {
	const previous = opening.get(auth.scope);
	if (previous && !fresh) return previous;
	const operation = (async () => {
		if (previous) await previous;
		const pointerKey = JSON.stringify([auth.scope, "active"]);
		let localId = await startupDeviceStore.get(pointerKey);
		if (localId !== null && !/^[0-9a-f-]{36}$/i.test(localId))
			throw new Error("invalid provisional identity");
		if (localId === null) localId = randomUUID();
		let key = JSON.stringify([auth.scope, localId]);
		let coordinator = coordinators.get(key);
		if (!coordinator) {
			coordinator = new StartupCoordinator(
				key,
				dependencies(key, auth, client),
			);
			coordinators.set(key, coordinator);
		}
		await coordinator.ready;
		/* An explicit New must open a FRESH editor without destroying what the old one
		 * holds. `sessionId !== null` is not the only state worth keeping: an
		 * unconfirmed create (no session id, queued messages) has no automatic
		 * recovery, and reusing its coordinator made New a no-op — the trap UX U1
		 * found, where only sign-out escaped. Rotating leaves the old record under its
		 * own key (nothing is deleted or overwritten, no id is invented) while the
		 * active pointer moves to a new local identity. */
		const previousSnapshot = coordinator.snapshot();
		const holdsPrivateWork =
			previousSnapshot.sessionId !== null ||
			previousSnapshot.queue.length > 0 ||
			previousSnapshot.phase === "unconfirmed" ||
			previousSnapshot.phase === "starting";
		if (fresh && holdsPrivateWork) {
			if (previousSnapshot.sessionId !== null)
				// Retain the old conversation's unfinished editor for its exact SID.
				await startupDeviceStore.set(
					JSON.stringify([auth.scope, "session", previousSnapshot.sessionId]),
					key,
				);
			coordinator.pause();
			localId = randomUUID();
			key = JSON.stringify([auth.scope, localId]);
			coordinator = new StartupCoordinator(
				key,
				dependencies(key, auth, client),
			);
			coordinators.set(key, coordinator);
			await coordinator.ready;
		}
		if (!current(auth)) {
			coordinator.pause();
			throw new Error("authorization changed");
		}
		await startupDeviceStore.set(pointerKey, localId);
		coordinator.bind(dependencies(key, auth, client));
		return coordinator;
	})();
	opening.set(auth.scope, operation);
	try {
		return await operation;
	} finally {
		if (opening.get(auth.scope) === operation) opening.delete(auth.scope);
	}
}

/** Exact locally recorded SID mapping only; never a listing/title inference. */
export async function startupForSession(
	auth: StartupAuthorization,
	client: RelayEndpoints,
	sessionId: string,
): Promise<StartupCoordinator | null> {
	for (const [key, owner] of coordinators) {
		if (
			(JSON.parse(key) as string[])[0] === auth.scope &&
			owner.snapshot().sessionId === sessionId
		) {
			owner.bind(dependencies(key, auth, client));
			return owner;
		}
	}
	const mapped = await startupDeviceStore.get(
		JSON.stringify([auth.scope, "session", sessionId]),
	);
	if (mapped !== null) {
		const identity: unknown = JSON.parse(mapped);
		if (
			!Array.isArray(identity) ||
			identity[0] !== auth.scope ||
			typeof identity[1] !== "string"
		)
			throw new Error("foreign provisional identity");
		const owner = new StartupCoordinator(
			mapped,
			dependencies(mapped, auth, client),
		);
		await owner.ready;
		if (!current(auth) || owner.snapshot().sessionId !== sessionId) {
			owner.pause();
			return null;
		}
		coordinators.set(mapped, owner);
		return owner;
	}
	const active = await openStartup(auth, client);
	if (active.snapshot().sessionId === sessionId) return active;
	active.pause();
	return null;
}

export async function retireStartupCoordinators(): Promise<void> {
	const owners = [...coordinators.values()];
	for (const owner of owners) owner.revoke();
	/* `quiesce`, not `flush`: retirement is where a drain still sitting inside
	 * `deps.send` must be waited for, and only `quiesce` covers the flight. */
	await Promise.all(owners.map((owner) => owner.quiesce()));
	await Promise.allSettled([...opening.values()]);
	await startupDeviceStore.clear();
	coordinators.clear();
	opening.clear();
}
registerStartupAuthorizationCleanup(retireStartupCoordinators);
