import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import type { AuditState } from "./checks.ts";
import {
	EXTRACT_PROBE,
	U08_GEOMETRY_SOURCE,
	u08GeometryProbe,
} from "./probe.ts";
import {
	assertRemote,
	fragmentIntersections,
	ORIGINAL_NODE_PATH,
	originalFailure,
	RECORD,
	verifyOriginalInstrument,
} from "./u08-geometry-proof.ts";

const root = resolve(import.meta.dirname, "../..");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const JOBS = /^ {2}([\w-]+):\n/m;
const JOB_GUARD = /^ {4}if: (.+)$/m;
const OBSERVER = /\n\s*state\.onU08Failure\?\.\(a\.index,\s*b\.index\);/;
function state(width = 22): AuditState {
	const rect = {
		x: 10,
		y: 100,
		w: width,
		h: 18,
		right: 10 + width,
		bottom: 118,
	};
	return {
		nodes: [
			{
				index: 0,
				tag: "button",
				testId: "turn-bar-tc-conv-00-user",
				interactive: true,
				ownText: "",
				ancestors: [],
				position: "static",
				rect,
				visibleRect: rect,
			},
			...[1, 2].map((index) => ({
				index,
				tag: "span",
				path: ORIGINAL_NODE_PATH,
				ancestors: [0],
				ownText: String(index),
				text: String(index),
				ownInk: true,
				ariaHidden: false,
				interactive: false,
				clippedAway: false,
				rect,
				visibleRect: rect,
				position: "static",
				background: "transparent",
				inModalDialog: false,
			})),
		],
		screen: RECORD.screen,
		state: RECORD.state,
		device: RECORD.device,
		theme: "dark",
		textScale: "1.5",
		url: "http://127.0.0.1/session/6714def86197?lo-scroll=top",
		viewport: { width: 390, height: 844, dpr: 3 },
		platform: "ios",
		scale: "150",
		insets: { top: 59, bottom: 34, left: 0, right: 0 },
	} as unknown as AuditState;
}
/** Execute the actual collector and unchanged canonical ancestor helpers in Node.
 * These supplied rectangles discriminate clipping ownership, not browser pixels. */
function collectGeometry(
	options: {
		overflow?: string;
		position?: string;
		ancestorWidth?: number;
		transform?: string;
		display?: string;
		textOverflow?: string;
	} = {},
) {
	const rect = (w: number) => ({
		left: 0,
		top: 0,
		right: w,
		bottom: 18,
		width: w,
		height: 18,
	});
	const defaults = {
		position: "static",
		display: "block",
		overflowX: "visible",
		overflowY: "visible",
		transform: "none",
		filter: "none",
		backdropFilter: "none",
		perspective: "none",
		willChange: "auto",
		contain: "none",
		textOverflow: "clip",
		font: "18px monospace",
		lineHeight: "18px",
	};
	const ancestor = {
		nodeType: 1,
		tagName: "DIV",
		parentElement: null,
		style: {
			...defaults,
			overflowX: "hidden",
			overflowY: "hidden",
			transform: options.transform ?? "none",
		},
		getBoundingClientRect: () => rect(options.ancestorWidth ?? 200),
		getAttribute: () => null,
	};
	const owner = {
		nodeType: 1,
		parentElement: options.ancestorWidth === undefined ? null : ancestor,
		childNodes: [{ nodeType: 3, textContent: "supplied text" }],
		style: {
			...defaults,
			position: options.position ?? "static",
			display: options.display ?? "block",
			overflowX: options.overflow ?? "visible",
			overflowY: options.overflow ?? "visible",
			textOverflow: options.textOverflow ?? "clip",
		},
		getBoundingClientRect: () => rect(22),
		getClientRects: () => [rect(22)],
		closest: () => null,
	};
	const all = [owner, ancestor];
	const nodes = [
		{
			index: 0,
			ownText: "supplied text",
			ancestors: options.ancestorWidth === undefined ? [] : [1],
			rect: { x: 0, y: 0, w: 22, h: 18 },
			visibleRect: { x: 0, y: 0, w: 22, h: 18 },
		},
	];
	const start = EXTRACT_PROBE.indexOf("  const establishesContainingBlock"),
		end = EXTRACT_PROBE.indexOf("  const insideHorizontalScroller");
	if (start < 0 || end <= start)
		throw new Error("Canonical clipping seam missing");
	return runInNewContext(
		`(()=>{${EXTRACT_PROBE.slice(start, end)};return (${U08_GEOMETRY_SOURCE})([0],all,nodes,clipIntersection);})()`,
		{
			all,
			nodes,
			getComputedStyle: (el: { style: unknown }) => el.style,
			document: {
				createRange: () => ({
					selectNodeContents: () => {},
					getClientRects: () => [rect(100)],
				}),
			},
		},
		{ timeout: 100 },
	) as [
		{
			textFragments: { clipped: { w: number } | null }[];
			selfClipping: {
				overflowX: string;
				textOverflow: string;
				appliesX: boolean;
			};
		},
	];
}

