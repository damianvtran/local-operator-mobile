import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CdpPage } from "../lib/cdp.ts";
import { launchChrome, resolveChrome } from "../lib/chrome.ts";
import { EXTRACT_PROBE } from "./probe.ts";

/**
 * Outline and column-rule purity, measured against REAL Chrome computed styles.
 *
 * WHY A BROWSER AND NOT THE STUB EVALUATOR in `pure-own-text.test.ts`: the defect
 * lives in what Chrome reports, not in the rule's arithmetic. For an element with
 * `outline-style: none` / `column-rule-style: none`, `getComputedStyle` keeps the
 * INITIAL width (`medium` = 3px) — unlike `border-*-width`, which reads 0. The
 * probe used to read that 3px as a painted outline, so every ordinary text node
 * was blocked by `outline-width` and then `column-rule-width` (hosted run
 * 40205225129, nodes 64/65/66/68). A stub that hands the rule `"0"` can never
 * show that; a test that hard-coded `"3px"` would only restate our belief about
 * Chrome. These cases therefore run the shipped `EXTRACT_PROBE` over a live page.
 *
 * The control cases are the other half of the contract: a node that genuinely
 * PAINTS an outline or a column rule must still be excluded, otherwise the fix
 * would have traded a false positive for a false negative (a collision hidden
 * behind a painted ring).
 *
 * No Chrome locally is a skip; no Chrome under CI is a failure, because a silently
 * skipped browser test is a gate that passes without having measured anything.
 */

interface Exclusion {
	blockedBy: string | null;
	expected: unknown;
	observed: unknown;
	conditions: { name: string; ok: boolean; observed: unknown }[];
}
interface ProbeNode {
	ownText: string;
	u08PaintFragments?: unknown[];
	u08PaintExclusion?: Exclusion;
}

const chromeAvailable = resolveChrome() !== null;
if (!chromeAvailable && process.env.CI) {
	throw new Error(
		"CI has no Chrome: the outline/column-rule purity test needs the installed browser.",
	);
}

let chrome: Awaited<ReturnType<typeof launchChrome>> | undefined;
let page: CdpPage | undefined;

beforeAll(async () => {
	if (!chromeAvailable) return;
	chrome = await launchChrome();
	page = await chrome.page();
}, 120_000);

afterAll(async () => {
	if (!chrome) return;
	const reaped = await chrome.close();
	expect(reaped.survivors).toBe(0);
}, 60_000);

/** Probe one text-bearing element and return its node record. */
async function probe(html: string, text: string): Promise<ProbeNode> {
	if (!page) throw new Error("no page");
	await page.evaluate(
		`document.body.innerHTML = ${JSON.stringify(html)}; document.body.offsetHeight`,
	);
	const state = (await page.evaluate(EXTRACT_PROBE)) as { nodes: ProbeNode[] };
	const node = state.nodes.find((n) => n.ownText === text);
	if (!node) throw new Error(`probe returned no node for "${text}"`);
	return node;
}

const condition = (node: ProbeNode, name: string) =>
	node.u08PaintExclusion?.conditions.find((row) => row.name === name);

describe.skipIf(!chromeAvailable)(
	"outline / column-rule purity in Chrome",
	() => {
		it("Chrome keeps the initial 3px width when the style is none (the premise)", async () => {
			if (!page) throw new Error("no page");
			await page.evaluate(
				`document.body.innerHTML = '<span id=s>plain</span><div id=m style="column-count:2">x</div>'`,
			);
			const computed = await page.evaluate(
				`(() => { const s = getComputedStyle(document.getElementById('s')), m = getComputedStyle(document.getElementById('m')); return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, ruleWidth: m.columnRuleWidth, ruleStyle: m.columnRuleStyle, borderTop: s.borderTopWidth }; })()`,
			);
			expect(computed).toEqual({
				outlineWidth: "3px",
				outlineStyle: "none",
				ruleWidth: "3px",
				ruleStyle: "none",
				borderTop: "0px",
			});
		});

		it("a plain text node is pure: a style-none outline and rule paint nothing", async () => {
			const node = await probe("<span>plain</span>", "plain");
			expect(node.u08PaintExclusion?.blockedBy).toBeUndefined();
			expect(node.u08PaintExclusion).toBeUndefined();
			expect(Array.isArray(node.u08PaintFragments)).toBe(true);
		});

		it("explicit outline:none and a multicol with rule-style none stay pure", async () => {
			const outline = await probe(
				'<div style="outline:none">none outline</div>',
				"none outline",
			);
			expect(outline.u08PaintExclusion).toBeUndefined();
			const columns = await probe(
				'<div style="column-count:2;column-rule-style:none;column-rule-width:5px">none rule</div>',
				"none rule",
			);
			expect(columns.u08PaintExclusion).toBeUndefined();
		});

		it("a painting style with zero width is still nothing to paint", async () => {
			const node = await probe(
				'<div style="outline:0 solid red;column-count:2;column-rule:0 solid red">zero width</div>',
				"zero width",
			);
			expect(node.u08PaintExclusion).toBeUndefined();
		});

		it.each([
			[
				"outline: 2px solid red",
				"outline:2px solid red",
				"outline-width",
				"2px solid",
			],
			[
				"outline: 1px dotted",
				"outline:1px dotted",
				"outline-width",
				"1px dotted",
			],
			[
				"column-rule: 2px solid in a multicol",
				"column-count:2;column-rule:2px solid",
				"column-rule-width",
				"2px solid",
			],
		])(
			"still excludes a node that paints: %s",
			async (_label, css, blockedBy, observed) => {
				const node = await probe(
					`<div style="${css}">painted</div>`,
					"painted",
				);
				expect(node.u08PaintFragments).toBeUndefined();
				expect(node.u08PaintExclusion?.blockedBy).toBe(blockedBy);
				expect(node.u08PaintExclusion?.observed).toBe(observed);
				// Only the painting condition fails; nothing else was loosened or tightened.
				expect(
					node.u08PaintExclusion?.conditions
						.filter((row) => !row.ok)
						.map((row) => row.name),
				).toEqual([blockedBy]);
			},
		);

		it("records the style beside the width, so a 3px width is explained", async () => {
			const node = await probe(
				'<div style="column-count:2;column-rule:2px solid">explained</div>',
				"explained",
			);
			// The passing outline row shows Chrome's initial width AND the style that
			// made it irrelevant, which a bare `3` would not.
			expect(condition(node, "outline-width")).toMatchObject({
				ok: true,
				observed: "3px none",
			});
		});
	},
);
