import { readFileSync } from "node:fs";
import {
	Children,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import type { SkillEntry } from "@/contracts";
import { SURFACE, skillTrayRowId } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";
import { SKILL_TRAY_MAX_PT, SkillRow, SkillTray } from "./skill-tray";

const PHYSICAL_SPACING = /\b(pl|pr|ml|mr|left|right)-\d/;
const LOGICAL_ROW_PAD = /\bps-3 pe-3\b/;

const ROWS: SkillEntry[] = [
	{ name: "ape-agent", description: "Drive an agent", hidden: false },
	{ name: "secret", description: "By name only", hidden: true },
];

/** Every element in a tree, depth first, unwrapping `SkillRow` and the
 *  Pressable's render-prop child. */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
	Children.forEach(node, (child) => {
		if (!isValidElement(child)) return;
		out.push(child);
		const props = child.props as { children?: ReactNode };
		if (child.type === SkillRow)
			elements(SkillRow(child.props as Parameters<typeof SkillRow>[0]), out);
		if (typeof props.children === "function")
			elements(
				(props.children as (state: { pressed: boolean }) => ReactNode)({
					pressed: false,
				}),
				out,
			);
		else elements(props.children, out);
	});
	return out;
}
const props = (element: ReactElement | undefined) =>
	(element?.props ?? {}) as Record<string, unknown>;
const tree = (onPick = vi.fn()) =>
	elements(
		SkillTray({ rows: ROWS, onPick, onHold: vi.fn(), onRelease: vi.fn() }),
	);
const texts = (nodes: ReactElement[]) =>
	nodes.flatMap((e) => {
		const c = props(e).children;
		return typeof c === "string"
			? [c]
			: Array.isArray(c)
				? c.filter((x) => typeof x === "string")
				: [];
	});

describe("SkillTray", () => {
	it("draws nothing for no rows", () => {
		expect(SkillTray({ rows: [], onPick: vi.fn() })).toBeNull();
	});
	it("keeps the keyboard up on a tap and caps its height at 3.5 rows", () => {
		const nodes = tree();
		const scroll = nodes.find((e) => props(e).keyboardShouldPersistTaps);
		expect(props(scroll).keyboardShouldPersistTaps).toBe("handled");
		expect(props(scroll).style).toEqual({ maxHeight: SKILL_TRAY_MAX_PT });
		expect(SKILL_TRAY_MAX_PT).toBe(Math.round(TOUCH_FLOOR * 3.5));
		expect(nodes.map((e) => props(e).testID)).toContain(SURFACE.skillTray);
	});
	it("one row per skill with `$name` and its description", () => {
		const nodes = tree();
		expect(nodes.map((e) => props(e).testID)).toEqual(
			expect.arrayContaining([
				skillTrayRowId("ape-agent"),
				skillTrayRowId("secret"),
			]),
		);
		const shown = texts(nodes);
		expect(shown).toContain("Drive an agent");
		// `$` and the name are two text children of one node.
		expect(
			nodes.some((e) => {
				const c = props(e).children;
				return Array.isArray(c) && c.join("") === "$ape-agent";
			}),
		).toBe(true);
	});
	it("marks only a hidden skill, with the relay's own word", () => {
		const shown = texts(tree());
		expect(shown.filter((s) => s === "hidden")).toHaveLength(1);
	});
	it("a tap picks that row's name; press-in/out report the hold", () => {
		const onPick = vi.fn();
		const onHold = vi.fn();
		const onRelease = vi.fn();
		const nodes = elements(
			SkillTray({ rows: ROWS, onPick, onHold, onRelease }),
		);
		const press = nodes.find(
			(e) => props(e).testID === skillTrayRowId("secret"),
		);
		(props(press).onPressIn as () => void)();
		expect(onHold).toHaveBeenCalledOnce();
		(props(press).onPress as () => void)();
		expect(onPick).toHaveBeenCalledWith("secret");
		(props(press).onPressOut as () => void)();
		expect(onRelease).toHaveBeenCalledOnce();
		expect(props(press).accessibilityLabel).toBe("$secret, hidden");
		expect(props(press).accessibilityHint).toBe("By name only");
	});
	it("rows use logical (start/end) padding only, so RTL mirrors", () => {
		const source = readFileSync(
			new URL("./skill-tray.tsx", import.meta.url),
			"utf8",
		);
		expect(source).not.toMatch(PHYSICAL_SPACING);
		expect(source).toMatch(LOGICAL_ROW_PAD);
	});
});
