/**
 * The two React ends of the last-target memory (`@/team-bridge/last-target`):
 * the list route that RESTORES it and the thread that RECORDS (or drops) it.
 * Kept apart from the screens so their behaviour is driven from the outside
 * in Node tests with a real store, not re-derived from a rendered tree.
 */
import { usePathname, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import {
	forgetTeamBridgeTarget,
	isGoneStatus,
	rememberTeamBridgeTarget,
	restoreDecision,
} from "@/team-bridge/last-target";
import { useTeamBridgeState } from "@/team-bridge/provider";

/** The list route's own path; anything else is a thread, a draft DM or not Bridge. */
export const TEAM_BRIDGE_LIST_PATH = "/team-bridge";

/**
 * RESTORE THE LAST CONVERSATION. A target-less entry onto the list route —
 * Home's or the drawer footer's "Team Bridge", the drawer pane's "Open Team
 * Bridge" — reopens the conversation this account last opened in the
 * selected organization, straight into the thread with `replace`: the list's
 * place in the stack goes to the thread exactly as a row pick does
 * (#219/#222), so Back still leaves Team Bridge and the hamburger still
 * reaches the list in the drawer. Switching organization here reopens THAT
 * organization's last conversation, or stays on its list when it has none.
 *
 * GUARDS:
 * - Only while the list route is the focused one (`pathname`): an explicit
 *   push tap or deep link lands on a thread and never passes through here, and
 *   a list left beneath another screen must not replace what is on top.
 * - Once per account + organization per mount: returning to the list (Back
 *   from a pushed thread, or the stale-target fallback) shows the list rather
 *   than bouncing the reader into a thread again. Leaving the list before it
 *   decided counts as deciding: the reader picked something else.
 * - Waits for the organization's full conversation list; a remembered id not
 *   in it is cleared and the list stays (never a dead end). The thread handles
 *   a later 403/404 itself by falling back here (`restored=1`).
 */
export function useRestoreLastTarget(): void {
	const router = useRouter();
	const pathname = usePathname();
	const gate = useTeamBridgeState((s) => s.gate);
	const accountId = useTeamBridgeState((s) => s.selfAccountId);
	const tenantId = useTeamBridgeState((s) => s.selectedTenantId);
	const org = useTeamBridgeState((s) =>
		s.selectedTenantId ? s.orgs[s.selectedTenantId] : undefined,
	);
	const decided = useRef(new Set<string>());
	const seenList = useRef(false);
	useEffect(() => {
		if (gate !== "open") return;
		const key = JSON.stringify([accountId, tenantId]);
		if (pathname !== TEAM_BRIDGE_LIST_PATH) {
			/* The reader left this list for another target BEFORE it decided
			 *  (a push tap or deep link landed while the organization list was
			 *  still loading underneath). They chose; this mount gives up its
			 *  restore for that account + organization. Otherwise Back from that
			 *  thread reached a list deciding for the first time, and it replaced
			 *  itself with the thread just left: Back looked like it did nothing
			 *  (round-1 R1-1 / U1-5). `seenList` keeps a mount that has not yet
			 *  shown the list from deciding on a path it never had. */
			if (seenList.current) decided.current.add(key);
			return;
		}
		seenList.current = true;
		if (decided.current.has(key)) return;
		const decision = restoreDecision({
			accountId,
			tenantId,
			conversationsState: org?.conversationsState,
			conversationIds: (org?.conversations ?? []).map((c) => c.id),
		});
		if (decision.kind === "wait") return;
		decided.current.add(key);
		if (decision.kind === "open")
			router.replace({
				pathname: "/team-bridge/[tenantId]/[conversationId]",
				params: {
					tenantId: decision.tenantId,
					conversationId: decision.conversationId,
					restored: "1",
				},
			});
	}, [gate, pathname, accountId, tenantId, org, router]);
}

/**
 * The thread's side. An ADMITTED conversation is a successful open: record it
 * for this account + organization, whichever way it was reached — a row pick,
 * an explicit push/deep link (which so becomes the new memory) or a restore.
 *
 * Returns `gone()`, for a 403/404 on this conversation: forget it (only if it
 * is still the remembered one) and, when memory rather than the reader chose
 * it (`restored`), fall back to the list instead of stranding them on an
 * error. An explicit target keeps its error state: they asked for exactly
 * that conversation and should be told it is unavailable. A thread-read
 * 403/404 (`threadErrorStatus`) triggers it here; the screen calls it for a
 * metadata read's.
 */
export function useRememberedThread(input: {
	admitted: boolean;
	accountId: string | null;
	tenantId: string;
	conversationId: string | null;
	restored: boolean;
	threadErrorStatus: number | null | undefined;
}): () => void {
	const router = useRouter();
	const { admitted, accountId, tenantId, conversationId, restored } = input;
	useEffect(() => {
		if (admitted && conversationId)
			rememberTeamBridgeTarget(accountId, tenantId, conversationId);
	}, [admitted, accountId, tenantId, conversationId]);
	const gone = useRef(() => {});
	gone.current = () => {
		if (!conversationId) return;
		forgetTeamBridgeTarget(accountId, tenantId, conversationId);
		// Replace, never push: the list takes the thread's place, as a row pick does.
		if (restored) router.replace(TEAM_BRIDGE_LIST_PATH as never);
	};
	useEffect(() => {
		if (isGoneStatus(input.threadErrorStatus)) gone.current();
	}, [input.threadErrorStatus]);
	// Stable identity: the screen calls it from an async catch.
	const call = useRef(() => gone.current()).current;
	return call;
}
