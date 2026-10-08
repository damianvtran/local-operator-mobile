import { describe, expect, it } from "vitest";

import {
	type AuditNode,
	type AuditState,
	runChecks,
	U40_DEFERRAL,
	U42_EXEMPTIONS,
} from "./checks.ts";
import { floorsFromTokens } from "./color.ts";

/**
 * The S5 redesign's five checks (U-38…U-42), asserted at the seam a canary
 * cannot reach: the string and geometry cases the fixtures only get near.
 *
 * Two reasons this file exists beside the canary rather than instead of it:
 *
 *  - the canary proves the checks FAIL on a page; these prove WHY, branch by
 *    branch (the cell that still carries `---`, the cue that exists but the
 *    rail it fails to reach), including branches no fixture stands on;
 *  - a check's arithmetic (tolerances, caps, the exemption list) is cheaper to
 *    pin here than to observe through a browser, and a wrong number in a
 *    fixture reads as a fixture problem rather than as the check's.
 */

const floors = floorsFromTokens(null);

/** A node with every required field, so a case states only what it tests. */
const node = (over: Partial<AuditNode> = {}): AuditNode =>
	({
		index: 0,
		tag: "div",
		path: "div",
		ancestors: [],
		rect: null,
		visibleRect: null,
		paintedRect: null,
		ownText: "",
		text: "",
		style: {},
		colour: "",
		background: "",
		ownBackground: "",
		position: "static",
		display: "block",
		overflowX: "visible",
		overflowY: "visible",
		textOverflow: "clip",
		whiteSpace: "normal",
		scrollWidth: 0,
		scrollHeight: 0,
		clientWidth: 0,
		clientHeight: 0,
		borderWidth: 0,
		padding: { top: 0, bottom: 0, left: 0, right: 0 },
		margin: { top: 0, bottom: 0, left: 0, right: 0 },
		rowGap: 0,
		columnGap: 0,
		scrollLeft: 0,
		testId: null,
		clippedAway: false,
		escapedClip: false,
		ariaHidden: false,
		inModalDialog: false,
		ownInk: false,
		interactive: false,
		disabled: false,
		isControl: false,
		childImages: 0,
		containerText: "",
		controlText: "",
		hasGlyph: false,
		semanticColour: "",
		semanticBackground: "",
		semanticBorder: "",
		...over,
	}) as AuditNode;

/** A state with everything the checks read, empty by default. */
const state = (over: Partial<AuditState> = {}): AuditState =>
	({
		nodes: [],
		platform: "web",
		scale: "100",
		url: "http://localhost/",
		viewport: { width: 320, height: 568, dpr: 2 },
		document: {
			scrollWidth: 320,
			clientWidth: 320,
			scrollHeight: 1000,
			clientHeight: 568,
			bodyScrollWidth: 320,
		},
		insets: { top: 0, bottom: 0, left: 0, right: 0 },
		textScale: "100",
		theme: "dark",
		canvas: { root: "rgb(34, 32, 28)", body: "rgb(34, 32, 28)" },
		nodeCount: 0,
		tables: [],
		summaries: [],
		ax: [],
		...over,
	}) as AuditState;

const run = (id: string, s: AuditState) =>
	runChecks(s, {
		floors,
		semantic: new Set<string>(),
		checks: [id],
		scaleIsLive: true,
	});

