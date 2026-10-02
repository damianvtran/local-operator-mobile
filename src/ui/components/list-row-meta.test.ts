import { describe, expect, it } from "vitest";

import {
	charWidthDp,
	META_PATH_FLOOR_CHARS,
	MODEL_MIN_CHARS,
	metaLineFor,
} from "./list-row-meta";

/**
 * The meta line's fit, pinned at the widths the design round measured.
 *
 * These are the numbers the finding is made of, so they are asserted as VALUES
 * rather than as "contains an ellipsis": the point of D26 is which PART of each
 * field survives, and a test that only checked for truncation would pass on the
 * tail-ellipsis behaviour the web build actually had.
 *
 * The widths are the measured meta lines: 232 dp on a 320 pt phone, 318 dp on a
 * 390 pt one, 287 dp in a split pane at 834×1112.
 */
const SE = {
	one: "~/work",
	path: "~/workspace/clients/meridian/operations/render",
	opus: "anthropic/claude-opus-5",
	mock: "nope/nope",
};

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
		// of line, 152 dp of room for the model, 21 characters — two short of the
		// 23-character id, so the 11-character vendor goes and the model name stays
		// whole.
		expect(
			metaLineFor({ cwd: SE.one, model: SE.opus, widthDp: 232, scale: 1 }),
		).toEqual({ cwd: "~/work", model: "…claude-opus-5" });
	});

	it("keeps the tail of a path, not its head, when the path has to be cut", () => {
		// The other half of the same bug: react-native-web elided the path from the
		// tail, so a row showed `~/workspace/clients/m…` — the part every row in
		// that folder shares.
		const { cwd } = metaLineFor({
			cwd: SE.path,
			model: SE.mock,
			widthDp: 232,
			scale: 1,
		});
		expect(cwd?.startsWith("…")).toBe(true);
		expect(cwd?.endsWith("operations/render")).toBe(true);
		expect(cwd).not.toContain("~/workspace");
	});

	it("fits both fields whole wherever the line is wide enough", () => {
		// The same pair that is cut at 320 pt is whole at 390 pt and in a split pane,
		// which is what keeps a plain `maxWidth` cap from being the answer: 28 and 33
		// characters of room against a 23-character id.
		for (const widthDp of [318, 287]) {
			expect(
				metaLineFor({ cwd: SE.one, model: SE.opus, widthDp, scale: 1 }),
			).toEqual({ cwd: "~/work", model: SE.opus });
		}
		// And the long path is still cut there — with the whole model beside it, so
		// the path's tail is what pays for the model's name.
		expect(
			metaLineFor({ cwd: SE.path, model: SE.opus, widthDp: 318, scale: 1 }),
		).toEqual({ cwd: "…n/operations/render", model: SE.opus });
	});

	it("gives the line to the cwd when no legible prefix of the model survives", () => {
		// 320 pt at 200 %: 72 dp of room is five characters, so the model would be
		// `…us-5` — a fragment that names nothing. The line carries the cwd alone
		// (D26's narrowest configuration, reached by measuring rather than by a
		// text-scale threshold).
		expect(
			metaLineFor({ cwd: SE.one, model: SE.opus, widthDp: 232, scale: 2 }),
		).toEqual({ cwd: "~/work", model: null });
	});

	it("keeps a model that still fits at 150 %, which the scale rule cut off", () => {
		// The reviewer's D2 case: at 150 % the scale rule removed the model even
		// though this one fits whole (9 characters of a 10-character budget).
		expect(
			metaLineFor({ cwd: SE.one, model: SE.mock, widthDp: 232, scale: 1.5 }),
		).toEqual({ cwd: "~/work", model: "nope/nope" });
	});

	it("trims a long model name to its own tail once the vendor is not enough", () => {
		const { model } = metaLineFor({
			cwd: SE.one,
			model: "openrouter/deepseek/deepseek-v4.1-flash",
			widthDp: 232,
			scale: 1,
		});
		expect(model?.startsWith("…")).toBe(true);
		expect(model?.endsWith("flash")).toBe(true);
		expect(model).not.toContain("openrouter");
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

	it("keeps the painted model inside the room its floor leaves", () => {
		// The invariant behind every case above: the model never takes more than
		// the line minus the gap minus the cwd's floor, which is what the flexbox
		// does with the same numbers.
		for (const scale of [1, 1.5, 2]) {
			for (const widthDp of [232, 287, 318, 390]) {
				const { model } = metaLineFor({
					cwd: SE.path,
					model: SE.opus,
					widthDp,
					scale,
				});
				if (model === null) continue;
				const room =
					widthDp - 8 * scale - META_PATH_FLOOR_CHARS * charWidthDp(scale);
				expect(model.length * charWidthDp(scale)).toBeLessThanOrEqual(room);
			}
		}
	});

	it("keeps the model's own name whole whenever the ellipsis can hold the slot", () => {
		// Which is the whole point: whenever the vendor's space buys the model's
		// name, the name is not itself cut.
		const { model } = metaLineFor({
			cwd: SE.one,
			model: SE.opus,
			widthDp: 232,
			scale: 1,
		});
		expect(model).toContain("claude-opus-5");
		expect((model ?? "").length).toBeGreaterThanOrEqual(MODEL_MIN_CHARS);
	});
});
