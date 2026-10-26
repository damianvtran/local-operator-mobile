import type { PromptImage } from "@/contracts";
import type { StartSessionRequest } from "@/relay/endpoints";
import { isRelayError } from "@/relay/errors";
import {
	type ContinuationEnvelope,
	isValidEnvelope,
} from "@/relay/retry-envelope";

export type StartupPhase =
	| "draft"
	| "starting"
	| "ready"
	/* A DEFINITE refusal of the create (the relay answered, nothing was made): the
	 * queue survives and the reader may correct the selection and send again —
	 * unlike `unconfirmed`, which means no answer arrived and a second POST could
	 * make a second conversation. */
	| "refused"
	| "unconfirmed"
	| "blocked";
export type StartupDraft = { text: string; images: PromptImage[] };
export type StartupRecord = {
	version: 1;
	scope: string;
	phase: StartupPhase;
	sessionId: string | null;
	selection: StartSessionRequest | null;
	draft: StartupDraft;
	queue: ContinuationEnvelope[];
};
export type StartupSnapshot = StartupRecord & {
	error: string | null;
	loaded: boolean;
};
export type StartupDeps = {
	store: {
		load(): Promise<StartupRecord | null>;
		save(record: StartupRecord): Promise<void>;
	};
	start(selection: StartSessionRequest): Promise<{ session_id: string }>;
	send(sessionId: string, message: ContinuationEnvelope): Promise<void>;
	isCurrent(): boolean;
	uuid(): string;
};

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** What a failure means for work already committed to the outbox.
 *
 *  This does NOT re-derive anything from status codes: `RelayError.envelope` is
 *  the decision `errors.ts` already made for every kind, and a second table here
 *  is exactly how the two drift apart. Three outcomes matter to the coordinator:
 *
 *   - `definitive` — the relay answered and refused (`clear`): nothing landed, so
 *     the work must become actionable again rather than sit in a HOLD.
 *   - `unauthorized` — the owning identity is gone (`clear-all`): stop, keep the
 *     bytes inaccessible, and let reauthentication mint its own generation.
 *   - `ambiguous` — no usable answer (`keep`): the command may or may not have
 *     been admitted, so the same immutable ID is the only safe replay.
 */
export type FailureClass = "definitive" | "unauthorized" | "ambiguous";

export const classifyFailure = (error: unknown): FailureClass => {
	if (!isRelayError(error)) return "ambiguous";
	if (error.envelope === "clear") return "definitive";
	if (error.envelope === "clear-all") return "unauthorized";
	return "ambiguous";
};

/** The relay's own sentence when it has one, and never a status code. */
const failureMessage = (error: unknown, fallback: string): string =>
	isRelayError(error) && error.displayableMessage.trim() !== ""
		? error.displayableMessage
		: error instanceof Error && error.message.trim() !== ""
			? error.message
			: fallback;
const SAVE_FAILED =
	"Could not save this conversation. Your message is still here; nothing new was sent.";
const REFUSED =
	"The relay refused to start this conversation. Check the folder and model, then send again.";
const SEND_REFUSED =
	"The relay refused that message, so it is back in your draft.";
const UNAUTHORIZED =
	"Sign in again to send this. Your draft has not been sent.";
const BLOCKED =
	"Could not confirm message delivery. Retry keeps the same message identity; later messages are waiting.";
const UNCONFIRMED =
	"Could not confirm that the conversation started. Your queued messages have not been sent. Check Conversations before starting another.";
/** A send while the start is unconfirmed would join a queue nothing can drain:
 *  there is no session id to address and the create is terminal until a person
 *  reconciles it. Say so and keep the text in the editor instead (UX U1). */
const QUEUE_BUSY =
	"A message is being sent right now. Try again when it finishes.";
const UNCONFIRMED_SEND =
	"This conversation was never confirmed as started, so nothing was queued. Your message is still in the editor — copy it before starting a new session, which opens an empty draft.";

/** One owner per authorization scope. The durable outbox, not the retry helper's
 * expiring slot, owns message identity. Every admission is committed before its
 * network effect; no queued operation is inferred from unsubmitted editor text.
 * Legacy creation has no idempotency key, so a pending/unknown create is terminal
 * until a person reconciles it. Never guess a session from the latest listing. */
export class StartupCoordinator {
	readonly ready: Promise<void>;
	private record: StartupRecord;
	private value: StartupSnapshot;
	private draftRevision = 0;
	private reservedRevision = -1;
	private tail: Promise<void> = Promise.resolve();
	private flight: Promise<void> | null = null;
	private pendingKick = false;
	private listeners = new Set<() => void>();
	private active = true;
	private revoked = false;
	private unreadable = false;
	private epoch = 0;