describe("remote U08 geometry diagnostic contract — no browser", () => {
	it("retains the original probe byte-for-byte and original policy except a post-FAIL observer", () => {
		expect(verifyOriginalInstrument().probeSHA256).toBe(sha(EXTRACT_PROBE));
		expect(sha(EXTRACT_PROBE)).toBe(
			"2ef600e4b42640db7b921a3fba9f17b1f380701f92e7546beab07cf424e67c13",
		);
		const source = readFileSync(resolve(root, "tools/audit/checks.ts"), "utf8"),
			at = source.indexOf("function u08Overlap("),
			end = source.indexOf("\nfunction ", at + 1);
		expect(sha(source.slice(at, end).replace(OBSERVER, ""))).toBe(
			"785138818c460fcdeeb2e3fcc4f2ff682b85c0572ab02ebf3fcf9e4f2547000d",
		);
		expect(u08GeometryProbe([1, 2])).toContain("clipIntersection");
		expect(() => new Script(u08GeometryProbe([1, 2]))).not.toThrow();
	});
	it("requires the exact original failure, not any red row or an empty diagnosis", () => {
		expect(originalFailure(state()).pair).toEqual([1, 2]);
		expect(() => originalFailure(state(21))).toThrow("NOT REPRODUCED");
		expect(() => originalFailure({ ...state(), nodes: [] })).toThrow(
			"NOT REPRODUCED",
		);
	});
	it("rejects same-size wrong family, wrong control, scene drift and ambiguous matches", () => {
		const otherFixtureTurn = state();
		const observedControl = otherFixtureTurn.nodes[0];
		if (!observedControl) throw new Error("Missing fixture control");
		observedControl.testId = "turn-bar-tc-conv-03-user";
		expect(originalFailure(otherFixtureTurn).pair).toEqual([1, 2]);
		const wrong = state();
		for (const n of wrong.nodes.filter((n) => n.tag === "span"))
			n.path = "unrelated-toolbar>span";
		expect(() => originalFailure(wrong)).toThrow("NOT REPRODUCED");
		const control = state();
		const firstControl = control.nodes[0];
		if (!firstControl) throw new Error("Missing fixture control");
		firstControl.testId = "turn-bar-tc-conv-99-user";
		expect(() => originalFailure(control)).toThrow("pressable scope");
		expect(() => originalFailure({ ...state(), state: "expanded" })).toThrow(
			"scene mismatch",
		);
		expect(() =>
			originalFailure({
				...state(),
				viewport: { width: 391, height: 844, dpr: 3 },
			}),
		).toThrow("scene mismatch");
		const ambiguous = state();
		const firstSpan = ambiguous.nodes[1];
		if (!firstSpan) throw new Error("Missing fixture span");
		ambiguous.nodes.push({ ...firstSpan, index: 3 });
		expect(() => originalFailure(ambiguous)).toThrow("ambiguous");
	});

	it("computes diagnostic fragment intersections without changing the original verdict", () => {
		expect(
			fragmentIntersections(
				[{ x: 0, y: 0, w: 22, h: 18 }],
				[{ x: 100, y: 0, w: 22, h: 18 }],
			),
		).toEqual([]);
		expect(
			fragmentIntersections(
				[{ x: 0, y: 0, w: 22, h: 18 }],
				[{ x: 0, y: 0, w: 22, h: 18 }],
			),
		).toEqual([{ x: 0, y: 0, w: 22, h: 18 }]);
		expect(originalFailure(state()).row?.verdict).toBe("FAIL");
	});
	it.each([
		[{ overflow: "visible" }, 100],
		[{ overflow: "hidden" }, 22],
		[{ overflow: "clip" }, 22],
		[{ overflow: "hidden", textOverflow: "ellipsis" }, 22],
		[{ overflow: "hidden", display: "inline" }, 100],
		[{ overflow: "hidden", ancestorWidth: 10 }, 10],
		[{ position: "fixed", ancestorWidth: 10 }, 100],
		[{ position: "fixed", overflow: "hidden", ancestorWidth: 10 }, 22],
		[{ position: "fixed", ancestorWidth: 10, transform: "translateZ(0)" }, 10],
	] as const)(
		"clips actual collector text by applicable owner before canonical ancestors: %j",
		(options, expected) => {
			const result = collectGeometry(options)[0];
			expect(result.textFragments[0]?.clipped?.w).toBe(expected);
			expect(result.selfClipping.overflowX).toBe(
				"overflow" in options ? options.overflow : "visible",
			);
		},
	);

	it("pins one canonical scene and refuses a local browser launch", () => {
		expect(RECORD).toMatchObject({
			viewport: { width: 390, height: 844, dpr: 3 },
			insets: { top: 59, bottom: 34, left: 0, right: 0 },
			scale: "150",
			theme: "dark",
			state: "condensed",
			pinnedScenario: "long-transcript",
			openers: [],
		});
		expect(() => assertRemote({})).toThrow("Remote GitHub Linux");
		expect(() =>
			assertRemote({ GITHUB_ACTIONS: "true", RUNNER_OS: "Linux" }),
		).not.toThrow();
	});
	it("refuses every non-dispatch event and non-full stage in the actual Bash validator", () => {
		const source = readFileSync(
			resolve(root, ".github/workflows/e2e.yml"),
			"utf8",
		);
		const script = source
			.split("- name: Validate proof selection")[1]
			?.split("        run: |\n")[1]
			?.split("      - name: Detect the harness")[0];
		if (!script) throw new Error("Missing canonical validator");
		for (const event of [
			"push",
			"pull_request",
			"schedule",
			"workflow_dispatch",
		]) {
			for (const stage of ["full", "setup", "preflight"]) {
				const result = spawnSync("bash", ["-c", script], {
					env: {
						PATH: process.env.PATH,
						GITHUB_EVENT_NAME: event,
						PROOF_MODE: "u08-geometry-proof",
						PROOF_STAGE: stage,
					},
					timeout: 1000,
				});
				expect(result.status === 0, `${event}/${stage}`).toBe(
					event === "workflow_dispatch" && stage === "full",
				);
			}
		}
	});

	it("schedules only bootstrap plus the one bounded proof and preserves explicit validation arms", () => {
		const source = readFileSync(
			resolve(root, ".github/workflows/e2e.yml"),
			"utf8",
		);
		const blocks = source.slice(source.indexOf("\njobs:\n")).split(JOBS);
		const selected = [];
		for (let i = 1; i < blocks.length; i += 2) {
			const name = blocks[i],
				body = blocks[i + 1];
			if (!name || !body) continue;
			const guard = JOB_GUARD.exec(body)?.[1] ?? "true";
			if (
				runInNewContext(
					guard,
					{
						github: { event_name: "workflow_dispatch" },
						inputs: { proof_mode: "u08-geometry-proof" },
					},
					{ timeout: 100 },
				)
			)
				selected.push(name);
		}
		expect(selected).toEqual(["harness", "u08-geometry-proof"]);
		expect(source).toContain("            s15-proof)");
		expect(source).toContain("            core-audit-only)");
		expect(source).toContain("            u08-geometry-proof)");
		const job = source.split("  u08-geometry-proof:\n")[1] ?? "";
		expect(job).toContain("timeout-minutes: 30");
		expect(job).toContain("timeout-minutes: 5");
		expect(job).not.toContain("--tier core");
		expect(job).not.toContain("maestro");
	});
});
