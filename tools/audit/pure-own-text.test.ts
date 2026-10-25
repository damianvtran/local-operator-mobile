import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	EXTRACT_PROBE,
	PURE_OWN_TEXT_SOURCE,
	PURE_OWN_TEXT_VERDICT_SOURCE,
	U08_COMPACT_SOURCE,
	U08_PAINT_EXCLUSION_SOURCE,
} from "./probe.ts";

/**
 * These tests drive the ACTUAL in-page evaluator — the same source string the
 * probe injects — never a re-implementation. A test that restated the conditions
 * would stay green while the gate and its recorded reason drifted apart, which is
 * exactly the failure the explainable verdict exists to prevent.
 *
 * The first test pins the ordered condition list. The second drives one
 * deliberately-failing case per name and asserts the rule reports *that* name, and
 * only that name, together with the value it actually observed. A condition that
 * is added, renamed or quietly weakened without a case here fails this file: an
 * unnamed or misattributed condition is not auditable.
 */

interface Row {
	name: string;
	expected: string | number | boolean | null;
	observed: string | number | boolean | null;
	ok: boolean;
}

interface Verdict {
	pure: boolean;
	blockedBy: string | null;
	expected: string | number | boolean | null;
	observed: string | number | boolean | null;
	conditions: Row[];
}

type Evaluator = (
	el: unknown,
	style: unknown,
	ownText: string,
	interactiveNode: boolean,
	px: (value: string) => number,
	explain: boolean,
) => Verdict;

const NAMES = [
	"own-text",
	"interactive",
	"display",
	"display-not-list-item",
	"content",
	"background-color",
	"background-image",
	"border-image-source",
	"box-shadow",
	"text-shadow",
	"text-decoration-line",
	"filter",
	"backdrop-filter",
	"mask-image",
	"text-emphasis-style",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"outline-width",
	"column-rule-width",
	"-webkit-text-stroke-width",
	"-webkit-box-reflect",
	"svg-ancestor",
	"replaced-content",
	"element-descendants",
	"::before-content",
	"::after-content",
	"::marker-content",
];

/** Every condition satisfied. Written out in full rather than defaulted: a
 * condition whose input is MISSING is a different case from one whose value is
 * neutral, and the rule treats missing as a failure. */
const neutralStyle = (): Record<string, string> => ({
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
	outlineStyle: "none",
	columnRuleWidth: "0",
	columnRuleStyle: "none",
	webkitTextStrokeWidth: "0",
	webkitBoxReflect: "none",
	borderTopWidth: "0",
	borderRightWidth: "0",
	borderBottomWidth: "0",
	borderLeftWidth: "0",
});

interface ElementStub {
	closest: (selector: string) => unknown;
	matches: (selector: string) => boolean;
	querySelectorAll: (selector: string) => unknown[];
}

/** A leaf: no element children, not inside an svg, no replaced content. */
function element(overrides: Partial<ElementStub> = {}): ElementStub {
	return {
		closest: (selector) => overrides.closest?.(selector) ?? null,
		matches: (selector) => overrides.matches?.(selector) ?? false,
		querySelectorAll: (selector) =>
			overrides.querySelectorAll?.(selector) ?? [],
	};
}

function load(pseudo: Record<string, unknown> = {}): Evaluator {
	const getComputedStyle = (_el: unknown, name: string) =>
		pseudo[name] ?? { content: "none" };
	return runInNewContext(
		`(${PURE_OWN_TEXT_VERDICT_SOURCE})`,
		{ getComputedStyle },
		{ timeout: 100 },
	) as Evaluator;
}

function loadBoolean(pseudo: Record<string, unknown> = {}) {
	const getComputedStyle = (_el: unknown, name: string) =>
		pseudo[name] ?? { content: "none" };
	return runInNewContext(
		`(${PURE_OWN_TEXT_SOURCE})`,
		{ getComputedStyle },
		{ timeout: 100 },
	) as (
		el: unknown,
		style: unknown,
		ownText: string,
		interactive: boolean,
		px: (value: string) => number,
	) => boolean;
}

interface Case {
	name: string;
	/** The value the failing condition should report as observed. */
	observed: string | number | boolean;
	style?: Record<string, string>;
	pseudo?: Record<string, unknown>;
	el?: Partial<ElementStub>;
	text?: string;
	interactive?: boolean;
}

