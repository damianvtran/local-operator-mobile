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
		const source = readFileSync(
			new URL("../../features/home/home.tsx", import.meta.url),
			"utf8",
		);
		// The rendered host Text, found by its own fitting call — the accessible-label
		// template above it is a different element.
		const at = source.indexOf("hostWidth > 0");
		const block = source.slice(source.lastIndexOf("<Text", at), source.indexOf("</Text>", at));
		// D3: a one-line tail fit showed "127.0.0.1:498…" at large text.
		expect(block).toContain("numberOfLines={1}");
		expect(block).toContain("middleFit(");
	});
});
