import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	type AuditNode,
	type AuditState,
	runChecks,
	U08_SUPPRESSION,
} from "./checks.ts";
import { floorsFromTokens } from "./color.ts";
import {
	type PaintRect,
	paintOverlap,
	rectangleUnion,
	unionArea,
} from "./paint-fragments.ts";
import { PURE_OWN_TEXT_SOURCE } from "./probe.ts";

const box = (x: number, y: number, w: number, h: number) => ({
	x,
	y,
	w,
	h,
	right: x + w,
	bottom: y + h,
});
// Complete neutral computed paint state, not an assumption that omitted CSS
// properties mean no paint. Generated-style reads are supplied independently.
const textStyle = () => ({
	display: "inline",
	content: "normal",
	backgroundColor: "transparent",
	backgroundImage: "none",
	borderImageSource: "none",
	boxShadow: "none",
	textShadow: "none",
	textDecorationLine: "none",
	filter: "none",
	backdropFilter: "none",
	maskImage: "none",
	textEmphasisStyle: "none",
	outlineWidth: "0",
	columnRuleWidth: "0",
	webkitTextStrokeWidth: "0",
	webkitBoxReflect: "none",
	borderTopWidth: "0",
	borderRightWidth: "0",
	borderBottomWidth: "0",
	borderLeftWidth: "0",
});
function node(
	index: number,
	rect: ReturnType<typeof box>,
	fragments?: PaintRect[],
): AuditNode {
	return {
		index,
		tag: "span",
		path: `generic-${index}`,
		ancestors: [],
		ownText: `text${index}`,
		interactive: false,
		rect,
		visibleRect: rect,
		u08PaintFragments: fragments,
		position: "static",
		ownBackground: "transparent",
		background: "transparent",
		borderWidth: 0,
		childImages: 0,
		inModalDialog: false,
	} as unknown as AuditNode;
}
function rows(nodes: AuditNode[]) {
	return runChecks(
		{
			nodes,
			viewport: { width: 390, height: 844, dpr: 3 },
			platform: "ios",
			insets: { top: 59, bottom: 34, left: 0, right: 0 },
			scale: "150",
		} as AuditState,
		{
			floors: floorsFromTokens(null),
			semantic: new Set(),
			checks: ["U-08"],
			scaleIsLive: true,
		},
	);
}
function incidentNodes(): AuditNode[] {
	// Recorded canonical hosted packet39544082930@f28: anonymized selectors so
	// this is a geometry regression, not a TurnBar/selector exception.
	return [
		node(1, box(25, 467, 22, 18), [
			{ x: 25, y: 467.484375, w: 21.609375, h: 18.171875 },
		]),
		node(2, box(25, 467, 274, 18), [
			{ x: 148.1875, y: 467.484375, w: 140.40625, h: 18.171875 },
			{ x: 288.59375, y: 467.484375, w: 10.8125, h: 18.171875 },
		]),
	];
}
describe("U08 exact paint rectangle sets", () => {
	it("preserves holes and never double-counts overlapping/duplicate fragments", () => {
		expect(
			unionArea([box(0, 0, 10, 10), box(5, 0, 10, 10), box(0, 0, 10, 10)]),
		).toBe(150);
		expect(unionArea([box(0, 0, 10, 2), box(0, 8, 10, 2)])).toBe(40);
		expect(rectangleUnion([box(0, 0, 5, 10), box(5, 0, 5, 10)])).toEqual([
			{ x: 0, y: 0, w: 10, h: 10 },
		]);
		expect(() => rectangleUnion([box(0, 0, Number.NaN, 10)])).toThrow(
			"Invalid U08",
		);
	});
	it("reproduces the old incident envelope failure then explains real fragment disjointness", () => {
		const precise = incidentNodes();
		const legacy = precise.map(
			({ u08PaintFragments: _old, ...n }) => n as AuditNode,
		);
		expect(rows(legacy).some((r) => r.verdict === "FAIL")).toBe(true);
		expect(rows(precise).some((r) => r.verdict === "FAIL")).toBe(false);
		expect(
			rows(precise).some((r) => r.measured?.includes(U08_SUPPRESSION.DISJOINT)),
		).toBe(true);
		expect(
			paintOverlap(
				precise[0] ?? node(0, box(0, 0, 0, 0)),
				precise[1] ?? node(0, box(0, 0, 0, 0)),
			).intersections,
		).toEqual([]);
	});
	it("keeps missing data conservative but distinguishes observed no-paint", () => {
		expect(
			rows([node(1, box(0, 100, 20, 20)), node(2, box(0, 100, 20, 20))])[0]
				?.verdict,
		).toBe("FAIL");
		expect(
			rows([
				node(1, box(0, 100, 20, 20), []),
				node(2, box(0, 100, 20, 20)),
			]).some((r) => r.verdict === "FAIL"),
		).toBe(false);
	});
	it("retains genuine glyph collision, 25% threshold and greater-than-one-point contact", () => {
		const a = node(1, box(0, 100, 20, 20), [box(0, 100, 20, 20)]);
		expect(
			rows([a, node(2, box(15, 100, 20, 20), [box(15, 100, 20, 20)])])[0]
				?.verdict,
		).toBe("FAIL");
		expect(
			rows([a, node(2, box(16, 100, 20, 20), [box(16, 100, 20, 20)])]).some(
				(r) => r.verdict === "FAIL",
			),
		).toBe(false);
		expect(
			rows([a, node(2, box(19, 100, 20, 20), [box(19, 100, 20, 20)])]).some(
				(r) => r.verdict === "FAIL",
			),
		).toBe(false);
		expect(
			paintOverlap(
				a,
				node(2, box(0, 100, 20, 20), [
					box(0, 100, 20, 20),
					box(0, 100, 20, 20),
				]),
			).pct,
		).toBe(1);
	});
	it.each([
		{ interactive: true },
		{ borderWidth: 1 },
		{ childImages: 1 },
		{ ownBackground: "rgb(1, 2, 3)" },
	])("never shrinks non-text/control paint to empty text: %j", (flags) => {
		const a = { ...node(1, box(0, 100, 20, 20), []), ...flags };
		expect(
			rows([a, node(2, box(0, 100, 20, 20))]).some((r) => r.verdict === "FAIL"),
		).toBe(true);
	});
	it("classifies actual pure-text probe eligibility conservatively for all four borders and other paint", () => {
		const style = textStyle();
		const el = {
			closest: () => null,
			matches: () => false,
			querySelectorAll: () => [],
		};
		const eligible = runInNewContext(
			`(${PURE_OWN_TEXT_SOURCE})`,
			{ getComputedStyle: () => ({ content: "none" }) },
			{ timeout: 100 },
		) as (
			el: unknown,
			style: unknown,
			text: string,
			interactive: boolean,
			px: (n: string) => number,
		) => boolean;
		expect(eligible(el, style, "own text", false, Number.parseFloat)).toBe(
			true,
		);
		expect(eligible(el, style, "own text", true, Number.parseFloat)).toBe(
			false,
		);
		for (const side of ["Top", "Right", "Bottom", "Left"])
			expect(
				eligible(
					el,
					{ ...style, [`border${side}Width`]: "1" },
					"text",
					false,
					Number.parseFloat,
				),
			).toBe(false);
		for (const override of [
			{ backgroundColor: "rgb(1,2,3)" },
			{ backgroundImage: "url(image)" },
			{ boxShadow: "0 0 1px black" },
			{ textShadow: "1px 1px black" },
			{ textDecorationLine: "underline" },
			{ outlineWidth: "1" },
			{ filter: "drop-shadow(1px 1px black)" },
			{ maskImage: "url(mask)" },
			{ borderImageSource: "url(border)" },
			{ columnRuleWidth: "1" },
			{ textEmphasisStyle: "filled" },
			{ webkitTextStrokeWidth: "1" },
			{ webkitBoxReflect: "below 0px" },
			{ content: "url(image)" },
			{ display: "list-item" },
		])
			expect(
				eligible(
					el,
					{ ...style, ...override },
					"text",
					false,
					Number.parseFloat,
				),
			).toBe(false);
		expect(
			eligible(
				{ ...el, querySelectorAll: () => [{}] },
				style,
				"text",
				false,
				Number.parseFloat,
			),
		).toBe(false);
		expect(
			eligible(
				{ ...el, closest: () => ({}) },
				style,
				"text",
				false,
				Number.parseFloat,
			),
		).toBe(false);
	});

	it("executes classifier-to-policy boundaries for pseudo and non-media child paint without losing pure inline controls", () => {
		const style = textStyle();
		const leaf = {
			closest: () => null,
			matches: () => false,
			querySelectorAll: (_selector: string): unknown[] => [],
		};
		const makeClassifier = (
			readStyle: (_el: unknown, pseudo: string) => unknown,
		) =>
			runInNewContext(
				`(${PURE_OWN_TEXT_SOURCE})`,
				{ getComputedStyle: readStyle },
				{ timeout: 100 },
			) as (
				el: unknown,
				style: unknown,
				text: string,
				interactive: boolean,
				px: (v: string) => number,
			) => boolean;
		const classify = (
			n: AuditNode,
			el: unknown = leaf,
			readStyle: (_el: unknown, pseudo: string) => unknown = () => ({
				content: "none",
			}),
		) => {
			const eligible = makeClassifier(readStyle)(
				el,
				style,
				n.ownText,
				false,
				Number.parseFloat,
			);
			return {
				...n,
				u08PaintFragments: eligible ? n.u08PaintFragments : undefined,
			};
		};
		// Empty generated content can paint a box; generated nodes are absent from
		// the canonical DOM list. Exercise the actual omission/fallback, not a flag.
		for (const pseudo of ["::before", "::after", "::marker"]) {
			const reads: string[] = [];
			const owner = classify(
				node(1, box(0, 100, 40, 18), [box(20, 100, 20, 18)]),
				leaf,
				(_el, kind) => {
					reads.push(kind);
					return {
						content: kind === pseudo ? '""' : "none",
						backgroundColor: kind === pseudo ? "red" : "transparent",
					};
				},
			);
			expect(reads).toEqual(["::before", "::after", "::marker"]);
			expect(owner.u08PaintFragments).toBeUndefined();
			expect(
				rows([
					owner,
					classify(node(2, box(5, 100, 10, 18), [box(5, 100, 10, 18)])),
				]).some((r) => r.verdict === "FAIL"),
			).toBe(true);
		}
		const child = { backgroundColor: "red", ownText: "" };
		const owner = classify(
			node(1, box(0, 100, 100, 20), [box(0, 100, 10, 20)]),
			{
				...leaf,
				querySelectorAll: (selector: string) =>
					selector === "*" ? [child] : [],
			},
		);
		expect(owner.u08PaintFragments).toBeUndefined();
		const childNode = {
			...node(3, box(50, 100, 10, 20)),
			ownText: "",
			ownBackground: "red",
			ancestors: [1],
		};
		expect(
			rows([
				owner,
				classify(node(2, box(50, 100, 10, 20), [box(50, 100, 10, 20)])),
				childNode,
			]).some((r) => r.verdict === "FAIL"),
		).toBe(true);
		for (const pseudo of ["::before", "::after", "::marker"]) {
			for (const unreadable of [
				() => null,
				() => ({}),
				() => {
					throw new Error("unreadable pseudo");
				},
			]) {
				const guarded = classify(
					node(1, box(0, 100, 40, 18), [box(20, 100, 20, 18)]),
					leaf,
					(_el, kind) => (kind === pseudo ? unreadable() : { content: "none" }),
				);
				expect(guarded.u08PaintFragments).toBeUndefined();
				expect(
					rows([guarded, node(2, box(5, 100, 10, 18))]).some(
						(r) => r.verdict === "FAIL",
					),
				).toBe(true);
			}
		}
		const wrapped = incidentNodes().map((n) => classify(n));
		expect(wrapped.every((n) => n.u08PaintFragments !== undefined)).toBe(true);
		expect(
			rows(wrapped).some((r) => r.measured?.includes(U08_SUPPRESSION.DISJOINT)),
		).toBe(true);
		expect(rows(wrapped).some((r) => r.verdict === "FAIL")).toBe(false);
		const genuine = [
			node(1, box(0, 100, 30, 20), [box(0, 100, 30, 20)]),
			node(2, box(10, 100, 30, 20), [box(10, 100, 30, 20)]),
		].map((n) => classify(n));
		expect(genuine.every((n) => n.u08PaintFragments !== undefined)).toBe(true);
		expect(rows(genuine).some((r) => r.verdict === "FAIL")).toBe(true);
	});

	it("retains real ancestry exclusions and modal/fixed-control semantics", () => {
		const a = node(1, box(0, 100, 20, 20), [box(0, 100, 20, 20)]),
			b = node(2, box(0, 100, 20, 20), [box(0, 100, 20, 20)]);
		expect(
			rows([a, { ...b, ancestors: [1] }]).some((r) => r.verdict === "FAIL"),
		).toBe(false);
		expect(
			rows([
				{ ...a, inModalDialog: true },
				{ ...b, inModalDialog: true },
			]).some((r) => r.verdict === "FAIL"),
		).toBe(true);
		expect(
			rows([
				{ ...a, position: "fixed", interactive: true },
				{ ...b, position: "fixed", interactive: true },
			]).some((r) => r.verdict === "FAIL"),
		).toBe(true);
	});
	it("preserves1pt contact tolerance even when overlap area exceeds25percent", () => {
		expect(
			rows([
				node(1, box(0, 100, 2, 20), [box(0, 100, 2, 20)]),
				node(2, box(1, 100, 2, 20), [box(1, 100, 2, 20)]),
			]).some((r) => r.verdict === "FAIL"),
		).toBe(false);
	});
	it("keeps true contact across narrow sweep slabs without filling thin-L holes", () => {
		const staircase = [
			box(0, 100, 0.75, 10),
			box(0.75, 101, 0.75, 10),
			box(1.5, 102, 0.75, 10),
		];
		expect(
			paintOverlap(
				{ visibleRect: null, u08PaintFragments: staircase },
				{ visibleRect: null, u08PaintFragments: staircase },
			).contact,
		).toBe(true);
		const thinL = [box(0, 100, 10, 0.5), box(0, 100, 0.5, 10)];
		expect(
			paintOverlap(
				{ visibleRect: null, u08PaintFragments: thinL },
				{ visibleRect: null, u08PaintFragments: thinL },
			).contact,
		).toBe(false);
	});
});
