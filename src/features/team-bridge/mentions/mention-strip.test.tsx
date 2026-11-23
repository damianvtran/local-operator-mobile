import { readFileSync } from "node:fs";
import {
	act,
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
	clearTeamBridgeDrafts,
	readTeamBridgeDraft,
	type TeamBridgeDraft,
	teamBridgeDraftKey,
	writeTeamBridgeDraft,
} from "@/team-bridge/thread-drafts";
import { installDomShim } from "@/testing/dom-shim";
import { SURFACE, teamBridgeMentionId } from "@/ui/a11y";
import type { MentionCandidateRow } from "./candidates";
import { rankMentionCandidates } from "./matcher";
import type { MentionView } from "./mention-state";
import {
	MENTION_ROW_PT,
	MENTION_STRIP_MAX_PT,
	MentionRow,
	MentionStripView,
	mentionGroups,
	mentionNoticeText,
} from "./mention-strip";
import { serializeMentions } from "./tokens";
import { useMentions } from "./use-mentions";

/*
 * The strip's drawing and the hook's state, in the Node host. Avatars are
 * stubbed (they read the hub's avatar cache, which is not under test here);
 * everything else is the shipping component, and activation calls the real
 * `onPress` found on its own element tree.
 */
vi.mock("../profile-card", () => ({
	ProfileSubjectAvatar: () => null,
	UnknownSenderAvatar: () => null,
}));

const row = (
	accountId: string,
	label: string,
	over: Partial<MentionCandidateRow> = {},
): MentionCandidateRow => ({
	kind: "human",
	accountId,
	label,
	member: true,
	bridgeOff: false,
	...over,
});
const ben = row("a_ben", "Ben Tran");
const aida = row("a_ben", "Aida (Ben Tran)", {
	kind: "agent",
	endpointId: "bep_aida",
	aliases: ["Aida", "Ben Tran"],
	secondary: "Chief of staff",
});
const tara = row("a_tara", "Tara Bentley", { member: false, bridgeOff: true });
const all = [ben, aida, tara];

const viewFor = (query: string, rows = all): MentionView => {
	const { sections, flat } = rankMentionCandidates(query, rows);
	return { query: { start: 0, end: query.length + 1, query }, sections, flat };
};

/** Every element in a tree, depth first, unwrapping function components. */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
	Children.forEach(node, (child) => {
		if (!isValidElement(child)) return;
		out.push(child);
		const props = child.props as { children?: ReactNode };
		if (typeof child.type === "function" && child.type === MentionRow)
			elements(
				MentionRow(child.props as Parameters<typeof MentionRow>[0]),
				out,
			);
		if (typeof props.children === "function")
			elements(
				(props.children as (s: { pressed: boolean }) => ReactNode)({
					pressed: false,
				}),
				out,
			);
		else elements(props.children, out);
	});
	return out;
}
/** The view's element tree, called directly (it is hook-free by design). */
const strip = (
	view: MentionView,
	directoryMissing: boolean,
	onPick: (row: MentionCandidateRow) => void,
) => elements(MentionStripView({ view, directoryMissing, onPick }));
const SERIALIZE_ACTIVE =
	/serializeMentions\(\s*composerDraft\.tokens,\s*memberKeys\(currentConversation\?\.members, "active"\),?\s*\)/;
