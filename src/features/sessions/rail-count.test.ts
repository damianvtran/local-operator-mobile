import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { inboxBadgeCount } from "./session-projection";

/**
 * The rail's count pill and its mirror are the SAME element, and neither side is
 * a constant width.
 *
 * WHY THIS IS A SOURCE INVARIANT. The two sides of the Notifications rail row
 * keep the route's label on the rail's centre line (`D19`), and the pill grows
 * with its text: at 320 × 568 / 200 % `99+` measured wider than the fixed 40 pt
 * slot, ran past the pane's edge and the list clipped it to "99" (design round 7,
 * D22 / code review round 8, R8-02 — on native the slot stayed 40 dp while the
 * system text size grew the badge). What has to hold is a LAYOUT fact about two
 * elements of one row, and this repository has no React renderer or jsdom to
 * measure it in; adding one for a 40 pt slot would be a new dependency and a
 * build seam the app does not have. So the invariant is asserted where it lives:
 *
 *   1. both sides render `RailCount` (one component, so they cannot drift), and
 *   2. the row carries no fixed-width slot — `w-10` and friends — which is what
 *      clipped the pill.
 *
 * The centring itself is measured in pixels by the capture instrument (S4 and
 * S15 frames, `D19`), not here. This test is honest about being static.
 */
const PANE = new URL("./conversations-pane.tsx", import.meta.url);
const source = readFileSync(PANE, "utf8");

/** Whitespace-insensitive, so re-indenting the component cannot turn a structural
 *  assertion red over layout of the source (code review round 10, n-1). */
const flat = (text: string) => text.replace(/\s+/g, " ");

const railSection = () => {
	// From the row's own leading comment (the invisible mirror comes BEFORE the
	// button, so a slice that started at the label would miss one side) to the next
	// destination.
	const start = source.indexOf("THE SAME PILL, INVISIBLE");
	expect(start).toBeGreaterThan(-1);
	const end = source.indexOf('label="Library"', start);
	expect(end).toBeGreaterThan(start);
	return source.slice(start, end);
};

