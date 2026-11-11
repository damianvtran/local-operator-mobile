import { afterEach, describe, expect, it } from "vitest";
import {
	clearTeamBridgeTargets,
	directoryMark,
	forgetTeamBridgeTarget,
	recallTeamBridgeTarget,
	rememberTeamBridgeTarget,
	restoreDecision,
} from "@/team-bridge/last-target";
import { teamBridgeThreadPath } from "@/team-bridge/push-payload";
import { createTeamBridgeStore } from "@/team-bridge/store";
import { ADA, OTHER_TENANT, SELF, TENANT } from "./fixtures";

/**
 * The last-target memory's contract from the outside: what one account
 * remembers per organization, what nobody else can read, and when it is gone.
 */
afterEach(() => clearTeamBridgeTargets());

const store = () =>
	createTeamBridgeStore({
		hub: () => {
			throw new Error("no hub in this test");
		},
		accessToken: async () => null,
	});

describe("last-target memory", () => {
	it("is keyed per account AND organization", () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_general");
		rememberTeamBridgeTarget(SELF, OTHER_TENANT, "conv_ops");
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBe("conv_general");
		expect(recallTeamBridgeTarget(SELF, OTHER_TENANT)).toBe("conv_ops");
		// A later open in one org replaces only that org's entry.
		rememberTeamBridgeTarget(SELF, TENANT, "conv_dm_ada");
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBe("conv_dm_ada");
		expect(recallTeamBridgeTarget(SELF, OTHER_TENANT)).toBe("conv_ops");
	});

	it("never leaks across accounts, even in the same organization", () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_private_dm");
		expect(recallTeamBridgeTarget(ADA, TENANT)).toBeNull();
		// No identity (signed out / not yet read) reads nothing at all.
		expect(recallTeamBridgeTarget(null, TENANT)).toBeNull();
		rememberTeamBridgeTarget(null, TENANT, "conv_x");
		expect(recallTeamBridgeTarget(null, TENANT)).toBeNull();
		rememberTeamBridgeTarget(ADA, TENANT, "conv_ada_channel");
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBe("conv_private_dm");
		expect(recallTeamBridgeTarget(ADA, TENANT)).toBe("conv_ada_channel");
	});

	it("does not remember an unsent draft DM route", () => {
		rememberTeamBridgeTarget(SELF, TENANT, "new");
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBeNull();
	});

	it("is wiped by sign-out (retire) and account reset, where drafts are", () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_general");
		store().actions.reset();
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBeNull();
		rememberTeamBridgeTarget(SELF, TENANT, "conv_general");
		rememberTeamBridgeTarget(ADA, OTHER_TENANT, "conv_ops");
		store().actions.retire();
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBeNull();
		expect(recallTeamBridgeTarget(ADA, OTHER_TENANT)).toBeNull();
	});

	it("forgets only the entry it names, so a late failure cannot erase a newer open", () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_new");
		forgetTeamBridgeTarget(SELF, TENANT, "conv_old");
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBe("conv_new");
		forgetTeamBridgeTarget(SELF, TENANT, "conv_new");
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBeNull();
	});
});

describe("restoreDecision", () => {
	const base = {
		accountId: SELF,
		tenantId: TENANT,
		conversationsState: "ready" as const,
		conversationIds: ["conv_general", "conv_ops"],
	};

	it("opens the remembered conversation once the directory has it", () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_ops");
		expect(restoreDecision(base)).toEqual({
			kind: "open",
			tenantId: TENANT,
			conversationId: "conv_ops",
		});
	});

	it("shows the list when nothing is remembered for this account + org", () => {
		rememberTeamBridgeTarget(SELF, OTHER_TENANT, "conv_ops");
		expect(restoreDecision(base)).toEqual({ kind: "list" });
		expect(restoreDecision({ ...base, accountId: ADA })).toEqual({
			kind: "list",
		});
	});

	it("waits for the conversation list rather than guessing", () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_ops");
		for (const conversationsState of ["idle", "loading", undefined] as const)
			expect(
				restoreDecision({ ...base, conversationsState, conversationIds: [] }),
			).toEqual({ kind: "wait" });
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBe("conv_ops");
	});

	it("a stale target falls back to the list and is cleared", () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_deleted");
		expect(restoreDecision(base)).toEqual({ kind: "list" });
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBeNull();
	});

	it("a failed list read shows the list but keeps the memory for a retry", () => {
		rememberTeamBridgeTarget(SELF, TENANT, "conv_ops");
		expect(restoreDecision({ ...base, conversationsState: "error" })).toEqual({
			kind: "list",
		});
		expect(recallTeamBridgeTarget(SELF, TENANT)).toBe("conv_ops");
	});
});

describe("teamBridgeThreadPath carries the push's message anchor", () => {
	it("adds messageId and seq when the push names a message", () => {
		expect(
			teamBridgeThreadPath({
				tenantId: TENANT,
				conversationId: "conv_general",
				messageId: "msg_0042",
				seq: 42,
			}),
		).toBe(`/team-bridge/${TENANT}/conv_general?messageId=msg_0042&seq=42`);
	});

	it("stays a plain thread path without one (open-at-newest)", () => {
		expect(
			teamBridgeThreadPath({
				tenantId: TENANT,
				conversationId: "conv_general",
				messageId: null,
				seq: null,
			}),
		).toBe(`/team-bridge/${TENANT}/conv_general`);
	});
});

describe("directoryMark: the drawer's marked row (round-1 R1-2 / D5 / U1-6)", () => {
	it("on a thread, the open conversation is marked AND is the current page", () => {
		const open = { tenantId: TENANT, conversationId: "conv_ops" };
		expect(directoryMark(open, "conv_general", TENANT)).toEqual({
			route: open,
			current: true,
		});
	});
	it("from Home or an agent chat, the remembered row is marked but NOT current", () => {
		// The screen announces aria-current / selected only from `current`.
		expect(directoryMark(null, "conv_general", TENANT)).toEqual({
			route: { tenantId: TENANT, conversationId: "conv_general" },
			current: false,
		});
	});
	it("nothing open and nothing remembered marks nothing", () => {
		expect(directoryMark(null, null, TENANT)).toEqual({
			route: null,
			current: false,
		});
		expect(directoryMark(null, "conv_general", null).route).toBeNull();
	});
});
