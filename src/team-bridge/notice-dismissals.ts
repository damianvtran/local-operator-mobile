/**
 * Where the default-on notice remembers it was dismissed.
 *
 * WHY THE DEVICE STORE, NOT THE KEYSTORE. A dismissal is a UI preference, not a
 * credential: nothing here authorises anything, and losing it costs one extra
 * banner. `features/session/device-storage` is the app's plain key/value port
 * (localStorage on web, a small file natively) and is what other non-secret
 * per-device records use. It deliberately survives sign-out via
 * `clearAllDrafts` (that clears only the draft family), so signing out and back
 * in as the SAME account does not resurrect a notice the person already closed.
 *
 * KEYED BY ACCOUNT AND ORGANIZATION. The notice is about one endpoint in one
 * organization for one person, so a second account on a shared phone, or a
 * second organization, gets its own first (and only) notice. The record never
 * expires: the product rule is "never returns once dismissed".
 */
import { deviceStore } from "@/features/session/device-storage";
import type { NoticeDismissals } from "@/team-bridge/store";

export const NOTICE_KEY_PREFIX = "lo-mobile-tb-default-on-notice:";

export const noticeKey = (accountId: string, tenantId: string): string =>
	`${NOTICE_KEY_PREFIX}${encodeURIComponent(accountId)}:${encodeURIComponent(tenantId)}`;

export const deviceNoticeDismissals: NoticeDismissals = {
	async has(accountId, tenantId) {
		return (await deviceStore.get(noticeKey(accountId, tenantId))) !== null;
	},
	async set(accountId, tenantId) {
		await deviceStore.set(noticeKey(accountId, tenantId), "1");
	},
};
