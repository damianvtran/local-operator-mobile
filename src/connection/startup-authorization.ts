/**
 * The native startup authorization generation: one opaque admission fence per
 * authenticated route, minted locally and never derived from a URL, an account
 * label or a credential digest.
 *
 * What this module is for. The startup coordinator and the durable draft/queue
 * stores need a stable owner for "the work that belongs to whoever is signed in
 * right now" (proposal: Stage A, `scoping` 91-109, `auth` 177-185, `native`
 * 200-205). A route string alone is not that owner: the same relay address can
 * be signed into by a different person, so reusing a generation across an auth
 * boundary would adopt the previous reader's drafts. The generation is therefore
 * random, persisted beside the credentials, and re-minted whenever ownership
 * cannot be proven — while the drafts themselves stay quarantined under the dead
 * generation instead of being silently deleted or silently shown.
 *
 * Three distinct boundaries, kept distinct on purpose:
 *
 * - `revoke()` — an uncertain or failed authentication (`401`, a lapsed grant, a
 *   cancelled login, unmount). Dispatch closes synchronously and the persisted
 *   generation is invalidated, but NOTHING is deleted: `docs/ux/flows.md` § C5
 *   ("never clear drafts on an auth blip") is the rule, and a draft lost to a
 *   token expiry is unrecoverable. The old drafts are not adopted by the next
 *   generation either, so nothing crosses the boundary unproven.
 * - `retire()` — an explicit privacy boundary: sign-out, a forget-the-route
 *   action, or an identity/server change proven by `admit()`. It closes the gate,
 *   writes a purge tombstone and then deletes the private families. The tombstone
 *   is what makes a crash mid-purge safe: the next admission finishes the purge
 *   before it can offer a new scope.
 * - `suspend()` — the synchronous half only (unmount / new route selection). No
 *   persistence, no deletion.
 *
 * Fail-closed ordering, and why it is not negotiable: the getter reports `null`
 * and subscribers are notified BEFORE any deletion starts, so no async completion
 * started under the old generation can publish into the new one, and a failing
 * cleanup leaves the lifecycle's own tail rejected — a later login cannot skip
 * that rejection, so admission stays closed rather than half-open.
 *
 * Stage B (encrypted cross-login retention, an account principal) is explicitly
 * NOT here: this module proves a locally generated generation, not a person.
 */

import { reopenPrivateWrites } from "@/features/session/scoped-storage";
import { reopenDispatch } from "@/relay/command-lifecycle";
import { randomState } from "./pkce";
import type { StartupAuthorizationRecord } from "./storage";

export type StartupAuthorization = Readonly<{
	scope: string;
	revision: number;
}>;

/** The only persistence this module needs, so it can be exercised in Node and
 *  stays free of React Native, the keystore adapter and the coordinator. */
export interface StartupAuthorizationStorage {
	read(): Promise<StartupAuthorizationRecord | null>;
	write(record: StartupAuthorizationRecord): Promise<void>;
}

export class StartupAuthorizationLifecycle {
	private authorization: StartupAuthorization | null = null;
	private revision = 0;
	/** Serializes every durable step: a late scope write must never land after a
	 *  tombstone, and a credential write must finish before a sign-out clears. */
	private tail: Promise<unknown> = Promise.resolve();
	private readonly listeners = new Set<() => void>();
	private readonly cleanups = new Set<() => Promise<void>>();

	constructor(
		private readonly storage: StartupAuthorizationStorage,
		private readonly generation: () => Promise<string> = () => randomState(),
	) {}

	get = (): StartupAuthorization | null => this.authorization;
	getRevision = (): number => this.revision;
	isCurrent = (revision: number): boolean => revision === this.revision;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/** Storage owners (drafts, envelopes, coordinators) register here instead of
	 *  being imported by this module: that keeps the dependency pointing at the
	 *  hook rather than creating an auth/coordinator import cycle. */
	registerCleanup = (cleanup: () => Promise<void>): (() => void) => {
		this.cleanups.add(cleanup);
		return () => {
			this.cleanups.delete(cleanup);
		};
	};

