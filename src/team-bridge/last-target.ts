/**
 * The last Team Bridge conversation a person opened, per Radient account and
 * organization — what a target-less "Team Bridge" entry reopens.
 *
 * WHY THIS EXISTS. Switching channels uses `router.replace` (#219/#222), so
 * the route stack never remembers where the reader was: every Home or drawer
 * entry landed on the channel list again and the reader had to find their
 * channel each time. The operator's standing parity item: "Restore the last
 * Bridge channel/group/DM per account and organization; explicit push/deep-link
 * targets override remembered selection down to the message."
 *
 * WHAT IT HOLDS. `{accountId, tenantId} → conversationId` only. Ids, never
 * titles, bodies or tokens, so nothing here is private message content.
 *
 * LIFECYCLE (mirrors `thread-drafts.ts`, deliberately):
 * - Keyed by `[accountId, tenantId]`; a lookup without an account id returns
 *   nothing, so a signed-out or not-yet-identified store can never read
 *   another person's entry, and two organizations never share one.
 * - `clearTeamBridgeTargets()` runs next to `clearTeamBridgeDrafts()` in the
 *   store's `retire()` and `reset()` — sign-out, account deletion (retirement)
 *   and account replacement — synchronously, so nothing crosses an
 *   authentication boundary even in memory.
 * - In memory only, like drafts: a synchronous wipe is the guarantee the
 *   boundary rests on, and an async keystore delete that can fail cannot give
 *   it. A cold launch therefore opens the list; cross-launch memory is a
 *   follow-up that needs its own account-scoped erase path.
 *
 * NO SIZE CAP: at most one entry per organization the signed-in account
 * belongs to, emptied at every account boundary.
 */

const targets = new Map<string, string>();

const keyOf = (accountId: string | null, tenantId: string | null) =>
	accountId && tenantId ? JSON.stringify([accountId, tenantId]) : null;

/** Record a successful open. "new" (an unsent draft DM) is not a conversation. */
export function rememberTeamBridgeTarget(
	accountId: string | null,
	tenantId: string,
	conversationId: string,
): void {
	const key = keyOf(accountId, tenantId);
	if (!key || !conversationId || conversationId === "new") return;
	targets.set(key, conversationId);
}

export function recallTeamBridgeTarget(
	accountId: string | null,
	tenantId: string | null,
): string | null {
	const key = keyOf(accountId, tenantId);
	return key ? (targets.get(key) ?? null) : null;
}

/**
 * Drop a stale entry. Only when it still names `conversationId`, so a late
 * failure from an older thread cannot erase a newer open in the same org.
 */
export function forgetTeamBridgeTarget(
	accountId: string | null,
	tenantId: string,
	conversationId: string,
): void {
	const key = keyOf(accountId, tenantId);
	if (key && targets.get(key) === conversationId) targets.delete(key);
}

export function clearTeamBridgeTargets(): void {
	targets.clear();
}

/**
 * What a target-less entry onto the list route does, decided purely so every
 * branch is a Node test:
 * - `wait`: the organization's conversation list has not settled yet;
 * - `list`: nothing remembered, the list failed to load, or the remembered
 *   conversation is gone from a fully loaded list (the entry is cleared —
 *   a removed or inaccessible channel must never be a dead end);
 * - `open`: replace the list with the remembered thread.
 */
export type RestoreDecision =
	| { kind: "wait" }
	| { kind: "list" }
	| { kind: "open"; tenantId: string; conversationId: string };

export function restoreDecision(input: {
	accountId: string | null;
	tenantId: string | null;
	conversationsState: "idle" | "loading" | "ready" | "error" | undefined;
	conversationIds: readonly string[];
}): RestoreDecision {
	const { accountId, tenantId } = input;
	const remembered = recallTeamBridgeTarget(accountId, tenantId);
	if (!tenantId || !remembered) return { kind: "list" };
	if (input.conversationsState === "error") return { kind: "list" };
	if (input.conversationsState !== "ready") return { kind: "wait" };
	// `loadOrganization` walks every page before it says "ready", so absence
	// here is absence from the directory, not an unread later page.
	if (!input.conversationIds.includes(remembered)) {
		forgetTeamBridgeTarget(accountId, tenantId, remembered);
		return { kind: "list" };
	}
	return { kind: "open", tenantId, conversationId: remembered };
}

/** A thread-open failure that means "this conversation is not yours to open". */
export const isGoneStatus = (status: number | null | undefined): boolean =>
	status === 403 || status === 404;

/**
 * The directory's marked row (A7, round-1 R1-2 / D5 / U1-6). On a thread the
 * open conversation is marked and it IS the current page. From Home or an
 * agent chat the remembered conversation is marked too — visually only, as a
 * preview of where "Team Bridge" will land — and must NOT announce
 * `aria-current="page"` / `selected`: a screen reader would call a page the
 * reader is not on "current". `current` says which of the two it is.
 */
export function directoryMark(
	openRoute: { tenantId: string; conversationId: string } | null,
	remembered: string | null,
	tenantId: string | null,
): {
	route: { tenantId: string; conversationId: string } | null;
	current: boolean;
} {
	if (openRoute) return { route: openRoute, current: true };
	if (remembered && tenantId)
		return { route: { tenantId, conversationId: remembered }, current: false };
	return { route: null, current: false };
}
