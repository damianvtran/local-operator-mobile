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
type RetiringDraftWriter = (key: string, value: string | null) => Promise<void>;
const retiringCheckpoints = new Set<
	(generation: string, write: RetiringDraftWriter) => Promise<void>
>();
export function registerRetiringDraftCheckpoint(
	checkpoint: (generation: string, write: RetiringDraftWriter) => Promise<void>,
): () => void {
	retiringCheckpoints.add(checkpoint);
	return () => {
		retiringCheckpoints.delete(checkpoint);
	};
}
startupAuthorizationLifecycle.configureRecoveryBoundary({
	checkpoint: async (generation, comparisonAuthority) => {
		if (Platform.OS === "web") return;
		// This comparison tuple grants blind writes/deletion only. The vault's
		// read lease stays withdrawn until a fresh /me proof matches after login.
		for (const checkpoint of retiringCheckpoints)
			await checkpoint(generation, (key, value) =>
				vault.checkpointRetiring(comparisonAuthority, key, value),
			);
	},
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

const recoveryListeners = new Set<() => void>();
let recoveryRevision = 0;
export const subscribeDraftRecovery = (listener: () => void): (() => void) => {
	recoveryListeners.add(listener);
	return () => {
		recoveryListeners.delete(listener);
	};
};
export const getDraftRecoveryRevision = (): number => recoveryRevision;
export function notifyDraftRecoveryReady(): void {
	recoveryRevision++;
	for (const listener of recoveryListeners) listener();
}
export const getDraftRecoveryAuthority = (): string | null =>
	getStartupAuthorization() === null ? null : vault.authorityScope();
export async function prepareOrdinaryPrivateStorage(): Promise<void> {
	if (Platform.OS !== "web") await clearNativePickerCache();
}

/** Failure to prove/recover does not block the authenticated relay. It simply
 * leaves the sealed vault closed. No cached identity is promoted offline. */
export async function prepareDraftRecovery(
	authority: string | null,
	isCurrent: () => boolean,
): Promise<void> {
	if (Platform.OS === "web") return;
	if (authority === null || !isCurrent()) {
		vault.withdraw();
		return;
	}
	try {
		await vault.drain();
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
