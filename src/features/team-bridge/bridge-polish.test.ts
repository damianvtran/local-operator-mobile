import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activeBridgeRoute } from "@/team-bridge/active-route";
import { createTeamBridgeStore } from "@/team-bridge/store";
import {
	clearTeamBridgeDrafts,
	readTeamBridgeDraft,
	teamBridgeDraftKey,
	writeTeamBridgeDraft,
} from "@/team-bridge/thread-drafts";
import { CONTROL_DISABLED_INK } from "@/ui/variants";

const stripComments = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
const listSource = stripComments(
	readFileSync(new URL("./list-screen.tsx", import.meta.url), "utf8"),
);
const threadSource = stripComments(
	readFileSync(new URL("./thread-screen.tsx", import.meta.url), "utf8"),
);
const attachmentSource = stripComments(
	readFileSync(new URL("./attachment-views.tsx", import.meta.url), "utf8"),
);
const gateSource = stripComments(
	readFileSync(new URL("./gate.tsx", import.meta.url), "utf8"),
);

describe("activeBridgeRoute: route-driven directory row selection", () => {
	it("extracts tenant and conversation id for an open channel or group thread", () => {
		expect(activeBridgeRoute("/team-bridge/tnt_atlas/bcv_general", {})).toEqual(
			{
				tenantId: "tnt_atlas",
				conversationId: "bcv_general",
				kind: undefined,
				accountId: undefined,
				endpointId: undefined,
			},
		);
	});

	it("extracts draft DM recipient params on /team-bridge/[tenantId]/new", () => {
		expect(
			activeBridgeRoute("/team-bridge/tnt_atlas/new", {
				kind: "person",
				accountId: "acct_ada",
			}),
		).toEqual({
			tenantId: "tnt_atlas",
			conversationId: "new",
			kind: "person",
			accountId: "acct_ada",
			endpointId: undefined,
		});
		expect(
			activeBridgeRoute("/team-bridge/tnt_atlas/new", {
				kind: "agent",
				endpointId: "bep_nova",
			}),
		).toEqual({
			tenantId: "tnt_atlas",
			conversationId: "new",
			kind: "agent",
			accountId: undefined,
			endpointId: "bep_nova",
		});
	});

	it("negative control: returns null on the list screen and non-bridge routes", () => {
		expect(activeBridgeRoute("/team-bridge", {})).toBeNull();
		expect(activeBridgeRoute("/session/abc", {})).toBeNull();
		expect(activeBridgeRoute("/", {})).toBeNull();
	});
});

describe("Team Bridge account-scoped text draft persistence", () => {
	it("retains drafts per account + tenant + conversation across channel switches", () => {
		clearTeamBridgeDrafts();
		const general = teamBridgeDraftKey({
			accountId: "acct_1",
			tenantId: "tnt_1",
			routeId: "bcv_general",
		});
		const ops = teamBridgeDraftKey({
			accountId: "acct_1",
			tenantId: "tnt_1",
			routeId: "bcv_ops",
		});
		writeTeamBridgeDraft(general, "unsent reply in general");
		writeTeamBridgeDraft(ops, "checking ops status");
		expect(readTeamBridgeDraft(general)).toBe("unsent reply in general");
		expect(readTeamBridgeDraft(ops)).toBe("checking ops status");
		writeTeamBridgeDraft(general, "");
		expect(readTeamBridgeDraft(general)).toBe("");
		expect(readTeamBridgeDraft(ops)).toBe("checking ops status");
	});

	it("negative control: isolates accounts/draft-DM targets and wipes every draft on store reset or retire", () => {
		clearTeamBridgeDrafts();
		const accountA = teamBridgeDraftKey({
			accountId: "acct_a",
			tenantId: "tnt_1",
			routeId: "bcv_general",
		});
		const accountB = teamBridgeDraftKey({
			accountId: "acct_b",
			tenantId: "tnt_1",
			routeId: "bcv_general",
		});
		const noAccount = teamBridgeDraftKey({
			accountId: null,
			tenantId: "tnt_1",
			routeId: "bcv_general",
		});
		writeTeamBridgeDraft(accountA, "private draft for A");
		writeTeamBridgeDraft(noAccount, "must never store without account");
		expect(readTeamBridgeDraft(accountA)).toBe("private draft for A");
		expect(readTeamBridgeDraft(accountB)).toBe("");
		expect(readTeamBridgeDraft(noAccount)).toBe("");

		const scoped = createTeamBridgeStore({
			hub: () => ({}) as never,
			accessToken: async () => null,
		});
		scoped.actions.reset();
		expect(readTeamBridgeDraft(accountA)).toBe("");

		writeTeamBridgeDraft(accountA, "second draft before retire");
		expect(readTeamBridgeDraft(accountA)).toBe("second draft before retire");
		scoped.actions.retire();
		expect(readTeamBridgeDraft(accountA)).toBe("");
	});
});

describe("Team Bridge visual & semantic polish contracts", () => {
	it("directory uses Hash/Lock/Users glyphs for channels & groups, SectionHeader, countLabel, and no opacity-50", () => {
		expect(listSource).toContain("ConversationKindGlyph");
		expect(listSource).toContain("<SectionHeader");
		expect(listSource).toContain("countLabel(unread.count)");
		// Muted conversations keep a quiet bg-sunken pill without bolding the label.
		expect(listSource).toContain("selected || unread?.loud");
		expect(listSource).toContain('unread.loud ? "bg-accent" : "bg-sunken"');
		// Disabled/self rows use semantic CONTROL_DISABLED_INK, never opacity-50.
		expect(listSource).not.toContain("opacity-50");
		expect(listSource).toContain("CONTROL_DISABLED_INK");
		expect(CONTROL_DISABLED_INK).toBe("text-ink-dim");
		// Full-screen /team-bridge header uses BridgeThreadTitle (17pt session header step).
		expect(listSource).toContain(
			'titleNode={<BridgeThreadTitle title={t("mobile.team_bridge.title")} />}',
		);
	});

	it("thread memoizes message rows, uses 14pt text-body-read author names, UnknownSenderAvatar, hairline day dividers, and BellOff when muted", () => {
		expect(threadSource).toContain("const ThreadMessageRow = memo(");
		expect(threadSource).toContain("<UnknownSenderAvatar");
		expect(threadSource).toContain("text-body-read font-semibold text-ink");
		expect(threadSource).toContain("text-body-read italic text-ink-dim");
		expect(threadSource).not.toContain("-my-2.5 py-2.5");
		expect(threadSource).toContain('notifyMode === "mute"');
		expect(threadSource).toContain("<BellOff");
		// Picker sheets do not double-pad inside Sheet's own px-4 container.
		const sheets = threadSource.slice(threadSource.indexOf("<ProfileSheet"));
		expect(sheets).not.toContain("p-4");
		const orgSheet = listSource.slice(
			listSource.indexOf("testID={SURFACE.teamBridgeOrganizations}"),
		);
		expect(orgSheet).not.toContain("p-4");
	});

	it("gate uses visible Skeleton rows and attachment views use hairline borders without opacity: 0.4", () => {
		expect(gateSource).toContain("<Skeleton");
		expect(gateSource).not.toContain("bg-surface");
		expect(attachmentSource).toContain("border-hairline");
		expect(attachmentSource).not.toContain("border-border-control");
		expect(attachmentSource).not.toContain("opacity: disabled ? 0.4");
	});
});
