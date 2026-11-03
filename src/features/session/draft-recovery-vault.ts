export interface RecoveryStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
	keys?(): Promise<string[]>;
}
/** Recovery is draft text/images only. The vault never sees a continuation
 * envelope, session-creation state, dispatch generation or a send callback. */
export class DraftRecoveryVault {
	private authority: string | null = null;
	private epoch = 0;
	private tail: Promise<unknown> = Promise.resolve();
	private current: () => boolean = () => false;
	private erasureFailed = false;
	/** Failed accepted edits stay in RAM only. Reauthentication must commit them
	 * before ordinary-generation cleanup; never write a plaintext retry cache. */
	private readonly failedWrites = new Map<string, () => Promise<void>>();
	constructor(
		private readonly store: RecoveryStore,
		private readonly erase: () => Promise<void>,
		private readonly now: () => number = Date.now,
		private readonly maxAge = 7 * 24 * 60 * 60 * 1000,
	) {}
	available = (): boolean =>
		this.authority !== null && this.current() && this.failedWrites.size === 0;
	authorityScope = (): string | null =>
		this.available() ? this.authority : null;
	withdraw = (): void => {
		this.authority = null;
		this.epoch++;
		this.current = () => false;
	};
	drain = async (): Promise<void> => {
		await Promise.allSettled([this.tail]);
		if (this.failedWrites.size === 0) return;
		await this.run(async () => {
			const errors: unknown[] = [];
			for (const [key, retry] of this.failedWrites) {
				try {
					await retry();
					if (this.failedWrites.get(key) === retry)
						this.failedWrites.delete(key);
				} catch (error) {
					errors.push(error);
				}
			}
			if (errors.length) throw errors[0];
		});
	};

	/** Serialized with accepted writes. A late proof can never reopen the vault
	 * after route/account change; a new tuple first erases the prior key+bytes. */
	prepare(authority: string, isCurrent: () => boolean): Promise<boolean> {
		const epoch = this.epoch;
		return this.run(async () => {
			if (this.erasureFailed)
				throw new Error("private cleanup requires an explicit retry");
			if (this.failedWrites.size > 0)
				throw new Error("draft checkpoint must complete before admission");
			if (epoch !== this.epoch || !isCurrent()) return false;
			const prior = await this.store.get("authority");
			if (epoch !== this.epoch || !isCurrent()) return false;
			if (prior !== null && prior !== authority) {
				this.erasureFailed = true;
				await this.erase();
				this.erasureFailed = false;
			}
			if (epoch !== this.epoch || !isCurrent()) return false;
			await this.store.set("authority", authority);
			if (epoch !== this.epoch || !isCurrent()) return false;
			this.authority = authority;
			this.current = isCurrent;
			return true;
		});
	}

	async read(key: string): Promise<string | null> {
		const authority = this.authority;
		const epoch = this.epoch;
		if (!authority || !this.current()) return null;
		await this.drain();
		if (this.failedWrites.has(this.key(authority, key))) return null;
		const raw = await this.store.get(this.key(authority, key));
		if (!raw || epoch !== this.epoch || !this.current()) return null;
		const record: unknown = JSON.parse(raw);
		if (
			typeof record !== "object" ||
			record === null ||
			!("version" in record) ||
			record.version !== 1 ||
			!("savedAt" in record) ||
			typeof record.savedAt !== "number" ||
			!Number.isFinite(record.savedAt) ||
			!("value" in record) ||
			typeof record.value !== "string"
		)
			throw new Error("recovery draft is unreadable");
		if (
			record.savedAt > this.now() ||
			this.now() - record.savedAt > this.maxAge
		) {
			await this.remove(key);
			return null;
		}
		return epoch === this.epoch && this.current() ? record.value : null;
	}
	write(key: string, value: string): Promise<void> {
		if (value.length > 16 * 1024 * 1024)
			return Promise.reject(new Error("recovery draft capacity reached"));
		const authority = this.authority;
		if (!authority || !this.current()) return Promise.resolve();
		// Capture the authorized destination before enqueueing. Withdrawal stops new
		// writes but drains already-accepted writes into that OLD sealed destination.
		const destination = this.key(authority, key);
		const record = JSON.stringify({ version: 1, savedAt: this.now(), value });
		return this.checkpoint(destination, () =>
			this.store.set(destination, record),
		);
	}
	remove(key: string): Promise<void> {
		const authority = this.authority;
		if (!authority || !this.current()) return Promise.resolve();
		const destination = this.key(authority, key);
		return this.checkpoint(destination, () => this.store.remove(destination));
	}
	/** Retirement-only write capability. The tuple comes from the generation's
	 * persisted last proof, NOT from a caller's display/account hint. It never
	 * opens read authority. Failed replacement falls back to deleting stale data;
	 * failed deletion rejects so the ordinary last copy must not be purged. */
	checkpointRetiring(
		authority: string | null,
		key: string,
		value: string | null,
	): Promise<void> {
		return this.run(async () => {
			let prior: string | null = null;
			try {
				prior = await this.store.get("authority");
			} catch {
				/* Only blind deletion is safe without readable comparison metadata. */
			}
			if (authority !== null && prior === authority) {
				const destination = this.key(authority, key);
				this.failedWrites.delete(destination);
				try {
					if (value === null) await this.store.remove(destination);
					else
						await this.store.set(
							destination,
							JSON.stringify({ version: 1, savedAt: this.now(), value }),
						);
					return;
				} catch {
					/* Never retain the superseded value as a fallback. */
				}
			}
			const destinations = new Set<string>();
			if (authority !== null) destinations.add(this.key(authority, key));
			if (prior !== null) destinations.add(this.key(prior, key));
			if (this.store.keys)
				for (const candidate of await this.store.keys()) {
					try {
						const pair: unknown = JSON.parse(candidate);
						if (Array.isArray(pair) && pair.length === 2 && pair[1] === key)
							destinations.add(candidate);
					} catch {
						/* The authority header is not a draft key. */
					}
				}
			else if (destinations.size === 0)
				throw new Error("cannot verify stale recovery deletion");
			for (const destination of destinations) {
				this.failedWrites.delete(destination);
				try {
					await this.store.remove(destination);
				} catch (error) {
					this.erasureFailed = true;
					throw error;
				}
			}
		});
	}
	clear(): Promise<void> {
		this.withdraw();
		this.erasureFailed = true;
		return this.run(async () => {
			// Serialized after accepted writes, and before any later preparation.
			// A failed erase is a sticky recovery fence until explicit retry.
			this.failedWrites.clear();
			await this.erase();
			this.erasureFailed = false;
		});
	}
	private checkpoint(key: string, write: () => Promise<void>): Promise<void> {
		return this.run(async () => {
			try {
				await write();
				this.failedWrites.delete(key);
			} catch (error) {
				this.failedWrites.set(key, write);
				throw error;
			}
		});
	}
	private key(authority: string, key: string): string {
		return JSON.stringify([authority, key]);
	}
	private run<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.tail.catch(() => undefined).then(operation);
		this.tail = next;
		return next;
	}
}
