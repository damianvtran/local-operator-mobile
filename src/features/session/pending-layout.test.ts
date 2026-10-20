import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { EMPTY, STATE_MARKER, SURFACE } from "@/ui/a11y";
import { collapsePendingTranscript } from "./pending-layout";

const COLLAPSE_CALL =
	/collapsePendingTranscript\(\s*compact,\s*pendingViewProps !== null,\s*runtime\.connection\.id,?\s*\)/;
const DUPLICATED_INSET = /marginLeft|marginRight|paddingLeft|paddingRight/;
const COMPACT_DETAIL =
	/compact\s*\? "text-title text-ink"\s*: "text-display text-ink"/;
const require = createRequire(import.meta.url);
const expo = createRequire(require.resolve("expo"));
const metro = createRequire(expo.resolve("@expo/metro-config"));
type Ast = { type: string; [key: string]: unknown };
const parser = metro("@babel/parser") as {
	parse: (source: string, options: object) => Ast;
};
const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
function elements(source: string): Ast[] {
	const found: Ast[] = [];
	function walk(node: Ast) {
		if (node.type === "JSXElement") found.push(node);
		for (const value of Object.values(node))
			for (const item of Array.isArray(value) ? value : [value])
				if (item && typeof item === "object" && "type" in item)
					walk(item as Ast);
	}
	walk(
		parser.parse(source, {
			sourceType: "module",
			plugins: ["typescript", "jsx"],
		}),
	);
	return found;
}
const opening = (node: Ast) => node.openingElement as Ast;
const attrs = (source: string, node: Ast) =>
	source.slice(Number(opening(node).start), Number(opening(node).end));

describe("PR92/main semantic convergence", () => {
	it("keeps the normal compact pending decision layout only without a live notice", () => {
		expect(collapsePendingTranscript(true, true, null)).toBe(true);
		expect(collapsePendingTranscript(false, true, null)).toBe(false);
		expect(collapsePendingTranscript(true, false, null)).toBe(false);
	});
	it.each(["C5", "C6", "C2"] as const)(
		"never hides the footer/action for active typed notice %s",
		(notice) => {
			expect(collapsePendingTranscript(true, true, notice)).toBe(false);
			expect(collapsePendingTranscript(false, true, notice)).toBe(false);
		},
	);
	it("wires the collapse decision to typed banner state while retaining the full footer", () => {
		const source = read("../../../app/(app)/session/[id].tsx");
		expect(source).toMatch(COLLAPSE_CALL);
		expect(source).toContain("footer={connectionBanner}");
		expect(source).toContain('className="flex-1 min-h-0"');
	});
	it("keeps both S6 and Library state contracts, not one conflict side", () => {
		expect(STATE_MARKER.subagent.populated).toBe(SURFACE.subagentTranscript);
		expect(STATE_MARKER.subagent.empty).toBe(EMPTY.subagent);
		expect(STATE_MARKER.library.populated).toBe("library-tile-");
		expect(STATE_MARKER["library-detail"].composer).toBe(
			SURFACE.libraryComposer,
		);
	});
	it("names the inner dialog surface with safe-area padding only on its box-none carrier", () => {
		const source = read("../../ui/components/dialog.tsx");
		const nodes = elements(source);
		const surface = nodes.find((node) =>
			attrs(source, node).includes("role={ROLE.dialog}"),
		);
		if (!surface) throw new Error("Missing named dialog surface");
		expect(attrs(source, surface)).toContain("aria-label={title}");
		expect(attrs(source, surface)).toContain(
			"className={DIALOG_SURFACE_CLASS}",
		);
		expect(attrs(source, surface)).not.toMatch(DUPLICATED_INSET);
		const carrier = nodes.find((node) =>
			(node.children as unknown[]).includes(surface),
		);
		if (!carrier) throw new Error("Missing inset carrier");
		expect(attrs(source, carrier)).toContain('pointerEvents="box-none"');
		expect(attrs(source, carrier)).toContain("paddingLeft: insets.left");
		expect(attrs(source, carrier)).toContain("paddingRight: insets.right");
		expect(attrs(source, carrier)).not.toContain("role={ROLE.dialog}");
	});
	it("combines compact heading typography with both headerDetail branches", () => {
		const source = read("../../ui/components/screen.tsx");
		const nodes = elements(source);
		expect(source.match(/headerDetail === undefined/g)).toHaveLength(2);
		const detail = nodes.find((node) =>
			attrs(source, node).includes('className="min-w-0 flex-1 gap-1"'),
		);
		if (!detail) throw new Error("Missing inline header detail");
		const heading = (detail.children as Ast[]).find(
			(node) => node.type === "JSXElement",
		);
		if (!heading) throw new Error("Missing detail heading");
		expect(attrs(source, heading)).toMatch(COMPACT_DETAIL);
		expect(source.slice(Number(detail.start), Number(detail.end))).toContain(
			"{headerDetail}",
		);
	});
});