	constructor(
		private readonly scope: string,
		private deps: StartupDeps,
	) {
		this.record = {
			version: 1,
			scope,
			phase: "draft",
			sessionId: null,
			selection: null,
			draft: { text: "", images: [] },
			queue: [],
		};
		this.value = { ...this.record, error: null, loaded: false };
		this.ready = this.restore();
	}

	snapshot = (): StartupSnapshot => this.value;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private publish(patch: Partial<StartupSnapshot> = {}) {
		this.value = { ...this.value, ...patch };
		for (const listener of this.listeners) listener();
	}

	private async restore() {
		try {
			const saved = await this.deps.store.load();
			if (this.revoked) return;
			if (saved !== null) {
				if (!validRecord(saved, this.scope))
					throw new Error("invalid startup record");
				this.record = copy(saved);
				// A process may have died after the POST but before saving the SID.
				if (this.record.phase === "starting" && this.record.sessionId === null)
					this.record.phase = "unconfirmed";
				this.publish({
					...this.record,
					draft:
						this.draftRevision === 0 ? this.record.draft : this.value.draft,
					error: this.record.phase === "unconfirmed" ? UNCONFIRMED : null,
				});
			}
		} catch {
			// Corrupt/foreign state is not an empty form. Never overwrite its bytes.
			this.unreadable = true;
			this.publish({
				error:
					"Could not restore this conversation safely. No messages will be sent.",
			});
		} finally {
			this.publish({ loaded: true });
		}
	}

	/** Each storage transaction captures the latest editor, not the editor that
	 * happened to exist before an earlier asynchronous write completed. */
	private persist(
		transform: (record: StartupRecord) => StartupRecord,
	): Promise<boolean> {
		let success = false;
		const operation = this.tail.then(async () => {
			await this.ready;
			if (this.unreadable || this.revoked) return;
			const next = transform(copy({ ...this.record, draft: this.value.draft }));
			try {
				await this.deps.store.save(next);
				if (this.revoked) return;
				this.record = next;
				this.publish({ ...next, draft: this.value.draft });
				success = true;
			} catch {
				this.publish({ error: SAVE_FAILED });
			}
		});
		this.tail = operation;
		return operation.then(() => success);
	}

	edit(text: string, images: PromptImage[]) {
		if (this.revoked) return;
		this.draftRevision += 1;
		this.publish({ draft: copy({ text, images }) });
		void this.persist((record) => record);
	}

	async configure(selection: StartSessionRequest, replace = false) {
		await this.ready;
		/* A selected target is immutable once creation is in progress or a SID exists.
		 * `refused` is neither: the relay answered "no", so nothing was created and the
		 * reader is correcting a request that never happened. It is therefore treated
		 * as editable and returns to `draft` — otherwise the copy told them to check
		 * the folder while every control that could change it stayed disabled (QA). */
		const editable =
			this.record.phase === "draft" || this.record.phase === "refused";
		if (
			this.record.sessionId !== null ||
			!editable ||
			(!replace && this.record.selection !== null) ||
			JSON.stringify(this.record.selection) === JSON.stringify(selection)
		)
			return;
		if (
			await this.persist((record) => ({
				...record,
				phase: "draft",
				selection: copy(selection),
			}))
		)
			this.kick();
	}

	async enqueue() {
		if (this.revoked || this.reservedRevision === this.draftRevision) return;
		/* Nothing may be added to a queue that cannot drain. An unconfirmed create
		 * has no session id and no automatic recovery (`retry()` refuses it), so an
		 * append here is the trap UX U1 found: Send looked enabled and silently
		 * stacked text that could never leave. The draft stays the reader's. */
		if (this.record.phase === "unconfirmed" && this.record.sessionId === null) {
			this.publish({ error: UNCONFIRMED_SEND });
			return;
		}
		const draft = copy(this.value.draft);
		if (draft.text.trim() === "" && draft.images.length === 0) return;
		if (this.record.queue.length >= 64) {
			this.publish({ error: "The queue is full. Your draft is still here." });
			return;
		}
		const revision = this.draftRevision;
		this.reservedRevision = revision;
		const envelope: ContinuationEnvelope = {
			op: "prompt",
			command_id: this.deps.uuid(),
			text: draft.text,
			...(draft.images.length ? { images: draft.images } : {}),
		};
		const saved = await this.persist((record) => ({
			...record,
			queue: [...record.queue, envelope],
			draft:
				revision === this.draftRevision
					? { text: "", images: [] }
					: this.value.draft,
		}));
		if (!saved) {
			if (this.reservedRevision === revision) this.reservedRevision = -1;
			return;
		}
		if (revision === this.draftRevision) {
			this.draftRevision += 1;
			this.publish({ draft: { text: "", images: [] } });
		}
		this.kick();
	}