describe("U-38 — a markdown table renders as a table", () => {
	const goodTable = {
		index: 0,
		headRows: 1,
		bodyRows: 2,
		cells: [
			{ index: 1, text: "key", broken: [] },
			{ index: 2, text: "value", broken: [] },
		],
		scroll: null,
	};

	it("passes a table with a header and body rows and clean cells", () => {
		const rows = run("U-38", state({ tables: [goodTable] }));
		expect(rows.map((r) => r.verdict)).toEqual(["PASS"]);
	});

	it("does not flag a pipe-run line — §1.2 renders a malformed run verbatim on purpose", () => {
		// The narrowed leak half reads the ESCAPE only. A malformed run (and a
		// mid-stream frame, which is one until its divider lands) draws its own
		// pipe source deliberately: ugly and honest, per §1.2. The structure half
		// is what catches a table that never became one; here there is no table
		// and no escape, so the verdict is not-applicable rather than a failure.
		const rows = run(
			"U-38",
			state({
				nodes: [
					node({ path: "p#table-leak", ownText: "| a | b |\n| --- | --- |" }),
				],
			}),
		);
		expect(rows.map((r) => r.verdict)).toEqual(["BLOCKED"]);
	});

	it("fails an escape that reached the rendered text", () => {
		const rows = run("U-38", state({ nodes: [node({ ownText: "a \\| b" })] }));
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toMatch(/^leaked source/);
	});

	it("accepts a legal header-only table (§1.7 — the divider is structure, not content)", () => {
		const rows = run(
			"U-38",
			state({ tables: [{ ...goodTable, bodyRows: 0 }] }),
		);
		expect(rows.map((r) => r.verdict)).toEqual(["EXCEPTION", "PASS"]);
		expect(rows[0]?.measured).toContain("header-only table is legal");
	});

	it("fails a table with no header row", () => {
		const rows = run(
			"U-38",
			state({ tables: [{ ...goodTable, headRows: 0 }] }),
		);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toMatch(/^table structure/);
	});

	it("reads the full-text escape flag even when the 200-character slice is clean", () => {
		const rows = run(
			"U-38",
			state({
				nodes: [
					node({
						ownText: "x".repeat(200),
						escapeInText: true,
					}),
				],
			}),
		);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toMatch(/^leaked source/);
	});

	it("fails the marker↔render cross-check: session-tables with no md-table", () => {
		const rows = run(
			"U-38",
			state({
				// The marker is read from the PRESENCE reading, not from a node:
				// the app's derived markers are zero-size Views and the probe's
				// node sweep drops zero-area elements (review round 2, R2-2).
				reading: {
					path: "/session/1",
					testIds: ["session-tables"],
					visibleTestIds: [],
				},
			}),
		);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toMatch(/^declared table did not render/);
	});

	it("does not fire the cross-check from a zero-area node (the shape the probe never sees)", () => {
		const rows = run(
			"U-38",
			state({ nodes: [node({ testId: "session-tables" })] }),
		);
		// No reading, no tables: not-applicable for the structure half — the
		// node-only evidence cannot affirm the marker, which is why the check
		// stopped reading nodes at all.
		expect(rows[0]?.verdict).toBe("BLOCKED");
	});

	it("passes the cross-check when the marker and the rendered table agree", () => {
		const rows = run(
			"U-38",
			state({
				reading: {
					path: "/session/1",
					testIds: ["session-tables"],
					visibleTestIds: [],
				},
				tables: [goodTable],
			}),
		);
		expect(rows[0]?.verdict).toBe("PASS");
	});

	it("fails a cell whose full text still carries the escape past the slice", () => {
		const rows = run(
			"U-38",
			state({
				tables: [
					{
						...goodTable,
						cells: [
							{ index: 1, text: "clean", escapeInText: true, broken: [] },
						],
					},
				],
			}),
		);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toMatch(/^table structure/);
	});

	it("fails a cell that still carries the divider", () => {
		const rows = run(
			"U-38",
			state({
				tables: [
					{
						...goodTable,
						cells: [{ index: 7, text: "---", broken: [] }],
					},
				],
			}),
		);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toMatch(/^table structure/);
	});

	it("is not-applicable, not a pass, when the frame carries no table", () => {
		const rows = run("U-38", state());
		expect(rows[0]?.verdict).toBe("BLOCKED");
		expect(rows[0]?.blockedKind).toBe("not-applicable");
	});
});

