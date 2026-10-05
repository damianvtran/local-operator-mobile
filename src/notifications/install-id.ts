/**
 * The device's install identity: one UUID, minted once, kept where a reinstall
 * cannot silently duplicate it.
 *
 * ADR 0006 §3.1 makes `install_id` the device's identity on the register
 * contract — "idempotent on (install_id, platform): re-registering with a
 * rotated token REPLACES the row" — and puts its custody in the keystore
 * ("minted once and kept in the keystore", §3.1). The same item holds this
 * device's `device_id` and `device_key` once a registration has happened,
 * because that is exactly how the ADR scopes them: "held by the phone in the
 * keystore keyed by its `install_id`" (§4's credential row). One item, keyed
 * by the id that survives every re-registration — two items could disagree
 * about which device they describe.
 *
 * **Why this does NOT join `SecureStorage.clearAll()`.** Sign-out is a revoke
 * (the app calls `DELETE /api/push/devices/{id}` on the way out), and a revoke
 * must STICK for the same device: if signing out destroyed the install id, the
 * next launch would mint a fresh one, register a fresh row and quietly undo the
 * revoke — the exact bypass the tombstone exists to prevent (`push_devices
 * .revoke`'s docstring: "the row stays, which is what makes the revoke stick
 * for the same install_id instead of being undone by the app's next launch").
 * The device identity therefore outlives the credentials stored beside it, and
 * this module owns its key rather than reusing `SECURE_KEYS` — a name in that
 * table is a name `clearAll` promises to clear.
 *
 * **The web fallback is stated, not hidden** (the pattern
 * `features/auth/tunnel-storage.ts` sets): a browser runtime has no keystore,
 * so the record lives for the session only — and the Settings surface that
 * reads it says "this device" only when the record is actually persistent.
 */

import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import {
	expoSecureStore,
	memorySecureStore,
	type SecureStoreAdapter,
} from "@/connection";

/** The keystore item. Deliberately not in `SECURE_KEYS`: that table is the set
 *  `SecureStorage.clearAll()` clears on sign-out, and this item must survive it
 *  (see the module note). Prefixed like the others so a dump is legible. */
export const INSTALL_RECORD_KEY = "lop.mobile.install";

/** The record's shape. `v` exists so a future field can migrate the item rather
 *  than guess at a partial one. */
export interface InstallRecord {
	v: 1;
	install_id: string;
	/** Present only after a successful registration. */
	device_id?: string;
	/** Present only after a successful registration; the response that minted it
	 *  is the only place it is ever sent, so this item is its one home. */
	device_key?: string;
}

const isRecord = (value: unknown): value is InstallRecord => {
	if (value === null || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	if (record.v !== 1) return false;
	if (typeof record.install_id !== "string" || record.install_id.length === 0) {
		return false;
	}
	if (record.device_id !== undefined && typeof record.device_id !== "string") {
		return false;
	}
	if (
		record.device_key !== undefined &&
		typeof record.device_key !== "string"
	) {
		return false;
	}
	return true;
};

let adapter: SecureStoreAdapter | null = null;

/** One adapter per app run — the singleton rule `tunnel-storage.ts` states, for
 *  the same reason (building one per screen opens a second keystore handle for
 *  nothing). */
async function open(): Promise<SecureStoreAdapter> {
	if (adapter !== null) return adapter;
	adapter =
		Platform.OS === "web" ? memorySecureStore() : await expoSecureStore();
	return adapter;
}

/** The stored record, or null. A corrupt or unreadable item reads as absent —
 *  and a fresh id is then minted by `ensureInstallRecord`, which is safe: the
 *  register contract upserts, so the worst case is one extra row a future list
 *  shows and the operator revokes. */
export async function readInstallRecord(): Promise<InstallRecord | null> {
	try {
		const store = await open();
		const raw = await store.getItemAsync(INSTALL_RECORD_KEY);
		if (raw === null) return null;
		const parsed: unknown = JSON.parse(raw);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Writes the record. Returns whether it can survive a restart, so a caller can
 *  say which of the two it is rather than implying persistence everywhere. */
export async function writeInstallRecord(
	record: InstallRecord,
): Promise<{ persistent: boolean }> {
	try {
		const store = await open();
		await store.setItemAsync(INSTALL_RECORD_KEY, JSON.stringify(record));
		return { persistent: Platform.OS !== "web" };
	} catch {
		return { persistent: false };
	}
}

/**
 * The record, minting the install id on first need.
 *
 * The mint is `Crypto.randomUUID()` — the platform CSPRNG, no network, no
 * platform identifier (a device serial is exactly what the ADR does not want
 * here). It is idempotent: an existing record is returned untouched, so this is
 * safe to call from any surface that needs the device identity and cannot
 * double-mint under concurrent callers in one run — the second caller reads the
 * first's item before its own write would happen only under a true race, and
 * the register contract makes that harmless (a fresh id registers a fresh row;
 * the first one's row is the one the reader sees).
 */
export async function ensureInstallRecord(): Promise<InstallRecord> {
	const existing = await readInstallRecord();
	if (existing !== null) return existing;
	const minted: InstallRecord = { v: 1, install_id: Crypto.randomUUID() };
	await writeInstallRecord(minted);
	return minted;
}

/**
 * Records the outcome of a registration: the device id the machine minted and
 * the per-device key it returned (ADR §3.1: the response that mints the key is
 * the only place it is ever sent).
 */
export async function recordRegistration(
	deviceId: string,
	deviceKey: string,
): Promise<void> {
	const record = await ensureInstallRecord();
	await writeInstallRecord({
		...record,
		device_id: deviceId,
		device_key: deviceKey,
	});
}
