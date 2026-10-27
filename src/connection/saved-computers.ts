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
 * - **Migration without deletion.** The first read seeds the registry from the
 *   existing `lop.mobile.custom` slot, parsed here from the raw value rather than
 *   through `SecureStorage.readCustomRoute()` — that reader deletes an item it
 *   cannot parse, and a migration must never change the slot it migrates from.
 *   The slot stays exactly as it was, so a build without this module (a rollback)
 *   still finds the reader's own tunnel and its remembered password.
 * - **Identity is the computer's key, never its address.** A VPN, a Wi-Fi to
 *   cellular hop, a new IP or a re-pointed custom URL is the SAME computer, so an
 *   entry's local `id`, timestamps and `hidden` flag never derive from
 *   `baseUrl` or `hostname`, and `updateAddress` changes an address in place.
 *   `identity.key_fingerprint` is reserved for the key that will prove it (pinning
 *   is a later slice); it is `null` on every entry today.
 * - **Secure store, though nothing here is secret.** Hostnames and addresses are
 *   still personal, and the keystore is this app's only durable store with the
 *   per-device accessibility class; AsyncStorage would put them in a plain file.
 */

import {
	MAX_SECURE_VALUE_CHARS,
	SECURE_KEYS,
	SecureStorageError,
	type SecureStoreAdapter,
	type SecureStoreOptions,
} from "./storage";

