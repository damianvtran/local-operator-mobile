import type { PromptImage } from "@/contracts";
import type { StartSessionRequest } from "@/relay/endpoints";
import {
	type ContinuationEnvelope,
	isValidEnvelope,
} from "@/relay/retry-envelope";

export type StartupPhase =
	| "draft"
	| "starting"
	| "ready"
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
const SAVE_FAILED =
	"Could not save this conversation. Your message is still here; nothing new was sent.";
const UNCONFIRMED =
	"Could not confirm that the conversation started. Your queued messages have not been sent. Check Conversations before starting another.";

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
		// A selected target is immutable once creation is in progress or a SID exists.
		if (
			this.record.sessionId !== null ||
			this.record.phase !== "draft" ||
			(!replace && this.record.selection !== null) ||
			JSON.stringify(this.record.selection) === JSON.stringify(selection)
		)
			return;
		if (
			await this.persist((record) => ({
				...record,
				selection: copy(selection),
			}))
		)
			this.kick();
	}

	async enqueue() {
		if (this.revoked || this.reservedRevision === this.draftRevision) return;
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
			this.flight ||
			!this.allowed() ||
			this.record.queue.length === 0 ||
			this.record.phase === "blocked" ||
			this.record.phase === "unconfirmed"
		)
			return;
		this.flight = Promise.resolve()
			.then(() => this.drain())
			.finally(() => {
				this.flight = null;
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
			} catch {
				await this.persist((record) => ({ ...record, phase: "unconfirmed" }));
				this.publish({ error: UNCONFIRMED });
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
			} catch {
				await this.persist((record) => ({ ...record, phase: "blocked" }));
				this.publish({
					error:
						"Could not confirm message delivery. Retry keeps the same message identity; later messages are waiting.",
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

	async retry() {
		await this.ready;
		if (!this.allowed() || this.record.phase === "unconfirmed") return;
		if (
			this.record.sessionId !== null &&
			(await this.persist((record) => ({ ...record, phase: "ready" })))
		) {
			this.publish({ error: null });
			this.kick();
		} else if (this.record.phase === "draft") this.kick();
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
		["draft", "starting", "ready", "unconfirmed", "blocked"].includes(
			value.phase,
		) &&
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
