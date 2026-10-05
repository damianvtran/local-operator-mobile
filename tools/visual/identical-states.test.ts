import { describe, expect, it } from "vitest";
import {
	type FrameRecord,
	findIdenticalFrames,
	matchDeclared,
} from "./identical-states.ts";

/**
 * The five outcomes of the identical-frame check, each asserted on its own.
 *
 * Why this exists at all: `identicalStateUndeclared` joined the blocking total in the
 * same change that introduced it, and a blocking term nobody can make fire on purpose
 * is the one path in a harness like this that rots quietly. These are the pure inputs
 * the capture hands it — `screen/state`, the settled frame's sha, and the content
 * digest read without the viewport — so the rule can be broken here deliberately.
 */
const cell = (
	screen: string,
	state: string,
	sha: string,
	contentDigest: string,
	overrides: Partial<FrameRecord> = {},
): FrameRecord => ({
	screen,
	state,
	cell: `${screen}/${state}`,
	device: "iphone-se",
	declaredSkip: null,
	contentDigest,
	frames: [{ sha }],
	...overrides,
});

describe("findIdenticalFrames", () => {
	it("says nothing about two frames of the SAME state", () => {
		const result = findIdenticalFrames([
			cell("S5", "populated", "aaaa", "one"),
			cell("S5", "populated", "aaaa", "one", { device: "tablet-landscape" }),
		]);
		expect(result).toEqual({
			collapses: [],
			undeclared: [],
			exemptions: [],
			coincidences: [],
		});
	});

	it("says nothing when the frames differ", () => {
		const result = findIdenticalFrames([
			cell("S5", "populated", "aaaa", "one"),
			cell("S5", "empty", "bbbb", "two"),
		]);
		expect(result).toEqual({
			collapses: [],
			undeclared: [],
			exemptions: [],
			coincidences: [],
		});
	});

	it("reports a COLLAPSE when the bytes and the content agree", () => {
		const result = findIdenticalFrames([
			cell("S13", "error", "aaaa", "identical"),
			cell("S2", "error", "aaaa", "identical"),
		]);
		expect(result.collapses).toHaveLength(1);
		expect(result.collapses[0]).toContain("S13/error = S2/error");
		expect(result.collapses[0]).toContain("carry the same content");
		expect(result.undeclared).toEqual([]);
		expect(result.exemptions).toEqual([]);
		expect(result.coincidences).toEqual([]);
	});

	it("passes a DECLARED one-view pair — the composed case, not a collapse", () => {
		// The pair the coincidence table was opened for: at tablet-landscape
		// `/conversations` renders the home with the panel docked, so S15/empty and
		// S4/idle are one view and BOTH cells are evidential — each reaches its own
		// root and marker inside it. Declared, it is reported as a coincidence; the
		// same bytes and the same content are what the composition SHOULD produce.
		const result = findIdenticalFrames([
			cell("S15", "empty", "aaaa", "one", {
				cell: "S15/empty",
				device: "tablet-landscape",
			}),
			cell("S4", "idle", "aaaa", "one", {
				cell: "S4/idle",
				device: "tablet-landscape",
			}),
		]);
		expect(result.collapses).toEqual([]);
		expect(result.undeclared).toEqual([]);
		expect(result.coincidences).toHaveLength(1);
		expect(result.coincidences[0]).toContain("S15/empty = S4/idle");
		expect(result.coincidences[0]).toContain(
			"declared one view for both states",
		);
	});

	it("refuses the declaration the moment a cell stops being evidential", () => {
		// `ready: false` is the guard's verdict that the cell shows the app's fallback
		// screen: a non-evidential partition can never declare itself out of a collapse.
		const result = findIdenticalFrames([
			cell("S15", "empty", "aaaa", "one", {
				cell: "S15/empty",
				device: "tablet-landscape",
			}),
			cell("S4", "idle", "aaaa", "one", {
				cell: "S4/idle",
				device: "tablet-landscape",
				ready: false,
			}),
		]);
		expect(result.collapses).toHaveLength(1);
		expect(result.coincidences).toEqual([]);
	});

	it("reports an UNDECLARED pair — the blocking term — when only the bytes agree", () => {
		const result = findIdenticalFrames([
			cell("S5", "populated-long", "aaaa", "long"),
			cell("S5", "scroll", "aaaa", "scrolled"),
		]);
		expect(result.collapses).toEqual([]);
		expect(result.undeclared).toHaveLength(1);
		expect(result.undeclared[0]).toContain("although their renderings differ");
		expect(result.undeclared[0]).toContain("IDENTICAL_FRAME_EXEMPTIONS");
		expect(result.exemptions).toEqual([]);
	});

	it("reports the DECLARED exemption for the group the matrix declares, and nothing else", () => {
		// The one key `matrix.ts` declares, so this test fails if the table loses it —
		// the exemption is a statement about a real group, not a variable. The group is
		// three names because that is the shape the check forms once a tier captures
		// every cell: `S5/subagents` joined `S5/populated-long` and `S5/rich-rows` in the
		// same byte-group, and the table extends the one statement rather than opening a
		// second entry for the same phenomenon.
		const result = findIdenticalFrames([
			cell("S5", "populated-long", "aaaa", "long", {
				cell: "S5/populated-long",
			}),
			cell("S5", "rich-rows", "aaaa", "rows", { cell: "S5/rich-rows" }),
			cell("S5", "subagents", "aaaa", "roster", { cell: "S5/subagents" }),
		]);
		expect(result.collapses).toEqual([]);
		expect(result.undeclared).toEqual([]);
		expect(result.exemptions).toHaveLength(1);
		expect(result.exemptions[0]).toContain("declared, not a collapse");
	});

	it("ignores a group made only of declared skips — a skip is not evidence", () => {
		const skipped = {
			declaredSkip: { cell: "S5/scroll", owner: "harness", reason: "…" },
		};
		const result = findIdenticalFrames([
			cell("S5", "populated", "aaaa", "one", skipped),
			cell("S5", "empty", "aaaa", "one", skipped),
		]);
		expect(result).toEqual({
			collapses: [],
			undeclared: [],
			exemptions: [],
			coincidences: [],
		});
	});

	it("ignores a group made only of frames that never reached their state", () => {
		// `ready: false` is the readiness guard's own verdict that the cell is showing the
		// app's fallback screen: the frame is not evidence for the state it declares.
		const unready = { ready: false };
		const result = findIdenticalFrames([
			cell("S5", "error", "aaaa", "signed-out", unready),
			cell("S5", "populated", "aaaa", "populated", unready),
		]);
		expect(result).toEqual({
			collapses: [],
			undeclared: [],
			exemptions: [],
			coincidences: [],
		});
	});

	it("still reports a collapse when a ready cell shares the bytes with an unready one", () => {
		const result = findIdenticalFrames([
			cell("S5", "error", "aaaa", "identical"),
			cell("S5", "populated", "aaaa", "identical", { ready: false }),
		]);
		expect(result.collapses).toHaveLength(1);
	});

	it("still reports a collapse when a skipped cell is in the same group", () => {
		const result = findIdenticalFrames([
			cell("S5", "populated", "aaaa", "identical"),
			cell("S5", "empty", "aaaa", "identical", {
				declaredSkip: { cell: "S5/empty", owner: "app", reason: "…" },
			}),
		]);
		expect(result.collapses).toHaveLength(1);
	});

	it("reports the collapse and drops the camera limit beside it", () => {
		// One real collapse is the finding; the exemption in the same byte-group would
		// only dilute it, so the exemption is not reported while a collapse stands.
		const result = findIdenticalFrames([
			cell("S13", "error", "aaaa", "identical"),
			cell("S2", "error", "aaaa", "identical"),
			cell("S5", "populated-long", "aaaa", "long", {
				cell: "S5/populated-long",
			}),
			cell("S5", "rich-rows", "aaaa", "rows", { cell: "S5/rich-rows" }),
			cell("S5", "subagents", "aaaa", "roster", { cell: "S5/subagents" }),
		]);
		expect(result.collapses).toHaveLength(1);
		expect(result.exemptions).toEqual([]);
		expect(result.undeclared).toEqual([]);
	});

	it("accepts a SUBSET of a declared class — the pair a narrower scale produces", () => {
		// THE MECHANISM THIS PINS, and why it is not a convenience. `CI_SCALES` gained the
		// 135 % step, and at iphone-se/light/135 only TWO of the three cells in the declared
		// S5 class collide: CI produced exactly this pair, and the blocking gate red on a
		// phenomenon a reviewer had already approved because the ledger was keyed on one
		// exact subset. A key per subset cannot be maintained — the next scale, device or
		// seed produces a different subset of the same cells — so the assertion is that the
		// pair qualifies through the class it belongs to.
		const result = findIdenticalFrames([
			cell("S5", "populated-long", "aaaa", "long", {
				cell: "S5/populated-long",
			}),
			cell("S5", "subagents", "aaaa", "roster", { cell: "S5/subagents" }),
		]);
		expect(result.collapses).toEqual([]);
		expect(result.undeclared).toEqual([]);
		expect(result.exemptions).toHaveLength(1);
		expect(result.exemptions[0]).toContain("declared, not a collapse");
	});

	it("still fails a group that contains a cell the class does not name", () => {
		// The tooth containment keeps: one undeclared cell in the group is enough, so a new
		// collapse cannot hide behind a class it is not part of.
		const result = findIdenticalFrames([
			cell("S5", "populated-long", "aaaa", "long", {
				cell: "S5/populated-long",
			}),
			cell("S5", "subagents", "aaaa", "roster", { cell: "S5/subagents" }),
			cell("S5", "empty", "aaaa", "empty"),
		]);
		expect(result.collapses).toEqual([]);
		expect(result.undeclared).toHaveLength(1);
		expect(result.exemptions).toEqual([]);
		expect(result.undeclared[0]).toContain("'S5/empty'");
	});

	it("matches a class by containment for BOTH ledgers, not just the exemption one", () => {
		// The rule lives in ONE matcher and both ledgers consult it, so containment is
		// asserted on the matcher itself rather than inferred from whichever branch happens
		// to be cheap to drive: with a composed class of three, any two of its cells qualify,
		// an empty ledger matches nothing, and one undeclared cell is still fatal.
		const composed = [
			cell("S15", "empty", "aaaa", "one", { cell: "S15/empty" }),
			cell("S4", "idle", "aaaa", "one", { cell: "S4/idle" }),
		];
		const classOfThree = [
			{
				cells: ["S15/empty", "S4/idle", "S4/live"],
				reason: "composed at this device",
			},
		];
		expect(matchDeclared(composed, classOfThree)?.reason).toBe(
			"composed at this device",
		);
		expect(matchDeclared(composed, [])).toBeUndefined();
		expect(
			matchDeclared(
				[...composed, cell("S13", "error", "aaaa", "x")],
				classOfThree,
			),
		).toBeUndefined();
	});

	it("quotes the most SPECIFIC declared class, not a broader one that contains it", () => {
		// Two entries can both cover a produced set. The narrow one is the statement that
		// describes this run; quoting a broader entry's reason would report a phenomenon the
		// reviewer never saw.
		const group = [
			cell("S5", "subagents", "aaaa", "roster", { cell: "S5/subagents" }),
		];
		const ledger = [
			{
				cells: ["S5/populated-long", "S5/rich-rows", "S5/subagents"],
				reason: "broad",
			},
			{ cells: ["S5/subagents"], reason: "narrow" },
		];
		expect(matchDeclared(group, ledger)?.reason).toBe("narrow");
	});

	it("hands over the CLASS to declare when a group is undeclared", () => {
		// The message IS the remedy, so it names the cells this run produced AND says that
		// extending an existing entry's `cells` is the answer when the phenomenon is one
		// already declared: reading it as "declare this exact set" is what produced the
		// per-subset literals this shape replaced.
		const result = findIdenticalFrames([
			cell("S5", "populated-long", "aaaa", "long", {
				cell: "S5/populated-long",
			}),
			cell("S5", "scroll", "aaaa", "scrolled"),
		]);
		expect(result.undeclared[0]).toContain(
			"{ cells: ['S5/populated-long', 'S5/scroll'] }",
		);
		expect(result.undeclared[0]).toContain("extend the `cells` of the entry");
	});
});
