import type { PrivateDataKeys } from "@/connection/private-data-key";
import { type PrivateDataKey, SecureStorageError } from "@/connection/storage";

export interface InstallationMarker {
	read(): Promise<string | null>;
	write(id: string): Promise<void>;
	clear(): Promise<void>;
}
/** A cache sentinel intentionally is NOT recoverable from Keychain. iOS can
 * preserve Keychain through reinstall, and backups can restore app documents.
 * Missing/evicted/mismatched cache => cryptographic erasure, never adoption.
 * The platform owner serializes bootstrap and all destruction with its writers. */
export async function openPrivateInstallation(deps: {
	marker: InstallationMarker;
	keys: PrivateDataKeys;
	purgeCiphertext(): Promise<void>;
	create(): Promise<PrivateDataKey>;
}): Promise<PrivateDataKey> {
	let marker: string | null = null;
	let saved: PrivateDataKey | null = null;
	// Unknown I/O/locked-store errors are not evidence of reinstall or absence.
	// Quarantine without deleting recoverable work until the platform can read.
	marker = await deps.marker.read();
	try {
		saved = await deps.keys.read();
	} catch (error) {
		if (!(error instanceof SecureStorageError)) throw error;
		// A positively identified malformed record is reset, never adopted.
	}
	if (marker !== null && saved !== null && marker === saved.installId)
		return saved;

	// Attempt every erasure even if another fails. Do not mint a replacement key
	// until removal has been verified, or a failed wipe could look like recovery.
	const results = await Promise.allSettled([
		deps.purgeCiphertext(),
		deps.keys.clear(),
		deps.marker.clear(),
	]);
	for (const result of results)
		if (result.status === "rejected") throw result.reason;
	const next = await deps.create();
	await deps.marker.write(next.installId);
	if ((await deps.marker.read()) !== next.installId)
		throw new Error("private installation marker could not be confirmed");
	await deps.keys.write(next);
	const confirmed = await deps.keys.read();
	if (
		confirmed?.installId !== next.installId ||
		confirmed.keyHex !== next.keyHex
	)
		throw new Error("private installation key could not be confirmed");
	return next;
}
