import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fieldClasses } from "../variants";

const source = (path: string) =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

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

	/* 22, not 24 and not the 20 the chrome shipped with: 24 crowded the 44 pt
	 * target and 20 read light beside it (user feedback on the polish round). The
	 * ladder in `IconButton` gained 22 as a named step for exactly this, so the
	 * assertion pins the number the design settled on rather than a range. */
	it.each([
		["src/features/home/home.tsx", "homeSidebar"],
		["src/features/sessions/conversations-pane.tsx", "sidebarSearch"],
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
	it("gives the home folder chip the same quiet treatment as the model chip", () => {
		const source = readFileSync(
			new URL("../../features/home/home.tsx", import.meta.url),
			"utf8",
		);
		const at = source.indexOf("testID={CONTROL.homeTargetFolder}");
		const chip = source.slice(source.lastIndexOf("<Chip", at), at);
		// D2: one row of disclosures must not mix a filled bordered chip with flat text.
		expect(chip).toContain("quiet");
	});

	it("keeps the home header's computer on ONE fitted line", () => {
		/* Since M2b the header's computer is `HeaderComputerChip`, mounted in the
		 *  same slot, so the D3 rule is asserted where its Text now lives. */
		const home = readFileSync(
			new URL("../../features/home/home.tsx", import.meta.url),
			"utf8",
		);
		expect(home).toContain(
			"<HeaderComputerChip testID={CONTROL.computersButton} />",
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
		// D3: a one-line tail fit showed "127.0.0.1:498…" at large text.
		expect(block).toContain("numberOfLines={1}");
		expect(block).toContain("middleFit(");
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
