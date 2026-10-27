/**
 * The computers this phone knows: a persisted, keyed registry.
 *
 * Why it exists. Until now the keystore held exactly one item per CONCERN
 * (`SECURE_KEYS` in `./storage.ts`): one Radient grant, one tunnel session, one
 * custom route. That is one custom computer and one Radient computer at most, and
 * the picker's list lived only in memory, refreshed by discovery — so "Remove" on a
 * Radient computer filtered a list the next discovery refresh rebuilt, and the
 * computer came back. This registry is the durable list a reader can shape:
 * any mix of Radient and custom computers, each with a stable local id, and a
 * `hidden` flag that discovery cannot override. It is also the foundation a
 * computer switcher builds on; nothing here assumes there is only one.
 *
 * Constraints this module keeps, and why:
 *
 * - **Metadata only, never a secret.** A password, a grant and a refresh handle
 *   stay in the single-value slots `./storage.ts` already owns, under the rules
 *   that file states (one concern per item, cleared by sign-out). Copying a secret
 *   here would put it in a second place that sign-out and the corrupt-item rules
 *   do not cover. An entry says WHERE a computer is and what the reader calls it.
 * - **One keystore item per entry, plus an index.** The same reason `./storage.ts`
 *   keeps one item per concern: iOS has historically refused values over
 *   `MAX_SECURE_VALUE_CHARS`, and a corrupt item must cost one computer, not the
 *   list. Sixteen entries in one blob could exceed the cap; one entry cannot.
 * - **Bounded.** `MAX_SAVED_COMPUTERS` caps the list so the index stays far
 *   under the cap and an unbounded discovery feed cannot grow the keystore.
 * - **No copy of the custom slot, yet.** The reader's own tunnel stays in the
 *   single `lop.mobile.custom` slot `./storage.ts` owns, and this registry does
 *   NOT seed itself from it. A seeded entry would be a snapshot nothing keeps in
 *   sync: saving, forgetting or signing out changes the slot, not the copy, so
 *   the registry would keep an address the reader asked the app to forget. The
 *   custom transport and `updateAddress` exist so the switcher slice can make
 *   the registry the owner of custom computers, writing through on every save,
 *   forget and sign-out in one place — not a one-shot copy here.
 * - **Identity is the computer's key, never its address.** A VPN, a Wi-Fi to
 *   cellular hop, a new IP or a re-pointed custom URL is the SAME computer, so an
 *   entry's local `id`, timestamps and `hidden` flag never derive from
 *   `baseUrl` or `hostname`, and `updateAddress` changes an address in place.
 *   `identity.key_fingerprint` is reserved for the key that will prove it (pinning
 *   is a later slice); it is `null` on every entry today.
 * - **Secure store, though nothing here is secret.** Hostnames and addresses are
 *   still personal, and the keystore keeps them out of a plain file, which is
 *   what AsyncStorage would be. It does NOT add a per-device accessibility class
 *   today: `tunnel-storage.ts` builds this registry, like the credential slots,
 *   without `keychainAccessible`, so every item gets expo-secure-store's default
 *   (`WHEN_UNLOCKED`, which an encrypted backup can carry to another device).
 *   That gap predates this module and is shared with the credential slots; the
 *   option is plumbed through so fixing it for both is one change.
 */

import {
	MAX_SECURE_VALUE_CHARS,
	SecureStorageError,
	type SecureStoreAdapter,
	type SecureStoreOptions,
} from "./storage";

/** The index item: the ordered list of entry ids, oldest added first. A missing
 *  index is an empty registry; nothing is seeded from anywhere on a first read. */
export const SAVED_COMPUTERS_INDEX_KEY = "lop.mobile.computers";

/** The per-entry item prefix. `expo-secure-store` keys may hold only
 *  `[A-Za-z0-9._-]`, which is why ids are generated locally rather than taken
 *  from a tunnel id or a URL. */
export const SAVED_COMPUTER_KEY_PREFIX = "lop.mobile.computer.";

/** The most computers one phone remembers. Generous for a person's machines,
 *  and small enough that the index (~40 characters per id) stays far below
 *  `MAX_SECURE_VALUE_CHARS`. */
export const MAX_SAVED_COMPUTERS = 16;

/** A display name longer than this is truncated: a name is chosen by a person
 *  or a console, and an entry must never be refused for its label. */
