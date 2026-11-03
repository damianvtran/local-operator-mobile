import { randomUUID } from "expo-crypto";
import { z } from "zod";
import {
	getStartupAuthorization,
	registerStartupAuthorizationCleanup,
} from "@/connection/startup-authorization";
import { promptImageSchema } from "@/contracts/schemas";
import { draftKey } from "@/features/session/device-storage";
import {
	discardRecoveryDraft,
	getDraftRecoveryAuthority,
	readRecoveryDraft,
	writeRecoveryDraft,
} from "@/features/session/draft-recovery";
import { envelopeStoreFor } from "@/features/session/envelope-store";
import { runPrivateWrite } from "@/features/session/scoped-storage";
import type { RelayEndpoints } from "@/relay/endpoints";
import { sendPersistedCommand } from "@/relay/send-command";
import {
	StartupCoordinator,
	type StartupDeps,
	type StartupDraft,
	type StartupRecord,
} from "./startup-coordinator";
import { startupDeviceStore } from "./startup-device-store";

const LOCAL_ID = /^[0-9a-f-]{36}$/i;

export type StartupAuthorization = Readonly<{
	scope: string;
	revision: number;
}>;
const coordinators = new Map<string, StartupCoordinator>();
const opening = new Map<string, Promise<StartupCoordinator>>();
const recoveryEditors = new Map<string, string>();
// Provenance is part of encrypted ordinary records, never a generation-level
// ownership guess. Cached imports stay hidden until their sealed slot proves.
const recoveryOrigins = new Map<
	string,
	{ authority: string | null; hidden: StartupDraft | null }
>();
type ProvenanceRecord = StartupRecord & { draftRecoveryAuthority?: string };
const recoveryDraftSchema = z
	.object({ text: z.string(), images: z.array(promptImageSchema) })
	.strict();