describe("U-39 — no token under the cap is broken", () => {
	const cell = (length: number) => ({
		index: 3,
		text: "x".repeat(length),
		broken: [{ token: "x".repeat(Math.min(length, 32)), length }],
	});

	it("fails a 64-character token that wrapped", () => {
		const rows = run(
			"U-39",
			state({
				tables: [
					{
						index: 0,
						headRows: 1,
						bodyRows: 1,
						cells: [cell(64)],
						scroll: null,
					},
				],
			}),
		);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toContain("64 characters");
	});

	it("allows a token longer than the cap to wrap, by design", () => {
		const rows = run(
			"U-39",
			state({
				tables: [
					{
						index: 0,
						headRows: 1,
						bodyRows: 1,
						cells: [cell(96)],
						scroll: null,
					},
				],
			}),
		);
		expect(rows[0]?.verdict).toBe("PASS");
	});

	it("is not-applicable when there are no cells", () => {
		const rows = run("U-39", state());
		expect(rows[0]?.verdict).toBe("BLOCKED");
		expect(rows[0]?.blockedKind).toBe("not-applicable");
	});
});

describe("U-40 — the scroll cue, both directions", () => {
	const table = (scroll: {
		overflow: boolean;
		bleeds: boolean;
		cues: number;
	}) => ({
		index: 0,
		headRows: 1,
		bodyRows: 1,
		cells: [],
		scroll: {
			index: 5,
			scrollWidth: 480,
			clientWidth: 288,
			scrollLeft: 0,
			...scroll,
		},
	});

	it("fails an overflowing table scroller with no cue", () => {
		const rows = run(
			"U-40",
			state({ tables: [table({ overflow: true, bleeds: true, cues: 0 })] }),
		);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toMatch(
			/^overflowing table scroller without a cue/,
		);
	});

	it("fails an overflowing viewport that stops at the rail", () => {
		const rows = run(
			"U-40",
			state({ tables: [table({ overflow: true, bleeds: false, cues: 1 })] }),
		);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toMatch(
			/^overflowing table viewport does not bleed/,
		);
	});

	it("fails a cue on a table that does not overflow", () => {
		const rows = run(
			"U-40",
			state({ tables: [table({ overflow: false, bleeds: false, cues: 1 })] }),
		);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toMatch(/^cue on/);
	});

	it("passes an overflowing table that is cued and bleeding", () => {
		const rows = run(
			"U-40",
			state({ tables: [table({ overflow: true, bleeds: true, cues: 1 })] }),
		);
		expect(rows.map((r) => r.verdict)).toEqual(["PASS"]);
	});

	it("keeps a deferral row visible on a frame that also has failures", () => {
		const rows = run(
			"U-40",
			state({
				tables: [table({ overflow: true, bleeds: true, cues: 0 })],
				nodes: [
					node({
						index: 9,
						overflowX: "auto",
						scrollWidth: 480,
						clientWidth: 288,
					}),
				],
			}),
		);
		expect(rows.some((r) => r.verdict === "FAIL")).toBe(true);
		expect(rows.some((r) => r.verdict === "EXCEPTION")).toBe(true);
	});

	it("records a lone deferral as an exception beside the pass", () => {
		const rows = run(
			"U-40",
			state({
				nodes: [
					node({
						index: 9,
						overflowX: "auto",
						scrollWidth: 480,
						clientWidth: 288,
					}),
				],
			}),
		);
		expect(rows.map((r) => r.verdict)).toEqual(["PASS", "EXCEPTION"]);
		const exception = rows.find((r) => r.verdict === "EXCEPTION");
		expect(exception?.measured).toContain(U40_DEFERRAL.SCOPE);
	});

	it("is not-applicable when the frame has no scroller", () => {
		const rows = run("U-40", state());
		expect(rows[0]?.verdict).toBe("BLOCKED");
		expect(rows[0]?.blockedKind).toBe("not-applicable");
	});
});