export const MAX_DISPLAY_NAME_CHARS = 120;

/** The id alphabet: a subset of what `expo-secure-store` accepts in a key. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const TRAILING_SLASHES = /\/+$/;

/** What will identify a computer cryptographically. Reserved: nothing writes a
 *  fingerprint yet, and nothing here verifies one — pinning is a later slice. The
 *  field exists now so entries written by this build already have the shape. */
export interface ComputerIdentity {
	key_fingerprint?: string;
}

interface SavedComputerBase {
	/** Local, stable, opaque. Not an account or device identifier. */
	id: string;
	/** What the reader calls it. */
	name: string;
	/** Epoch ms. */
	addedAt: number;
	/** Epoch ms; ordering for a switcher and the eviction order at the bound. */
	lastUsedAt: number;
	/** The reader removed it. Discovery keeps reporting it; the app keeps it out
	 *  of every list and never reconnects to it on its own. */
	hidden: boolean;
	/** `null` until key pinning lands. See `ComputerIdentity`. */
	identity: ComputerIdentity | null;
}

export interface SavedRadientComputer extends SavedComputerBase {
	transport: "radient";
	tunnelId: string;
	/** The Radient tunnel origin, exactly as discovery issued it. */
	hostname: string;
	/**
	 * The Radient account the computer was used under: the account id (the OAuth
	 * `id_token`'s `sub`), opaque and never the email. `null` when it is not known —
	 * an entry written before this field existed, or a sign-in whose token response
	 * carried no id.
	 *
	 * Why it exists: signing in with a second Radient account does not clear this
	 * registry (only sign-out does), so without it account A's computers — names and
	 * hostnames, account-linked personal data — would be listed as this phone's under
	 * account B, probed, and offered for a mint B cannot authorise (PR #122 review
	 * round 1, M2). The switcher shows a saved Radient entry only when the signed-in
	 * account matches this key, or when that account's own discovery lists the tunnel.
	 */
	account: string | null;
}

export interface SavedCustomComputer extends SavedComputerBase {
	transport: "custom";
	baseUrl: string;
	allowInsecure: boolean;
}

export type SavedComputer = SavedRadientComputer | SavedCustomComputer;

export interface RadientComputerInput {
	tunnelId: string;
	hostname: string;
	/** Omitted when the caller does not know it (a pick made from a saved row that
	 *  discovery has not listed): the saved name is then kept, and only a computer
	 *  never named falls back to its hostname. A hostname must never overwrite a
	 *  name the reader already sees (PR #122 QA round 1, Q2). */
	name?: string;
	/** See `SavedRadientComputer.account`. Omitted (not `null`) when unknown, so a
	 *  key already recorded is kept rather than erased. */
	account?: string | null;
}

/** A remember whose `onlyIf` guard failed inside the serialised write: the route
 *  it describes ended, or sign-out cleared the registry, while the write queued. */
export class RegistryWriteFenced extends Error {
	override readonly name = "RegistryWriteFenced";
}

/** Options for a remember the caller may need to withdraw while it is queued. */
export interface RememberOptions {
	/** Checked INSIDE the serialised operation, after every write queued before it
	 *  (a sign-out's `clear()` included) has finished. False → nothing is written and
	 *  the call rejects with `RegistryWriteFenced` (PR #122 review round 1, m3). */
	onlyIf?: () => boolean;
}

export interface CustomComputerInput {
	/** The entry being re-saved, when the caller knows it. Matching by id is the
	 *  only match that survives an address change. */
	id?: string;
	baseUrl: string;
	allowInsecure: boolean;
	/** Defaults to the address's host, the one name the reader is sure to know. */
	name?: string;
}

export interface SavedComputersOptions {
	keychainAccessible?: string;
	now?: () => number;
	/** Injected so a test can pin ids. Must return `[A-Za-z0-9_-]+`. */
	newId?: () => string;
}

/**
 * The registry over a `SecureStoreAdapter`.
 *
 * Every mutation is serialised through one promise chain: each is a
 * read-modify-write of the index, and two screens acting at once (a Remove while
 * a connect records `lastUsedAt`) must not drop each other's change.
 */
