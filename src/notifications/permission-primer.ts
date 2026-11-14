/**
 * The notification permission primer: the in-context sheet that asks a new
 * user to turn notifications on, and the rules that keep it from nagging.
 *
 * WHY IT EXISTS. Until 2026-11-14 the only surface that raised the OS prompt
 * was Settings → Notifications, so a user who never opened Settings never
 * granted permission and never received a push — the operator included, on
 * TestFlight build 953: "most users wouldn't realize this. Make sure that the
 * app requests to turn on notifications for new users that download it". Session
 * push registration stops at `permission` without a grant, so the phone never
 * registered with the computer at all.
 *
 * WHY A PRIMER AND NOT A BARE PROMPT. ADR 0006 §5 requires the OS prompt "in
 * context, with the §2.4 copy already on screen": iOS raises its dialog once
 * per install, and a refusal given to an unexplained dialog is permanent
 * (only system settings can undo it). The primer is that context — it says
 * what arrives before the OS asks, and only its primary button calls
 * `requestPermission()`. §5 was amended to name this surface; Settings remains
 * the fallback.
 *
 * THE ANTI-NAG RULE (operator, 2026-11-14), all enforced here:
 *  - offered only while the OS permission is `undetermined` — never for
 *    `granted`, never for `denied` (the OS will not prompt again; Settings keeps
 *    the "open system settings" remedy), never for `unsupported`/`unknown`;
 *  - never on web, where alerts are not an app capability (`permission.ts`);
 *  - the FIRST offer on the first arrival at a live computer on Home;
 *  - "Not now" persisted with its time; ONE re-offer, only after this run has
 *    seen a completed agent turn AND `PRIMER_REOFFER_AFTER_MS` has passed since
 *    the last offer or dismissal;
 *  - never a third offer (`PRIMER_MAX_OFFERS`).
 * An offer is recorded at SHOW time, not at dismissal, so an app killed with
 * the sheet up has still spent it; "Not now" then moves the clock forward.
 *
 * Pure on purpose: no React and no native module, so the policy is tested in
 * Node (`permission-primer.test.ts`) and the host component
 * (`features/notifications/permission-primer-sheet.tsx`) only wires it.
 */
import { Platform } from "react-native";
import { createStore } from "zustand/vanilla";

import {
	expoSecureStore,
	type SecureStoreAdapter,
	type SecureStoreOptions,
	thisDeviceOnlyAccessibility,
} from "@/connection/storage";
import type { PushAvailability } from "@/notifications/permission";

/** Three days between a dismissal and the single re-offer. Not a measured
 *  bound: it is the operator's stated product rule (2026-11-14 request). */
export const PRIMER_REOFFER_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** The first offer plus one re-offer; after that, Settings is the only path. */
export const PRIMER_MAX_OFFERS = 2;

/** The keystore key. SecureStore accepts only alphanumerics, `.`, `-`, `_`. */
export const PRIMER_RECORD_KEY = "lo-mobile-notification-primer";

/** What the device remembers: how many offers were made, and when the last
 *  offer or dismissal happened (epoch ms). Versioned so a later shape can be
 *  told from this one rather than misread. */
export type PrimerRecord = { v: 1; offers: number; lastAt: number };

/** A record that exists but cannot be read is SPENT, not absent: re-offering on
 *  a corrupt record is the nag this module exists to prevent. */
const SPENT: PrimerRecord = { v: 1, offers: PRIMER_MAX_OFFERS, lastAt: 0 };

export const parsePrimerRecord = (raw: string | null): PrimerRecord | null => {
	if (raw === null) return null;
	try {
		const value = JSON.parse(raw) as Partial<PrimerRecord> | null;
		if (
			value !== null &&
			value.v === 1 &&
			Number.isInteger(value.offers) &&
			(value.offers as number) >= 0 &&
			typeof value.lastAt === "number" &&
			Number.isFinite(value.lastAt)
		) {
			return { v: 1, offers: value.offers as number, lastAt: value.lastAt };
		}
	} catch {
		// Falls through to SPENT.
	}
	return SPENT;
};

export type PrimerRecords = {
	get: () => Promise<PrimerRecord | null>;
	set: (record: PrimerRecord) => Promise<void>;
};

type RecordStorage = Pick<SecureStoreAdapter, "getItemAsync" | "setItemAsync">;

/**
 * The record's storage, the same shape and lifecycle as the Team Bridge
 * notice dismissals (`team-bridge/notice-dismissals.ts`): a tiny, non-secret,
 * device-only UI preference in the platform keystore — outside the relay's
 * private-data family, so a sign-out or relay retirement does not erase it and
 * re-arm the primer for the same person on the same phone.
 */
