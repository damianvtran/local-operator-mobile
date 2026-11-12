import { badgeWritesSettled } from "@/notifications/app-badge";
import {
	type AttentionPush,
	attentionPushFromData,
	conversationPushFromData,
	pushDataObject,
} from "@/notifications/payload";
import { teamBridgePushFromData } from "@/team-bridge/push-payload";

/**
 * What the background notification task does with a silent attention push: the
 * cloud's "the reader acknowledged something on another surface" wake (ADR 0006
 * §1.5, §3.2 attention form; agent-server SESSION-PUSH §3.3). Goal: the icon
 * badge and the delivered banners catch up while the app is backgrounded,
 * instead of waiting for the next foreground.
 *
 * PURE apart from the injected deps, so every branch is a Node test; the task
 * registration that feeds it lives in `background-task.ts`.
 *
 * THE CONSTRAINTS IT KEEPS, and why each one shapes the code:
 *  - It never writes the badge itself. `app-badge.ts` is the one badge writer,
 *    and Team Bridge's source follows its store (`team-bridge/badge.ts`). The
 *    task asks the LIVE, signed-in store to re-read unread; the store's
 *    generation check drops a read that lands after an account switch, and its
 *    subscription moves the badge through `app-badge.ts`. The task then only
 *    waits for those writes to settle before iOS may suspend it.
 *  - Signed out writes nothing. The live scope is registered only while a
 *    Radient account is signed in (`team-bridge/provider.tsx`); with no scope
 *    the task returns before touching the badge or the tray.
 *  - It only DISMISSES what a fresh read proves read. A Team Bridge banner goes
 *    when the fresh account read says its organization (or the whole account)
 *    has nothing unread. A computer (relay) banner goes only when this attention
 *    push reports `count: 0` for that banner's computer: the attention form
 *    carries no conversation handle, so a non-zero count cannot say WHICH
 *    conversations were read, and a banner that might still be unread stays.
 *  - Bounded and never throws: iOS gives a background fetch ~30 s, so the whole
 *    run races `BUDGET_MS` and every failure becomes a result value.
 */

/** iOS allows a background remote-notification fetch about 30 s; stay inside it. */
export const BUDGET_MS = 25_000;
/**
 * How long to wait for the signed-in scope to appear. A silent push can launch
 * the app straight into the background; the provider mounts and registers its
 * scope a moment later, after the connection's cold start restores the account.
 */
export const SCOPE_WAIT_MS = 8_000;

/**
 * Mirrors expo-notifications' `BackgroundNotificationTaskResult` (NewData 0,
 * NoData 1, Failed 2) so this module needs no native import to be tested.
 */
export const BackgroundResult = { NewData: 0, NoData: 1, Failed: 2 } as const;
export type BackgroundResult =
	(typeof BackgroundResult)[keyof typeof BackgroundResult];

/** What one fresh unread read said, at the granularity the hub gives. */
export interface UnreadSnapshot {
	total: number;
	byTenant: ReadonlyMap<string, number>;
}

/** The signed-in Team Bridge store, as the background task may use it. */
export interface BackgroundUnreadScope {
	/** False once the account behind this scope is retired (switch, sign-out). */
	isActive(): boolean;
	/**
	 * Re-read unread through the store (single-flight, generation-checked). The
	 * snapshot is non-null only when THIS read landed for this account; a failed,
	 * dropped or superseded read is `null`, and nothing is dismissed on it.
	 */
	refreshUnread(): Promise<UnreadSnapshot | null>;
}

/** A delivered notification, reduced to what the clear reads. */
export interface PresentedNotification {
	identifier: string;
	/** `request.content.data` as expo hands it over. */
	data: unknown;
}