export class SavedComputers {
	private readonly adapter: SecureStoreAdapter;
	private readonly options: SavedComputersOptions;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		adapter: SecureStoreAdapter,
		options: SavedComputersOptions = {},
	) {
		this.adapter = adapter;
		this.options = options;
	}

	/** Every entry, hidden ones included, most recently used first.
	 *
	 *  READ-ONLY, so tolerant: an entry whose keystore read throws is skipped and
	 *  the rest are returned. Failing the whole read instead would empty the
	 *  hidden set for the app run (every removed computer back) over one flaky
	 *  item, and a permanently unreadable item would do it on every start. Nothing
	 *  is written here, so skipping cannot drop the id from the index. */
	async list(): Promise<SavedComputer[]> {
		return this.serial(async () =>
			sortByUse(readable(await this.readSlots(), "list")),
		);
	}

	/** The entries a list or a switcher may show. */
	async visible(): Promise<SavedComputer[]> {
		return (await this.list()).filter((entry) => !entry.hidden);
	}

	/** The Radient tunnel ids the reader removed, for the connection store's
	 *  discovery filter. */
	async hiddenTunnelIds(): Promise<string[]> {
		return (await this.list())
			.filter(
				(entry): entry is SavedRadientComputer =>
					entry.hidden && entry.transport === "radient",
			)
			.map((entry) => entry.tunnelId);
	}

	/** Whether the app may reconnect to this entry WITHOUT a tap. A hidden
	 *  computer never qualifies: the reader removed it, and reconnecting to it
	 *  behind their back is the resurrection this flag exists to prevent. */
	static mayAutoReconnect(entry: SavedComputer): boolean {
		return !entry.hidden;
	}

	/** Adds or refreshes a Radient computer, keyed by tunnel id. A refresh keeps
	 *  the entry's id, timestamps and `hidden` flag: discovery reporting a
	 *  computer again is not the reader asking to see it again. */
	async rememberRadient(
		input: RadientComputerInput,
		options: RememberOptions = {},
	): Promise<SavedComputer> {
		return this.serial(() => {
			if (options.onlyIf && !options.onlyIf())
				return Promise.reject(
					new RegistryWriteFenced("route no longer current"),
				);
			return this.upsert(
				"fail",
				(entry) =>
					entry.transport === "radient" && entry.tunnelId === input.tunnelId,
				(existing, now) => radientEntry(input, existing, now, false),
			);
		});
	}

	/**
	 * Adds or refreshes a custom computer.
	 *
	 * Matching, in order: the entry `id` when given (an address may have changed
	 * since), else an entry at the same address. The address match is a stopgap
	 * for "the reader saved the same URL twice" until a key fingerprint can say
	 * whether it is the same computer. It is deliberately NOT how an address change
	 * is recorded: re-saving under a new URL without the id would fork one computer
	 * into two entries, so a caller that knows the entry passes its `id` or calls
	 * `updateAddress`. An unknown `id` falls through to the address match rather
	 * than inventing a second entry for an address already saved. When several
	 * entries share the address (`updateAddress` allows it), the address match
	 * refreshes the one added FIRST — index order — so the choice is stable across
	 * reads rather than dependent on `lastUsedAt`.
	 */
	async rememberCustom(
		input: CustomComputerInput,
		options: RememberOptions = {},
	): Promise<SavedComputer> {
		const baseUrl = normaliseBaseUrl(input.baseUrl);
		return this.serial(async () => {
			if (options.onlyIf && !options.onlyIf())
				throw new RegistryWriteFenced("route no longer current");
			const target =
				input.id === undefined ? null : await this.readTarget(input.id);
			const byId = target?.transport === "custom" ? target : undefined;
			return this.upsert(
				"fail",
				byId
					? (entry) => entry.id === byId.id
					: (entry) =>
							entry.transport === "custom" && entry.baseUrl === baseUrl,
				(existing, now) => ({
					transport: "custom",
					id: existing?.id ?? "",
					baseUrl,
					allowInsecure: input.allowInsecure,
					name: clampName(
						input.name ?? existing?.name ?? hostOf(baseUrl),
						baseUrl,
					),
					addedAt: existing?.addedAt ?? now,
					lastUsedAt: existing?.lastUsedAt ?? now,
					hidden: existing?.hidden ?? false,
					identity: existing?.identity ?? null,
				}),
			);
		});
	}

	/**
	 * Moves a custom computer to a new address, keeping everything that makes it
	 * the same computer: id, timestamps, name, `hidden`, `identity`. A network
	 * change is not a new computer. Another entry may already sit at that
	 * address — two entries at one address is allowed, because an address is not
	 * an identity. Returns `null` for an unknown id or a Radient entry, whose
	 * address is the tunnel's and is refreshed by `rememberRadient`.
	 */
	async updateAddress(
		id: string,
		address: { baseUrl: string; allowInsecure?: boolean },
	): Promise<SavedComputer | null> {
		return this.serial(async () => {
			const existing = await this.readTarget(id);
			if (existing?.transport !== "custom") return null;
			const next: SavedCustomComputer = {
				...existing,
				baseUrl: normaliseBaseUrl(address.baseUrl),
				allowInsecure: address.allowInsecure ?? existing.allowInsecure,
			};
			await this.writeEntry(next);
			return next;
		});
	}

	/** "Remove" on a Radient computer: remembered AND hidden in one write, so a
	 *  computer known only from discovery (never saved before) stays removed.
	 *
	 *  Proceeds past an entry whose read throws, keeping that id in the index
	 *  (`upsert`'s `unreadable: "keep"`). If the unreadable entry IS this tunnel,
	 *  the result is a second hidden record for it, which is the reader's intent
	 *  either way; refusing instead would make every Remove fail while one item
	 *  stays unreadable. */
	async hideRadient(input: RadientComputerInput): Promise<SavedComputer> {
		return this.serial(() =>
			this.upsert(
				"keep",
				(entry) =>
					entry.transport === "radient" && entry.tunnelId === input.tunnelId,
				(existing, now) => radientEntry(input, existing, now, true),
			),
		);
	}

	async hide(id: string): Promise<SavedComputer | null> {
		return this.patch(id, () => ({ hidden: true }));
	}

	/** The way back from "Remove". The connection store re-filters its last
	 *  discovery answer (`unhideComputer`), so the computer is listed again at once
	 *  when discovery had listed it; this only makes the change durable. */
	async unhide(id: string): Promise<SavedComputer | null> {
		return this.patch(id, () => ({ hidden: false }));
	}

	/** Records a connection, for ordering. */
	async markUsed(id: string): Promise<SavedComputer | null> {
		return this.patch(id, (now) => ({ lastUsedAt: now }));
	}

	/** Drops an entry entirely. Index first, then the item: a crash between the
	 *  two leaves an unreachable item, never an index pointing at nothing.
	 *
	 *  Works on index ids, not entries: forgetting needs nothing from the item, so
	 *  an unreadable target is still forgotten, and every OTHER id — readable or
	 *  not — is written back. */
	async forget(id: string): Promise<void> {
		await this.serial(async () => {
			const slots = await this.readSlots();
			if (!slots.some((slot) => slot.id === id)) return;
			await this.writeIndex(
				slots.filter((slot) => slot.id !== id).map((slot) => slot.id),
			);
			await this.deleteEntry(id);
		});
	}

	/**
	 * Every entry, leaving an EMPTY index (sign-out). Leaves the custom slot alone,
	 * like every other operation here — that slot belongs to `./storage.ts`.
	 *
	 * Works from the raw index, not `load()`: an entry whose read fails must still
	 * be deleted, and a flaky entry read must not make sign-out fail. The empty
	 * index is written BEFORE the items go, for the same crash rule as `forget`;
	 * writing it rather than deleting it keeps "cleared" a state on disk, so a
	 * later seeding rule can never mistake a signed-out phone for a fresh install.
	 */
	async clear(): Promise<void> {
		await this.serial(async () => {
			let rawIndex: string | null;
			try {
				rawIndex = await this.adapter.getItemAsync(
					SAVED_COMPUTERS_INDEX_KEY,
					this.writeOptions(),
				);
			} catch (error) {
				/* An unreadable INDEX still must not leave the registry populated after
				 * sign-out: the empty index needs no read, so it is written anyway and the
				 * registry is logically empty. Only the items it named stay behind,
				 * unreachable. The read error is still surfaced, so sign-out reports the
				 * failure (and a retry re-runs) rather than claiming a clean wipe. */
				await this.writeIndex([]);
				throw error;
			}
			const ids = rawIndex === null ? [] : parseIndex(rawIndex);
			await this.writeIndex([]);
			for (const id of ids) await this.deleteEntry(id);
		});
	}

	/* ------------------------------------------------------------- internals */

	private serial<T>(work: () => Promise<T>): Promise<T> {
		const run = this.queue.then(work, work);
		this.queue = run.catch(() => undefined);
		return run;
	}

	private async patch(
		id: string,
		change: (now: number) => Partial<SavedComputerBase>,
	): Promise<SavedComputer | null> {
		return this.serial(async () => {
			const existing = await this.readTarget(id);
			if (!existing) return null;
			const next = { ...existing, ...change(this.now()) } as SavedComputer;
			await this.writeEntry(next);
			return next;
		});
	}

	/**
	 * Refresh-or-add, keyed by `match`. `unreadable` says what to do when an entry
	 * read THROWS (R2: never treated as corrupt):
	 *
	 * - `"fail"` — reject before writing anything. For `rememberRadient` and
	 *   `rememberCustom`: the unreadable entry may be the very computer being
	 *   refreshed, and adding a fresh one beside it would fork that computer into
	 *   two records with diverging `hidden`/timestamps.
	 * - `"keep"` — proceed, and write every unreadable id back into the index in
	 *   place. Only for writes whose result is safe even if they fork (`hideRadient`).
	 *
	 * Either way no write drops an id it could not read. Unreadable entries count
	 * toward the bound and are never evicted: their `hidden` flag is unknown, and
	 * evicting a hidden one would resurrect a removed computer.
	 */
	private async upsert(
		unreadable: "fail" | "keep",
		match: (entry: SavedComputer) => boolean,
		build: (existing: SavedComputer | undefined, now: number) => SavedComputer,
	): Promise<SavedComputer> {
		const slots = await this.readSlots();
		if (unreadable === "fail") {
			const failed = slots.find((slot) => "error" in slot);
			if (failed && "error" in failed) throw failed.error;
		}
		const entries = readable(slots, "write");
		const existing = entries.find(match);
		const now = this.now();
		const next = build(existing, now);
		if (existing) {
			await this.writeEntry(next);
			return next;
		}
		next.id = this.freshId(slots.map((slot) => slot.id));
		const evicted = evictionFor(entries, slots.length);
		const kept = slots
			.map((slot) => slot.id)
			.filter((id) => id !== evicted?.id);
		/* Only possible when the bound is full and nothing is evictable (every slot
		 * unreadable): `parseIndex` would truncate the new id off the end, so the
		 * write would claim a success the next read cannot see. */
		if (kept.length >= MAX_SAVED_COMPUTERS)
			throw new SecureStorageError(
				"the saved-computer list is full of entries that cannot be read",
				SAVED_COMPUTERS_INDEX_KEY,
			);
		/* Entry before index: a crash between the two leaves an item nothing lists
		 * (harmless), never an index naming an item that does not exist. */
		await this.writeEntry(next);
		await this.writeIndex([...kept, next.id]);
		if (evicted) await this.deleteEntry(evicted.id);
		return next;
	}

	/** The entry a patch targets, or `null` when the index does not name it (or it
	 *  is gone/corrupt). Other entries' read errors are irrelevant — a patch writes
	 *  only its own item, never the index — but the TARGET's error propagates: a
	 *  patch cannot be built from an entry it could not read. */
	private async readTarget(id: string): Promise<SavedComputer | null> {
		const slot = (await this.readSlots()).find(
			(candidate) => candidate.id === id,
		);
		if (!slot) return null;
		if ("error" in slot) throw slot.error;
		return slot.entry;
	}

	/**
	 * One slot per index id, in index order, with its entry or the error its read
	 * threw. A missing or unparseable item yields no slot: that is the one case that
	 * costs the computer (the next index write drops its id). A THROWING read keeps
	 * its slot, so each caller decides — read-only paths skip it, writes keep the id
	 * or fail — instead of one item's error deciding for the whole registry.
	 *
	 * An index read that throws still propagates: without it there is nothing to
	 * read or to write back.
	 */
	private async readSlots(): Promise<Slot[]> {
		const rawIndex = await this.adapter.getItemAsync(
			SAVED_COMPUTERS_INDEX_KEY,
			this.writeOptions(),
		);
		if (rawIndex === null) return [];
		const slots: Slot[] = [];
		for (const id of parseIndex(rawIndex)) {
			try {
				const entry = await this.readEntry(id);
				if (entry) slots.push({ id, entry });
			} catch (error) {
				slots.push({ id, error });
			}
		}
		return slots;
	}

	/**
	 * One entry, or `null` when it is gone or unparseable — the only two cases
	 * that may cost the reader that computer.
	 *
	 * A THROWING read is not one of them and is deliberately not caught here:
	 * Android keystore reads fail transiently, and treating that as "corrupt" would
	 * let the caller's write drop the id from the index — a hidden entry lost that
	 * way is a removed computer coming back. `readSlots` records it instead.
	 */
	private async readEntry(id: string): Promise<SavedComputer | null> {
		const raw = await this.adapter.getItemAsync(
			entryKey(id),
			this.writeOptions(),
		);
		if (raw === null) return null;
		try {
			return parseEntry(JSON.parse(raw), id);
		} catch {
			return null;
		}
	}

	private async writeEntry(entry: SavedComputer): Promise<void> {
		await this.write(entryKey(entry.id), { v: 1, ...entry });
	}

	private async writeIndex(ids: string[]): Promise<void> {
		await this.write(SAVED_COMPUTERS_INDEX_KEY, { v: 1, ids });
	}

	private async deleteEntry(id: string): Promise<void> {
		try {
			await this.adapter.deleteItemAsync(entryKey(id), this.writeOptions());
		} catch {
			/* The index no longer names it, so a failed delete leaves only an item
			 * nothing reads. */
		}
	}

	private async write(key: string, value: unknown): Promise<void> {
		const raw = JSON.stringify(value);
		if (raw.length > MAX_SECURE_VALUE_CHARS) {
			throw new SecureStorageError(
				`this value is too large for the platform keystore (${raw.length} > ${MAX_SECURE_VALUE_CHARS} characters)`,
				key,
			);
		}
		await this.adapter.setItemAsync(key, raw, this.writeOptions());
	}

	private freshId(ids: string[]): string {
		const taken = new Set(ids);
		for (;;) {
			const id = (this.options.newId ?? defaultId)();
			if (!SAFE_ID.test(id))
				throw new Error(`saved-computer id has unsafe characters: ${id}`);
			if (!taken.has(id)) return id;
		}
	}

	private now(): number {
		return this.options.now?.() ?? Date.now();
	}

	/** The same per-item accessibility rule as `SecureStorage.writeOptions`. */
	private writeOptions(): SecureStoreOptions {
		const options: SecureStoreOptions = {};
		if (this.options.keychainAccessible)
			options.keychainAccessible = this.options.keychainAccessible;
		return options;
	}
}