export function createPrimerRecords(
	storage: () => Promise<RecordStorage>,
	options: () => Promise<SecureStoreOptions> = async () => ({}),
): PrimerRecords {
	return {
		async get() {
			return parsePrimerRecord(
				await (await storage()).getItemAsync(
					PRIMER_RECORD_KEY,
					await options(),
				),
			);
		},
		async set(record) {
			await (await storage()).setItemAsync(
				PRIMER_RECORD_KEY,
				JSON.stringify(record),
				await options(),
			);
		},
	};
}

/** The device's record. Native only in practice — the primer never shows on
 *  web — but web gets a localStorage reader so nothing here throws there. */
export const devicePrimerRecords: PrimerRecords = createPrimerRecords(
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

/**
 * The high-value moment the re-offer waits for: a completed agent turn seen in
 * this app run. In memory on purpose — "after the user's first completed turn"
 * is about the reader having just watched an agent finish, not about history.
 */
export const primerMomentStore = createStore<{ turnCompleted: boolean }>(
	() => ({ turnCompleted: false }),
);
export const markPrimerMoment = (): void => {
	if (!primerMomentStore.getState().turnCompleted)
		primerMomentStore.setState({ turnCompleted: true });
};
/** Tests only: a fresh run. */
export const resetPrimerMoment = (): void => {
	primerMomentStore.setState({ turnCompleted: false });
};

/**
 * Whether one list frame shows a turn finishing: a row that was `streaming` in
 * the previous frame and is present but not streaming in this one. A sent
 * message runs a turn, so this covers "first send" too, once that turn ends —
 * the moment the reader has seen what a notification would have told them.
 * A row that disappeared is not a completion (it ended, moved or was hidden).
 */
export const completedTurnObserved = (
	previous: readonly { session_id: string; streaming: boolean }[],
	next: readonly { session_id: string; streaming: boolean }[],
): boolean => {
	const wasStreaming = new Set(
		previous.filter((row) => row.streaming).map((row) => row.session_id),
	);
	if (wasStreaming.size === 0) return false;
	return next.some((row) => !row.streaming && wasStreaming.has(row.session_id));
};

export type PrimerDeps = {
	platform: string;
	readAvailability: () => Promise<PushAvailability>;
	records: PrimerRecords;
	now: () => number;
};

/**
 * Decide whether to show the primer now, and spend the offer if so. The caller
 * has already established the context (Home, live computer); this owns every
 * rule that can say no.
 */
export async function evaluatePrimer(deps: PrimerDeps): Promise<boolean> {
	if (deps.platform !== "ios" && deps.platform !== "android") return false;
	if ((await deps.readAvailability()) !== "undetermined") return false;
	const record = await deps.records.get();
	const now = deps.now();
	const offers = record?.offers ?? 0;
	const offer =
		offers === 0 ||
		(offers < PRIMER_MAX_OFFERS &&
			record !== null &&
			primerMomentStore.getState().turnCompleted &&
			now - record.lastAt >= PRIMER_REOFFER_AFTER_MS);
	if (!offer) return false;
	await deps.records.set({ v: 1, offers: offers + 1, lastAt: now });
	return true;
}

/** "Not now" (or any dismissal that is not the primary): restart the re-offer
 *  clock from this moment, keeping the offer count. */
export async function dismissPrimer(
	deps: Pick<PrimerDeps, "records" | "now">,
): Promise<void> {
	const record = await deps.records.get();
	await deps.records.set({
		v: 1,
		offers: Math.max(record?.offers ?? 0, 1),
		lastAt: deps.now(),
	});
}

export type AcceptDeps = {
	/** `native.ts`'s `requestPermission` — the OS dialog. */
	requestPermission: () => Promise<PushAvailability>;
	/** `requestSessionPushRegistration` — the routed computer learns this phone. */
	registerSession: () => void;
	radientSignedIn: boolean;
	/** Team Bridge's `registerPush` — Radient's hub learns this phone. */
	registerTeamBridge: () => Promise<void>;
};

/**
 * "Turn on notifications": ask the OS, then register immediately on a grant —
 * the same two entry points Settings' Allow press uses, so the phone is
 * reachable without a restart or a foreground. Nothing registers on any other
 * answer; a `denied` is final and the primer's own policy never offers again.
 */
export async function acceptPrimer(
	deps: AcceptDeps,
): Promise<PushAvailability> {
	const permission = await deps.requestPermission();
	if (permission !== "granted") return permission;
	deps.registerSession();
	if (deps.radientSignedIn) await deps.registerTeamBridge();
	return permission;
}
