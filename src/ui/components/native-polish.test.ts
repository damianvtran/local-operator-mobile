import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fieldClasses } from "../variants";

/** A rung row whose JSX carries the `compact` prop on its own line, after the
 *  session sheet's group opens (round 2 F2). */
const COMPACT_SESSION_RUNG =
	/<EffortRungGroup>[\s\S]*?<EffortRungRow[^>]*?^\s*compact$/m;
const COMPACT_PROP = /^\s*compact$/gm;

const source = (path: string) =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const NATIVE_MENU = /<Menu color=\{ink\} size=\{24\} \/>/;

/** Wiring checks are not visual evidence. They pin the accessible control/asset
 * choices while the rendered baseline/after round judges geometry and hierarchy. */
describe("native conversation chrome", () => {
	it("integrates the composer field without removing error or keyboard focus cues", () => {
		expect(fieldClasses("rest", { inComposer: true })).toContain(
			"border-transparent",
		);
		expect(fieldClasses("rest", { inComposer: true })).toContain(
			"focus-visible:border-accent",
		);
		expect(fieldClasses("invalid", { inComposer: true })).toContain(
			"border-danger",
		);
		expect(fieldClasses("rest")).toContain("border-border-control");
	});
	it("uses the established white disk asset without recolouring it", () => {
		const asset = new URL(
			"../../../assets/brand/navigation-mark.png",
			import.meta.url,
		);
		expect(existsSync(asset)).toBe(true);
		if (!existsSync(asset)) return;
		expect(createHash("sha256").update(readFileSync(asset)).digest("hex")).toBe(
			"e438b0430a45a6b42c4e1a49ac8b52c5e5fdefe0955251d94abfbcc0217f7113",
		);
	});

	/* Home and chat intentionally share the native menu affordance now. Pin the
	 * shared glyph and touch floor, not the removed inline home implementation. */
	it("shares the 24 pt native menu and preserves its touch target", () => {
		const home = source("src/features/home/home.tsx");
		const chat = source("app/(app)/session/[id].tsx");
		const menu = source("src/features/sessions/workspace-drawer.tsx");
		expect(home).toContain("<WorkspaceDrawerButton />");
		expect(chat).toContain(
			"<WorkspaceDrawerButton testID={CONTROL.sessionBack} />",
		);
		expect(menu).toMatch(NATIVE_MENU);
		expect(menu.replace("size={24}", "size={22}")).not.toMatch(NATIVE_MENU);
		expect(menu).toContain("minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR");
		const pane = source("src/features/sessions/conversations-pane.tsx");
		expect(pane).toContain(
			"<Search size={18} color={destinationInk} aria-hidden />",
		);
	});
	it.each([
		["src/features/sessions/conversations-pane.tsx", "sidebarNewChat"],
		["app/(app)/session/[id].tsx", "sessionFind"],
	])("keeps the native chrome glyph at 22 in %s", (path, id) => {
		// Icon render callbacks contain >, so inspect the complete caller's local span.
		const text = source(path);
		const end = text.indexOf(`testID={CONTROL.${id}}`);
		const start = text.lastIndexOf("<IconButton", end);
		expect(start).toBeGreaterThanOrEqual(0);
		expect(text.slice(start, text.indexOf("/>", end))).toContain("size={22}");
	});
});