/* ------------------------------------------------------------------ helpers */

function entryKey(id: string): string {
	return `${SAVED_COMPUTER_KEY_PREFIX}${id}`;
}

function sortByUse(entries: SavedComputer[]): SavedComputer[] {
	return [...entries].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

/** An index id with what its read produced. */
type Slot =
	| { id: string; entry: SavedComputer }
	| { id: string; error: unknown };

/** The entries that could be read, in index order; each skipped one is logged
 *  with its local id and the error's message only — the item's value never
 *  reaches the log, and an id is a local opaque handle, not an address. */
function readable(slots: Slot[], path: "list" | "write"): SavedComputer[] {
	const entries: SavedComputer[] = [];
	for (const slot of slots) {
		if ("entry" in slot) entries.push(slot.entry);
		else
			console.warn(
				`[saved-computers] entry ${slot.id} could not be read; the ${path} skips it and keeps its id in the index`,
				slot.error instanceof Error ? slot.error.message : String(slot.error),
			);
	}
	return entries;
}

/** Which entry to drop when a new one would exceed the bound: the least recently
 *  used VISIBLE entry first. A hidden entry is what keeps a removed computer
 *  removed, so evicting one would resurrect it; only a list made entirely of
 *  hidden entries gives up its oldest. `total` counts unreadable slots too: they
 *  occupy the bound but are never candidates (their `hidden` flag is unknown). */
function evictionFor(
	entries: SavedComputer[],
	total: number,
): SavedComputer | null {
	if (total < MAX_SAVED_COMPUTERS) return null;
	const oldestFirst = [...entries].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
	return oldestFirst.find((entry) => !entry.hidden) ?? oldestFirst[0] ?? null;
}

/** Local and opaque: uniqueness on this phone is the only requirement, so this
 *  is not a security boundary and needs no CSPRNG guarantee. */
function defaultId(): string {
	const crypto = (globalThis as { crypto?: Crypto }).crypto;
	if (crypto && typeof crypto.getRandomValues === "function") {
		const bytes = new Uint8Array(8);
		crypto.getRandomValues(bytes);
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
			"",
		);
	}
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** One builder for both Radient writes, so a remember and a Remove agree on what
 *  survives a refresh: the id, timestamps, identity, the saved name when no new one
 *  is given, and the account key when the caller does not know it. */
function radientEntry(
	input: RadientComputerInput,
	existing: SavedComputer | undefined,
	now: number,
	hidden: boolean,
): SavedRadientComputer {
	const previous = existing?.transport === "radient" ? existing : undefined;
	return {
		transport: "radient",
		id: existing?.id ?? "",
		tunnelId: input.tunnelId,
		hostname: input.hostname,
		name: clampName(input.name ?? existing?.name ?? "", input.hostname),
		account:
			input.account !== undefined ? input.account : (previous?.account ?? null),
		addedAt: existing?.addedAt ?? now,
		lastUsedAt: existing?.lastUsedAt ?? now,
		hidden: hidden || (existing?.hidden ?? false),
		identity: existing?.identity ?? null,
	};
}

function clampName(name: string, fallback: string): string {
	const trimmed = name.trim() || fallback;
	return trimmed.length > MAX_DISPLAY_NAME_CHARS
		? trimmed.slice(0, MAX_DISPLAY_NAME_CHARS)
		: trimmed;
}

/** One spelling per address, so saving `https://host/` and `https://host` is one
 *  computer rather than two. */
function normaliseBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(TRAILING_SLASHES, "");
}

