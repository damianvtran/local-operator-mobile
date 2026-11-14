/**
 * The "Notifications are off" nudge: one small, dismissible row at the top of
 * the drawer's session list while the OS permission is DENIED.
 *
 * WHY IT EXISTS. The operator's standing rule (2026-11-14): "the vast majority
 * of users don't interact heavily with settings nor want to, so the first
 * impression would be that 'Notifications don't work'". The primer covers
 * `undetermined`; a reader who said no (or turned alerts off in the OS) had no
 * way back except finding Settings → Notifications. The app cannot re-ask a
 * denied permission — only the OS settings can grant it — so the row's one
 * action opens them (`Linking.openSettings()`).
 *
 * WHEN IT SHOWS, and why each limit:
 *  - native and `denied` only. `undetermined` belongs to the primer, `granted`
 *    needs nothing, `unknown` is a failed read (not a refusal), and web has no
 *    OS settings page to open.
 *  - a dismissal hides it for `NUDGE_SNOOZE_MS` (14 days); after
 *    `NUDGE_MAX_DISMISSALS` (3) it never returns — a reader who keeps saying
 *    no has decided. Both are the operator's stated product bounds, not
 *    measured thresholds. Settings → Notifications keeps its remedy forever.
 *  - re-read on every app foreground, so a grant made in the OS settings
 *    removes the row when the reader comes back.
 *  - a corrupt record, or a keystore that cannot be read, shows nothing: the
 *    nudge must never become a nag it cannot remember dismissing (the same
 *    rule as `permission-primer.ts`).
 *
 * The record is a tiny device-only UI preference in the platform keystore,
 * the same pattern and lifecycle as the primer's record.
 */
import { Platform } from "react-native";

import {
	expoSecureStore,
	type SecureStoreAdapter,
	type SecureStoreOptions,
	thisDeviceOnlyAccessibility,
} from "@/connection/storage";
import type { PushAvailability } from "@/notifications/permission";

export const NUDGE_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;
export const NUDGE_MAX_DISMISSALS = 3;

/** SecureStore accepts only alphanumerics, `.`, `-`, `_`. */
export const NUDGE_RECORD_KEY = "lo-mobile-notifications-off-nudge";

export type NudgeRecord = { v: 1; dismissals: number; lastAt: number };

const SPENT: NudgeRecord = {
	v: 1,
	dismissals: NUDGE_MAX_DISMISSALS,
	lastAt: 0,
};

export const parseNudgeRecord = (raw: string | null): NudgeRecord | null => {
	if (raw === null) return null;
	try {
		const value = JSON.parse(raw) as Partial<NudgeRecord> | null;
		if (
			value !== null &&
			value.v === 1 &&
			Number.isInteger(value.dismissals) &&
			(value.dismissals as number) >= 0 &&
			typeof value.lastAt === "number" &&
			Number.isFinite(value.lastAt)
		) {
			return {
				v: 1,
				dismissals: value.dismissals as number,
				lastAt: value.lastAt,
			};
		}
	} catch {
		// Falls through to SPENT.
	}
	return SPENT;
};

export type NudgeRecords = {
	get: () => Promise<NudgeRecord | null>;
	set: (record: NudgeRecord) => Promise<void>;
};

type RecordStorage = Pick<SecureStoreAdapter, "getItemAsync" | "setItemAsync">;

export function createNudgeRecords(
	storage: () => Promise<RecordStorage>,
	options: () => Promise<SecureStoreOptions> = async () => ({}),
): NudgeRecords {
	return {
		async get() {
			return parseNudgeRecord(
				await (await storage()).getItemAsync(NUDGE_RECORD_KEY, await options()),
			);
		},
		async set(record) {
			await (await storage()).setItemAsync(
				NUDGE_RECORD_KEY,
				JSON.stringify(record),
				await options(),
			);
		},
	};
}

export const deviceNudgeRecords: NudgeRecords = createNudgeRecords(
	async () =>
		Platform.OS === "web"
			? {
					async getItemAsync(key) {
						return globalThis.localStorage?.getItem(key) ?? null;
					},
					async setItemAsync(key, value) {
						globalThis.localStorage?.setItem(key, value);
					},
				}
			: expoSecureStore(),
	async () =>
		Platform.OS === "web"
			? {}
			: { keychainAccessible: await thisDeviceOnlyAccessibility() },
);

export type NudgeDeps = {
	platform: string;
	readAvailability: () => Promise<PushAvailability>;
	records: NudgeRecords;
	now: () => number;
	/** `Linking.openSettings` — this app's page in the OS settings. */
	openSettings: () => Promise<void>;
	/** Subscribe to "the app came to the foreground"; returns the unsubscribe. */
	onForeground: (listener: () => void) => () => void;
};

/** The pure rule over one read of the permission and the record. */
const nudgeDue = (record: NudgeRecord | null, now: number): boolean => {
	if (record === null) return true;
	if (record.dismissals >= NUDGE_MAX_DISMISSALS) return false;
	// `now < lastAt` (a clock moved backwards) is NOT due: never early.
	return now - record.lastAt >= NUDGE_SNOOZE_MS;
};

async function evaluateNudge(deps: NudgeDeps): Promise<boolean> {
	if (deps.platform !== "ios" && deps.platform !== "android") return false;
	if ((await deps.readAvailability()) !== "denied") return false;
	return nudgeDue(await deps.records.get(), deps.now());
}

export type NudgeWatch = {
	/** Open the OS settings. The row stays until the next foreground re-read
	 *  says the permission is granted. */
	turnOn: () => Promise<void>;
	/** Hide now and record the dismissal (14-day snooze, 3 at most). */
	dismiss: () => Promise<void>;
	stop: () => void;
};

/**
 * Evaluate now and on every foreground, reporting visibility through
 * `onChange`. Evaluations are sequenced by a counter so a slow read that
 * started before a dismissal or a newer foreground never repaints the row.
 */
export function watchNudge(
	deps: NudgeDeps,
	onChange: (visible: boolean) => void,
): NudgeWatch {
	let stopped = false;
	let generation = 0;
	const evaluate = () => {
		const mine = ++generation;
		void evaluateNudge(deps)
			.catch(() => false)
			.then((visible) => {
				if (!stopped && mine === generation) onChange(visible);
			});
	};
	evaluate();
	const unsubscribe = deps.onForeground(evaluate);
	return {
		turnOn: () => deps.openSettings(),
		async dismiss() {
			generation++;
			onChange(false);
			const record = await deps.records.get().catch(() => null);
			await deps.records
				.set({
					v: 1,
					dismissals: (record?.dismissals ?? 0) + 1,
					lastAt: deps.now(),
				})
				.catch(() => undefined);
		},
		stop() {
			stopped = true;
			unsubscribe();
		},
	};
}