const CANDIDATES_NEED_CONVERSATION =
	/conversation\s*\?\s*buildMentionCandidates\(/;
const PHYSICAL_SPACING = /\b(pl|pr|ml|mr|left|right)-\d/;
const LOGICAL_ROW_PAD = /\bps-3 pe-3\b/;

const testIds = (tree: ReactElement[]) =>
	tree.flatMap((e) => {
		const id = (e.props as { testID?: string }).testID;
		return id ? [id] : [];
	});
const texts = (tree: ReactElement[]) =>
	tree.flatMap((e) => {
		const c = (e.props as { children?: unknown }).children;
		return typeof c === "string" ? [c] : [];
	});

describe("MentionStripView", () => {
	it("keeps the keyboard up on a tap and caps its height at 4.5 rows", () => {
		const tree = strip(viewFor(""), false, vi.fn());
		const scroll = tree.find(
			(e) =>
				(e.props as { keyboardShouldPersistTaps?: string })
					.keyboardShouldPersistTaps !== undefined,
		);
		expect(
			(scroll?.props as { keyboardShouldPersistTaps?: string } | undefined)
				?.keyboardShouldPersistTaps,
		).toBe("handled");
		expect(MENTION_STRIP_MAX_PT).toBe(Math.round(MENTION_ROW_PT * 4.5));
		expect(testIds(tree)).toContain(SURFACE.teamBridgeMentionStrip);
	});
	it("one row per candidate, keyed kind:account so a person and their agent differ", () => {
		const tree = strip(viewFor(""), false, vi.fn());
		expect(testIds(tree)).toEqual(
			expect.arrayContaining([
				teamBridgeMentionId("human:a_ben"),
				teamBridgeMentionId("agent:a_ben"),
				teamBridgeMentionId("human:a_tara"),
			]),
		);
	});
	it("headings only when both members and others have rows", () => {
		const both = texts(strip(viewFor(""), false, vi.fn()));
		expect(both).toEqual(
			expect.arrayContaining([
				"In this conversation",
				"Others in your organization",
			]),
		);
		const membersOnly = texts(strip(viewFor("", [ben, aida]), false, vi.fn()));
		expect(membersOnly).not.toContain("In this conversation");
		expect(mentionGroups(viewFor("", [ben, aida]).sections)).toHaveLength(1);
	});
	it("a tap picks that row", () => {
		const onPick = vi.fn();
		const tree = strip(viewFor("aid"), false, onPick);
		const press = tree.find(
			(e) =>
				(e.props as { testID?: string }).testID ===
				teamBridgeMentionId("agent:a_ben"),
		);
		(press?.props as { onPress?: () => void } | undefined)?.onPress?.();
		expect(onPick).toHaveBeenCalledWith(aida);
	});
	it("a bridge-off person says why, and a missing directory says so", () => {
		const tree = texts(strip(viewFor("tar"), true, vi.fn()));
		expect(tree).toContain("Hasn’t turned on Team Bridge yet");
		expect(tree).toContain(
			"People list unavailable. Showing members of this conversation.",
		);
	});
	it("rows use logical (start/end) padding only, so RTL mirrors", () => {
		const source = readFileSync(
			new URL("./mention-strip.tsx", import.meta.url),
			"utf8",
		);
		expect(source).not.toMatch(PHYSICAL_SPACING);
		expect(source).toMatch(LOGICAL_ROW_PAD);
	});
	it("names the notice's reason in its sentence", () => {
		expect(mentionNoticeText({ label: "Sam", reason: "not_member" })).toBe(
			"Sam isn’t in this conversation and won’t be notified.",
		);
		expect(mentionNoticeText({ label: "Sam", reason: "invited" })).toBe(
			"Sam hasn’t joined this conversation yet and won’t be notified.",
		);
	});
});

describe("useMentions", () => {
	type Hook = ReturnType<typeof useMentions>;
	/*
	 * `persist` stands in for the thread screen's draft wiring: the screen seeds
	 * its state from `readTeamBridgeDraft(key)` on mount and writes every
	 * `setValue` back under the same key, so a remount under a key is exactly
	 * what a drawer channel switch (unmount + remount) does to the composer.
	 */
	const mount = (
		rows: MentionCandidateRow[],
		initial: TeamBridgeDraft = { text: "", tokens: [] },
		persist?: (next: TeamBridgeDraft) => void,
	) => {
		const dom = installDomShim();
		const root = createRoot(dom.container as Element);
		const state = { value: initial, hook: null as Hook | null };
		const setValue = vi.fn((next: TeamBridgeDraft) => {
			state.value = next;
			persist?.(next);
			render();
		});
		// Text-only replacement the hook did not make (restore, clear after send).
		const setText = (text: string) => setValue({ text, tokens: [] });
		function Probe() {
			state.hook = useMentions({
				value: state.value,
				setValue,
				candidates: rows,
				directoryMissing: false,
			});
			return null;
		}
		const render = () => root.render(<Probe />);
		act(() => render());
		const hook = () => {
			if (!state.hook) throw new Error("not mounted");
			return state.hook;
		};
		return { state, setText, hook, root };
	};

	it("@ opens with every candidate, and a pick inserts with a one-shot caret", () => {
		const m = mount(all);
		act(() => m.hook().onChangeText("hi @"));
		expect(m.hook().view?.flat).toHaveLength(3);
		act(() => m.hook().onChangeText("hi @be"));
		act(() => m.hook().pick(ben));
		expect(m.state.value.text).toBe("hi @Ben Tran ");
		expect(m.hook().selection).toEqual({ start: 13, end: 13 });
		expect(m.hook().view).toBeNull();
		expect(m.state.value.tokens).toHaveLength(1);
		// The platform reports the caret: the one-shot is released.
		act(() =>
			m.hook().onSelectionChange({
				nativeEvent: { selection: { start: 13, end: 13 } },
			} as never),
		);
		expect(m.hook().selection).toBeUndefined();
		act(() => m.root.unmount());
	});
	it("a non-member pick keeps the name, sends no row, and raises the notice", () => {
		const m = mount(all);
		act(() => m.hook().onChangeText("@tar"));
		act(() => m.hook().pick(tara));
		expect(m.state.value.text).toBe("@Tara Bentley ");
		expect(m.hook().notice).toEqual({
			label: "Tara Bentley",
			reason: "not_member",
		});
		expect(m.state.value.tokens[0]?.notify).toBe(false);
		// Deleting the mention retires its notice with it.
		act(() => m.hook().onChangeText("@Tara Bentley"));
		act(() => m.hook().onChangeText("@Tara Bentle"));
		expect(m.state.value.text).toBe("");
		expect(m.hook().notice).toBeNull();
		act(() => m.root.unmount());
	});
	it("U1: a picked mention survives a thread switch A→B→A and still reaches the wire", () => {
		clearTeamBridgeDrafts();
		const key = (routeId: string) =>
			teamBridgeDraftKey({ accountId: "acct_me", tenantId: "tnt_1", routeId });
		const visit = (routeId: string) =>
			mount(all, readTeamBridgeDraft(key(routeId)), (next) =>
				writeTeamBridgeDraft(key(routeId), next.text, next.tokens),
			);
		const a = visit("bcv_general");
		act(() => a.hook().onChangeText("hi @be"));
		act(() => a.hook().pick(ben));
		act(() => a.root.unmount());
		const b = visit("bcv_ops");
		expect(b.state.value).toEqual({ text: "", tokens: [] });
		act(() => b.hook().onChangeText("ops note"));
		act(() => b.root.unmount());
		const back = visit("bcv_general");
		expect(back.state.value.text).toBe("hi @Ben Tran ");
		expect(back.state.value.tokens).toHaveLength(1);
		// Restoring must not reopen the strip on its own.
		expect(back.hook().view).toBeNull();
		// Keep typing after the restore: the pick still rides the edit.
		act(() => back.hook().onChangeText("hi @Ben Tran see this"));
		expect(
			serializeMentions(back.state.value.tokens, new Set(["human:a_ben"])),
		).toEqual([{ kind: "human", account_id: "a_ben" }]);
		act(() => back.root.unmount());
		clearTeamBridgeDrafts();
	});
	it("a draft cleared after send drops every token", () => {
		const m = mount(all);
		act(() => m.hook().onChangeText("@be"));
		act(() => m.hook().pick(ben));
		expect(m.state.value.tokens).toHaveLength(1);
		// The screen clears the draft itself after a send (not through the hook).
		act(() => m.setText(""));
		expect(m.state.value.tokens).toEqual([]);
		expect(m.hook().view).toBeNull();
		act(() => m.root.unmount());
	});
});

describe("thread screen wiring", () => {
	const screen = readFileSync(
		new URL("../thread-screen.tsx", import.meta.url),
		"utf8",
	);
	it("every field edit goes through the mention hook, with caret reports", () => {
		expect(screen).toContain("onDraftChange={mentions.onChangeText}");
		expect(screen).toContain("onSelectionChange={mentions.onSelectionChange}");
		expect(screen).toContain("selection={mentions.selection}");
	});
	it("sends only active members' rows, and offers none in a draft DM", () => {
		expect(screen).toMatch(SERIALIZE_ACTIVE);
		expect(screen).toContain("sender.current?.(body, ids, mentionRows)");
		expect(screen).toMatch(CANDIDATES_NEED_CONVERSATION);
	});
	it("the strip renders in the dock, above the field", () => {
		const strip = screen.indexOf("<MentionStrip");
		const field = screen.indexOf("<BridgeComposerField");
		const dock = screen.indexOf("<BridgeComposerDock");
		expect(dock).toBeGreaterThan(0);
		expect(strip).toBeGreaterThan(dock);
		expect(field).toBeGreaterThan(strip);
	});
});
