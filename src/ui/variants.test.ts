import { describe, expect, it } from "vitest";
import { TYPE_STEPS } from "@/ui/tokens.gen";
import {
	avatarClasses,
	BUTTON_VISUAL_HEIGHT,
	badgeClasses,
	buttonClasses,
	chipClasses,
	emptyStateClasses,
	fieldClasses,
	listRowIndicator,
	segmentedItemClasses,
	segmentedLabelWeight,
	skeletonBarClasses,
	skeletonClasses,
	touchFloorFor,
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
		/* The ink is `ink-dim`, not `ink-disabled`: the audit measures a disabled
		 * label at 2.16-2.96:1 against every surface it can sit on, and a label that
		 * NAMES the action has to stay readable — the state is carried by the fill and
		 * the border. (This assertion used to pin `text-ink-disabled`, which is how a
		 * sub-3:1 disabled label survived a passing test.) */
		expect(disabled).toContain("text-ink-dim");
		expect(disabled).not.toContain("text-ink-disabled");
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

	it("states the floor per platform, which is the only floor rule in the kit", () => {
		/* One rule, two numbers, and the number a control needs depends on the
		 *  platform it renders on — the web build the audit measures takes 48, iOS 44.
		 *  This replaced a duplicate `TOUCH_FLOOR = 44` whose only effect could be a
		 *  control importing the wrong one. */
		expect(touchFloorFor("ios")).toBe(44);
		expect(touchFloorFor("other")).toBe(48);
	});

	it("keeps the visual sizes as designed, with the BOX raised to the floor", () => {
		/* The visual height is the pill; the pressable box is what a thumb and the
		 *  audit's target check see, and `button.tsx` raises it to `TOUCH_FLOOR`. `sm`
		 *  is the one size below the floor, and it is below on purpose. */
		// The visual is the pill as designed: `md` and `icon` sit at the iOS floor, and
		// the BOX (not this) is what the platform floor raises — 48 wherever Platform.OS
		// is not iOS, which includes the web build the audit measures.
		expect(BUTTON_VISUAL_HEIGHT.md).toBeGreaterThanOrEqual(
			touchFloorFor("ios"),
		);
		expect(BUTTON_VISUAL_HEIGHT.icon).toBeGreaterThanOrEqual(
			touchFloorFor("ios"),
		);
		expect(BUTTON_VISUAL_HEIGHT.sm).toBeLessThan(touchFloorFor("ios"));
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
		// Derived from the generated ramp, so a token change that shrinks `body`
		// below the floor fails here instead of shipping a zooming keyboard.
		expect(TYPE_STEPS.body.size).toBeGreaterThanOrEqual(16);
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
		// The tint alone is a ~1.0x luminance difference for a low-vision reader, so
		// the selected item must differ in a second channel: label weight.
		expect(segmentedLabelWeight(true)).not.toBe(segmentedLabelWeight(false));
		expect(segmentedItemClasses({ selected: true })).not.toBe(
			segmentedItemClasses({ selected: false }),
		);
	});
});

describe("empty state", () => {
	it("is not an error: no semantic danger binding anywhere in it", () => {
		expect(emptyStateClasses).not.toMatch(/danger|warning/);
	});
});

describe("skeleton bar classes", () => {
	it("carries exactly one width, whoever asks for what", () => {
		// The defect this holds shut: `w-full` appended after a caller's `w-16` won
		// on the rendered page (Tailwind resolves `w-*` by stylesheet order), so the
		// bar measured 0 px inside a content-sized pill and the loading chip painted
		// nothing (design round 2 D13 / QA round 4 Q1).
		for (const input of [
			undefined,
			{ barClassName: "h-3" },
			{ widthClassName: "w-24" },
			{ barClassName: "h-3", widthClassName: "w-7" },
		]) {
			const classes = skeletonBarClasses(input);
			expect(
				classes.match(/\bw-[a-z0-9[\]/.-]+/g) ?? [],
				JSON.stringify(input),
			).toHaveLength(1);
		}
	});

	it("uses the caller's width instead of the full-width default", () => {
		const classes = skeletonBarClasses({
			barClassName: "h-3",
			widthClassName: "w-24",
		});
		expect(classes).toContain("w-24");
		expect(classes).not.toContain("w-full");
		expect(classes).toContain("h-3");
	});

	it("defaults a list placeholder to the full width, once", () => {
		expect(skeletonBarClasses()).toBe("h-4 w-full rounded-sm");
	});
});
