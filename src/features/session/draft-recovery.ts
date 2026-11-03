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

const vault = new DraftRecoveryVault(
	nativePrivateStore("recovery"),
	eraseNativePrivateInstallation,
);
startupAuthorizationLifecycle.configureRecoveryBoundary({
	withdraw: vault.withdraw,
	drain: vault.drain,
	clear: async (policy) => {
		if (Platform.OS !== "web" && policy === "retire") await vault.clear();
	},
});

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
		await vault.prepare(authority, isCurrent);
	} catch {
		vault.withdraw();
	}
}
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
	if (Platform.OS !== "web" && admitted(scope)) await vault.write(key, value);
}
export async function discardRecoveryDraft(
	key: string,
	scope: string | null,
): Promise<void> {
	if (Platform.OS !== "web" && admitted(scope)) await vault.remove(key);
}
