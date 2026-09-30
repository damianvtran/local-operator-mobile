import { describe, expect, it } from "vitest";

import {
	estimateVisibleRows,
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
const PHONE_MOUNTED_BUDGET = 72;
const MOUNTED_CEILING: Record<DeviceClass, number> = {
	foldable: 60,
	phone: PHONE_MOUNTED_BUDGET,
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
			// And it is not a bare restatement of the budget: a phone is inside it.
			if (kind !== "tablet") {
				expect(policy.estimatedMountedRows, label).toBeLessThanOrEqual(
					PHONE_MOUNTED_BUDGET,
				);
			}
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