function hostOf(baseUrl: string): string {
	try {
		return new URL(baseUrl).host || baseUrl;
	} catch {
		return baseUrl;
	}
}

function parseIndex(raw: string): string[] {
	try {
		const value = JSON.parse(raw) as { v?: unknown; ids?: unknown };
		if (value?.v !== 1 || !Array.isArray(value.ids)) return [];
		return value.ids
			.filter((id): id is string => typeof id === "string" && SAFE_ID.test(id))
			.slice(0, MAX_SAVED_COMPUTERS);
	} catch {
		return [];
	}
}

function parseEntry(value: unknown, id: string): SavedComputer | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	if (record.v !== 1 || record.id !== id) return null;
	const name = typeof record.name === "string" ? record.name : "";
	const addedAt = finite(record.addedAt);
	const lastUsedAt = finite(record.lastUsedAt) ?? addedAt;
	if (addedAt === null || lastUsedAt === null) return null;
	const base = {
		id,
		addedAt,
		lastUsedAt,
		hidden: record.hidden === true,
		identity: parseIdentity(record.identity),
	};
	if (
		record.transport === "radient" &&
		typeof record.tunnelId === "string" &&
		record.tunnelId.length > 0 &&
		typeof record.hostname === "string" &&
		record.hostname.length > 0
	)
		return {
			...base,
			transport: "radient",
			tunnelId: record.tunnelId,
			hostname: record.hostname,
			name: clampName(name, record.hostname),
			/* Absent on entries written before the key existed: `null`, which the
			 *  switcher treats as "not known" (see `SavedRadientComputer.account`). */
			account:
				typeof record.account === "string" && record.account.length > 0
					? record.account
					: null,
		};
	if (
		record.transport === "custom" &&
		typeof record.baseUrl === "string" &&
		record.baseUrl.length > 0
	)
		return {
			...base,
			transport: "custom",
			baseUrl: record.baseUrl,
			allowInsecure: record.allowInsecure === true,
			name: clampName(name, hostOf(record.baseUrl)),
		};
	return null;
}

/** Tolerant on purpose: an unreadable identity is "not known yet", which is what
 *  every entry is today, and must not cost the reader the computer. */
function parseIdentity(value: unknown): ComputerIdentity | null {
	if (typeof value !== "object" || value === null) return null;
	const fingerprint = (value as { key_fingerprint?: unknown }).key_fingerprint;
	return typeof fingerprint === "string" && fingerprint.length > 0
		? { key_fingerprint: fingerprint }
		: null;
}

function finite(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
