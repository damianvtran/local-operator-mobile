/**
 * The ONLY module that touches `expo-secure-store` (or the Keychain / Android
 * Keystore behind it).
 *
 * The rule this file enforces is `docs/architecture.md` principle 4: *secrets
 * live in the platform keystore, in one module; no screen reads a token.* Above
 * this file, credentials are a plain object that is passed into exactly the two
 * callers that need them — the HTTP layer (for the `Cookie` header) and the
 * refresh scheduler — and never into a store or a component.
 *
 * Storage decisions, all from `ADR 0002` §3 "Storage":
 *
 * - **One small JSON item per concern**, not one blob: a corrupt item must cost
 *   one credential, not the sign-in state.
 * - **Bounded size.** iOS has historically refused SecureStore values over ~2 KB,
 *   so a value that large is refused here with a named error rather than failing
 *   in the platform layer at the worst moment. The retry envelope, which can
 *   legitimately be megabytes, therefore belongs in DEVICE storage and is not
 *   stored here (see `relay/retry-envelope.ts`).
 * - **`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no `requireAuthentication`.** The
 *   accessibility level is set on every write; `requireAuthentication` is
 *   deliberately off because it would block a background refresh and force a
 *   sign-in the user would read as a bug.
 * - **Never logged.** `describe()` exists so a diagnostic screen can say what is
 *   present without any value crossing the boundary.
 */

/* Type-only, and deliberately so: the two shapes are read for their fields and nothing
 * else, so this module still loads with no React Native, no bundler and no cycle. */
import type { RadientTokens } from "./radient-oauth";
import type { TunnelSession } from "./tunnel-session";

/** The subset of `expo-secure-store` this module uses. Narrow on purpose: the
 *  adapter is injected, so the module is testable in Node and the dependency is
 *  visible in one place. */
export interface SecureStoreAdapter {
	getItemAsync(
		key: string,
		options?: SecureStoreOptions,
	): Promise<string | null>;
	setItemAsync(
		key: string,
		value: string,
		options?: SecureStoreOptions,
	): Promise<void>;
	deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void>;
}

export interface SecureStoreOptions {
	keychainAccessible?: string;
	/** Deliberately never set at v1 (`ADR 0002` §3). */
	requireAuthentication?: boolean;
	keychainService?: string;
}

/** Storage keys. Prefixed so a future migration can find its own items, and so a
 *  dump of the keystore (which nobody should take) is at least legible. */
export const SECURE_KEYS = {
	oauth: "lop.mobile.oauth",
	tunnel: "lop.mobile.tunnel",
	custom: "lop.mobile.custom",
} as const;

/** The value iOS has historically refused. Anything larger is refused here. */
export const MAX_SECURE_VALUE_CHARS = 2_048;

/** The Radient OAuth set. `expires_at` is epoch ms (the desktop client's unit and
 *  the one `Date.now()` compares against). */
export interface RadientOAuthSet {
	access: string;
	refresh: string | null;
	expires_at: number;
	/** The account label only — never an email address in a log line. */
	account_label: string | null;
	scope: string;
	token_type: string;
}

/** The tunnel session set. The grant is short-lived and kept here anyway,
 *  because losing it across a restart would cost a mint round trip on every cold
 *  start. */
export interface TunnelSessionSet {
	grant: string;
	grant_expires_at: number;
	/** The absolute 30-day refresh handle; it never rotates server-side. */
	refresh_handle: string;
	refresh_expires_at: number;
	hostname: string;
	tunnel_id: string;
	/** When the handle was minted, so the day-25 re-mint can be scheduled without
	 *  trusting `refresh_expires_at` alone. */
	minted_at: number;
}

/** The custom route's set. The password is present only when the user opted to
 *  remember it. */
export interface CustomRouteSet {
	base_url: string;
	password: string | null;
	allow_insecure: boolean;
}

/** A value that cannot be stored safely, with the reason named. */
export class SecureStorageError extends Error {
	override readonly name = "SecureStorageError";
	readonly key: string;
	constructor(message: string, key: string) {
		super(message);
		this.key = key;
	}
}

/** Whether a credential set is present. Never carries the value. */
export interface StoragePresence {
	oauth: boolean;
	oauthExpiresInMs: number | null;
	tunnel: boolean;
	tunnelExpiresInMs: number | null;
	customRoute: boolean;
	remembersPassword: boolean;
}

/**
 * The secure store, by concern.
 *
 * Every read tolerates a corrupt item by returning `null` and deleting it: a
 * half-written value must degrade to "sign in again", never to a request signed
 * with a truncated token or a crash on a cold start.
 */
export class SecureStorage {
	private readonly adapter: SecureStoreAdapter;
	private readonly options: {
		keychainAccessible?: string;
		now?: () => number;
	};

	constructor(
		adapter: SecureStoreAdapter,
		options: { keychainAccessible?: string; now?: () => number } = {},
	) {
		this.adapter = adapter;
		this.options = options;
	}