export interface BackgroundClearDeps {
	/** The live scope, waiting up to `timeoutMs` for one; `null` = signed out. */
	scope(timeoutMs: number): Promise<BackgroundUnreadScope | null>;
	presented(): Promise<PresentedNotification[]>;
	dismiss(identifier: string): Promise<void>;
	/** Defaults to `badgeWritesSettled`; injectable for tests. */
	badgeSettled?: () => Promise<void>;
	/** Timer seam for the budget; defaults to the global timers. */
	setTimer?: (run: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

/** The attention push inside a background task payload, or `null`. */
export function attentionFromTaskPayload(
	payload: unknown,
): AttentionPush | null {
	if (payload === null || typeof payload !== "object") return null;
	// The task's payload is `{data, notification, aps?}`; a notification
	// RESPONSE (an Android action tap) has no `data` key and is not a wake.
	const data = (payload as Record<string, unknown>).data;
	return attentionPushFromData(data);
}

/**
 * Which presented notifications the fresh state proves read. Exported for the
 * tests; the rules are the module comment's.
 */
export function readNotificationIds(
	presented: readonly PresentedNotification[],
	attention: AttentionPush,
	unread: UnreadSnapshot | null,
): string[] {
	const ids: string[] = [];
	for (const notification of presented) {
		const data = pushDataObject(notification.data);
		if (data === null) continue;
		const bridge = teamBridgePushFromData(data);
		if (bridge !== null) {
			if (
				unread !== null &&
				(unread.total === 0 || unread.byTenant.get(bridge.tenantId) === 0)
			) {
				ids.push(notification.identifier);
			}
			continue;
		}
		// Computer banners: completion (has a conversation) and digest (does not).
		const relayComputer =
			conversationPushFromData(data)?.computer ??
			(data.type === "digest" && typeof data.computer === "string"
				? data.computer
				: null);
		if (relayComputer === attention.computer && attention.count === 0) {
			ids.push(notification.identifier);
		}
	}
	return ids;
}

async function clear(
	attention: AttentionPush,
	deps: BackgroundClearDeps,
	expired: () => boolean,
): Promise<BackgroundResult> {
	const scope = await deps.scope(SCOPE_WAIT_MS);
	if (scope === null || !scope.isActive() || expired()) {
		return BackgroundResult.NoData;
	}
	const unread = await scope.refreshUnread();
	// The badge moved (or not) through the store's own subscription; let those
	// writes reach the OS before the task can be suspended.
	await (deps.badgeSettled ?? badgeWritesSettled)();
	// An account switch during the read: the store already dropped it, and
	// nothing of the old account's may touch the new account's tray.
	if (!scope.isActive() || expired()) return BackgroundResult.NoData;
	const ids = readNotificationIds(await deps.presented(), attention, unread);
	if (!scope.isActive() || expired()) return BackgroundResult.NoData;
	for (const id of ids) {
		try {
			await deps.dismiss(id);
		} catch {
			// Already gone (the reader swiped it) is the same end state.
		}
	}
	return unread !== null || ids.length > 0
		? BackgroundResult.NewData
		: BackgroundResult.NoData;
}

/**
 * The task body. Returns a result for every input and every failure; it never
 * throws and never runs past `budgetMs`.
 */
export async function runBackgroundClear(
	payload: unknown,
	deps: BackgroundClearDeps,
	budgetMs: number = BUDGET_MS,
): Promise<BackgroundResult> {
	const attention = attentionFromTaskPayload(payload);
	if (attention === null) return BackgroundResult.NoData;
	const setTimer =
		deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
	const clearTimer =
		deps.clearTimer ??
		((handle: unknown) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>));
	let timedOut = false;
	let handle: unknown;
	const budget = new Promise<BackgroundResult>((resolve) => {
		handle = setTimer(() => {
			timedOut = true;
			resolve(BackgroundResult.Failed);
		}, budgetMs);
	});
	const work = clear(attention, deps, () => timedOut).catch(
		() => BackgroundResult.Failed,
	);
	try {
		return await Promise.race([work, budget]);
	} finally {
		clearTimer(handle);
	}
}

// ---------------------------------------------------------------------------
// The live-scope registry: how the provider hands its signed-in store to a task
// that runs outside React.
// ---------------------------------------------------------------------------

let current: BackgroundUnreadScope | null = null;
const waiters = new Set<(scope: BackgroundUnreadScope) => void>();

/**
 * Register the signed-in scope; returns the unregister. Called by the
 * Team Bridge provider only while an account is signed in, so its absence IS
 * "signed out" to the task.
 */
export function registerBackgroundUnreadScope(
	scope: BackgroundUnreadScope,
): () => void {
	current = scope;
	for (const wake of [...waiters]) wake(scope);
	return () => {
		if (current === scope) current = null;
	};
}

/** The registered scope, waiting up to `timeoutMs` for one to appear. */
export function waitForBackgroundUnreadScope(
	timeoutMs: number,
): Promise<BackgroundUnreadScope | null> {
	if (current !== null) return Promise.resolve(current);
	return new Promise((resolve) => {
		const wake = (scope: BackgroundUnreadScope | null) => {
			clearTimeout(timer);
			waiters.delete(wake);
			resolve(scope);
		};
		const timer = setTimeout(() => wake(null), timeoutMs);
		waiters.add(wake);
	});
}

/** Test seam. */
export function resetBackgroundUnreadScopeForTests(): void {
	current = null;
	waiters.clear();
}