	/** Synchronous, non-durable close. A remount may restore a persisted
	 *  generation; a privacy boundary MUST go through `revoke`/`retire` instead. */
	suspend(): number {
		this.authorization = null;
		this.revision += 1;
		for (const listener of this.listeners) listener();
		return this.revision;
	}

	/**
	 * Invalidates the generation without deleting anything, and resolves once the
	 * invalidation is durable. The drafts stay on disk, unreachable from any later
	 * generation: a token that lapsed is not permission to destroy the reader's
	 * unfinished sentence (`docs/ux/flows.md` § C5).
	 */
	revoke(afterRevoke?: () => Promise<void>): Promise<void> {
		this.suspend();
		return this.enqueue(async () => {
			const outcomes = await Promise.allSettled([
				this.storage.write({ version: 1, state: "revoked" }),
				afterRevoke?.() ?? Promise.resolve(),
			]);
			const failures = outcomes.flatMap((outcome) =>
				outcome.status === "rejected" ? [outcome.reason] : [],
			);
			if (failures.length === 1) throw failures[0];
			if (failures.length > 1)
				throw new AggregateError(
					failures,
					"Authorization revocation could not be confirmed",
				);
		});
	}

	/**
	 * The explicit privacy boundary. Every deletion is attempted even when an
	 * earlier one fails — a refused draft purge must not abandon the credential
	 * wipe beside it — and the joined rejection keeps admission closed.
	 *
	 * `preserveUnscoped` covers first run after upgrade: with no record at all,
	 * nothing is owned yet, so legacy unscoped drafts are left quarantined rather
	 * than wiped on an upgrade the reader never asked for. Once a record exists,
	 * an explicit login IS an identity boundary and the purge runs.
	 */
	retire(
		preserveUnscoped = false,
		afterCleanup?: () => Promise<void>,
	): Promise<void> {
		this.suspend();
		return this.enqueue(async () => {
			if (preserveUnscoped && (await this.storage.read()) === null) return;
			const outcomes = await Promise.allSettled([
				this.storage.write({ version: 1, state: "tombstone" }),
				this.cleanup(),
				afterCleanup?.() ?? Promise.resolve(),
			]);
			const failures = outcomes.flatMap((outcome) =>
				outcome.status === "rejected" ? [outcome.reason] : [],
			);
			if (failures.length === 1) throw failures[0];
			if (failures.length > 1)
				throw new AggregateError(
					failures,
					"Authorization retirement could not be confirmed",
				);
		});
	}

	/**
	 * Admits a route that authentication has already proven, with the revision the
	 * caller captured before it started. Returns the generation in force, or
	 * `null` when a newer action superseded this one.
	 *
	 * A persisted generation is reused ONLY for the exact same validated route
	 * descriptor (an authorized app restart). Anything else — a different server,
	 * or a prior revoke — mints a fresh generation, so work recorded under the old
	 * one is never adopted by the new identity. A `tombstone` record means a purge
	 * was owed, so that purge is completed before the new generation exists.
	 */
	admit(route: string, revision: number): Promise<StartupAuthorization | null> {
		const work = this.tail.then(async () => {
			if (!this.isCurrent(revision)) return null;
			let record = await this.storage.read();
			if (!this.isCurrent(revision)) return null;
			if (record?.state === "tombstone") {
				await this.cleanup();
				record = null;
			}
			if (record?.state === "active" && record.route !== route) {
				// Identity/server change on a still-authorized generation: this is a
				// privacy boundary, so the old owner's drafts go with it.
				await this.storage.write({ version: 1, state: "tombstone" });
				await this.cleanup();
				record = null;
			}
			if (!this.isCurrent(revision)) return null;
			if (record?.state !== "active") {
				const generation = await this.generation();
				if (!this.isCurrent(revision)) return null;
				record = { version: 1, state: "active", generation, route };
				await this.storage.write(record);
			}
			if (!this.isCurrent(revision) || record.state !== "active") return null;
			/* Admission is the ONLY moment private writes reopen: a purge that ran at
			 * sign-out closed them, and nothing may write for a scope that no longer
			 * has an owner. */
			reopenPrivateWrites();
			reopenDispatch();
			this.authorization = Object.freeze({
				scope: record.generation,
				revision,
			});
			for (const listener of this.listeners) listener();
			return this.authorization;
		});
		this.tail = work;
		return work;
	}

