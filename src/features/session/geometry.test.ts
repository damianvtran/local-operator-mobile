import { describe, expect, it } from "vitest";

import { sessionLayout } from "@/features/session/layout";
import {
	ESTIMATED_ROW_PT,
	estimateVisibleRows,
	TARGET_MOUNTED_ROWS,
	windowPolicy,
} from "@/features/session/windowing";

/**
 * The two pieces of geometry the screen derives rather than measures, pinned
 * because both fail silently.
 *
 * A transcript that mounts 520 rows is not visibly broken; it is slow, and the
 * slowness arrives with the one conversation long enough to matter. A tablet that
 * shows a phone column stretched across 1366 px is *visibly* broken but only on a
 * device nobody in the loop is holding.
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

	it("estimates visible rows from the row height the list actually uses", () => {
		expect(estimateVisibleRows(ESTIMATED_ROW_PT * 3)).toBe(3);
		// A viewport too short for one row still renders one row.
		expect(estimateVisibleRows(10)).toBe(1);
	});
});

describe("the responsive layout", () => {
	it("keeps every phone and every foldable in a single column, in both orientations", () => {
		// A landscape phone is 844 pt wide — wider than an iPad mini — so a width-only
		// rule gives it a rail, which trades the transcript's width for a panel on a
		// 390 pt-tall screen with a keyboard up. This case is why the rule reads height.
		for (const [label, width, height, kind] of VIEWPORTS) {
			if (kind === "tablet") continue;
			expect(sessionLayout(width, height).twoPane, label).toBe(false);
		}
	});

	it("gives a rail only where a full measure still fits beside it", () => {
		// The point of a tablet layout is a readable transcript; a rail that squeezes
		// the transcript below its measure trades the thing being read for a panel.
		for (const [label, width, height] of VIEWPORTS) {
			const layout = sessionLayout(width, height);
			if (layout.twoPane) {
				expect(width - layout.railPt, label).toBeGreaterThanOrEqual(
					layout.measurePt,
				);
			}
		}
		// Full-width landscape tablets get the rail…
		expect(sessionLayout(1366, 1024).twoPane).toBe(true);
		expect(sessionLayout(1112, 834).twoPane).toBe(true);
		expect(sessionLayout(1280, 800).twoPane).toBe(true);
		// …and a split view's detail pane (1366 − 360 = 1006) is NOT: 1006 − 300
		// leaves 706 pt, under a full measure, so the panels stack inside the column.
		// This is the case the container measurement exists for — the window says
		// 1366, the view is given 1006.
		expect(sessionLayout(1006, 1024).twoPane).toBe(false);
	});

	it("never stretches a tablet's transcript past the readable measure", () => {
		// A portrait tablet that cannot fit a rail beside a full measure is ONE
		// measure-capped column (768, 800, 834); the iPad Pro at 1024 can (724 pt
		// remains), so it gets the rail. Either way the transcript never exceeds the
		// measure — a phone layout stretched to tablet width is the finding this pins.
		for (const [label, width, height, kind] of VIEWPORTS) {
			if (kind !== "tablet") continue;
			expect(sessionLayout(width, height).measurePt, label).toBeLessThanOrEqual(
				720,
			);
		}
		expect(sessionLayout(768, 1024).twoPane).toBe(false);
		expect(sessionLayout(834, 1112).twoPane).toBe(false);
		expect(sessionLayout(1024, 1366).twoPane).toBe(true);
	});

	it("caps the readable measure instead of stretching it", () => {
		// A paragraph 1366 px wide is unreadable, and the fix is a constrained column.
		expect(sessionLayout(1366, 1024).measurePt).toBeLessThan(1366);
		expect(sessionLayout(390, 844).measurePt).toBe(390);
	});

	it("classifies every matrix viewport into a bucket", () => {
		for (const [label, width, height] of VIEWPORTS) {
			const layout = sessionLayout(width, height);
			expect(["compact", "medium", "wide"], label).toContain(layout.bucket);
		}
		expect(sessionLayout(280, 653).bucket).toBe("compact");
		expect(sessionLayout(390, 844).bucket).toBe("compact");
		// A phone in landscape is `medium`: more width than a portrait phone, and still
		// one column.
		expect(sessionLayout(844, 390).bucket).toBe("medium");
		expect(sessionLayout(1366, 1024).bucket).toBe("wide");
		expect(sessionLayout(768, 1024).bucket).toBe("medium");
	});
});
