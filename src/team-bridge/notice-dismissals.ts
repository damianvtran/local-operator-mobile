import { Platform } from "react-native";
import {
	expoSecureStore,
	type SecureStoreAdapter,
	type SecureStoreOptions,
	thisDeviceOnlyAccessibility,
} from "@/connection/storage";
import type { NoticeDismissals } from "@/team-bridge/store";

/** A dismissal is a durable UI preference for one Radient account + organization,
 * NOT relay-session private data. `deviceStore` now fences and erases the relay's
 * private family on retirement; using it makes direct-hub dismissals silently
 * disappear when no relay is admitted. Keep this tiny record outside that family
 * without reopening its writer barrier or retaining drafts/tokens.
 *
 * Native uses the existing platform-keystore adapter (no new filesystem or key
 * lifecycle), device-only like other records. Web stores only the non-authorizing
 * dismissal bit in localStorage, never a bearer. Storage errors propagate: the
 * caller can still hide the banner for this session, but must not claim durability.
 */
export const NOTICE_KEY_PREFIX = "lo-mobile-tb-default-on-notice.";

// SecureStore allows only alphanumerics, '.', '-' and '_'. Fixed-width UTF-16
// encoding is injective even for punctuation/Unicode and cannot alias two owners.
const keyPart = (value: string): string =>
	Array.from({ length: value.length }, (_, i) =>
		value.charCodeAt(i).toString(16).padStart(4, "0"),
	).join("");
export const noticeKey = (accountId: string, tenantId: string): string =>
	`${NOTICE_KEY_PREFIX}${keyPart(accountId)}.${keyPart(tenantId)}`;

type NoticeStorage = Pick<SecureStoreAdapter, "getItemAsync" | "setItemAsync">;
export function createNoticeDismissals(
	storage: () => Promise<NoticeStorage>,
	options: () => Promise<SecureStoreOptions> = async () => ({}),
): NoticeDismissals {
	return {
		async has(accountId, tenantId) {
			return (
				(await (
					await storage()
				).getItemAsync(noticeKey(accountId, tenantId), await options())) === "1"
			);
		},
		async set(accountId, tenantId) {
			await (await storage()).setItemAsync(
				noticeKey(accountId, tenantId),
				"1",
				await options(),
			);
		},
	};
}

const webStorage: NoticeStorage = {
	async getItemAsync(key) {
		return globalThis.localStorage.getItem(key);
	},
	async setItemAsync(key, value) {
		globalThis.localStorage.setItem(key, value);
	},
};
export const deviceNoticeDismissals = createNoticeDismissals(
	async () => (Platform.OS === "web" ? webStorage : expoSecureStore()),
	async () =>
		Platform.OS === "web"
			? {}
			: { keychainAccessible: await thisDeviceOnlyAccessibility() },
);