describe("final design audit wiring", () => {
	it("draws the home's folder and the run settings as the same icon control", () => {
		const source = readFileSync(
			new URL("../../features/home/home.tsx", import.meta.url),
			"utf8",
		);
		/* The home passes its folder as DATA (the composer's plan decides whether
		 *  the icon is on the row or a row in More, issue #325), under the id the
		 *  folder chip had. */
		expect(source).toContain("testID: CONTROL.homeFolderChip");
		const composer = readFileSync(
			new URL(
				"../../features/session/components/composer.tsx",
				import.meta.url,
			),
			"utf8",
		);
		/* D2's rule survives the chips: one row of disclosures does not mix two
		 *  treatments. Both are `ComposerIconControl` — the kit's `IconButton` —
		 *  the folder under its host's id, the run settings under the model
		 *  chip's id. */
		const zone = composer.slice(
			composer.indexOf("const controlZone = ("),
			composer.indexOf("const clearDraft ="),
		);
		const folder = zone.indexOf("testID={folder.testID}");
		const settings = zone.indexOf("testID={CONTROL.composerModelChip}");
		expect(folder).toBeGreaterThan(-1);
		expect(settings).toBeGreaterThan(folder);
		expect(zone.lastIndexOf("<ComposerIconControl", folder)).toBeGreaterThan(
			-1,
		);
		expect(
			zone.slice(zone.lastIndexOf("<ComposerIconControl", settings), settings),
		).toContain("onPress={onOpenRunSettings}");
		const control = composer.slice(
			composer.indexOf("const ComposerIconControl"),
			composer.indexOf("/** The failure notice's row floor:"),
		);
		expect(control).toContain("<IconButton");
		expect(control).not.toContain("<Chip");
	});

	it("pins the run-settings sheet's wiring on both hosts (round 2 F2/Q6)", () => {
		const read = (path: string) =>
			readFileSync(new URL(path, import.meta.url), "utf8");
		const session = read("../../../app/(app)/session/[id].tsx");
		/* An ended session with no recorded effort says to resume, never "no
		 *  effort setting" — only if the screen tells the helper it ended. */
		const wiring = session.slice(
			session.indexOf("sessionRunSettings({"),
			session.indexOf("});", session.indexOf("sessionRunSettings({")),
		);
		expect(wiring).toContain(
			'ended: headerHealth(projection, runtime.link) === "ended",',
		);
		// A refused change shows inside the open sheet (round 1 R2).
		expect(session).toContain("error={chipError}");
		const home = read("../../features/home/home.tsx");
		expect(home).toContain(
			"summary={runSettingsSummary(chips.model, chips.effort ?? null)}",
		);
		const sheet = read("../../features/session/components/model-sheet.tsx");
		const sessionSheet = sheet.slice(
			sheet.indexOf("export const SessionRunSettingsSheet"),
		);
		expect(sessionSheet).toMatch(COMPACT_SESSION_RUNG);
		const pickers = read("../../features/home/home-pickers.tsx");
		const choices = pickers.slice(
			pickers.indexOf("const EffortChoices"),
			pickers.indexOf("export const RunSettingsPicker"),
		);
		expect(choices).toContain("<EffortRungGroup>");
		// Both of the home's rungs (the default row and the ladder) are compact.
		expect(choices.match(COMPACT_PROP)?.length).toBe(2);
	});

	it("draws run settings with a settings glyph and pins the dot to the glyph (D4, D5)", () => {
		const composer = readFileSync(
			new URL(
				"../../features/session/components/composer.tsx",
				import.meta.url,
			),
			"utf8",
		);
		/* Sparkles reads as "AI feature" beside a message field (design round 1
		 *  D5); the control changes run SETTINGS, so it is a sliders glyph. */
		expect(composer).toContain(
			"<SlidersHorizontal color={color} size={size} />",
		);
		expect(composer).not.toContain("Sparkles");
		/* The non-default dot's inset is computed from the platform floor, not a
		 *  fixed 7 that only fit the 44 pt box (D4). */
		expect(composer).toContain(
			"customMarkInset({\n\tfloor: TOUCH_FLOOR,\n\tbox: ICON_BUTTON_BOX_PT,\n\tglyph: ATTACH_GLYPH_PT,\n\tmark: CUSTOM_MARK_PT,\n})",
		);
		expect(composer).toContain("top: MARK_INSET.top,");
		expect(composer).toContain("end: MARK_INSET.end,");
		expect(composer).not.toContain("top: 7,");
	});

	it("keeps the home header's computer on ONE fitted line", () => {
		/* Since M2b the header's computer is `HeaderComputerChip`, mounted in the
		 *  same slot, so the D3 rule is asserted where its Text now lives. */
		const home = readFileSync(
			new URL("../../features/home/home.tsx", import.meta.url),
			"utf8",
		);
		expect(home).toMatch(
			/<HeaderComputerChip\s+testID=\{CONTROL\.computersButton\}/,
		);
		const chip = readFileSync(
			new URL("../../features/auth/computer-entry-points.tsx", import.meta.url),
			"utf8",
		);
		const source = chip.slice(
			chip.indexOf("export function HeaderComputerChip"),
			chip.indexOf("export function DrawerComputerRow"),
		);
		// The rendered name Text, found by its own fitting call — the accessible-label
		// template above it is a different element.
		const at = source.indexOf("nameWidth > 0");
		const block = source.slice(
			source.lastIndexOf("<Text", at),
			source.indexOf("</Text>", at),
		);
		// D3: a one-line tail fit showed "127.0.0.1:498…" at large text; a host:port
		// still goes through `middleFit` inside `headerChipFit` (asserted there).
		expect(block).toContain("numberOfLines={1}");
		expect(block).toContain("headerChipFit(");
	});
});