	/**
	 * Runs a credential write inside the same fence: a late OAuth handoff cannot
	 * recreate credentials after sign-out, and a write already running finishes
	 * BEFORE the clear that a retirement queued — in that order, on one chain.
	 */
	runIfCurrent<T>(
		revision: number,
		operation: () => Promise<T>,
	): Promise<T | undefined> {
		const work = this.tail.then(() =>
			this.isCurrent(revision) ? operation() : undefined,
		);
		this.tail = work;
		return work;
	}

	/** Only an EXPLICIT, verified login may turn retained credentials into restore
	 * authority again. The caller first awaits its privacy retirement; this runs
	 * on that same tail, not a bypass around it. The durable writer reports proof
	 * (not merely that a platform write was attempted). If killed before the final
	 * record write, the tombstone still refuses restore — conservative, not a
	 * silent re-adoption of the signed-out account. `revoked` opens no live scope;
	 * normal route authentication/admit still owns that decision.
	 *
	 * Check both sides of persistence: a newer sign-out suspends synchronously
	 * while its tombstone write queues behind us. Never acknowledge that newer
	 * boundary, even when the previous login's write was already in storage. */
	replaceCredentialsIfCurrent(
		revision: number,
		persist: () => Promise<boolean>,
	): Promise<boolean> {
		const work = this.tail.then(async () => {
			if (!this.isCurrent(revision)) return false;
			if (!(await persist()) || !this.isCurrent(revision)) return false;
			await this.storage.write({ version: 1, state: "revoked" });
			return this.isCurrent(revision);
		});
		this.tail = work;
		return work;
	}

	/** One durable step at a time, and a rejected step never blocks the next
	 *  explicit retry — `retire`/`revoke` are the user's own actions, so they may
	 *  replace a failed one. `admit` deliberately does NOT catch: an unrepaired
	 *  failure keeps admission closed. */
	private enqueue(step: () => Promise<void>): Promise<void> {
		const work = this.retryable().then(step);
		this.tail = work;
		return work;
	}

	private retryable(): Promise<void> {
		return this.tail.then(
			() => undefined,
			() => undefined,
		);
	}

	private async cleanup(): Promise<void> {
		// Every owner runs even if one fails; the joined rejection is the signal.
		const results = await Promise.allSettled(
			[...this.cleanups].map((cleanup) => Promise.resolve().then(cleanup)),
		);
		for (const result of results) {
			if (result.status === "rejected") throw result.reason;
		}
	}
}

/** Injected by the credential-storage owner (`features/auth/tunnel-storage`), so
 *  this module never imports the platform keystore itself. */
let persistence: StartupAuthorizationStorage | null = null;

export function configureStartupAuthorizationStorage(
	storage: StartupAuthorizationStorage,
): void {
	persistence = storage;
}

function configured(): StartupAuthorizationStorage {
	if (!persistence)
		throw new Error("Startup authorization storage is not configured");
	return persistence;
}

export const startupAuthorizationLifecycle = new StartupAuthorizationLifecycle({
	read: () => configured().read(),
	write: (record) => configured().write(record),
});

export const getStartupAuthorization = startupAuthorizationLifecycle.get;
export const subscribeStartupAuthorization =
	startupAuthorizationLifecycle.subscribe;
export const registerStartupAuthorizationCleanup =
	startupAuthorizationLifecycle.registerCleanup;
/** Explicit privacy boundary (sign-out, forget route). Dispatch closes
 *  synchronously; await the promise to verify the deletions. */
export const retireStartupAuthorization = (): Promise<void> =>
	startupAuthorizationLifecycle.retire();
/** Authentication failure or uncertain boundary: invalidate, delete nothing. */
export const revokeStartupAuthorization = (): Promise<void> =>
	startupAuthorizationLifecycle.revoke();