	private allowed(epoch = this.epoch) {
		return (
			epoch === this.epoch &&
			this.active &&
			!this.revoked &&
			!this.unreadable &&
			this.deps.isCurrent()
		);
	}
	bind(deps: StartupDeps) {
		this.epoch += 1;
		this.deps = deps;
		this.active = true;
	}
	private kick() {
		if (
			!this.allowed() ||
			this.record.queue.length === 0 ||
			this.record.phase === "blocked" ||
			this.record.phase === "unconfirmed"
		)
			return;
		/* A tap that arrives while a drain is still unwinding must not be dropped:
		 * Retry right after a refusal is the common case, and the drain that was
		 * running has already decided its outcome. Remember the request and re-run
		 * once the current flight settles. */
		if (this.flight) {
			this.pendingKick = true;
			return;
		}
		this.flight = Promise.resolve()
			.then(() => this.drain())
			.finally(() => {
				this.flight = null;
				if (this.pendingKick) {
					this.pendingKick = false;
					this.kick();
				}
			});
	}
	private async drain() {
		const epoch = this.epoch;
		const deps = this.deps;
		if (!this.allowed(epoch)) return;
		if (this.record.sessionId === null) {
			const selection = this.record.selection;
			if (selection === null) return;
			if (!(await this.persist((record) => ({ ...record, phase: "starting" }))))
				return;
			if (!this.allowed(epoch)) return;
			let sessionId: string;
			try {
				sessionId = (await deps.start(copy(selection))).session_id;
			} catch (failure) {
				const outcome = classifyFailure(failure);
				if (outcome === "definitive") {
					// The relay refused the request itself: nothing exists, so the queue
					// stays and the selection becomes correctable again.
					await this.persist((record) => ({ ...record, phase: "refused" }));
					this.publish({
						error: failureMessage(failure, REFUSED),
					});
					return;
				}
				// Unauthorized and ambiguous both stop automatic work; only the ambiguous
				// case is a permanent HOLD, because only it could have created something.
				await this.persist((record) => ({
					...record,
					phase: outcome === "unauthorized" ? "blocked" : "unconfirmed",
				}));
				this.publish({
					error: outcome === "unauthorized" ? UNAUTHORIZED : UNCONFIRMED,
				});
				return;
			}
			// Late completion may save its own SID, but cannot navigate or dispatch in
			// a replaced scope. Explicit privacy revocation forbids even that write.
			if (
				!(await this.persist((record) => ({
					...record,
					sessionId,
					phase: "ready",
				})))
			)
				return;
		}
		while (
			this.allowed(epoch) &&
			this.record.sessionId !== null &&
			this.record.queue.length > 0
		) {
			const message = this.record.queue[0];
			if (!message) return;
			try {
				await deps.send(this.record.sessionId, copy(message));
			} catch (failure) {
				const outcome = classifyFailure(failure);
				if (outcome === "definitive") {
					/* The relay answered "no" about THIS command. Replaying it would be a
					 * lie about delivery and would stall everything behind it, so the item
					 * leaves the queue and its bytes go back to the editor the reader owns. */
					const restored =
						this.record.draft.text.trim() === "" &&
						this.record.draft.images.length === 0
							? {
									text: message.text,
									images: message.images ? copy(message.images) : [],
								}
							: null;
					if (
						await this.persist((record) => ({
							...record,
							queue: record.queue.filter(
								(entry) => entry.command_id !== message.command_id,
							),
							draft: restored ?? record.draft,
						}))
					) {
						this.publish({
							...(restored ? { draft: restored } : {}),
							error: failureMessage(failure, SEND_REFUSED),
						});
					}
					continue;
				}
				await this.persist((record) => ({ ...record, phase: "blocked" }));
				this.publish({
					error: outcome === "unauthorized" ? UNAUTHORIZED : BLOCKED,
				});
				return;
			}
			// If this commit fails, the same immutable ID remains the retry authority.
			if (
				!(await this.persist((record) => ({
					...record,
					queue: record.queue.filter(
						(entry) => entry.command_id !== message.command_id,
					),
				})))
			) {
				this.record.phase = "blocked";
				this.publish({ phase: "blocked" });
				return;
			}
			this.publish({ error: null });
		}
	}