const CASES: Case[] = [
	{ name: "own-text", observed: 0, text: "" },
	{ name: "interactive", observed: true, interactive: true },
	{ name: "display", observed: "", style: { display: "" } },
	{
		name: "display-not-list-item",
		observed: "list-item",
		style: { display: "list-item" },
	},
	{ name: "content", observed: "url(image)", style: { content: "url(image)" } },
	{
		name: "background-color",
		observed: "rgb(1, 2, 3)",
		style: { backgroundColor: "rgb(1, 2, 3)" },
	},
	{
		name: "background-image",
		observed: "url(image)",
		style: { backgroundImage: "url(image)" },
	},
	{
		name: "border-image-source",
		observed: "url(border)",
		style: { borderImageSource: "url(border)" },
	},
	{
		name: "box-shadow",
		observed: "0 0 1px black",
		style: { boxShadow: "0 0 1px black" },
	},
	{
		name: "text-shadow",
		observed: "1px 1px black",
		style: { textShadow: "1px 1px black" },
	},
	{
		name: "text-decoration-line",
		observed: "underline",
		style: { textDecorationLine: "underline" },
	},
	{
		name: "filter",
		observed: "drop-shadow(1px 1px black)",
		style: { filter: "drop-shadow(1px 1px black)" },
	},
	{
		name: "backdrop-filter",
		observed: "blur(2px)",
		style: { backdropFilter: "blur(2px)" },
	},
	{
		name: "mask-image",
		observed: "url(mask)",
		style: { maskImage: "url(mask)" },
	},
	{
		name: "text-emphasis-style",
		observed: "filled",
		style: { textEmphasisStyle: "filled" },
	},
	{ name: "border-top-width", observed: 1, style: { borderTopWidth: "1" } },
	{ name: "border-right-width", observed: 1, style: { borderRightWidth: "1" } },
	{
		name: "border-bottom-width",
		observed: 1,
		style: { borderBottomWidth: "1" },
	},
	{ name: "border-left-width", observed: 1, style: { borderLeftWidth: "1" } },
	// The observation carries the style beside the width: "1px solid" is a painted
	// outline, where Chrome's "3px none" for an unstyled node is not (the real
	// browser cases live in outline-rule-purity.chrome.test.ts).
	{
		name: "outline-width",
		observed: "1px solid",
		style: { outlineWidth: "1", outlineStyle: "solid" },
	},
	{
		name: "column-rule-width",
		observed: "1px solid",
		style: { columnRuleWidth: "1", columnRuleStyle: "solid" },
	},
	{
		name: "-webkit-text-stroke-width",
		observed: "1",
		style: { webkitTextStrokeWidth: "1" },
	},
	{
		name: "-webkit-box-reflect",
		observed: "below 0px",
		style: { webkitBoxReflect: "below 0px" },
	},
	{
		name: "svg-ancestor",
		observed: true,
		el: { closest: (selector) => (selector === "svg" ? {} : null) },
	},
	{
		name: "replaced-content",
		observed: true,
		el: { matches: () => true },
	},
	{
		name: "element-descendants",
		observed: 1,
		el: {
			querySelectorAll: (selector) => (selector === "*" ? [{}] : []),
		},
	},
	{
		name: "::before-content",
		observed: '""',
		pseudo: { "::before": { content: '""' } },
	},
	{
		name: "::after-content",
		observed: '""',
		pseudo: { "::after": { content: '""' } },
	},
	{
		name: "::marker-content",
		observed: '""',
		pseudo: { "::marker": { content: '""' } },
	},
];

function run(evaluator: Evaluator, kase: Partial<Case> = {}): Verdict {
	const style = { ...neutralStyle(), ...(kase.style ?? {}) };
	return evaluator(
		element(kase.el),
		style,
		kase.text ?? "own text",
		kase.interactive ?? false,
		Number.parseFloat,
		true,
	);
}
/** The same evaluator with whole-map recording off — what the probe's hot path
 * calls for every non-candidate node. */
function runFast(kase: Case): boolean {
	return load(kase.pseudo)(
		element(kase.el),
		{ ...neutralStyle(), ...(kase.style ?? {}) },
		kase.text ?? "own text",
		kase.interactive ?? false,
		Number.parseFloat,
		false,
	).pure;
}

