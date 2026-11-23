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
import { insertMention, serializeMentions } from "./mentions/tokens";

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
const paneSource = stripComments(
	readFileSync(
		new URL("../sessions/conversations-pane.tsx", import.meta.url),
		"utf8",
	),
);
const adapterSource = stripComments(
	readFileSync(new URL("./drawer-adapter.tsx", import.meta.url), "utf8"),
);
const profileSource = stripComments(
	readFileSync(new URL("./profile-card.tsx", import.meta.url), "utf8"),
);
const draftsSource = stripComments(
	readFileSync(
		new URL("../../team-bridge/thread-drafts.ts", import.meta.url),
		"utf8",
	),
);
/** A directory skeleton with no `ground`: the canvas default, wrong here. */
const BARE_SKELETON = /<Skeleton lines=\{\d\} \/>/;
const flat = (text: string) => text.replace(/\s+/g, " ");

it("restores only chosen mentions from the original account and thread", () => {
	clearTeamBridgeDrafts();
	const key = (accountId: string, routeId: string) =>
		teamBridgeDraftKey({ accountId, tenantId: "tnt_1", routeId });
	const general = key("acct_me", "bcv_general");
	const ops = key("acct_me", "bcv_ops");
	const picked = insertMention(
		"hi @be",
		[],
		{ start: 3, end: 6 },
		{
			kind: "human",
			accountId: "acct_ben",
			label: "Ben Tran",
		},
	);
	writeTeamBridgeDraft(general, picked.text, picked.tokens);
	writeTeamBridgeDraft(ops, picked.text); // identical spelling, no pick
	const eligible = new Set(["human:acct_ben"]);
	const restored = readTeamBridgeDraft(general);
	expect(restored.text).toBe("hi @Ben Tran ");
	expect(serializeMentions(restored.tokens, eligible)).toEqual([
		{ kind: "human", account_id: "acct_ben" },
	]);
	expect(serializeMentions(restored.tokens, new Set())).toEqual([]);
	expect(readTeamBridgeDraft(ops)).toEqual({ text: picked.text, tokens: [] });
	expect(readTeamBridgeDraft(key("acct_other", "bcv_general")).tokens).toEqual(
		[],
	);
	writeTeamBridgeDraft(general, "hi @Bon Tran ", picked.tokens);
	expect(readTeamBridgeDraft(general).tokens).toEqual([]);
	writeTeamBridgeDraft(general, picked.text, picked.tokens);
	writeTeamBridgeDraft(general, "");
	expect(readTeamBridgeDraft(general)).toEqual({ text: "", tokens: [] });
	expect(readTeamBridgeDraft(ops).text).toBe(picked.text);
});

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
		expect(readTeamBridgeDraft(general)).toEqual({
			text: "unsent reply in general",
			tokens: [],
		});
		expect(readTeamBridgeDraft(ops)).toEqual({
			text: "checking ops status",
			tokens: [],
		});
		writeTeamBridgeDraft(general, "");
		expect(readTeamBridgeDraft(general)).toEqual({ text: "", tokens: [] });
		expect(readTeamBridgeDraft(ops)).toEqual({
			text: "checking ops status",
			tokens: [],
		});
	});

	it("never evicts an unsent draft: no size cap, entries leave only on empty/send or the sign-out wipe (R1-7)", () => {
		clearTeamBridgeDrafts();
		const key = (n: number) =>
			teamBridgeDraftKey({
				accountId: "acct_1",
				tenantId: "tnt_1",
				routeId: `bcv_${n}`,
			});
		// Past the former 64-entry cap, the FIRST draft must still be there.
		for (let n = 0; n < 100; n++) writeTeamBridgeDraft(key(n), `draft ${n}`);
		expect(readTeamBridgeDraft(key(0))).toEqual({
			text: "draft 0",
			tokens: [],
		});
		expect(readTeamBridgeDraft(key(99))).toEqual({
			text: "draft 99",
			tokens: [],
		});
		expect(draftsSource).not.toContain("MAX_DRAFTS");
		clearTeamBridgeDrafts();
		expect(readTeamBridgeDraft(key(0))).toEqual({ text: "", tokens: [] });
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
		expect(readTeamBridgeDraft(accountA)).toEqual({
			text: "private draft for A",
			tokens: [],
		});
		expect(readTeamBridgeDraft(accountB)).toEqual({ text: "", tokens: [] });
		expect(readTeamBridgeDraft(noAccount)).toEqual({ text: "", tokens: [] });

		const scoped = createTeamBridgeStore({
			hub: () => ({}) as never,
			accessToken: async () => null,
		});
		scoped.actions.reset();
		expect(readTeamBridgeDraft(accountA)).toEqual({ text: "", tokens: [] });

		writeTeamBridgeDraft(accountA, "second draft before retire");
		expect(readTeamBridgeDraft(accountA)).toEqual({
			text: "second draft before retire",
			tokens: [],
		});
		scoped.actions.retire();
		expect(readTeamBridgeDraft(accountA)).toEqual({ text: "", tokens: [] });
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

	it("gate uses visible Skeleton rows; passive attachment tiles are hairline, interactive controls keep the 3:1 control border (R1-5)", () => {
		expect(gateSource).toContain("<Skeleton");
		expect(gateSource).not.toContain("bg-surface");
		const attachment = flat(attachmentSource);
		// Passive: the placeholder tile and the composer chip.
		expect(attachment).toContain(
			"overflow-hidden rounded-sm border border-hairline bg-elevated px-2",
		);
		expect(attachment).toContain(
			'failed ? "border-danger" : "border-hairline"',
		);
		// Interactive: the viewer's buttons (hairline only while disabled) and
		// the chip's Retry / Remove discs.
		expect(attachment).toContain(
			'disabled ? "border-hairline bg-sunken" : "border-border-control bg-elevated"',
		);
		expect(
			attachment.split(
				"absolute h-6 w-6 items-center justify-center rounded-full border border-border-control bg-elevated",
			),
		).toHaveLength(3);
		expect(attachmentSource).not.toContain("opacity: disabled ? 0.4");
	});

	it("the docked pane keeps the workspace footer in Team Bridge mode (R1-1)", () => {
		const branch = paneSource.slice(
			paneSource.indexOf(
				'if (dockedBridgeAdapter && dockedMode === "team-bridge")',
			),
		);
		const end = branch.indexOf("\n\t}\n");
		const bridgeBranch = branch.slice(0, end);
		expect(bridgeBranch).toContain("dockedBridgeAdapter.bridgePane(");
		// The footer follows the bridge pane, inside the same branch.
		expect(bridgeBranch.indexOf("<WorkspaceSidebarFooter")).toBeGreaterThan(
			bridgeBranch.indexOf("dockedBridgeAdapter.bridgePane("),
		);
		expect(paneSource).toContain("testID={REGION.sidebarFooter}");
	});

	it("loading skeletons draw for the panel's own ground, sit under their section header, and are one labelled element (R1-2/R1-6/U1-5/Q2-1)", () => {
		// Raised in the drawer, canvas in the docked split (no `onClose`).
		expect(flat(adapterSource)).toContain(
			'<BridgeDirectory onBeforeOpen={onNavigate} ground={onClose ? "raised" : "canvas"} />',
		);
		expect(flat(paneSource)).not.toContain("onClose: () => undefined");
		expect(listSource).toContain('ground = "canvas"');
		expect(listSource).toContain("<Skeleton lines={3} ground={ground} />");
		expect(listSource).toContain("<Skeleton lines={2} ground={ground} />");
		expect(listSource).not.toMatch(BARE_SKELETON);
		const list = flat(listSource);
		// The conversation skeleton comes AFTER the Channels header, and the
		// Groups header renders only once conversations are not loading.
		const channels = list.indexOf(
			'heading(t("mobile.team_bridge.list.channels")',
		);
		const skeleton = list.indexOf(
			"testID={SURFACE.teamBridgeConversationsLoading}",
		);
		const groups = list.indexOf('heading(t("mobile.team_bridge.list.groups"))');
		expect(channels).toBeGreaterThan(-1);
		expect(skeleton).toBeGreaterThan(channels);
		expect(groups).toBeGreaterThan(skeleton);
		expect(list.slice(channels, groups)).toContain("{conversationsLoading ? (");
		// Both loading wrappers are one accessible element carrying the label.
		expect(list).toContain(
			'<View accessible className="px-4 py-3" testID={SURFACE.teamBridgeConversationsLoading}',
		);
		expect(list).toContain(
			'<View accessible className="px-4 py-2" accessibilityLabel={t("mobile.team_bridge.list.people_loading")}',
		);
	});

	it("People / Chiefs rows: the link's Pressable takes the remaining width, so long names truncate and the count sits at the trailing edge (D1-1)", () => {
		const profileBranch = flat(
			listSource.slice(
				listSource.indexOf("if (profile)"),
				listSource.indexOf("allowHoverFill={!selected}"),
			),
		);
		expect(profileBranch).toContain('pressableClassName="min-w-0 flex-1"');
		expect(flat(listSource)).toContain(
			"testID={testID} className={pressableClassName}",
		);
	});

	it("selected and pressed rows stay distinct on the dark elevated panel, and selection is never colour alone (Q1-1/R1-8)", () => {
		expect(listSource).toContain('const ROW_SELECTED_FILL = "bg-accent-wash"');
		// The directory rows (not the org sheet, whose ground is the sheet's).
		const rows = listSource.slice(
			listSource.indexOf("export function BridgeRow("),
			listSource.indexOf("export function BridgeDirectory("),
		);
		expect(rows.includes('"bg-row-selected"')).toBe(false);
		expect(listSource).toContain(
			'ground === "raised" ? "bg-row-hover dark:bg-sunken" : "bg-row-hover"',
		);
		expect(listSource).toContain(
			'const ROW_SELECTED_INK = "text-accent-active dark:text-accent-hover"',
		);
		// The selected label takes the accent ink (no identical ternary arms).
		expect(flat(listSource)).toContain(
			'disabled ? CONTROL_DISABLED_INK : selected ? ROW_SELECTED_INK : "text-ink"',
		);
		expect(listSource).not.toContain(
			'? "text-ink"\n\t\t\t\t\t\t\t\t\t\t: "text-ink"',
		);
		// The kind glyph turns accent for a selected row.
		expect(listSource).toContain(
			'disabled ? "ink-dim" : emphasized ? "accent" : "ink-muted"',
		);
	});

	it("the author name's padded box reaches the touch floor without overhanging the body by >= 35 % of a line (R1-4)", () => {
		const number = (name: string) =>
			Number(new RegExp(`const ${name} = (\\d+);`).exec(profileSource)?.[1]);
		const line = number("AUTHOR_NAME_LINE");
		const below = number("AUTHOR_NAME_BELOW");
		expect(line).toBe(25);
		expect(below).toBe(6);
		// The laid-out line (21.7 + the former py-0.5's 4) plus both paddings.
		const laidOut = 14 * 1.55 + 4;
		for (const floor of [44, 48]) {
			const above = Math.max(0, floor - line - below);
			expect(laidOut + above + below).toBeGreaterThanOrEqual(floor);
		}
		// One 22 px body line: the overhang below is under the 35 % overlap bar.
		expect(below / 22).toBeLessThan(0.35);
		expect(profileSource).toContain("style={AUTHOR_NAME_TOUCH_BOX}");
		expect(threadSource).toContain(
			'<View className="relative z-10 flex-row flex-wrap items-baseline gap-x-2">',
		);
	});
});

