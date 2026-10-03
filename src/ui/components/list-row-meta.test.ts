import { describe, expect, it } from "vitest";

import {
	charWidthDp,
	META_PATH_FLOOR_CHARS,
	MODEL_MIN_CHARS,
	metaLineFor,
	textWidthDp,
} from "./list-row-meta";

/**
 * The meta line's fit, pinned at the widths the design round measured.
 *
 * These are the numbers the finding is made of, so they are asserted as VALUES
 * rather than as "contains an ellipsis": the point of D26 (and of R-3 after it)
 * is WHICH PART of each field survives, and a test that only checked for truncation
 * would pass on either direction.
 *
 * The widths are the measured meta lines: 232 dp on a 320 pt phone, 318 dp on a
 * 390 pt one, 287 dp in a split pane at 834×1112.
 */
const SE = {
	one: "~/work",
	path: "~/workspace/clients/meridian/operations/nightly-reconciliation",
	opus: "anthropic/claude-opus-5",
	mock: "nope/nope",
};

/** A code unit left on its own by a UTF-16 slice, which renders as U+FFFD. */
const hasLoneSurrogate = (text: string): boolean => {
	for (let index = 0; index < text.length; index += 1) {
		const unit = text.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = text.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) {
			return true;
		}
	}
	return false;
};

const roomFor = (widthDp: number, scale: number): number =>
	widthDp - 8 - META_PATH_FLOOR_CHARS * charWidthDp(scale);