describe("own-text purity verdict", () => {
	it("reports every condition, in rule order, for a genuinely pure leaf", () => {
		const result = run(load());
		expect(result.pure).toBe(true);
		expect(result.blockedBy).toBeNull();
		expect(result.expected).toBeNull();
		expect(Array.from(result.conditions, (row) => row.name)).toEqual(NAMES);
		expect(result.conditions.every((row) => row.ok)).toBe(true);
	});

	it("names the single condition that rejects a node, with the value it observed", () => {
		for (const kase of CASES) {
			const result = run(load(kase.pseudo), kase);
			expect(result.pure, kase.name).toBe(false);
			expect(result.blockedBy, kase.name).toBe(kase.name);
			expect(result.observed, kase.name).toEqual(kase.observed);
			const failed = result.conditions.filter((row) => !row.ok);
			expect(
				Array.from(failed, (row) => row.name),
				kase.name,
			).toEqual([kase.name]);
			expect(
				result.conditions.find((row) => row.name === kase.name)?.observed,
				kase.name,
			).toEqual(kase.observed);
			// The hot path and the explained path are the same rule: a short-circuit
			// cannot change the verdict, only how much of the map is recorded.
			expect(runFast(kase), `${kase.name} (hot path)`).toBe(false);
		}
		expect(new Set(CASES.map((kase) => kase.name))).toEqual(new Set(NAMES));
	});

	it("keeps the policy's boolean identical to the recorded verdict", () => {
		expect(
			loadBoolean()(
				element(),
				neutralStyle(),
				"own text",
				false,
				Number.parseFloat,
			),
		).toBe(true);
		for (const kase of CASES) {
			const boolean = loadBoolean(kase.pseudo)(
				element(kase.el),
				{ ...neutralStyle(), ...(kase.style ?? {}) },
				kase.text ?? "own text",
				kase.interactive ?? false,
				Number.parseFloat,
			);
			expect(boolean, kase.name).toBe(run(load(kase.pseudo), kase).pure);
		}
	});

	it("keeps the paint the reviewers found conservative conservative", () => {
		// The two historical false negatives, driven through the real rule rather
		// than described: a generated box that paints, and a child element that
		// paints its own background while the owner has no text of its own to
		// shrink to.
		const pseudo = load({
			"::after": { content: '""', backgroundColor: "red" },
		});
		expect(run(pseudo).pure).toBe(false);
		expect(run(pseudo).blockedBy).toBe("::after-content");
		const child = load()(
			element({ querySelectorAll: () => [{ backgroundColor: "red" }] }),
			neutralStyle(),
			"",
			false,
			Number.parseFloat,
			true,
		);
		// No own text at all: the first condition already keeps it conservative.
		expect(child.pure).toBe(false);
		expect(child.blockedBy).toBe("own-text");
		const owner = run(load(), {
			name: "",
			observed: 1,
			el: { querySelectorAll: () => [{ backgroundColor: "red" }] },
		});
		expect(owner.pure).toBe(false);
		expect(owner.blockedBy).toBe("element-descendants");
	});
});

describe("the diagnostic record's emission and truncation rules", () => {
	const emit = (purity: unknown, ownText: string) =>
		runInNewContext(
			`(${U08_PAINT_EXCLUSION_SOURCE})`,
			{},
			{ timeout: 100 },
		)(purity, ownText) as
			| { blockedBy?: string; observed?: unknown; conditions?: unknown[] }
			| undefined;
	const compact = (value: unknown) =>
		runInNewContext(
			`(${U08_COMPACT_SOURCE})`,
			{},
			{ timeout: 100 },
		)(value) as unknown;
	const conservative = () =>
		run(load(), {
			name: "text-shadow",
			observed: "x",
			style: { textShadow: "1px 1px black" },
		});

	it("is emitted only for an own-text node that stayed conservative", () => {
		const purity = conservative();
		// No own text was never a candidate: dropping this guard would add a record to
		// every node in the frame, and a 3,384-cell audit would carry the bloat.
		expect(emit(purity, "")).toBeUndefined();
		// A pure node has nothing to explain.
		expect(emit({ ...purity, pure: true }, "own text")).toBeUndefined();
		const record = emit(purity, "own text");
		expect(record?.blockedBy).toBe("text-shadow");
		expect(record?.observed).toBe("1px 1px black");
		expect(record?.conditions).toHaveLength(NAMES.length);
	});

	it("injects each shared source exactly once instead of inlining a copy", () => {
		const occurrences = (haystack: string, needle: string) =>
			haystack.split(needle).length - 1;
		// An inline copy beside the export would keep both green while the probe and
		// its tests stopped sharing a rule; the count is what makes that impossible.
		expect(occurrences(EXTRACT_PROBE, U08_COMPACT_SOURCE)).toBe(1);
		expect(occurrences(EXTRACT_PROBE, U08_PAINT_EXCLUSION_SOURCE)).toBe(1);
	});

	it("truncates a long observed value but never a condition name", () => {
		expect(compact(undefined)).toBeNull();
		expect(compact("short")).toBe("short");
		const long = "x".repeat(60);
		expect(compact(long)).toBe(`${long.slice(0, 45)}...`);
		const result = run(load(), {
			name: "text-shadow",
			observed: long,
			style: { textShadow: long },
		});
		expect(result.blockedBy).toBe("text-shadow");
		expect(
			result.conditions.find((row) => row.name === "text-shadow")?.observed,
		).toBe(`${long.slice(0, 45)}...`);
		// Every name survives at full length, so the cap can never rename a condition.
		expect(Array.from(result.conditions, (row) => row.name)).toEqual(NAMES);
		expect(NAMES.every((name) => name.length <= 48)).toBe(true);
	});
});