describe("the rail's inbox count", () => {
	it("renders the same pill on both sides, one of them hidden", () => {
		const rail = railSection();
		// Both sides come from the same component…
		expect(rail.match(/<RailCount /g) ?? []).toHaveLength(2);
		// …and exactly one is the invisible mirror, which the row renders only while
		// its own measurement says the label and both pills fit (D23).
		expect(flat(rail)).toContain(
			'placement === "symmetric" ? ( <RailCount count={inboxCount} hidden />',
		);
		expect(
			rail.match(/<RailCount count=\{inboxCount\} hidden \/>/g) ?? [],
		).toHaveLength(1);
		// The visible pill measures itself for that decision.
		expect(
			rail.match(
				/<RailCount count=\{inboxCount\} onWidth=\{measurePill\} \/>/g,
			) ?? [],
		).toHaveLength(1);
	});

	it("starts in the safe placement and only improves on it (M-2)", () => {
		/* The invariant is about the UNMEASURED state: measurement may only replace a
		 * layout that was already correct, because on native `onLayout` is delivered
		 * after the layout is presented. A `symmetric` default would paint the
		 * overlap D23 exists to prevent, once, before switching. */
		expect(flat(source)).toContain('? "grouped"');
		expect(flat(source)).not.toContain('? "symmetric"');
		// …and grouped is CENTRED as one pair, or the frame is not the model.
		expect(flat(source)).toContain(
			'"w-full flex-row items-center justify-center"',
		);
		// The mirror is the only thing that changes sides, and only under a PROVEN fit.
		expect(flat(railSection())).toContain(
			'placement === "symmetric" ? ( <RailCount count={inboxCount} hidden />',
		);
		// The pair's label is the part that gives when it overruns (m-5).
		expect(flat(source)).toContain(
			'labelLines={ placement === "symmetric" || !hasInboxCount ? undefined : 1 }',
		);
	});

	it("shrinks the grouped wrapper, so an over-running pair shortens the label (m-2)", () => {
		const rail = railSection();
		// The ellipsis only happens because the WRAPPER can shrink; without it the
		// label keeps its width and paints under the badge again.
		expect(rail).toMatch(/\?\s*"flex-1"\s*:\s*\/\*[\s\S]*?\*\/\s*"shrink"/);
		expect(rail).toContain('"shrink"');
	});

	it("bottoms out in a full-width row when there is no count (R11 m-1)", () => {
		// No count means no pair: the row keeps the symmetric shape so the control is
		// as wide as its siblings instead of sitting as a grouped pair forever.
		// The ROW's own class sits above the slice these tests otherwise read, so the
		// whole module is the subject for the first assertion.
		expect(flat(source)).toContain(
			'placement === "symmetric" || !hasInboxCount ? "w-full flex-row items-center"',
		);
		expect(flat(source)).toContain(
			'placement === "symmetric" || !hasInboxCount ? "flex-1"',
		);
		expect(flat(source)).toContain(
			"const hasInboxCount = inboxCount !== null && inboxCount > 0;",
		);
	});

	it("names the destination once (m-6)", () => {
		const rail = railSection();
		// The button and the measuring stand-in read the same constant…
		expect(rail.match(/\{RAIL_INBOX_LABEL\}/g) ?? []).toHaveLength(2);
		// …so no literal copy of the word survives in the row.
		expect(rail.match(/"Notifications"/g) ?? []).toHaveLength(0);
	});

	it("does not pin either side to a fixed width", () => {
		const rail = railSection();
		// `w-10` is the constant that clipped "99+" at 200 %; a fixed width in any
		// spacing step would reintroduce the same class of defect for a longer count.
		expect(rail).not.toMatch(/\bw-(?:[4-9]|1[0-9])\b/);
		expect(rail).not.toMatch(/\bmin-w-(?:[4-9]|1[0-9])\b/);
	});

	it("drops the mirror from the painted frame at the badge itself", () => {
		/* The invisibility has to be on the BADGE, not on a wrapper: a transparent
		 * wrapper leaves the badge inside it a painted node, and the audit read the
		 * mirrored count as a colour-only status (U-03, 270 rows) — a status with no
		 * word or name, because a spacer has none to give. With `opacity-0` on the
		 * badge, the probe's own visibility test drops it and only its text node
		 * remains, which carries its own text and is therefore not a suspect. */
		const component = source.slice(
			source.indexOf("const RailCount = ("),
			source.indexOf("export const ConversationsPane = ("),
		);
		// The wrapper is NOT the thing that disappears…
		expect(component).not.toMatch(/className=\{[^}]*opacity-0/);
		// …the badge it renders is.
		// The View's own `aria-hidden` is a different prop; the badge's `hidden` is
		// the one that must appear.
		expect(component.match(/\n\s+hidden=\{hidden\}/g) ?? []).toHaveLength(1);
		// And the rail passes it only from the mirror.
		expect(
			railSection().match(/<RailCount count=\{inboxCount\} hidden \/>/g) ?? [],
		).toHaveLength(1);

		const badge = readFileSync(
			new URL("../../ui/components/badge.tsx", import.meta.url),
			"utf8",
		);
		// The prop adds the class to the badge's own View and nothing else: the box
		// the mirror reserves is the badge it mirrors.
		expect(badge).toMatch(/hidden \? " opacity-0" : ""/);
	});

	it("keeps the count off the accessibility tree's second copy", () => {
		// A spacer is not content: the mirrored pill must be hidden from assistive
		// tech, or a screen reader would announce the count twice.
		const component = source.slice(
			source.indexOf("const RailCount = ("),
			source.indexOf("export const ConversationsPane = ("),
		);
		expect(component).toMatch(/accessibilityElementsHidden=\{hidden\}/);
		expect(component).toMatch(/importantForAccessibility=\{/);
	});

	it("still caps the numeral with the app's one label", () => {
		// The pill's text is `countLabel`, so a three-digit count reads 99+ in the
		// slot whose width the mirror has to match.
		const component = source.slice(
			source.indexOf("const RailCount = ("),
			source.indexOf("export const ConversationsPane = ("),
		);
		expect(component).toMatch(/label=\{countLabel\(count\)\}/);
	});
});

describe("the count the rail asks for", () => {
	it("is unread plus waiting, or nothing when the relay is silent", () => {
		expect(
			inboxBadgeCount({
				unread_count: 2,
				waiting_unread_count: 3,
			} as unknown as Parameters<typeof inboxBadgeCount>[0]),
		).toBe(5);
		// No block at all, and a block the relay could not read, are both "unknown":
		// no numeral rather than a zero the reader would trust.
		expect(inboxBadgeCount(null)).toBeNull();
		expect(
			inboxBadgeCount({} as unknown as Parameters<typeof inboxBadgeCount>[0]),
		).toBeNull();
	});
});
