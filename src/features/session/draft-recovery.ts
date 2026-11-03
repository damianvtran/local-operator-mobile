import { Platform } from "react-native";
import {
	getStartupAuthorization,
	startupAuthorizationLifecycle,
} from "@/connection/startup-authorization";
import { DraftRecoveryVault } from "./draft-recovery-vault";
import {
	eraseNativePrivateInstallation,
	nativePrivateStore,
} from "./native-private-store";
import { clearNativePickerCache } from "./picker-cache";
import { pickerPrivacy } from "./picker-privacy";

const vault = new DraftRecoveryVault(
	nativePrivateStore("recovery"),
	eraseNativePrivateInstallation,
);
startupAuthorizationLifecycle.configureRecoveryBoundary({
	withdraw: () => {
		vault.withdraw();
		pickerPrivacy.withdraw();
	},
	drain: async () => {
		await Promise.all([vault.drain(), pickerPrivacy.drain()]);
	},
	admitted: pickerPrivacy.reopen,
	clear: async (policy) => {
		if (Platform.OS === "web") return;
		const results = await Promise.allSettled([
			clearNativePickerCache(),
			policy === "retire" ? vault.clear() : Promise.resolve(),
		]);
		for (const result of results)
			if (result.status === "rejected") throw result.reason;
	},
});

/** Failure to prove/recover does not block the authenticated relay. It simply
 * leaves the sealed vault closed. No cached identity is promoted offline. */
export async function prepareDraftRecovery(
	authority: string | null,
	isCurrent: () => boolean,
): Promise<void> {
	if (Platform.OS === "web") return;
	// A killed picker may have left a native temporary image before JS received
	// its URI. This verified cleanup is mandatory even when owner proof fails.
	await clearNativePickerCache();
	if (authority === null || !isCurrent()) {
		vault.withdraw();
		return;
	}
	try {
		await vault.prepare(authority, isCurrent);
	} catch {
		vault.withdraw();
	}
}
/** Observers and privacy owners can wait for accepted sealed edits without
 * obtaining a recovery capability or touching their plaintext. */
export const awaitDraftRecoveryWrites = vault.drain;
export const isDraftRecoveryAdmitted = (): boolean =>
	getStartupAuthorization() !== null && vault.available();

const admitted = (scope: string | null) =>
	scope !== null && getStartupAuthorization()?.scope === scope;
export async function readRecoveryDraft(
	key: string,
	scope: string | null,
): Promise<string | null> {
	if (Platform.OS === "web" || !admitted(scope)) return null;
	try {
		const value = await vault.read(key);
		return admitted(scope) ? value : null;
	} catch {
		return null;
	}
}
export async function writeRecoveryDraft(
	key: string,
	value: string,
	scope: string | null,
): Promise<void> {
	if (Platform.OS !== "web" && admitted(scope)) {
		if (value === "") await vault.remove(key);
		else await vault.write(key, value);
	}
}
export async function discardRecoveryDraft(
	key: string,
	scope: string | null,
): Promise<void> {
	if (Platform.OS !== "web" && admitted(scope)) await vault.remove(key);
}