	/** What is stored, in a form safe to render. */
	async presence(): Promise<StoragePresence> {
		const now = this.options.now?.() ?? Date.now();
		const [oauth, tunnel, custom] = await Promise.all([
			this.readOauth(),
			this.readTunnelSession(),
			this.readCustomRoute(),
		]);
		return {
			oauth: oauth !== null,
			oauthExpiresInMs: oauth ? oauth.expires_at - now : null,
			tunnel: tunnel !== null,
			tunnelExpiresInMs: tunnel ? tunnel.refresh_expires_at - now : null,
			customRoute: custom !== null,
			remembersPassword: custom?.password != null,
		};
	}

	async readOauth(): Promise<RadientOAuthSet | null> {
		return this.read(SECURE_KEYS.oauth, parseOauth);
	}

	async writeOauth(value: RadientOAuthSet): Promise<void> {
		await this.write(SECURE_KEYS.oauth, value);
	}

	async readTunnelSession(): Promise<TunnelSessionSet | null> {
		return this.read(SECURE_KEYS.tunnel, parseTunnel);
	}

	async writeTunnelSession(value: TunnelSessionSet): Promise<void> {
		await this.write(SECURE_KEYS.tunnel, value);
	}

	async readCustomRoute(): Promise<CustomRouteSet | null> {
		return this.read(SECURE_KEYS.custom, parseCustom);
	}

	async writeCustomRoute(value: CustomRouteSet): Promise<void> {
		await this.write(SECURE_KEYS.custom, value);
	}

	/** Sign-out. Clears every item this app owns; unrelated keystore items are
	 *  another app's business. */
	async clearAll(): Promise<void> {
		await Promise.all([
			this.remove(SECURE_KEYS.oauth),
			this.remove(SECURE_KEYS.tunnel),
			this.remove(SECURE_KEYS.custom),
		]);
	}

	/** The Radient grant is gone but the tunnel session is kept: the ADR keeps the
	 *  tunnel session until the user acts, so a lapsed OAuth token does not throw
	 *  away a still-valid 30-day handle. */
	async clearOauthOnly(): Promise<void> {
		await this.remove(SECURE_KEYS.oauth);
	}

	private async read<T>(
		key: string,
		parse: (value: unknown) => T | null,
	): Promise<T | null> {
		let raw: string | null;
		try {
			raw = await this.adapter.getItemAsync(key, this.writeOptions());
		} catch {
			/* A locked keystore (device not yet unlocked) reads as absent, which sends
			 * the user to the sign-in screen rather than crashing a cold start. */
			return null;
		}
		if (raw === null) return null;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			await this.remove(key);
			return null;
		}
		const value = parse(parsed);
		if (value === null) await this.remove(key);
		return value;
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

	private async remove(key: string): Promise<void> {
		try {
			await this.adapter.deleteItemAsync(key, this.writeOptions());
		} catch {
			/* Best-effort: every caller of `remove` re-reads afterwards, and a failed
			 * delete leaves a value that is still parseable or still ignored. */
		}
	}

	/** Accessibility is set on every call, not only on the first write: it is a
	 *  per-item attribute on iOS, and a value written once without it would keep
	 *  the wrong level for the life of the install. */
	private writeOptions(): SecureStoreOptions {
		const options: SecureStoreOptions = {};
		if (this.options.keychainAccessible)
			options.keychainAccessible = this.options.keychainAccessible;
		return options;
	}
}

function parseOauth(value: unknown): RadientOAuthSet | null {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value as Partial<RadientOAuthSet>;
	if (typeof candidate.access !== "string" || candidate.access.length === 0)
		return null;
	if (
		typeof candidate.expires_at !== "number" ||
		!Number.isFinite(candidate.expires_at)
	)
		return null;
	return {
		access: candidate.access,
		refresh:
			typeof candidate.refresh === "string" && candidate.refresh.length > 0
				? candidate.refresh
				: null,
		expires_at: candidate.expires_at,
		account_label:
			typeof candidate.account_label === "string"
				? candidate.account_label
				: null,
		scope: typeof candidate.scope === "string" ? candidate.scope : "",
		token_type:
			typeof candidate.token_type === "string"
				? candidate.token_type
				: "Bearer",
	};
}

function parseTunnel(value: unknown): TunnelSessionSet | null {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value as Partial<TunnelSessionSet>;
	if (typeof candidate.grant !== "string" || candidate.grant.length === 0)
		return null;
	if (
		typeof candidate.refresh_handle !== "string" ||
		candidate.refresh_handle.length === 0
	)
		return null;
	if (typeof candidate.hostname !== "string" || candidate.hostname.length === 0)
		return null;
	if (
		typeof candidate.grant_expires_at !== "number" ||
		typeof candidate.refresh_expires_at !== "number"
	)
		return null;
	return {
		grant: candidate.grant,
		grant_expires_at: candidate.grant_expires_at,
		refresh_handle: candidate.refresh_handle,
		refresh_expires_at: candidate.refresh_expires_at,
		hostname: candidate.hostname,
		tunnel_id:
			typeof candidate.tunnel_id === "string" ? candidate.tunnel_id : "",
		minted_at:
			typeof candidate.minted_at === "number" ? candidate.minted_at : 0,
	};
}