describe("U-41 — one rail, caret on the first line", () => {
	const summary = (over: Partial<AuditState["summaries"][number]> = {}) => ({
		index: 0,
		rowLeft: 0,
		lines: [
			{ left: 17, top: 100, bottom: 117 },
			{ left: 17, top: 121, bottom: 138 },
		],
		caret: { left: 300, top: 100, bottom: 117 },
		...over,
	});

	it("passes a row whose lines share the rail and whose caret rides line one", () => {
		const rows = run("U-41", state({ summaries: [summary()] }));
		expect(rows.map((r) => r.verdict)).toEqual(["PASS"]);
	});

	it("fails a line that drifted off the rail", () => {
		const rows = run(
			"U-41",
			state({
				summaries: [
					summary({
						lines: [
							{ left: 17, top: 100, bottom: 117 },
							{ left: 29, top: 121, bottom: 138 },
						],
					}),
				],
			}),
		);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toMatch(/^rail drift/);
	});

	it("fails a caret centred between the lines", () => {
		const rows = run(
			"U-41",
			state({
				summaries: [summary({ caret: { left: 300, top: 115, bottom: 132 } })],
			}),
		);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toMatch(/^caret midline/);
	});

	it("is not-applicable when the frame carries no disclosure row", () => {
		const rows = run("U-41", state());
		expect(rows[0]?.verdict).toBe("BLOCKED");
		expect(rows[0]?.blockedKind).toBe("not-applicable");
	});
});

