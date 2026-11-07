import { randomUUID } from "expo-crypto";
import { z } from "zod";
import {
	getStartupAuthorization,
	registerStartupAuthorizationCleanup,
} from "@/connection/startup-authorization";
import { promptImageSchema } from "@/contracts/schemas";
import {
	draftKey,
	hasOrdinarySessionDraft,
	reconcileOrdinarySessionDraft,
} from "@/features/session/device-storage";
import {
	discardRecoveryDraft,
	getDraftRecoveryAuthority,
	readRecoveryDraft,
	registerRetiringDraftCheckpoint,
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
	{
		authority: string | null;
		hidden: StartupDraft | null;
		pending: boolean;
		eligible: boolean;
		revision: number;
	}
>();
type ProvenanceRecord = StartupRecord & {
	draftRecoveryAuthority?: string;
	draftMirrorPending?: boolean;
	draftRecoveryEligible?: boolean;
};
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
): Promise<void> {
	return draft.text === "" && draft.images.length === 0
		? discardRecoveryDraft(key, scope)
		: writeRecoveryDraft(key, JSON.stringify(draft), scope);
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
/** A durable local intent wins over the vault, including an empty discard. The
 * acknowledgement is queued behind ordinary persistence and revision checked so
 * an older mirror cannot clear a newer edit's pending marker. */
async function mirrorOrdinaryDraft(
	owner: StartupCoordinator,
	key: string,
	auth: StartupAuthorization,
): Promise<boolean> {
	const origin = recoveryOrigins.get(key);
	const authority = getDraftRecoveryAuthority();
	if (
		!origin ||
		authority === null ||
		!current(auth) ||
		(origin.authority !== null && origin.authority !== authority)
	)
		return false;
	const revision = origin.revision;
	const draft = origin.hidden ?? owner.snapshot().draft;
	const sid = owner.snapshot().sessionId;
	try {
		const writes: Promise<void>[] = [];
		if (sid !== null) {
			writes.push(
				checkpointEditor(`startup:session:${sid}`, draft, auth.scope),
			);
			writes.push(discardRecoveryDraft(draftKey(sid), auth.scope));
		}
		if (recoveryEditors.get(auth.scope) === key)
			writes.push(
				checkpointEditor(
					"startup:active",
					sid === null ? draft : { text: "", images: [] },
					auth.scope,
				),
			);
		await Promise.all(writes);
		if (
			!current(auth) ||
			getDraftRecoveryAuthority() !== authority ||
			origin.revision !== revision
		)
			return false;
		const saved = await owner.persistRecoveryMetadata(() => {
			if (
				current(auth) &&
				getDraftRecoveryAuthority() === authority &&
				origin.revision === revision
			)
				origin.pending = false;
		});
		if (!saved && origin.revision === revision) origin.pending = true;
		return (
			saved && !origin.pending && origin.revision === revision && current(auth)
		);
	} catch {
		return false;
	}
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
	if (origin?.pending) {
		if (!(await mirrorOrdinaryDraft(owner, key, auth))) return;
		// A locally edited imported draft was deliberately hidden offline. Reveal
		// its current ordinary value only after matching fresh proof and handoff.
		if (origin.hidden !== null)
			await owner.restoreDraft(origin.hidden, () => {
				origin.hidden = null;
			});
		return;
	}
	if (origin && !origin.eligible && origin.authority === null) return;
	const raw = await recoveredEditor(owner.snapshot().sessionId, auth);
	if (raw !== null && current(auth))
		await owner.restoreDraft(recoveryDraftSchema.parse(JSON.parse(raw)), () => {
			if (origin) {
				origin.authority = authority;
				origin.hidden = null;
				origin.eligible = false;
			}
		});
}

/** Called only by the serialized auth retirement boundary, after withdrawal and
 * before ordinary purge. Process one encrypted record at a time; a failed stale
 * deletion propagates so the last ordinary copy and marker cannot be destroyed. */
export async function checkpointRetiringDrafts(
	generation: string,
	write: (key: string, value: string | null) => Promise<void>,
): Promise<void> {
	const belongs = (key: string): boolean => {
		try {
			const parts: unknown = JSON.parse(key);
			return (
				Array.isArray(parts) &&
				parts.length === 2 &&
				parts[0] === generation &&
				typeof parts[1] === "string" &&
				LOCAL_ID.test(parts[1])
			);
		} catch {
			return false;
		}
	};
	for (const [key, owner] of coordinators)
		if (belongs(key)) await owner.quiesce();
	const activeId = await startupDeviceStore.get(
		JSON.stringify([generation, "active"]),
	);
	const activeKey =
		recoveryEditors.get(generation) ??
		(activeId === null ? null : JSON.stringify([generation, activeId]));
	const keys = new Set([
		...(await startupDeviceStore.keys()),
		...coordinators.keys(),
	]);
	for (const key of keys) {
		if (!belongs(key)) continue;
		const origin = recoveryOrigins.get(key);
		const owner = coordinators.get(key);
		const value = await startupDeviceStore.get(key);
		const saved =
			value === null ? null : (JSON.parse(value) as ProvenanceRecord);
		if (!(origin?.pending || saved?.draftMirrorPending === true)) continue;
		const draft = recoveryDraftSchema.parse(
			origin?.pending && owner
				? (origin.hidden ?? owner.snapshot().draft)
				: saved?.draft,
		);
		const sid = owner?.snapshot().sessionId ?? saved?.sessionId ?? null;
		const encoded =
			draft.text === "" && draft.images.length === 0
				? null
				: JSON.stringify(draft);
		if (sid !== null) {
			await write(`startup:session:${sid}`, encoded);
			await write(draftKey(sid), null);
		}
		if (key === activeKey)
			await write("startup:active", sid === null ? encoded : null);
	}
}
registerRetiringDraftCheckpoint(checkpointRetiringDrafts);

function dependencies(
	key: string,
	auth: StartupAuthorization,
	client: RelayEndpoints,
	recoverDraft = true,
): StartupDeps {
	let origin = recoveryOrigins.get(key);
	if (!origin) {
		origin = {
			authority: null,
			hidden: null,
			pending: false,
			eligible: true,
			revision: 0,
		};
		recoveryOrigins.set(key, origin);
	}
	const provenance = origin;
	return {
		store: {
			load: async () => {
				const value = await startupDeviceStore.get(key);
				if (value !== null) {
					const saved = JSON.parse(value) as ProvenanceRecord;
					for (const field of [
						saved.draftMirrorPending,
						saved.draftRecoveryEligible,
					])
						if (field !== undefined && typeof field !== "boolean")
							throw new Error("invalid recovery reconciliation state");
					provenance.pending = saved.draftMirrorPending === true;
					// Older ordinary records are not evidence that a blank editor is new.
					provenance.eligible = saved.draftRecoveryEligible === true;
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
						draftMirrorPending: provenance.pending,
						draftRecoveryEligible: provenance.eligible,
					}),
				),
		},
		checkpointDraft: (draft, _sessionId, changed) => {
			if (!current(auth)) return;
			// This intent must survive JS restart even when the proof-gated vault
			// correctly refuses a write/remove. A later proof reconciles outward.
			provenance.pending = true;
			provenance.eligible = false;
			provenance.revision++;
			if (changed && provenance.hidden !== null) {
				provenance.hidden = null;
				provenance.authority = null;
			}
			if (changed && draft.text === "" && draft.images.length === 0)
				provenance.authority = null;
			const owner = coordinators.get(key);
			if (owner) void mirrorOrdinaryDraft(owner, key, auth);
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
			coordinator = new StartupCoordinator(
				key,
				dependencies(key, auth, client, false),
			);
			coordinators.set(key, coordinator);
			await coordinator.ready;
			// New is a durable empty-editor intent even while proof is unavailable.
			coordinator.edit("", []);
			await coordinator.flush();
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
	// A legacy ordinary editor (including its durable empty discard) is already
	// authoritative for this generation; do not replace it with a vault import.
	if (await hasOrdinarySessionDraft(sessionId, auth.scope)) {
		await reconcileOrdinarySessionDraft(sessionId, auth.scope).catch(
			() => undefined,
		);
		return null;
	}
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
					draftMirrorPending: false,
					draftRecoveryEligible: false,
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
			if (await hasOrdinarySessionDraft(sessionId, auth.scope)) {
				// Keep the committed record/SID pointer: the mapped branch can reopen a fresh owner.
				owner.pause();
				coordinators.delete(key);
				recoveryOrigins.delete(key);
				return null;
			}
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
