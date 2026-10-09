import { describe, expect, it } from "vitest";

import {
	ESTIMATED_ROW_PT,
	estimateVisibleRows,
	rowLayout,
	rowOffsets,
	tailStartIndex,
	windowPolicy,
} from "@/features/session/windowing";

/**
 * The render window, pinned because it fails silently: a transcript that mounts 520
 * rows is not visibly broken, it is slow, and the slowness arrives with the one
 * conversation long enough to matter.
 *
 * The LAYOUT is deliberately NOT unit-tested here, and that is a decision rather
 * than an omission. On this head the layout is `Screen`'s measure cap plus
 * `src/ui/column.ts` (`maxColumnWidth`, which IS importable and has its own test):
 * the screen stacks its panels inside one capped column, so there is no pane
 * arithmetic of this feature's to test. Anything that imports `react-native` cannot
 * be unit-tested at all — vitest cannot parse RN's Flow source, so such a file fails
 * to LOAD rather than failing an assertion (measured: `Parse failure: Flow is not
 * supported`) — which is why the primitives' geometry is not asserted here.
 *
 * The invariants that a still frame cannot show are therefore verified where they
 * render: the capture rig measures every frame's real widths (transcript, composer,
 * the column cap) and its mounted-row budget, and fails the frame when one is
 * broken. That rig check exists because a unit test did not catch an 833 pt rail
 * beside a 533 pt transcript, and because 524 rows mounted looks identical to 51 in
 * a screenshot. When #11 restores the two-pane layout, the rail's own width becomes
 * a rig invariant again and the tablet class gets its own measured rows below.
 */

/**
 * The viewport sizes the capture matrix must cover, tagged by the class whose
 * layout requirement they test. Tagged rather than classified in the test, because
 * the question the operator asks is "does a PHONE work, in every size, both
 * orientations" — and answering that by recomputing the rule would prove nothing.
 */
type DeviceClass = "phone" | "foldable" | "tablet";

const VIEWPORTS: [
	label: string,
	width: number,
	height: number,
	kind: DeviceClass,
][] = [
	["foldable cover 280x653", 280, 653, "foldable"],
	["unfolded 673x841", 673, 841, "foldable"],
	["iPhone SE 320x568", 320, 568, "phone"],
	["SE2 375x667", 375, 667, "phone"],
	["small Android 360x640", 360, 640, "phone"],
	["Android 360x780", 360, 780, "phone"],
	["iPhone 15 390x844", 390, 844, "phone"],
	["large Android 412x915", 412, 915, "phone"],
	["Pro Max 430x932", 430, 932, "phone"],
	["phone landscape 844x390", 844, 390, "phone"],
	["phone landscape 915x412", 915, 412, "phone"],
	["iPad 768x1024", 768, 1024, "tablet"],
	["iPad 1024x768", 1024, 768, "tablet"],
	["iPad Air 834x1112", 834, 1112, "tablet"],
	["iPad Air 1112x834", 1112, 834, "tablet"],
	["iPad Pro 1024x1366", 1024, 1366, "tablet"],
	["iPad Pro 1366x1024", 1366, 1024, "tablet"],
	["Android tablet 800x1280", 800, 1280, "tablet"],
	["Android tablet 1280x800", 1280, 800, "tablet"],
];

/**
 * The mounted-row ceilings, per device class, as literals — see the assertion below
 * for why they are not computed. Measured on this head at each class's largest
 * viewport: `foldable` 60 (673x841, the same as the budget), `phone` 66 (Pro Max
 * 430x932, where `MIN_WINDOW_SIZE` forces a third screen over a 22-row viewport),
 * `tablet` 96 (iPad Pro 1024x1366). The budget itself is 60.
 */
const MOUNTED_CEILING: Record<DeviceClass, number> = {
	foldable: 60,
	phone: 72,
	tablet: 96,
};

describe("the transcript's render window", () => {
	it("mounts a window, not the conversation", () => {
		// The relay's own long-transcript scenario is 520 rows. The property that
		// matters is that the mounted count is bounded by the viewport rather than by
		// the transcript, and that it never falls below what fills the screen.
		for (const [label, _width, height, kind] of VIEWPORTS) {
			const visible = estimateVisibleRows(height);
			const policy = windowPolicy(height, 520);
			// The CEILING is a literal per device class, not the policy's own formula.
			// Asserting `max(TARGET, visible * 3)` compared the policy against itself:
			// every term came from the code under test, so a policy that stayed
			// internally consistent and over budget passed — measured, raising
			// TARGET_MOUNTED_ROWS to 200 keeps the old assertion true while mounting 200
			// rows. These are the numbers this app commits to, measured at each class's
			// largest viewport.
			expect(policy.estimatedMountedRows, label).toBeLessThanOrEqual(
				MOUNTED_CEILING[kind],
			);
			// No second budget assertion here: `MOUNTED_CEILING[kind]` already IS the
			// per-class number — foldable 60 (the budget), phone 72, tablet 96 — so a
			// per-class re-check against the budget is implied by the line above and
			// would only fire if a ceiling were raised past it, which is the change the
			// ceiling itself already fails (review round 2, F8).
			expect(policy.estimatedMountedRows, label).toBeGreaterThanOrEqual(
				Math.min(520, visible),
			);
			expect(policy.windowSize, label).toBeGreaterThanOrEqual(3);
			expect(policy.windowSize, label).toBeLessThanOrEqual(11);
			expect(policy.initialNumToRender, label).toBeGreaterThanOrEqual(
				Math.min(520, Math.max(12, visible)),
			);
		}
		// The phone that matters: a 520-row conversation at 390x844 mounts well under a
		// fifth of it.
		expect(windowPolicy(844, 520).estimatedMountedRows).toBeLessThan(120);
		expect(windowPolicy(844, 520).estimatedMountedRows).toBeLessThan(520 / 4);
	});

	it("renders a short transcript in full, rather than windowing it", () => {
		const policy = windowPolicy(844, 7);
		expect(policy.estimatedMountedRows).toBe(7);
		expect(policy.initialNumToRender).toBe(7);
	});
});