describe("U-42 — spacing on the token scale", () => {
	const withPadding = (value: number) =>
		state({
			nodes: [
				node({
					path: "div#somewhere",
					padding: { top: value, bottom: 0, left: 0, right: 0 },
				}),
			],
		});

	it("passes a value on the scale", () => {
		const rows = run("U-42", withPadding(12));
		expect(rows.map((r) => r.verdict)).toEqual(["PASS"]);
	});

	it("fails a value off the scale, naming the property and the selector", () => {
		const rows = run("U-42", withPadding(6));
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toBe(
			"off-scale padding-top 6pt — not a step of space.scale",
		);
		expect(rows[0]?.detail).toBe("div#somewhere");
	});

	it("reports a RECORDED site as an exception instead of a failure", () => {
		// The list is module state; the test restores it whatever the assertion does.
		const entry = { path: "div#somewhere", value: 6, reason: "test site" };
		U42_EXEMPTIONS.push(entry);
		try {
			const rows = run("U-42", withPadding(6));
			expect(rows.map((r) => r.verdict)).toEqual(["PASS", "EXCEPTION"]);
			expect(rows[1]?.measured).toContain("test site");
		} finally {
			U42_EXEMPTIONS.pop();
		}
	});

	it("still fails the same value when the path is not the recorded one", () => {
		const entry = { path: "div#elsewhere", value: 6, reason: "test site" };
		U42_EXEMPTIONS.push(entry);
		try {
			const rows = run("U-42", withPadding(6));
			expect(rows[0]?.verdict).toBe("FAIL");
		} finally {
			U42_EXEMPTIONS.pop();
		}
	});

	it("reports an inset PLUS a step on the SHEET SURFACE as an exception, and nowhere else", () => {
		/* 24 + 20 = 44pt: the sheet pads its action region by one step of the scale on
		 *  top of the device's declared inset. Thirty rows in CI's run 37705167165 were
		 *  exactly this, all on the sheet's scroll body (round 5, D2's attribution). */
		const sheetPath =
			"div.css-g5y9jx.r-13awgt0>div.css-g5y9jx.rounded-t-lg>div.css-g5y9jx.px-4";
		const onSheet = state({
			insets: { top: 0, right: 0, bottom: 20, left: 0 },
			nodes: [
				node({
					path: sheetPath,
					padding: { top: 0, bottom: 44, left: 0, right: 0 },
				}),
			],
		});
		const rows = run("U-42", onSheet);
		const verdicts = rows.map((r) => r.verdict);
		expect(verdicts).toContain("EXCEPTION");
		expect(verdicts).not.toContain("FAIL");
		expect(rows.find((r) => r.verdict === "EXCEPTION")?.measured).toContain(
			"plus the declared bottom inset",
		);

		/* AND THE SAME VALUE OFF THE SHEET IS STILL A FAILURE. This is the reviewer's
		 *  counter-example kept as a test: an unscoped allowance passed `pt-7`/`pt-9`/
		 *  `pt-11` (28/36/44pt) on any node on both per-push devices (R24). */
		for (const value of [28, 36, 44]) {
			const offSheet = state({
				insets: { top: 0, right: 0, bottom: 20, left: 0 },
				nodes: [
					node({
						path: "div.css-g5y9jx.flex-1>div#somewhere",
						padding: { top: 0, bottom: value, left: 0, right: 0 },
					}),
				],
			});
			expect(run("U-42", offSheet)[0]?.verdict).toBe("FAIL");
		}
	});

	it("bounds the sheet allowance to the clearance region, not to anything below the surface", () => {
		/* R30: `path.includes("rounded-t-lg")` passed any descendant in the six levels a
		 *  path keeps, so a sheet descendant padded to 20+8 on iphone-se read as an
		 *  inset-plus-step it is not. The clearance lives at depth 1, or 2 through the
		 *  scroll view between the surface and the padded body. */
		const deep = state({
			insets: { top: 0, right: 0, bottom: 20, left: 0 },
			nodes: [
				node({
					path: "div.css-g5y9jx.rounded-t-lg>div.css-g5y9jx.gap-2>div.css-g5y9jx.p-1>div.css-g5y9jx.px-4",
					padding: { top: 0, bottom: 44, left: 0, right: 0 },
				}),
			],
		});
		expect(run("U-42", deep)[0]?.verdict).toBe("FAIL");

		const scroll = state({
			insets: { top: 0, right: 0, bottom: 20, left: 0 },
			nodes: [
				node({
					path: "div.css-g5y9jx.rounded-t-lg>div.css-g5y9jx.r-150rngu>div.css-g5y9jx.px-4",
					padding: { top: 0, bottom: 44, left: 0, right: 0 },
				}),
			],
		});
		const verdicts = run("U-42", scroll).map((r) => r.verdict);
		expect(verdicts).toContain("EXCEPTION");
		expect(verdicts).not.toContain("FAIL");
	});

	it("reports the sheet allowance even when the ledger fills the cap", () => {
		/* R30's second half: the EXCEPTION row was pushed into the same list that
		 *  `.slice(0, 8)` cuts, and CI's artifact shows 464 of 696 cells at that cap with
		 *  the carve-out row present ZERO times — an allowance nobody could see. */
		const path = "div.css-g5y9jx.rounded-t-lg>div.css-g5y9jx.px-4";
		const pushed = [];
		for (let i = 0; i < 12; i += 1) {
			const entry = {
				path: `div#filler-${i}`,
				value: 6,
				properties: ["row-gap", "column-gap"],
				reason: `filler ${i}`,
			};
			U42_EXEMPTIONS.push(entry);
			pushed.push(entry);
		}
		try {
			const rows = run(
				"U-42",
				state({
					insets: { top: 0, right: 0, bottom: 20, left: 0 },
					nodes: [
						node({
							path,
							padding: { top: 0, bottom: 44, left: 0, right: 0 },
						}),
					],
				}),
			);
			const sheetRows = rows.filter((r) =>
				(r.measured ?? "").includes("the sheet's own clearance"),
			);
			expect(sheetRows).toHaveLength(1);
		} finally {
			for (const entry of pushed) U42_EXEMPTIONS.pop();
		}
	});

	it("needs BOTH the inset and the surface: a sheet padding on an inset-free device still fails", () => {
		const sheetPath = "div.css-g5y9jx.rounded-t-lg>div.css-g5y9jx.px-4";
		const noInset = state({
			nodes: [
				node({
					path: sheetPath,
					padding: { top: 0, bottom: 44, left: 0, right: 0 },
				}),
			],
		});
		expect(run("U-42", noInset)[0]?.verdict).toBe("FAIL");
		/* 47 is inset + 27, a sum no step can produce, so the bound is asserted too. */
		const offSum = state({
			insets: { top: 0, right: 0, bottom: 20, left: 0 },
			nodes: [
				node({
					path: sheetPath,
					padding: { top: 0, bottom: 47, left: 0, right: 0 },
				}),
			],
		});
		expect(run("U-42", offSum)[0]?.verdict).toBe("FAIL");
	});

	it("a recorded site is exempt for the PROPERTIES its reason names, not for the path alone", () => {
		/* R28 / QA Q1: matching on path substring plus value alone also exempted
		 *  `padding-left 2pt` — and any descendant at that value — on the badge path. */
		const entry = {
			path: ">div.css-g5y9jx.self-start",
			value: 2,
			properties: ["padding-top", "padding-bottom"],
			reason: "test site",
		};
		U42_EXEMPTIONS.push(entry);
		try {
			const badgePath =
				"div.css-g5y9jx.flex-row>div.css-g5y9jx.r-1loqt21>div.css-g5y9jx.self-start";
			const vertical = state({
				nodes: [
					node({
						path: badgePath,
						padding: { top: 2, bottom: 2, left: 0, right: 0 },
					}),
				],
			});
			// the two properties the record names come back as exceptions
			const named = run("U-42", vertical).map((r) => r.verdict);
			expect(named.filter((v) => v === "EXCEPTION")).toHaveLength(2);
			expect(named).not.toContain("FAIL");

			const horizontal = state({
				nodes: [
					node({
						path: badgePath,
						padding: { top: 0, bottom: 0, left: 2, right: 2 },
					}),
				],
			});
			// and the same value on an axis the record does not cover still fails
			const other = run("U-42", horizontal).map((r) => r.verdict);
			expect(other.filter((v) => v === "FAIL")).toHaveLength(2);
			expect(other).not.toContain("EXCEPTION");
		} finally {
			U42_EXEMPTIONS.pop();
		}
	});

	it("accepts a negated step, because the bleed is `-gutters.phone`", () => {
		const negative = state({
			nodes: [
				node({
					path: "div#table",
					margin: { top: 0, bottom: 0, left: 0, right: -16 },
				}),
			],
		});
		const rows = run("U-42", negative);
		expect(rows.map((r) => r.verdict)).toEqual(["PASS"]);
	});

	it("does not score an `auto` margin — its pixels are layout, not a step", () => {
		// `ml-auto` resolved to 147.2pt on one viewport and 243.2pt on another; no
		// exemption list can name those, and the keyword is the only honest reading.
		const autoMargin = state({
			nodes: [
				node({
					path: "div#row-tail",
					margin: { top: 0, bottom: 0, left: 147.2, right: 0 },
					marginAuto: { top: false, bottom: false, left: true, right: false },
				}),
			],
		});
		expect(run("U-42", autoMargin).map((r) => r.verdict)).toEqual(["PASS"]);
	});

	it("records a scale-dependent value by path when anyValue is set", () => {
		// The refusal glyph's alignment offset (refusal-surface.tsx): 1.475 at
		// 100 %, 12.95 at 200 %. Its value moves with the reader's text size, so
		// the record is the node, not a number.
		const entry = {
			path: "svg.lucide.lucide-triangle-alert",
			anyValue: true,
			reason: "scale-derived alignment offset",
		};
		U42_EXEMPTIONS.push(entry as never);
		try {
			const svg = state({
				nodes: [
					node({
						path: "div.gap-3>div.flex-row>svg.lucide.lucide-triangle-alert",
						margin: { top: 1.475, bottom: 0, left: 0, right: 0 },
					}),
				],
			});
			const rows = run("U-42", svg);
			expect(rows.map((r) => r.verdict)).toEqual(["PASS", "EXCEPTION"]);
		} finally {
			U42_EXEMPTIONS.pop();
		}
	});

	it("still fails the same resolved pixels when the margin is NOT auto", () => {
		const realMargin = state({
			nodes: [
				node({
					path: "div#row-tail",
					margin: { top: 0, bottom: 0, left: 147.2, right: 0 },
					marginAuto: { top: false, bottom: false, left: false, right: false },
				}),
			],
		});
		const rows = run("U-42", realMargin);
		expect(rows[0]?.verdict).toBe("FAIL");
		expect(rows[0]?.measured).toContain("margin-left");
	});

	it("accepts a padding that IS the frame's declared inset, per side", () => {
		// iphone-15's top inset is 59pt and the screen root resolves it as a
		// padding — the inset is not spacing drift. The allowance is per SIDE: the
		// same value on a side whose inset is zero still fails.
		const insetTop = state({
			insets: { top: 59, bottom: 0, left: 0, right: 0 },
			nodes: [
				node({
					path: "div#root",
					padding: { top: 59, bottom: 0, left: 0, right: 0 },
				}),
			],
		});
		expect(run("U-42", insetTop).map((r) => r.verdict)).toEqual(["PASS"]);
		const insetBottom = state({
			insets: { top: 59, bottom: 0, left: 0, right: 0 },
			nodes: [
				node({
					path: "div#root",
					padding: { top: 0, bottom: 59, left: 0, right: 0 },
				}),
			],
		});
		const rows = run("U-42", insetBottom);
		expect(rows[0]?.verdict).toBe("FAIL");
	});

	it("reads the scale from the tokens, not from a second copy", () => {
		const fromTokens = floorsFromTokens({
			space: { base: 4, scale: [0, 1, 2, 3, 4, 6, 8, 12] },
		});
		expect(fromTokens.spacing).toEqual([4, 8, 12, 16, 24, 32, 48]);
		const rows = runChecks(withPadding(6), {
			floors: fromTokens,
			semantic: new Set<string>(),
			checks: ["U-42"],
			scaleIsLive: true,
		});
		expect(rows[0]?.verdict).toBe("FAIL"); // 6 is not a step of THIS scale either
	});
});