/** The index item: the ordered list of entry ids. Its PRESENCE is also the
 *  migration marker — once it exists, the custom slot is never re-seeded, so a
 *  reader who forgets the migrated entry does not see it come back. */
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
	name: string;
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

	/** Every entry, hidden ones included, most recently used first. */
	async list(): Promise<SavedComputer[]> {
		return this.serial(async () => sortByUse(await this.load()));
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
	async rememberRadient(input: RadientComputerInput): Promise<SavedComputer> {
		return this.serial(() =>
			this.upsert(
				(entry) =>
					entry.transport === "radient" && entry.tunnelId === input.tunnelId,
				(existing, now) => ({
					transport: "radient",
					id: existing?.id ?? "",
					tunnelId: input.tunnelId,
					hostname: input.hostname,
					name: clampName(input.name, input.hostname),
					addedAt: existing?.addedAt ?? now,
					lastUsedAt: existing?.lastUsedAt ?? now,
					hidden: existing?.hidden ?? false,
					identity: existing?.identity ?? null,
				}),
			),
		);
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
	 * than inventing a second entry for an address already saved.
	 */
	async rememberCustom(input: CustomComputerInput): Promise<SavedComputer> {
		const baseUrl = normaliseBaseUrl(input.baseUrl);
		return this.serial(async () => {
			const byId =
				input.id === undefined
					? undefined
					: (await this.load()).find(
							(entry) => entry.transport === "custom" && entry.id === input.id,
						);
			return this.upsert(
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
			const existing = (await this.load()).find((entry) => entry.id === id);
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
	 *  computer known only from discovery (never saved before) stays removed. */
	async hideRadient(input: RadientComputerInput): Promise<SavedComputer> {
		return this.serial(() =>
			this.upsert(
				(entry) =>
					entry.transport === "radient" && entry.tunnelId === input.tunnelId,
				(existing, now) => ({
					transport: "radient",
					id: existing?.id ?? "",
					tunnelId: input.tunnelId,
					hostname: input.hostname,
					name: clampName(input.name, input.hostname),
					addedAt: existing?.addedAt ?? now,
					lastUsedAt: existing?.lastUsedAt ?? now,
					hidden: true,
					identity: existing?.identity ?? null,
				}),
			),
		);
	}

	async hide(id: string): Promise<SavedComputer | null> {
		return this.patch(id, () => ({ hidden: true }));
	}

	/** The way back from "Remove". The computer reappears on the next discovery
	 *  refresh; the store does not keep an unfiltered copy to restore it from. */
	async unhide(id: string): Promise<SavedComputer | null> {
		return this.patch(id, () => ({ hidden: false }));
	}

	/** Records a connection, for ordering. */
	async markUsed(id: string): Promise<SavedComputer | null> {
		return this.patch(id, (now) => ({ lastUsedAt: now }));
	}

	/** Drops an entry entirely. Index first, then the item: a crash between the
	 *  two leaves an unreachable item, never an index pointing at nothing. */
	async forget(id: string): Promise<void> {
		await this.serial(async () => {
			const entries = await this.load();
			if (!entries.some((entry) => entry.id === id)) return;
			await this.writeIndex(entries.filter((entry) => entry.id !== id));
			await this.deleteEntry(id);
		});
	}

	/** Every entry and the index. Leaves the custom slot alone, like every other
	 *  operation here — that slot belongs to `./storage.ts`. */
	async clear(): Promise<void> {
		await this.serial(async () => {
			const entries = await this.load();
			await this.adapter.deleteItemAsync(
				SAVED_COMPUTERS_INDEX_KEY,
				this.writeOptions(),
			);
			for (const entry of entries) await this.deleteEntry(entry.id);
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
			const entries = await this.load();
			const existing = entries.find((entry) => entry.id === id);
			if (!existing) return null;
			const next = { ...existing, ...change(this.now()) } as SavedComputer;
			await this.writeEntry(next);
			return next;
		});
	}

	private async upsert(
		match: (entry: SavedComputer) => boolean,
		build: (existing: SavedComputer | undefined, now: number) => SavedComputer,
	): Promise<SavedComputer> {
		const entries = await this.load();
		const existing = entries.find(match);
		const now = this.now();
		const next = build(existing, now);
		if (existing) {
			await this.writeEntry(next);
			return next;
		}
		next.id = this.freshId(entries);
		const evicted = evictionFor(entries);
		const kept = evicted
			? entries.filter((entry) => entry.id !== evicted.id)
			: entries;
		/* Entry before index: a crash between the two leaves an item nothing lists
		 * (harmless), never an index naming an item that does not exist. */
		await this.writeEntry(next);
		await this.writeIndex([...kept, next]);
		if (evicted) await this.deleteEntry(evicted.id);
		return next;
	}

	/** The entries, migrating on the first ever read. */
	private async load(): Promise<SavedComputer[]> {
		const rawIndex = await this.adapter.getItemAsync(
			SAVED_COMPUTERS_INDEX_KEY,
			this.writeOptions(),
		);
		if (rawIndex === null) return this.migrate();
		const ids = parseIndex(rawIndex);
		const entries: SavedComputer[] = [];
		for (const id of ids) {
			const entry = await this.readEntry(id);
			/* A corrupt or missing item costs that one computer; the next write of the
			 * index drops its id. */
			if (entry) entries.push(entry);
		}
		return entries;
	}

	/**
	 * Seeds the registry from the single custom slot, once.
	 *
	 * The slot is only READ. A read that throws (a keystore still locked after a
	 * reboot) is rethrown rather than read as "no custom computer": writing an
	 * empty index then would mark the migration done and lose the reader's tunnel
	 * from this list for good.
	 */
	private async migrate(): Promise<SavedComputer[]> {
		const raw = await this.adapter.getItemAsync(
			SECURE_KEYS.custom,
			this.writeOptions(),
		);
		const seed = raw === null ? null : parseLegacyCustom(raw);
		if (!seed) {
			await this.writeIndex([]);
			return [];
		}
		const now = this.now();
		const entry: SavedCustomComputer = {
			transport: "custom",
			id: this.freshId([]),
			baseUrl: seed.baseUrl,
			allowInsecure: seed.allowInsecure,
			name: clampName(hostOf(seed.baseUrl), seed.baseUrl),
			addedAt: now,
			lastUsedAt: now,
			hidden: false,
			identity: null,
		};
		await this.writeEntry(entry);
		await this.writeIndex([entry]);
		return [entry];
	}

	private async readEntry(id: string): Promise<SavedComputer | null> {
		let raw: string | null;
		try {
			raw = await this.adapter.getItemAsync(entryKey(id), this.writeOptions());
		} catch {
			return null;
		}
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

	private async writeIndex(entries: SavedComputer[]): Promise<void> {
		await this.write(SAVED_COMPUTERS_INDEX_KEY, {
			v: 1,
			ids: entries.map((entry) => entry.id),
		});
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

	private freshId(entries: SavedComputer[]): string {
		const taken = new Set(entries.map((entry) => entry.id));
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

/** Which entry to drop when a new one would exceed the bound: the least recently
 *  used VISIBLE entry first. A hidden entry is what keeps a removed computer
 *  removed, so evicting one would resurrect it; only a list made entirely of
 *  hidden entries gives up its oldest. */
function evictionFor(entries: SavedComputer[]): SavedComputer | null {
	if (entries.length < MAX_SAVED_COMPUTERS) return null;
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

/** The legacy slot's address fields, and nothing else: its password stays where
 *  it is, owned by `./storage.ts`. */
function parseLegacyCustom(
	raw: string,
): { baseUrl: string; allowInsecure: boolean } | null {
	try {
		const value = JSON.parse(raw) as {
			base_url?: unknown;
			allow_insecure?: unknown;
		};
		if (typeof value?.base_url !== "string" || value.base_url.length === 0)
			return null;
		return {
			baseUrl: normaliseBaseUrl(value.base_url),
			allowInsecure: value.allow_insecure === true,
		};
	} catch {
		return null;
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