	/** The reader's way out of a queue nothing can drain. Every queued message
	 *  returns to the editor it came from — text joined in arrival order, images in
	 *  the same order — and the queue is cleared in the same committed transaction,
	 *  so one message can never be both "queued" and "in the editor". */
	async restoreQueueToDraft(): Promise<boolean> {
		await this.ready;
		if (!this.allowed() || this.record.queue.length === 0) return false;
		/* A drain owns the queue head while it is in flight: moving or dropping the
		 * queue under it let an admitted message be re-sent under a new id (duplicate
		 * delivery) or lost with no id to reconcile (R11-1). Refusing is honest and
		 * immediate; the reader can act the moment the flight settles. */
		if (this.flight !== null) {
			this.publish({ error: QUEUE_BUSY });
			return false;
		}
		/* The merge is computed INSIDE the transaction, against the record's draft at
		 * execution time: the editor may have been typed into while this awaited the
		 * persistence tail, and merging a stale snapshot would silently drop it. */
		const revision = this.draftRevision;
		let merged: StartupDraft | null = null;
		const saved = await this.persist((record) => {
			const held = record.queue.map((message) => copy(message));
			const text = [record.draft.text, ...held.map((message) => message.text)]
				.filter((part) => part.trim() !== "")
				.join("\n\n");
			const images = [
				...record.draft.images,
				...held.flatMap((message) => message.images ?? []),
			].map((image) => copy(image));
			merged = { text, images };
			return { ...record, queue: [], draft: { text, images } };
		});
		if (!saved || merged === null) return false;
		if (revision === this.draftRevision) {
			// Only repaint the editor if nobody typed during the transaction; a newer
			// keystroke is the reader's, and the next edit persists it over this merge.
			this.draftRevision += 1;
			this.publish({ draft: merged });
		}
		return true;
	}

	/** Explicit discard. Queued bytes are the reader's; they go only when said so. */
	async discardQueue(): Promise<boolean> {
		await this.ready;
		if (!this.allowed() || this.record.queue.length === 0) return false;
		if (this.flight !== null) {
			this.publish({ error: QUEUE_BUSY });
			return false;
		}
		return this.persist((record) => ({ ...record, queue: [] }));
	}

	async retry() {
		await this.ready;
		if (!this.allowed() || this.record.phase === "unconfirmed") return;
		if (
			this.record.sessionId !== null &&
			(await this.persist((record) => ({ ...record, phase: "ready" })))
		) {
			this.publish({ error: null });
			this.kick();
		} else if (
			this.record.phase === "draft" ||
			this.record.phase === "refused"
		) {
			/* A refused create is retryable: nothing was made, so this is a NEW attempt
			 * with the selection as it stands, not a replay of an unknown outcome. */
			if (this.record.phase === "refused")
				await this.persist((record) => ({ ...record, phase: "draft" }));
			this.publish({ error: null });
			this.kick();
		}
	}
	pause() {
		this.active = false;
		this.epoch += 1;
	}
	resume() {
		this.active = true;
		this.kick();
	}
	/** Stop writes before the auth owner purges storage. A late HTTP response must
	 * not recreate private data after sign-out's cleanup completed. */
	revoke() {
		this.revoked = true;
		this.active = false;
		this.publish({ draft: { text: "", images: [] }, queue: [], error: null });
	}
	async flush() {
		await this.ready;
		await this.tail;
	}
	/**
	 * "Nothing of mine is still running": the persistence tail AND the drain.
	 *
	 * Separate from `flush()` on purpose. `flush()` is the persistence barrier the
	 * typing path uses while a create may legitimately still be in flight; a
	 * retirement that waited on it would be wrong to redefine. This is the one
	 * retirement awaits before the purge (review round 2, R1-4: `flush()` alone
	 * reported quiescence with `client.command` still open).
	 */
	async quiesce() {
		await this.ready;
		await this.flight;
		await this.tail;
	}
	async settled() {
		await this.flush();
		await this.flight;
		await this.tail;
	}
}

function validRecord(value: StartupRecord, scope: string): boolean {
	return (
		value.version === 1 &&
		value.scope === scope &&
		[
			"draft",
			"starting",
			"ready",
			"refused",
			"unconfirmed",
			"blocked",
		].includes(value.phase) &&
		(value.sessionId === null ||
			(typeof value.sessionId === "string" && value.sessionId.length > 0)) &&
		(value.selection === null ||
			(typeof value.selection.cwd === "string" &&
				value.selection.cwd.length > 0)) &&
		typeof value.draft?.text === "string" &&
		Array.isArray(value.draft.images) &&
		Array.isArray(value.queue) &&
		value.queue.length <= 64 &&
		value.queue.every(isValidEnvelope)
	);
}