describe("U-06 — an overrunning run inside a single-line ellipsis clip", () => {
	/** The find sheet's measured shape: a matched inline run keeps its full
	 *  layout box (330 on a 320 viewport) while its ancestor's `text-overflow:
	 *  ellipsis` + `white-space: nowrap` draws everything inside the box. */
	const runNode = () =>
		node({
			index: 9,
			path: "div.truncator>div.text>span.text-ink",
			ancestors: [7],
			rect: { x: 0, y: 0, w: 330, h: 17, right: 330, bottom: 17 },
			visibleRect: { x: 0, y: 0, w: 320, h: 17, right: 320, bottom: 17 },
			ownText: "retry",
		});
	const truncator = (over: Partial<AuditNode> = {}) =>
		node({
			index: 7,
			path: "div.truncator",
			rect: { x: 0, y: 0, w: 320, h: 17, right: 320, bottom: 17 },
			visibleRect: { x: 0, y: 0, w: 320, h: 17, right: 320, bottom: 17 },
			...over,
		});

	it("records the pair as an EXCEPTION naming the clipping ancestor, never a FAIL", () => {
		const rows = run(
			"U-06",
			state({
				nodes: [
					truncator({ textOverflow: "ellipsis", whiteSpace: "nowrap" }),
					runNode(),
				],
			}),
		);
		expect(rows.map((r) => r.verdict)).toEqual(["EXCEPTION"]);
		expect(rows[0]?.detail).toContain("div.truncator");
		expect(rows[0]?.detail).toContain("single-line ellipsis");
	});

	it("still fails the same overrun when no ancestor carries the idiom", () => {
		const rows = run("U-06", state({ nodes: [truncator(), runNode()] }));
		expect(rows.map((r) => r.verdict)).toEqual(["FAIL"]);
	});

	it("does not accept a multi-line clamp's `ellipsis` (white-space stays normal)", () => {
		const rows = run(
			"U-06",
			state({
				nodes: [
					truncator({ textOverflow: "ellipsis", whiteSpace: "normal" }),
					runNode(),
				],
			}),
		);
		expect(rows.map((r) => r.verdict)).toEqual(["FAIL"]);
	});

	it("keeps both allowance branches as named EXCEPTIONs", () => {
		const code = node({
			index: 2,
			path: "span.code",
			rect: { x: 0, y: 40, w: 400, h: 17, right: 400, bottom: 57 },
			visibleRect: { x: 0, y: 40, w: 400, h: 17, right: 400, bottom: 57 },
			scrollsX: true,
		});
		const rows = run(
			"U-06",
			state({
				nodes: [
					truncator({ textOverflow: "ellipsis", whiteSpace: "nowrap" }),
					runNode(),
					code,
				],
			}),
		);
		expect(rows.map((r) => r.verdict)).toEqual(["EXCEPTION", "EXCEPTION"]);
		expect(rows[0]?.detail).toContain("single-line ellipsis");
		expect(rows[1]?.detail).toContain("overflow-x: auto|scroll");
	});
});
