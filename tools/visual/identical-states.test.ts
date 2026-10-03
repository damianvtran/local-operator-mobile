import { describe, expect, it } from "vitest";
import { type FrameRecord, findIdenticalFrames } from "./identical-states.ts";

/**
 * The four outcomes of the identical-frame check, each asserted on its own.
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
		expect(result).toEqual({ collapses: [], undeclared: [], exemptions: [] });
	});

	it("says nothing when the frames differ", () => {
		const result = findIdenticalFrames([
			cell("S5", "populated", "aaaa", "one"),
			cell("S5", "empty", "bbbb", "two"),
		]);
		expect(result).toEqual({ collapses: [], undeclared: [], exemptions: [] });
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

	it("reports the DECLARED exemption for the pair the matrix declares, and nothing else", () => {
		// The one key `matrix.ts` declares, so this test fails if the table loses it —
		// the exemption is a statement about a real pair, not a variable.
		const result = findIdenticalFrames([
			cell("S5", "populated-long", "aaaa", "long", {
				cell: "S5/populated-long",
			}),
			cell("S5", "rich-rows", "aaaa", "rows", { cell: "S5/rich-rows" }),
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
		expect(result).toEqual({ collapses: [], undeclared: [], exemptions: [] });
	});

	it("ignores a group made only of frames that never reached their state", () => {
		// `ready: false` is the readiness guard's own verdict that the cell is showing the
		// app's fallback screen: the frame is not evidence for the state it declares.
		const unready = { ready: false };
		const result = findIdenticalFrames([
			cell("S5", "error", "aaaa", "signed-out", unready),
			cell("S5", "populated", "aaaa", "populated", unready),
		]);
		expect(result).toEqual({ collapses: [], undeclared: [], exemptions: [] });
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
		]);
		expect(result.collapses).toHaveLength(1);
		expect(result.exemptions).toEqual([]);
		expect(result.undeclared).toEqual([]);
	});
});