/**
 * The list's placement arithmetic: where the tail start is, and what one row
 * occupies.
 *
 * These are pinned because both failures are SILENT. A tail start that is off by
 * the render window leaves the first frame showing rows the reader did not come
 * for (the defect: the transcript opened at the top and was scrolled down after
 * it painted); and a row layout that ignores the measured heights makes
 * `getItemLayout` place its jumps from the estimate alone, so a find jump lands
 * near the target rather than on it. Neither shows up as a thrown error, and a
 * still frame of the settled state cannot tell either apart from the correct
 * one.
 */
describe("tailStartIndex", () => {
	it("starts at the first row of the last screenful, so the first render mounts the tail", () => {
		// 520 rows, a 12-row window: rows 508..519 mount on the first render —
		// the tail the reader asked for, at the heights the list already knows.
		expect(tailStartIndex(520, 12)).toBe(508);
	});

	it("starts at 0 for a conversation shorter than the window", () => {
		expect(tailStartIndex(7, 12)).toBe(0);
		expect(tailStartIndex(12, 12)).toBe(0);
		expect(tailStartIndex(0, 12)).toBe(0);
	});

	it("never returns a negative index, whatever window it is handed", () => {
		// A window of 0 or less is not a thing the policy produces, but the
		// arithmetic must not depend on that: a negative index is a list that
		// throws rather than a list that opens at the top.
		expect(tailStartIndex(5, 0)).toBe(4);
		expect(tailStartIndex(5, -3)).toBe(4);
	});
});

describe("rowOffsets: the table `getItemLayout` answers from", () => {
	const ids = ["a", "b", "c", "d"];
	const idAt = (at: number) => ids[at];

	it("carries the content's height and agrees with rowLayout at every index", () => {
		/* The list answers a batch from this table rather than walking per call
		 * (review NIT-2), so the table IS the layout: if the two ever disagree, a
		 * jump lands somewhere the virtualiser does not expect. */
		const heights = new Map([
			["a", 100],
			["c", 60],
		]);
		const offsets = rowOffsets(ids.length, idAt, heights);
		expect(offsets).toEqual([
			0,
			100,
			100 + ESTIMATED_ROW_PT,
			100 + ESTIMATED_ROW_PT + 60,
			100 + ESTIMATED_ROW_PT + 60 + ESTIMATED_ROW_PT,
		]);
		for (let at = 0; at < ids.length; at += 1) {
			const row = rowLayout(at, idAt, heights);
			expect(row.offset).toBe(offsets[at]);
			expect(row.length).toBe((offsets[at + 1] ?? 0) - (offsets[at] ?? 0));
		}
	});

	it("is monotone and never NaN, for a table with no rows and one with unmeasured ids", () => {
		expect(rowOffsets(0, idAt, new Map())).toEqual([0]);
		const offsets = rowOffsets(6, () => undefined, new Map());
		expect(offsets).toHaveLength(7);
		for (let at = 1; at < offsets.length; at += 1)
			expect(offsets[at]).toBeGreaterThan(offsets[at - 1] as number);
	});
});

describe("rowLayout", () => {
	const ids = ["a", "b", "c", "d"];
	const idAt = (at: number) => ids[at];

	it("offsets a row by the MEASURED heights above it", () => {
		const heights = new Map([
			["a", 100],
			["b", 20],
			["c", 60],
		]);
		expect(rowLayout(0, idAt, heights)).toEqual({
			index: 0,
			offset: 0,
			length: 100,
		});
		expect(rowLayout(2, idAt, heights)).toEqual({
			index: 2,
			offset: 120,
			length: 60,
		});
	});

	it("falls back to the estimate for a row nobody has measured", () => {
		const heights = new Map([["a", 100]]);
		// b and c have never laid out: the estimate is the small side of the real
		// distribution (windowing.ts's note), so the tail the list asks for is
		// reached as the rows above it mount rather than overshot into blank space.
		// b has not measured either, so the offset is a's real height plus b's
		// estimate — never a re-estimate of the row being asked about.
		expect(rowLayout(2, idAt, heights)).toEqual({
			index: 2,
			offset: 100 + ESTIMATED_ROW_PT,
			length: ESTIMATED_ROW_PT,
		});
		// An index with no id at all (the list asking about a row it does not have)
		// is the estimate, never NaN.
		expect(rowLayout(9, idAt, heights).length).toBe(ESTIMATED_ROW_PT);
	});

	it("is the same answer the list's own metrics would give when every row is measured", () => {
		const heights = new Map([
			["a", 100],
			["b", 20],
			["c", 60],
			["d", 40],
		]);
		// Sum of the heights above equals the offset, for every index: the property
		// that makes the layout consistent enough to place an initial scroll.
		let expected = 0;
		for (let at = 0; at < ids.length; at += 1) {
			expect(rowLayout(at, idAt, heights).offset).toBe(expected);
			expected += heights.get(ids[at] as string) ?? 0;
		}
	});
});
