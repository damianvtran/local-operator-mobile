import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	FIELD_BORDER_Y,
	fieldBoxHeight,
	fieldBoxStyle,
	fieldScrollEnabled,
} from "@/ui/variants";

/**
 * TestFlight 800: on iOS the composer stayed one line and the draft ran on out
 * of sight, on the new-conversation and the agent-chat composer alike; the web
 * build grew correctly. React Native's New Architecture emits iOS
 * `onContentSizeChange` only from `updateLayoutMetrics`
 * (`RCTTextInputComponentView.mm`), so a `height` pinned from that event never
 * changes layout and never hears about line two. These pins keep native off
 * that loop: no `height`, the same floor/cap as bounds, and scrolling that does
 * not wait for a report that will not come.
 */
/* Source shapes the wiring pins look for (top level: biome useTopLevelRegex). */
const PINNED_HEIGHT = /\bheight: fieldBoxHeight\(/;
const ALWAYS_MULTILINE = /multiline=\{\s*integrated \|\|/;
const LINE_LIMIT = /numberOfLines=/;

const box = {
	contentFloor: 40,
	oneLineBox: 40,
	placeholderFloor: 40,
	cap: 132,
	touchFloor: 44,
	empty: false,
	placeholderClamped: true,
};

describe("native field height is measured, not pinned", () => {
	it("never pins a height on iOS or Android", () => {
		for (const platform of ["ios", "android"]) {
			const style = fieldBoxStyle(platform, box);
			expect(style).not.toHaveProperty("height");
			// Floor: the one-line box (+ border), raised to the touch floor.
			expect(style.minHeight).toBe(44);
			// Ceiling: the same six-line content cap web uses, as a border box.
			expect(style.maxHeight).toBe(132 + FIELD_BORDER_Y);
		}
	});

	it("keeps a stale one-line report from holding a filled field at one line", () => {
		// The defect's state: the report says one line while the reader has typed
		// three. Native must leave room to grow to the cap regardless.
		const style = fieldBoxStyle("ios", { ...box, contentFloor: 22 });
		expect(style.maxHeight).toBeGreaterThan(style.minHeight);
	});

	it("holds an empty, placeholder-clamped field at its resting floor", () => {
		// §2.5 D1: the native measure of a wrapped placeholder must not grow the
		// resting composer, so empty is pinned at the floor by min = max.
		const style = fieldBoxStyle("ios", {
			...box,
			oneLineBox: 64,
			placeholderFloor: 64,
			cap: 264,
			empty: true,
		});
		expect(style.minHeight).toBe(64 + FIELD_BORDER_Y);
		expect(style.maxHeight).toBe(64 + FIELD_BORDER_Y);
	});

	it("lets an empty, unclamped field grow with its wrapped placeholder", () => {
		const style = fieldBoxStyle("ios", {
			...box,
			empty: true,
			placeholderClamped: false,
		});
		expect(style.maxHeight).toBe(132 + FIELD_BORDER_Y);
	});

	it("leaves web on the pinned content-report height", () => {
		const style = fieldBoxStyle("web", { ...box, contentFloor: 88 });
		expect(style).toEqual({
			height: fieldBoxHeight(88, 40, 40, 132),
			minHeight: 44,
		});
		expect(style).not.toHaveProperty("maxHeight");
	});
});

describe("native field scrolling does not wait on a content report", () => {
	it("scrolls a filled native field even when the last report said it fits", () => {
		// Past the cap the box stops moving, so iOS sends no further report:
		// `scrollable` stays false and line seven would be unreachable.
		expect(fieldScrollEnabled("ios", false, false)).toBe(true);
		expect(fieldScrollEnabled("android", false, false)).toBe(true);
	});

	it("never scrolls an empty native field", () => {
		expect(fieldScrollEnabled("ios", true, true)).toBe(false);
	});

	it("keeps web on the content-report decision", () => {
		expect(fieldScrollEnabled("web", false, false)).toBe(false);
		expect(fieldScrollEnabled("web", true, false)).toBe(true);
	});
});

describe("the Textarea reads both rules", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./textarea.tsx", import.meta.url)),
		"utf8",
	);

	it("spreads fieldBoxStyle and no longer sets height directly", () => {
		expect(source).toContain("...fieldBoxStyle(Platform.OS, {");
		expect(source).not.toMatch(PINNED_HEIGHT);
	});

	it("stays multiline for every composer field", () => {
		// `integrated` (the composer and the Bridge composer) is always multiline;
		// a single-line native field cannot wrap at all.
		expect(source).toMatch(ALWAYS_MULTILINE);
		expect(source).not.toMatch(LINE_LIMIT);
	});
});