describe("phone status surface wiring (D2 final)", () => {
	it("gates the tray, the sheet and the inline region on ONE layout decision", () => {
		const screen = readFileSync(
			new URL("../../../app/(app)/session/[id].tsx", import.meta.url),
			"utf8",
		);
		// The tray replaces the strip on a phone ...
		expect(screen).toContain(
			"const { tray, inlineSecondary, statusSheet } = sessionStatusLayout(",
		);
		expect(screen).toContain("{tray ? (");
		// ... on a portrait phone the tray row yields to the header subtitle and the
		// ONE activity line above the composer (record 2026-11-04 §2.2, D-S3; visual
		// audit D1 folded the chips' band into that line); short landscape keeps it.
		// The line's gate is derived from the SAME decision, once, and its complement
		// is what keeps the queued count on the composer card where there is no line —
		// two hand-written copies of the condition is how a tablet lost the count.
		const flat = screen.replace(/\s+/g, " ");
		expect(flat).toContain("const activityLineHost = tray && !compact;");
		expect(flat).toContain("{activityLineHost ? ( <PinnedWorkingLine");
		expect(flat).toContain("queueOnCard={!activityLineHost}");
		// The pending-card yield the removed `&& pendingViewProps === null` made is
		// now the counts' own: tasks/agents step aside, the queue count does not.
		expect(flat).toContain("const pendingShowing = pendingViewProps !== null;");
		expect(flat).toContain("activityCounts( pendingShowing ? null : {");
		// ... both panels open the SAME sheet there (not a dead disabled prop) ...
		expect(screen.match(/statusSheet \? statusSheetOpen/g)?.length).toBe(2);
		// ... and the old inline stack is not painted beside it.
		expect(screen).toContain('inlineSecondary ? {} : { display: "none"');
		expect(screen).toContain("const regionItems = !inlineSecondary");
	});

	it("renders the tray only through statusTrayVisible, so a pending decision displaces it", () => {
		const screen = readFileSync(
			new URL("../../../app/(app)/session/[id].tsx", import.meta.url),
			"utf8",
		);
		// The unconditional `{tray ? <StatusTray …` is what put 48 pt between the pinned
		// Approve/Deny and the composer in short landscape (audit U-08, S8 landscape).
		expect(screen).toContain(
			"statusTrayVisible(tray, compact, pendingViewProps !== null)",
		);
		expect(screen).not.toContain("{tray ? (\n\t\t\t\t<StatusTray");
	});

	it("bottom-anchors a pending decision's card and composer in short landscape", () => {
		const screen = readFileSync(
			new URL("../../../app/(app)/session/[id].tsx", import.meta.url),
			"utf8",
		);
		// With the transcript collapsed and the status tray yielding, the remaining
		// children do not fill the column. Without this the slack lands UNDER the
		// composer (38 pt at approval/100 %, 55 pt at ask/100 %, measured) and the
		// composer jumps as the decision arrives and is answered (design D1/D18).
		expect(screen).toContain(
			'compact && pendingViewProps !== null\n\t\t\t\t\t\t\t? { justifyContent: "flex-end" as const }',
		);
	});
});