const current = (auth: StartupAuthorization) => {
	const admitted = getStartupAuthorization();
	return admitted?.scope === auth.scope && admitted.revision === auth.revision;
};
function checkpointEditor(
	key: string,
	draft: StartupDraft,
	scope: string,
): void {
	const write =
		draft.text === "" && draft.images.length === 0
			? discardRecoveryDraft(key, scope)
			: writeRecoveryDraft(key, JSON.stringify(draft), scope);
	void write.catch(() => undefined);
}
async function recoveredEditor(
	sessionId: string | null,
	auth: StartupAuthorization,
): Promise<string | null> {
	if (sessionId === null)
		return readRecoveryDraft("startup:active", auth.scope);
	const draft = await readRecoveryDraft(
		`startup:session:${sessionId}`,
		auth.scope,
	);
	if (draft !== null) return draft;
	const text = await readRecoveryDraft(draftKey(sessionId), auth.scope);
	return text === null ? null : JSON.stringify({ text, images: [] });
}
async function restoreOptionalDraft(
	owner: StartupCoordinator,
	key: string,
	auth: StartupAuthorization,
): Promise<void> {
	const authority = getDraftRecoveryAuthority();
	const origin = recoveryOrigins.get(key);
	if (
		authority === null ||
		!current(auth) ||
		(origin?.authority != null && origin.authority !== authority)
	)
		return;
	const raw = await recoveredEditor(owner.snapshot().sessionId, auth);
	if (raw !== null && current(auth))
		await owner.restoreDraft(recoveryDraftSchema.parse(JSON.parse(raw)), () => {
			// Keep the bound persistence closure and map on the same provenance object.
			if (origin) {
				origin.authority = authority;
				origin.hidden = null;
			} else recoveryOrigins.set(key, { authority, hidden: null });
		});
	if (current(auth) && owner.hasDraftEdits()) {
		const sid = owner.snapshot().sessionId;
		if (sid !== null)
			checkpointEditor(
				`startup:session:${sid}`,
				owner.snapshot().draft,
				auth.scope,
			);
		else if (recoveryEditors.get(auth.scope) === key)
			checkpointEditor("startup:active", owner.snapshot().draft, auth.scope);
	}
}
function dependencies(
	key: string,
	auth: StartupAuthorization,
	client: RelayEndpoints,
	recoverDraft = true,
): StartupDeps {
	let origin = recoveryOrigins.get(key);
	if (!origin) {
		origin = { authority: null, hidden: null };
		recoveryOrigins.set(key, origin);
	}
	const provenance = origin;
	return {
		store: {
			load: async () => {
				const value = await startupDeviceStore.get(key);
				if (value !== null) {
					const saved = JSON.parse(value) as ProvenanceRecord;
					if (saved.draftRecoveryAuthority !== undefined) {
						if (typeof saved.draftRecoveryAuthority !== "string")
							throw new Error("invalid recovery provenance");
						provenance.authority = saved.draftRecoveryAuthority;
						provenance.hidden = saved.draft;
						return { ...saved, draft: { text: "", images: [] } };
					}
					return saved;
				}
				if (!recoverDraft) return null;
				const recovered = await readRecoveryDraft("startup:active", auth.scope);
				if (recovered === null || !current(auth)) return null;
				provenance.authority = getDraftRecoveryAuthority();
				// A recovered editor is a fresh draft, never a recovered create or
				// outbox. No old session ID, selection or continuation can dispatch.
				return {
					version: 1,
					scope: key,
					phase: "draft",
					sessionId: null,
					selection: null,
					queue: [],
					draft: recoveryDraftSchema.parse(JSON.parse(recovered)),
				} as StartupRecord;
			},
			save: async (value) =>
				startupDeviceStore.set(
					key,
					JSON.stringify({
						...value,
						draft: provenance.hidden ?? value.draft,
						draftRecoveryAuthority: provenance.authority ?? undefined,
					}),
				),
		},
		checkpointDraft: (draft, sessionId, changed) => {
			if (!current(auth)) return;
			if (changed && provenance.hidden !== null) {
				provenance.hidden = null;
				provenance.authority = null;
			}
			if (changed && draft.text === "" && draft.images.length === 0)
				provenance.authority = null;
			if (sessionId !== null)
				checkpointEditor(`startup:session:${sessionId}`, draft, auth.scope);
			if (recoveryEditors.get(auth.scope) !== key) return;
			// This call is accepted synchronously while the owner is still admitted;
			// vault withdrawal will drain it even if normal persistence is delayed.
			checkpointEditor(
				"startup:active",
				sessionId === null ? draft : { text: "", images: [] },
				auth.scope,
			);
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
	if (previous && !fresh) {
		const owner = await previous;
		const key = recoveryEditors.get(auth.scope);
		if (key) await restoreOptionalDraft(owner, key, auth);
		return owner;
	}
	const operation = (async () => {
		if (previous) await previous;
		const pointerKey = JSON.stringify([auth.scope, "active"]);
		let localId = await startupDeviceStore.get(pointerKey);
		if (localId !== null && !LOCAL_ID.test(localId))
			throw new Error("invalid provisional identity");
		if (localId === null) localId = randomUUID();
		let key = JSON.stringify([auth.scope, localId]);
		recoveryEditors.set(auth.scope, key);
		let coordinator = coordinators.get(key);
		if (!coordinator) {
			coordinator = new StartupCoordinator(
				key,
				dependencies(key, auth, client),
			);
			coordinators.set(key, coordinator);
		}
		await coordinator.ready;
		await restoreOptionalDraft(coordinator, key, auth);
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
			else {
				/* A create still in flight when New is pressed may save its session id
				 * into the OLD record after the pointer has moved: the coordinator keeps
				 * that late write (it only forbids navigation and dispatch in a replaced
				 * scope). Without a mapping that conversation exists but cannot be found
				 * after a restart, so map it the moment it lands. */
				const rotated = coordinator;
				const rotatedKey = key;
				const stop = rotated.subscribe(() => {
					const sid = rotated.snapshot().sessionId;
					if (sid === null) return;
					stop();
					void startupDeviceStore.set(
						JSON.stringify([auth.scope, "session", sid]),
						rotatedKey,
					);
				});
			}
			coordinator.pause();
			localId = randomUUID();
			key = JSON.stringify([auth.scope, localId]);
			recoveryEditors.set(auth.scope, key);
			await discardRecoveryDraft("startup:active", auth.scope);
			coordinator = new StartupCoordinator(
				key,
				dependencies(key, auth, client, false),
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
			await restoreOptionalDraft(owner, key, auth);
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
			dependencies(mapped, auth, client, false),
		);
		await owner.ready;
		if (!current(auth) || owner.snapshot().sessionId !== sessionId) {
			owner.pause();
			return null;
		}
		coordinators.set(mapped, owner);
		await restoreOptionalDraft(owner, mapped, auth);
		return owner;
	}
	const recovered = await recoveredEditor(sessionId, auth);
	if (recovered !== null && current(auth)) {
		// This new owner is not in the coordinator map yet. Register the WHOLE
		// import so retirement drains it before purge, including its second write.
		return runPrivateWrite(async () => {
			if (!current(auth)) return null;
			// The requested SID comes from the current authenticated conversation, not
			// from recovery bytes. Rebuild ONLY its editor with an empty fresh outbox.
			const key = JSON.stringify([auth.scope, randomUUID()]);
			const record: StartupRecord = {
				version: 1,
				scope: key,
				phase: "ready",
				sessionId,
				selection: null,
				queue: [],
				draft: recoveryDraftSchema.parse(JSON.parse(recovered)),
			};
			await startupDeviceStore.set(
				key,
				JSON.stringify({
					...record,
					draftRecoveryAuthority: getDraftRecoveryAuthority(),
				}),
			);
			if (!current(auth)) return null;
			await startupDeviceStore.set(
				JSON.stringify([auth.scope, "session", sessionId]),
				key,
			);
			if (!current(auth)) return null;
			const owner = new StartupCoordinator(
				key,
				dependencies(key, auth, client, false),
			);
			await owner.ready;
			if (!current(auth)) {
				owner.revoke();
				return null;
			}
			coordinators.set(key, owner);
			await restoreOptionalDraft(owner, key, auth);
			return owner;
		});
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
	recoveryEditors.clear();
	recoveryOrigins.clear();
}
registerStartupAuthorizationCleanup(retireStartupCoordinators);