const STANDALONE_CATCHING_UP = /catchingUp\(SURFACE\./;
const SKELETON_EXCLUDES_CATCHING_UP =
	/!org\??\.(conversations|people)CatchingUp/;
const SPINNER_FROM_LOAD_STATE = /refreshing=\{\s*org\?\.conversationsState/;

describe("Team Bridge 429 status placement (PR #297 round 1)", () => {
	it("Catching up rides each heading's trailing side, never a line of its own above held rows (design D1)", () => {
		const list = flat(listSource);
		expect(list).toContain(
			'heading(t("mobile.team_bridge.list.channels"), { show: conversationsSection.catchingUp, testID: SURFACE.teamBridgeConversationsCatchingUp, })',
		);
		expect(list).toContain(
			'heading(t("mobile.team_bridge.list.people"), { show: peopleSection.catchingUp, testID: SURFACE.teamBridgePeopleCatchingUp, })',
		);
		// The status shares the heading row and the heading's own type metrics,
		// so the row height cannot change when it appears.
		expect(list).toContain('<View className="flex-row items-end gap-3 px-4">');
		expect(list).toContain(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: matching source text.
			"className={`min-w-0 flex-1 pb-1 ${TEXT_END_CLASS} text-mono-label text-ink-dim`} numberOfLines={1}",
		);
		// No standalone body-sm status line anywhere in the list.
		expect(list).not.toMatch(STANDALONE_CATCHING_UP);
		// D2: a cold catch-up keeps the skeleton, so Groups stays held back.
		expect(list).toContain(
			"const conversationsLoading = conversationsSection.skeleton;",
		);
		expect(list).not.toMatch(SKELETON_EXCLUDES_CATCHING_UP);
	});

	it("the pull spinner follows the reader's pull, not a load held through a 429 wait (review m3)", () => {
		const list = flat(listSource);
		expect(list).toContain("refreshing={pulling}");
		expect(list).toContain("onRefresh={pull}");
		expect(list).toContain(".finally(() => setPulling(false))");
		expect(list).not.toMatch(SPINNER_FROM_LOAD_STATE);
	});
});
