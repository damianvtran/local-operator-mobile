import { describe, expect, it } from "vitest";

import {
	estimateVisibleRows,
	TARGET_MOUNTED_ROWS,
	windowPolicy,
} from "@/features/session/windowing";

/**
 * The render window, pinned because it fails silently: a transcript that mounts 520
 * rows is not visibly broken, it is slow, and the slowness arrives with the one
 * conversation long enough to matter.
 *
 * The LAYOUT is deliberately NOT unit-tested here, and that is a decision rather
 * than an omission. The adaptive vocabulary lives in `src/ui/layout.ts`, which
 * imports `react-native` — and vitest cannot parse react-native's Flow source, so
 * any test that imports it fails to load rather than failing an assertion (measured:
 * `Parse failure: Flow is not supported`). The layout is therefore verified where it
 * actually renders: the capture rig measures the rail's and the transcript's real
 * pixel widths on every device and fails the frame when the invariant is broken,
 * which is evidence a hand-built literal could not give. That rig check exists
 * because a unit test did not catch an 833 pt rail beside a 533 pt transcript.
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

describe("the transcript's render window", () => {
	it("mounts a window, not the conversation", () => {
		// The relay's own long-transcript scenario is 520 rows. The property that
		// matters is that the mounted count is bounded by the viewport rather than by
		// the transcript, and that it never falls below what fills the screen.
		for (const [label, _width, height] of VIEWPORTS) {
			const visible = estimateVisibleRows(height);
			const policy = windowPolicy(height, 520);
			expect(policy.estimatedMountedRows, label).toBeLessThanOrEqual(
				Math.max(TARGET_MOUNTED_ROWS, visible * 3),
			);
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