describe("the meta line's fit", () => {
	it("paints both fields whole before the first layout has a width", () => {
		// The first frame has no measurement, and trimming against a width of 0
		// would blank the row for a frame. Both fields are painted whole, which is
		// also the final answer for every row that does not need a trim.
		expect(
			metaLineFor({ cwd: SE.path, model: SE.opus, widthDp: 0, scale: 2 }),
		).toEqual({ cwd: SE.path, model: SE.opus });
	});

	it("drops the provider prefix rather than the model's own name, at 320 pt @ 100 %", () => {
		// The finding's own configuration, and the one frame it asked for: 232 dp
		// of line, 152 dp of room for the model, 21 glyphs — two short of the
		// 23-glyph id, so the 11-glyph vendor goes and the model name stays whole.
		expect(
			metaLineFor({ cwd: SE.one, model: SE.opus, widthDp: 232, scale: 1 }),
		).toEqual({ cwd: "~/work", model: "…claude-opus-5" });
	});

	it("keeps a model whose whole name is shorter than the legibility floor", () => {
		// R2-1: the floor is about an ELIDED label. `o3` and `gpt-4` are complete
		// names, and a length gate over the painted string dropped them at every
		// width and scale — the fixtures here are the ones that would have caught it.
		for (const model of ["o3", "gpt-4", "abcdef"]) {
			expect(
				metaLineFor({ cwd: SE.one, model, widthDp: 232, scale: 1 }),
			).toEqual({ cwd: "~/work", model });
			expect(
				metaLineFor({ cwd: SE.one, model, widthDp: 160, scale: 1 }),
			).toEqual({ cwd: "~/work", model });
		}
	});

	it("paints a short model whole when the row has no cwd, rather than an empty line", () => {
		// The same defect's second face: with no path to share the line with, a
		// short model was dropped and the row painted an empty meta line.
		for (const scale of [1, 2]) {
			expect(metaLineFor({ model: "gpt-4", widthDp: 232, scale })).toEqual({
				cwd: null,
				model: "gpt-4",
			});
		}
	});

	it("still drops a label that was elided below the legibility floor", () => {
		// The floor still applies where it was meant to: an elided fragment that
		// names nothing leaves the line to the cwd.
		expect(
			metaLineFor({ cwd: SE.one, model: SE.opus, widthDp: 232, scale: 2 }),
		).toEqual({ cwd: "~/work", model: null });
	});

	it("keeps the head of a path, so both lines of the row elide their tail (R-3)", () => {
		// R-3 (2026-10-03, on the narrow frame): the title kept its head while the
		// path kept its tail — TWO truncation rules inside one row. A path is read
		// from its start (`~/workspace/…` is what a reader scans for), so the path
		// now elides its tail like the row's prose does. The same string D26 called
		// a defect is the intended direction now, and the reason it was rejected
		// then no longer applies: tail-keeping was chosen for BOTH fields together,
		// while the MODEL still keeps its name-end (the D26 reasoning about
		// `anthropic/` is unchanged — see `list-row-meta.ts`).
		const { cwd } = metaLineFor({
			cwd: SE.path,
			model: SE.mock,
			widthDp: 232,
			scale: 1,
		});
		expect(cwd?.endsWith("…")).toBe(true);
		expect(cwd?.startsWith("~/workspace/clients/")).toBe(true);
		expect(cwd).not.toContain("ightly-reconciliation");
	});

	it("fits both fields whole wherever the line is wide enough", () => {
		// The same pair that is cut at 320 pt is whole at 390 pt and in a split
		// pane, which is what keeps a plain `maxWidth` cap from being the answer: 28
		// and 33 glyphs of room against a 23-glyph id.
		for (const widthDp of [318, 287]) {
			expect(
				metaLineFor({ cwd: SE.one, model: SE.opus, widthDp, scale: 1 }),
			).toEqual({ cwd: "~/work", model: SE.opus });
		}
		// And the long path is still cut there — with the whole model beside it, so
		// the path's tail is what pays for the model's name.
		expect(
			metaLineFor({ cwd: SE.path, model: SE.opus, widthDp: 318, scale: 1 }),
		).toMatchObject({ model: SE.opus });
	});

	it("keeps a model that still fits at 150 %, which the scale rule cut off", () => {
		// The reviewer's D2 case: at 150 % the scale rule removed the model even
		// though this one fits whole.
		expect(
			metaLineFor({ cwd: SE.one, model: SE.mock, widthDp: 232, scale: 1.5 }),
		).toEqual({ cwd: "~/work", model: "nope/nope" });
		// And the id that genuinely does not fit keeps a legible tail.
		expect(
			metaLineFor({ cwd: SE.one, model: SE.opus, widthDp: 232, scale: 1.5 }),
		).toEqual({ cwd: "~/work", model: "…de-opus-5" });
	});

	it("does not reserve a scaled gap for a spacing unit that is fixed", () => {
		// R2-2: `gap-2` is 8 dp at every text size, so the model's room is the line
		// minus 8 — not minus 8 x scale. At 285 dp / 200 % the scaled gap dropped a
		// 9-glyph model that fits the room the shipped unit leaves; this is the
		// keep/drop flip, pinned.
		expect(roomFor(285, 2)).toBe(133);
		expect(
			metaLineFor({ cwd: "~/work", model: SE.mock, widthDp: 285, scale: 2 }),
		).toEqual({ cwd: "~/work", model: "nope/nope" });
	});

	it("charges a glyph the face cannot draw at the fallback's advance", () => {
		// R2-3: JetBrains Mono has no CJK coverage, so `文` is drawn from a
		// fallback face at a full-width em. Counting it at the Latin advance
		// under-states the line, and the web build then clamps it from the tail —
		// the direction D26 forbids.
		expect(charWidthDp(1)).toBeCloseTo(7.2, 6);
		expect(textWidthDp("文", 1)).toBeCloseTo(12, 6);
		expect(textWidthDp("~/文書/渲染", 1)).toBeCloseTo(69.6, 6);
		// A CJK path of 7 glyphs is elided at a budget a Latin path of 8 glyphs
		// fits whole, because the budget is measured in dp rather than counted.
		expect(metaLineFor({ cwd: "~/abcdef", widthDp: 60, scale: 1 })).toEqual({
			cwd: "~/abcdef",
			model: null,
		});
		expect(metaLineFor({ cwd: "~/文書/渲染", widthDp: 60, scale: 1 })).toEqual({
			cwd: "~/文書/…",
			model: null,
		});
	});

	it("never leaves a lone surrogate behind when it cuts", () => {
		// R2-4: slicing by UTF-16 unit split `🙂` in half and the half rendered as
		// U+FFFD in the middle of a path. The cut is by code point — and the cut
		// here lands AT the emoji, which is the boundary a code-unit slice would
		// have split.
		const { cwd } = metaLineFor({ cwd: "~/a🙂b/c", widthDp: 41, scale: 1 });
		expect(cwd).toBe("~/a🙂…");
		expect(hasLoneSurrogate(cwd ?? "")).toBe(false);
		for (const widthDp of [24, 32, 40, 48, 56, 64, 72]) {
			const painted = metaLineFor({
				cwd: "~/a🙂b/c",
				model: "gpt-4",
				widthDp,
				scale: 1,
			});
			expect(hasLoneSurrogate(painted.cwd ?? "")).toBe(false);
			expect(hasLoneSurrogate(painted.model ?? "")).toBe(false);
		}
	});

	it("gives the model the whole line when the row has no cwd", () => {
		// No path to share with, so the model's own budget is the full width: it
		// keeps the model name at 200 %, where the shared line would have dropped it.
		expect(metaLineFor({ model: SE.opus, widthDp: 232, scale: 2 })).toEqual({
			cwd: null,
			model: "…claude-opus-5",
		});
	});

	it("paints the cwd alone when the row has no model", () => {
		expect(metaLineFor({ cwd: SE.one, widthDp: 232, scale: 1 })).toEqual({
			cwd: "~/work",
			model: null,
		});
	});

	it("has no fields to place when the row has neither", () => {
		expect(metaLineFor({ widthDp: 232, scale: 1 })).toEqual({
			cwd: null,
			model: null,
		});
	});

	it("keeps every painted field inside the box its floor leaves", () => {
		// The invariant behind every case above: the model never takes more than
		// the line minus the gap minus the cwd's floor, and the cwd never takes
		// more than the line minus the gap minus the model — which is what the
		// flexbox does with the same numbers.
		for (const scale of [1, 1.5, 2]) {
			for (const widthDp of [100, 160, 232, 285, 287, 318, 390]) {
				const { cwd, model } = metaLineFor({
					cwd: SE.path,
					model: SE.opus,
					widthDp,
					scale,
				});
				if (model !== null) {
					expect(textWidthDp(model, scale)).toBeLessThanOrEqual(
						roomFor(widthDp, scale),
					);
					expect([...model].length).toBeGreaterThanOrEqual(MODEL_MIN_CHARS);
				}
				if (cwd !== null) {
					// With no model the cwd has the whole line, so the gap is only spent
					// when there is something on the other side of it.
					const budget =
						model === null ? widthDp : widthDp - 8 - textWidthDp(model, scale);
					expect(textWidthDp(cwd, scale)).toBeLessThanOrEqual(budget);
				}
			}
		}
	});
});
