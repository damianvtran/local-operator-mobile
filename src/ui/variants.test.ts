import { describe, expect, it } from "vitest";

import {
	avatarClasses,
	BUTTON_VISUAL_HEIGHT,
	badgeClasses,
	buttonClasses,
	chipClasses,
	emptyStateClasses,
	fieldClasses,
	listRowIndicator,
	SHEET_CONTENT_MAX_FRACTION,
	SHEET_DETENTS,
	segmentedItemClasses,
	segmentedLabelWeight,
	skeletonClasses,
	slopToFloor,
	TOUCH_FLOOR,
} from "@/ui/variants";

/**
 * The design system's decision table, tested in Node.
 *
 * These are the rules from docs/design/components.md that a screenshot does not
 * catch, either because the wrong value still looks plausible (disabled as
 * opacity looks *fine* on one ground and wrong on another) or because the failure
 * is a behaviour under a state nobody photographed (a row that is pending AND
 * streaming).
 */

describe("a component names a role, never a hue", () => {
	it("never emits a hex literal from the decision table", () => {
		// The systemic version of anti-pattern 1. Any variant that resolves to a
		// colour VALUE rather than a role is a defect, however good it looks.
		const table = [
			...(["primary", "outline", "quiet", "danger"] as const).flatMap(
				(variant) =>
					(["sm", "md", "lg", "icon", "fab"] as const).flatMap((size) =>
						(
							[
								{},
								{ pressed: true },
								{ disabled: true },
								{ pressed: true, disabled: true },
							] as const
						).map((state) => buttonClasses(variant, size, state)),
					),
			),
			fieldClasses("rest"),
			fieldClasses("invalid"),
			fieldClasses("disabled"),
			badgeClasses("danger"),
			chipClasses({ selected: true }),
			segmentedItemClasses({ selected: true }),
			avatarClasses("md"),
			skeletonClasses({ lines: 3 }),
			emptyStateClasses,
		];
		for (const classes of table) {
			expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
		}
	});
});

describe("button", () => {
	it("steps the colour on press and never scales (anti-pattern 3)", () => {
		const rest = buttonClasses("primary", "md", {});
		const pressed = buttonClasses("primary", "md", { pressed: true });
		expect(rest).toContain("bg-accent");
		expect(pressed).toContain("bg-accent-active");
		expect(pressed).not.toBe(rest);
	});

	it("changes colour rather than opacity when disabled (anti-pattern 4)", () => {
		const disabled = buttonClasses("primary", "md", { disabled: true });
		expect(disabled).toContain("text-ink-disabled");
		expect(disabled).not.toMatch(/opacity-/);
		// The failure the rule exists for: an opacity fade also fades the GROUND, so
		// the same button renders two unspecified colours on two surfaces.
		expect(disabled).not.toContain("bg-accent");
	});

	it("always carries a border, so a variant switch cannot resize the box", () => {
		// `border-transparent` where there is no visible border is what keeps the
		// geometry identical between variants.
		for (const variant of ["primary", "outline", "quiet", "danger"] as const) {
			expect(buttonClasses(variant, "md", {})).toMatch(/border-/);
		}
	});

	it("meets the touch floor, and meets it by slop at the one size below it", () => {
		expect(BUTTON_VISUAL_HEIGHT.md).toBeGreaterThanOrEqual(TOUCH_FLOOR);
		expect(BUTTON_VISUAL_HEIGHT.icon).toBe(TOUCH_FLOOR);
		expect(BUTTON_VISUAL_HEIGHT.sm).toBeLessThan(TOUCH_FLOOR);
		expect(slopToFloor(BUTTON_VISUAL_HEIGHT.sm)).toBe(6);
	});

	it("never emits a no-op when both pressed and disabled are true", () => {
		// A control that is both must read as disabled: the disabled binding wins,
		// or a press on a dead control looks like it did something.
		expect(
			buttonClasses("primary", "md", { pressed: true, disabled: true }),
		).toBe(buttonClasses("primary", "md", { disabled: true }));
	});
});

describe("fields", () => {
	it("sets every state at the 16pt floor that stops iOS zooming on focus", () => {
		for (const state of ["rest", "invalid", "disabled"] as const) {
			expect(fieldClasses(state)).toContain("text-body");
		}
	});

	it("is bounded by border-control where it is the field's only boundary", () => {
		expect(fieldClasses("rest")).toContain("border-border-control");
		expect(fieldClasses("invalid")).toContain("border-danger");
	});
});

describe("list row indicator ladder", () => {
	it("puts a pending decision above streaming", () => {
		// An approval gate runs inside a turn, so the row that most needs the reader
		// carries both. Testing streaming first swaps the danger pulse for a neutral
		// spinner on exactly that row.
		expect(
			listRowIndicator({ ready: true, pending: true, streaming: true }),
		).toBe("pending");
	});

	it("puts streaming above unread", () => {
		expect(
			listRowIndicator({ ready: true, streaming: true, unread: true }),
		).toBe("streaming");
	});

	it("falls through to unread, then to an empty slot", () => {
		expect(listRowIndicator({ ready: true, unread: true })).toBe("unread");
		expect(listRowIndicator({ ready: true })).toBe("none");
	});
});

describe("badge against chip", () => {
	it("gives the interactive one the 44pt target and the static one no target", () => {
		expect(chipClasses({})).toContain("min-h-11");
		expect(badgeClasses("neutral")).not.toContain("min-h-11");
	});

	it("keeps a badge off the interactive surfaces", () => {
		// A badge is resolved against the PAGE, not against its own fill, which is
		// the only reason its border/fill pair is legal.
		expect(badgeClasses("info")).toContain("bg-info-wash");
		expect(badgeClasses("info")).not.toContain("bg-surface");
	});
});

describe("sheet", () => {
	it("caps content detents at a fraction of the column, not the viewport", () => {
		expect(SHEET_DETENTS.content).toBeNull();
		expect(SHEET_CONTENT_MAX_FRACTION).toBe(0.6);
		expect(SHEET_DETENTS.half).toBeLessThan(SHEET_DETENTS.full as number);
	});
});

describe("skeleton", () => {
	it("rests on `elevated`, never on `sunken`", () => {
		// Measured: a `sunken` bar sits at ~1.3:1 and vanishes in a still frame, so
		// the loading state reads as an empty one — and the resting tone has to carry
		// it, because reduced motion removes the pulse first.
		expect(skeletonClasses({ lines: 3 })).toContain("bg-elevated");
		expect(skeletonClasses({ lines: 3 })).not.toContain("bg-sunken");
	});
});

describe("segmented control", () => {
	it("never signals selection with colour alone", () => {
		const selected = segmentedItemClasses({ selected: true });
		expect(selected).toContain("bg-accent-muted");
		expect(segmentedLabelWeight(true)).toBe("font-semibold");
		expect(segmentedLabelWeight(false)).toBe("font-normal");
	});
});

describe("empty state", () => {
	it("is not an error: no semantic danger binding anywhere in it", () => {
		expect(emptyStateClasses).not.toMatch(/danger|warning/);
	});
});