function parseCustom(value: unknown): CustomRouteSet | null {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value as Partial<CustomRouteSet>;
	if (typeof candidate.base_url !== "string" || candidate.base_url.length === 0)
		return null;
	return {
		base_url: candidate.base_url,
		password:
			typeof candidate.password === "string" && candidate.password.length > 0
				? candidate.password
				: null,
		allow_insecure: candidate.allow_insecure === true,
	};
}

/**
 * An in-memory adapter: the tests' store, and the honest fallback for a runtime
 * with no keystore (the web target of `expo export`).
 *
 * It is deliberately NOT a silent production fallback: a caller that reaches for
 * this outside a test must say so, because "the credential leaks on restart" is
 * a security decision rather than a convenience.
 */
export function memorySecureStore(
	seed: Record<string, string> = {},
): SecureStoreAdapter & { readonly items: Map<string, string> } {
	const items = new Map<string, string>(Object.entries(seed));
	return {
		items,
		async getItemAsync(key) {
			return items.get(key) ?? null;
		},
		async setItemAsync(key, value) {
			items.set(key, value);
		},
		async deleteItemAsync(key) {
			items.delete(key);
		},
	};
}

/**
 * The platform adapter.
 *
 * `expo-secure-store` is imported lazily so that Node (unit tests, the smoke
 * script) never resolves it: the module graph stays runnable outside a phone
 * without a stub of the native module.
 */
export async function expoSecureStore(): Promise<SecureStoreAdapter> {
	/* Lazy import so Node (tests, scripts) never loads the native module. The
	 * compiler cannot know the module's shape until it resolves at runtime, so the
	 * subset used is declared here and each function is checked before it is called. */
	const module = (await import("expo-secure-store")) as unknown as {
		getItemAsync: (
			key: string,
			options?: SecureStoreOptions,
		) => Promise<string | null>;
		setItemAsync: (
			key: string,
			value: string,
			options?: SecureStoreOptions,
		) => Promise<void>;
		deleteItemAsync: (
			key: string,
			options?: SecureStoreOptions,
		) => Promise<void>;
		WHEN_UNLOCKED_THIS_DEVICE_ONLY: string;
	};
	return {
		getItemAsync: (key, options) => module.getItemAsync(key, options),
		setItemAsync: (key, value, options) =>
			module.setItemAsync(key, value, options),
		deleteItemAsync: (key, options) => module.deleteItemAsync(key, options),
	};
}

/** The accessibility level every write uses, read from the platform so a future
 *  Expo rename fails at the import rather than silently downgrading. */
export async function thisDeviceOnlyAccessibility(): Promise<string> {
	/* Lazy import so Node (tests, scripts) never loads the native module. The
	 * compiler cannot know the module's shape until it resolves at runtime, so the
	 * subset used is declared here and each function is checked before it is called. */
	const module = (await import("expo-secure-store")) as unknown as {
		WHEN_UNLOCKED_THIS_DEVICE_ONLY: string;
	};
	return module.WHEN_UNLOCKED_THIS_DEVICE_ONLY;
}

/* --------------------------------------------------- app shape ↔ stored shape */

/**
 * The two bridges between the connection layer's WORKING shapes and the records
 * this module stores.
 *
 * They live here because this is the one file that knows both: `radient-oauth.ts`
 * and `tunnel-session.ts` deliberately say nothing about the keystore, and a caller
 * that built a record inline would be a second place the field names could drift from
 * the parser's. Every value crosses unchanged — `expires_at` already carries the
 * access-token skew on the app's side, so neither direction re-derives an expiry.
 *
 * `import type` only: these are shapes, not behaviour, so the module keeps its
 * property of loading in Node with no React Native and no cycle.
 */
export function oauthSetFromTokens(tokens: RadientTokens): RadientOAuthSet {
	return {
		access: tokens.access,
		refresh: tokens.refresh,
		expires_at: tokens.expires_at,
		account_label: tokens.account_label,
		scope: tokens.scope,
		token_type: tokens.token_type,
	};
}

export function tokensFromOauthSet(set: RadientOAuthSet): RadientTokens {
	return {
		access: set.access,
		refresh: set.refresh,
		expires_at: set.expires_at,
		account_label: set.account_label,
		scope: set.scope,
		token_type: set.token_type,
	};
}

export function tunnelSetFromSession(session: TunnelSession): TunnelSessionSet {
	return {
		grant: session.grant,
		grant_expires_at: session.grantExpiresAt,
		refresh_handle: session.refreshHandle,
		refresh_expires_at: session.refreshExpiresAt,
		hostname: session.hostname,
		tunnel_id: session.tunnelId,
		minted_at: session.mintedAt,
	};
}

export function sessionFromTunnelSet(set: TunnelSessionSet): TunnelSession {
	return {
		grant: set.grant,
		grantExpiresAt: set.grant_expires_at,
		refreshHandle: set.refresh_handle,
		refreshExpiresAt: set.refresh_expires_at,
		hostname: set.hostname,
		tunnelId: set.tunnel_id,
		mintedAt: set.minted_at,
	};
}
