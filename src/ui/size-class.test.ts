import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	type ComposerBox,
	compactChromeFor,
	compactChromeShare,
	composerAtHostCap,
	composerBudget,
	composerChromeKey,
	composerHostBound,
	composerLimit,
	computersHeaderStackWidth,
	HEADER_STACK_WIDTH,
	headerStacks,
	headerStackWidth,
	heldComposerLimit,
	layoutFor,
	pinnedRoutesPaneFloor,
	regionOrder,
	SIDEBAR_MIN_WIDTH,
	SIDEBAR_TABLET_MAX,
	SPLIT_MIN_HEIGHT,
	sameComposerBox,
	sessionStatusLayout,
	sidebarFooterScrolls,
	sidebarWidthFor,
	snapRegion,
	statusTrayVisible,
} from "@/ui/size-class";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { TOUCH_TARGET } from "@/ui/tokens.gen";
import { FIELD_BORDER_Y, touchFloorFor } from "@/ui/variants";

/**
 * The layout thresholds, and only the thresholds.
 *
 * Each case below is a decision a reviewer argues with, and the two that matter
 * most are the ones where width alone would get it wrong: a landscape PHONE is
 * wide and short, so it must not get two panes, and a tablet near the breakpoint
 * must not either. What is NOT here: any assertion about a rendered component,
 * which belongs to the capture harness in `tools/visual` where the frames and the
 * geometry come from the same run.
 */

/**
 * The composer's ceiling while the keyboard is up (TestFlight 753: "when I paste
 * images it pushes the composer send buttons below the bottom of the keyboard").
 *
 * The old keyboard bound was `window - overlap - 8`: the room from the window's
 * TOP to the keyboard, as if the composer's top were at 0. A composer whose top
 * sits under the header and the chrome (241 pt in the operator's screenshot)
 * was allowed 512 pt it did not have, so its controls row ran under the
 * keyboard. The ceiling is now `composerLimit` over the KEYBOARD-AWARE visible
 * height (`window - overlap`), through the same held-box rule the screen uses,
 * so the measurement still never depends on the output it controls.
 */
describe("the composer's ceiling above the keyboard (TestFlight 753)", () => {
	const GAP = 8;
	const floor = TOUCH_TARGET.ios;
	const PAD = 20; // `composerPad` for the portrait card.
	const CONTROLS = floor + 4; // `fixedRows`: the controls row + its gap.
	const box = (
		top: number,
		height: number,
		viewport: { width: number; height: number; keyboardOverlap: number },
		capped = false,
	): ComposerBox => ({
		top,
		height,
		capped,
		viewportWidth: viewport.width,
		viewportHeight: viewport.height,
		keyboardOverlap: viewport.keyboardOverlap,
	});

	it("binds at the keyboard's top, not the window's top (the screenshot's arithmetic)", () => {
		/* Screenshot: composer top 241, keyboard top 528 in an 844 pt window. */
		const viewport = { width: 390, height: 844, keyboardOverlap: 316 };
		const limit = heldComposerLimit(box(241, 600, viewport), viewport);
		expect(limit).toBe(287);
		expect(composerHostBound(limit ?? 0, GAP, floor)).toBe(279);
		/* The same box with the keyboard down fits the window, so stays unbound. */
		const down = { width: 390, height: 844, keyboardOverlap: 0 };
		expect(heldComposerLimit(box(241, 500, down), down)).toBe(null);
	});

	it("discards an uncapped box measured under another keyboard height, as it does another window", () => {
		/* An uncapped box rides the lift: its top is from a layout that no longer
		 *  exists, and holding it is the U1 fixed point. */
		const up = { width: 390, height: 844, keyboardOverlap: 336 };
		const down = { width: 390, height: 844, keyboardOverlap: 0 };
		expect(heldComposerLimit(box(600, 236, down), up)).toBe(null);
		expect(heldComposerLimit(box(400, 100, up, true), up)).toBe(108);
		expect(sameComposerBox(box(241, 279, up), box(241, 279, down))).toBe(false);
		/* Another window is still no measurement, capped or not. */
		expect(
			heldComposerLimit(box(241, 595, down, true), {
				...up,
				height: 800,
			}),
		).toBe(null);
	});

	/* TestFlight 836 (build 836, main eee80204): with the keyboard up and two
	 *  pasted images, the composer froze at ~108 pt — two lines of draft, the
	 *  thumbnails clipped out of a zero-height extras scroller — while the
	 *  transcript still had half the screen. Read off the screenshot at 393x852:
	 *  composer top 417, keyboard top 533. */
	describe("a capped composer is not a fixed point while the transcript can still yield", () => {
		const viewport = { width: 393, height: 852, keyboardOverlap: 319 };
		const visible = viewport.height - viewport.keyboardOverlap;
		const CHROME_BOTTOM = 150; // where the transcript starts (header + safe area)

		/* One settle loop of the real pieces: the host's limit from the held box,
		 *  the composer painting `min(natural, bound)` bottom-anchored above the
		 *  keyboard, and the transcript taking whatever is left above it. */
		const settle = (natural: number, start: ComposerBox, passes = 12) => {
			let held = start;
			const heights: number[] = [];
			for (let i = 0; i < passes; i++) {
				const slack = Math.max(0, held.top - CHROME_BOTTOM);
				const limit = heldComposerLimit(held, {
					...viewport,
					transcriptSlack: slack,
				});
				const bound =
					limit === null
						? Number.POSITIVE_INFINITY
						: composerHostBound(limit, GAP, floor);
				const room = visible - GAP - CHROME_BOTTOM;
				const height = Math.min(natural, bound, room);
				heights.push(height);
				held = box(
					visible - GAP - height,
					height,
					viewport,
					composerAtHostCap(height, limit, GAP, floor),
				);
			}
			return heights;
		};

		it("the stale bound alone holds the frozen height (the defect, slack unknown)", () => {
			const frozen = box(417, 108, viewport, true);
			expect(heldComposerLimit(frozen, viewport)).toBe(116);
		});

		it("measures the ceiling from the transcript's top, so the frozen box can grow", () => {
			const frozen = box(417, 108, viewport, true);
			const limit = heldComposerLimit(frozen, {
				...viewport,
				transcriptSlack: 417 - CHROME_BOTTOM,
			});
			expect(limit).toBe(visible - CHROME_BOTTOM);
		});

		it("a frozen composer whose content fits grows to it and stays there", () => {
			/* 8 lines (208) + thumbnails (88) + controls (48) + padding (20). */
			const natural = 208 + 88 + CONTROLS + PAD;
			const heights = settle(natural, box(417, 108, viewport, true));
			expect(heights.at(-1)).toBe(natural);
			expect(new Set(heights.slice(-4)).size).toBe(1);
		});

		/* The paste half of the same report: the two images WERE in state (they
		 *  appeared a minute later, unchanged) but the extras scroller is capped
		 *  by `composerBudget`, and a budget spent from the frozen bound has no
		 *  room for the strip, so it painted at height 0. */
		it("gives a pasted strip its height once the stale bound lets go", () => {
			const STRIP = 88; // 64 pt thumbnails + their meta line + `pb-2`
			const frozenBound = composerHostBound(116, GAP, floor);
			expect(
				composerBudget(frozenBound, CONTROLS, STRIP, floor, PAD).extras,
			).toBe(0);
			const limit = heldComposerLimit(box(417, 108, viewport, true), {
				...viewport,
				transcriptSlack: 417 - CHROME_BOTTOM,
			});
			const bound = composerHostBound(limit ?? 0, GAP, floor);
			const budget = composerBudget(bound, CONTROLS, STRIP, floor, PAD);
			expect(budget.extras).toBe(STRIP);
			/* ...and the field keeps room for more than the two lines it showed. */
			expect(budget.field).toBeGreaterThanOrEqual(5 * 24 + 16);
		});

		it("content past the room binds at the chrome and holds without oscillating", () => {
			const heights = settle(900, box(417, 108, viewport, true));
			const room = visible - GAP - CHROME_BOTTOM;
			expect(heights.at(-1)).toBe(room);
			expect(new Set(heights.slice(-4)).size).toBe(1);
		});

		/* PR #230 review m1: a defensive pin, not a native ordering. On Fabric
		 *  (RN 0.86) `measureInWindow` calls back synchronously from the current
		 *  shadow-tree revision (`NativeDOM.cpp:434-447`), and the composer
		 *  publishes inside its own `onLayout`, so in a settled state the top is
		 *  never older than the slack. The real stale-top window is the keyboard
		 *  lift, where the composer suppresses its mid-lift publish on purpose
		 *  (covered by "through the keyboard lift" above). Should any pass still
		 *  pair a fresh slack with an older top, this pins that it costs at most
		 *  one off frame (`375,108,375,…`) and then holds, rather than staying
		 *  bound. */
		it("one pass whose top is older than the slack recovers on the next paired pass", () => {
			const room = visible - GAP - CHROME_BOTTOM;
			let held = box(417, 108, viewport, true);
			let previous = held;
			const heights: number[] = [];
			for (let i = 0; i < 12; i++) {
				// Pass 1 reads pass 0's fresh slack against the top from before it.
				const top = i === 1 ? previous : held;
				const limit = heldComposerLimit(top, {
					...viewport,
					transcriptSlack: Math.max(0, held.top - CHROME_BOTTOM),
				});
				const bound =
					limit === null
						? Number.POSITIVE_INFINITY
						: composerHostBound(limit, GAP, floor);
				const height = Math.min(900, bound, room);
				heights.push(height);
				previous = held;
				held = box(
					visible - GAP - height,
					height,
					viewport,
					composerAtHostCap(height, limit, GAP, floor),
				);
			}
			expect(heights.slice(0, 3)).toEqual([room, 108, room]);
			expect(new Set(heights.slice(2))).toEqual(new Set([room]));
		});
	});

	/* PR #216 review m1: the store reaches the new overlap at the native event,
	 *  the matching box only when the lift lands. A CAPPED box is pinned at the
	 *  chrome, which the keyboard does not move, so it keeps the settled bound
	 *  for the NEW keyboard through the animation instead of none. */
	it("bounds a capped box for the new keyboard through the lift", () => {
		const down = { width: 390, height: 844, keyboardOverlap: 0 };
		const up = { width: 390, height: 844, keyboardOverlap: 316 };
		/* The screenshot: a long draft capped at the chrome (top 241). */
		expect(heldComposerLimit(box(241, 595, down, true), up)).toBe(287);
		/* The same number the settled box gives: no flash when it lands. */
		expect(heldComposerLimit(box(241, 279, up, true), up)).toBe(287);
		/* And back down. */
		expect(heldComposerLimit(box(241, 279, up, true), down)).toBe(603);
	});

	/* The lift over time, with the REAL functions: the screen holds the last
	 *  box the composer published, and the composer publishes only when its
	 *  lift sits at the frame's overlap (mid-lift layouts are not published).
	 *  Layout model: bottom = window - lift - gap; a box taller than the room
	 *  under the chrome overflows downward. */
	const simulate = (
		H: number,
		chromeTop: number,
		natural: number,
		overlaps: number[],
	) => {
		const vp = (overlap: number) => ({
			width: 390,
			height: H,
			keyboardOverlap: overlap,
		});
		let held: ComposerBox | null = null;
		const paint = (overlap: number, lift: number) => {
			const limit = heldComposerLimit(held, vp(overlap));
			const bound =
				limit === null
					? Number.POSITIVE_INFINITY
					: composerHostBound(limit, GAP, floor);
			const height = Math.min(natural, bound);
			const bottom = Math.max(H - lift - GAP, chromeTop + height);
			return { limit, height, top: bottom - height, bottom };
		};
		const settle = (overlap: number) => {
			const passes: ReturnType<typeof paint>[] = [];
			for (let pass = 0; pass < 12; pass++) {
				const p = paint(overlap, overlap);
				passes.push(p);
				held = {
					top: p.top,
					height: p.height,
					capped: composerAtHostCap(p.height, p.limit, GAP, floor),
					viewportWidth: 390,
					viewportHeight: H,
					keyboardOverlap: overlap,
				};
			}
			return passes;
		};
		const steps: {
			overlap: number;
			settled: ReturnType<typeof paint>;
			lifting: number[];
			stable: boolean;
		}[] = [];
		let from = overlaps[0] ?? 0;
		settle(from);
		for (const overlap of overlaps.slice(1)) {
			/* The animation: the store is at `overlap`, the lift on its way. */
			const lifting = [0, 0.25, 0.5, 0.75].map(
				(k) => paint(overlap, from + (overlap - from) * k).height,
			);
			const passes = settle(overlap);
			const last = passes.at(-1);
			if (!last) throw new Error("no passes");
			steps.push({
				overlap,
				settled: last,
				lifting,
				stable: passes
					.slice(1)
					.every((p) => p.height === last.height && p.top === last.top),
			});
			from = overlap;
		}
		return steps;
	};

	it.each([
		["screenshot, long draft", 844, 241, 700],
		["screenshot, edge draft", 844, 241, 283],
		["short draft", 844, 241, 140],
		["probe 844/201, very long draft", 844, 201, 1011],
		["Android 800/120", 800, 120, 642],
		["probe 568/314 (floor)", 568, 314, 425],
	])(
		"%s: show, hide and height changes never grow the box past the new keyboard or oscillate",
		(_name, H, chromeTop, natural) => {
			const sequence = [0, 316, 336, 316, 0, 336, 0, 260, 0];
			const steps = simulate(H, chromeTop, natural, sequence);
			for (const [index, step] of steps.entries()) {
				expect(step.stable).toBe(true);
				const settled = step.settled.height;
				/* Settled: above the keyboard's top (a box that just fits may eat
				 *  its gap: `composerLimit`'s overflow test) or at the one-control
				 *  floor, where the geometry has no room at all — pre-existing,
				 *  review round 1. */
				if (settled > floor)
					expect(step.settled.bottom).toBeLessThanOrEqual(H - step.overlap);
				/* Through the lift: never taller than the larger of the settled
				 *  boxes either side of it, so a long draft cannot grow under the
				 *  keyboard and snap back (m1: it grew to `natural`). */
				const before =
					index === 0
						? Math.min(natural, H - chromeTop - GAP)
						: (steps[index - 1]?.settled.height ?? 0);
				for (const height of step.lifting)
					expect(height).toBeLessThanOrEqual(Math.max(before, settled));
				/* The same keyboard gives the same box every time, up to the dock's
				 *  gap: no latch. The one difference is `composerLimit`'s own band
				 *  at the edge (edge draft, 283 at 316: unbound eating its gap,
				 *  bottom 524, when it arrives from below; capped at 279, bottom
				 *  520, when it arrives capped from 336), the same hysteresis a
				 *  draft has against the window bottom. Both end above the
				 *  keyboard, asserted above. */
				const first = steps.find((s) => s.overlap === step.overlap);
				expect(
					Math.abs((first?.settled.height ?? 0) - settled),
				).toBeLessThanOrEqual(GAP);
			}
			/* Keyboard down at the end: the box is back to its resting size. */
			expect(steps.at(-1)?.settled.height).toBe(
				Math.min(
					natural,
					heldComposerLimit(null, { width: 390, height: H }) ?? natural,
					composerHostBound(H - chromeTop, GAP, floor),
				),
			);
		},
	);

	/* The controls row (attach, paste, mic, Stop, Send) is what the bound exists
	 *  to keep on screen: under a binding cap the FIELD and the EXTRAS scroll,
	 *  never it. Model of the portrait card: padding, field, extras (the
	 *  attachment strip), then the controls row, bottom-anchored on its gap. */
	const controlsBottom = (
		viewport: { width: number; height: number; keyboardOverlap: number },
		chromeTop: number,
		naturalField: number,
		naturalExtras: number,
	) => {
		const natural = PAD + naturalField + naturalExtras + CONTROLS;
		const visible = viewport.height - viewport.keyboardOverlap;
		/* Unbound first paint: the composer grows down from the chrome (the
		 *  transcript above it is already 0 tall) or rests on its gap. */
		const top = Math.max(chromeTop, visible - GAP - natural);
		const limit = heldComposerLimit(box(top, natural, viewport), viewport);
		if (limit === null) return { bottom: top + natural - PAD / 2, visible };
		const bound = composerHostBound(limit, GAP, floor);
		const budget = composerBudget(bound, CONTROLS, naturalExtras, floor, PAD);
		const height =
			PAD +
			Math.min(naturalField, budget.field + FIELD_BORDER_Y) +
			budget.extras +
			CONTROLS;
		expect(height).toBeLessThanOrEqual(bound);
		/* The controls row's bottom: the box's bottom less its bottom padding. */
		return { bottom: top + height - PAD / 2, visible, budget };
	};

	it.each([
		["iPhone, one image, long draft", 844, 336, 241, 72],
		["iPhone, two images, long draft", 844, 336, 241, 144],
		["Android 800 window, one image", 800, 300, 120, 72],
		["Android 800 window, two images", 800, 300, 120, 144],
	])(
		"%s: the controls row ends above the keyboard",
		(_name, h, kb, chromeTop, extras) => {
			const viewport = { width: 390, height: h, keyboardOverlap: kb };
			const { bottom, visible, budget } = controlsBottom(
				viewport,
				chromeTop,
				12 * 22, // A long draft: twelve lines.
				extras,
			);
			expect(budget).toBeDefined();
			expect(bottom).toBeLessThanOrEqual(visible - GAP);
			/* The field keeps at least one touch row of its own. */
			expect((budget?.field ?? 0) + FIELD_BORDER_Y).toBeGreaterThanOrEqual(
				floor,
			);
		},
	);

	it("a short draft with the keyboard up stays unbound and above the keyboard", () => {
		const viewport = { width: 390, height: 844, keyboardOverlap: 336 };
		const { bottom, visible, budget } = controlsBottom(viewport, 241, 44, 0);
		expect(budget).toBeUndefined();
		expect(bottom).toBeLessThanOrEqual(visible - GAP);
	});

	/* PR #230 review round 2, M2: the lift is the one window where the two
	 *  inputs of `top - slack` come from different layouts. The composer does
	 *  not publish mid-lift (`publishBox`), so the held `top` is frozen at the
	 *  last settled layout; the transcript's `onLayout` still fires on every
	 *  pass of the animated `marginBottom`, and its height depends on the
	 *  composer's own painted height H. A fresh slack against a frozen top made
	 *  the limit an output of itself and a capped composer alternated by up to
	 *  ~240 pt through the lift (`375,615,375,547,…`). The model: 393×852, a
	 *  319 pt keyboard, chrome ending at 150, an ease-out lift; the composer
	 *  paints bottom-anchored at `window - k - gap` and the column can never
	 *  give it more than `window - k - gap - chrome`. */
	describe("through the keyboard lift (PR #230 R2 M2)", () => {
		const VW = 393;
		const VH = 852;
		const KB = 319;
		const CHROME = 150;
		const liftBox = (
			top: number,
			height: number,
			overlap: number,
			capped: boolean,
		): ComposerBox => ({
			top,
			height,
			capped,
			keyboardOverlap: overlap,
			viewportWidth: VW,
			viewportHeight: VH,
		});
		const ease = (from: number, to: number, n: number) =>
			Array.from({ length: n }, (_, i) =>
				Math.round(from + (to - from) * (1 - (1 - (i + 1) / n) ** 2)),
			);
		type Phase = { frames: number[]; target: number };
		/* One layout pass per frame (the reviewer's model also ran two; the
		 *  flip is the same). `freezeSlack` is the screen's wiring: while the
		 *  composer reports it is lifting, `[id].tsx` passes the slack it held
		 *  when the lift began instead of the transcript's fresh `onLayout`. */
		const lift = (
			natural: number,
			start: ComposerBox,
			phases: Phase[],
			freezeSlack: boolean,
		) => {
			let held = start;
			let H = start.height;
			const settledSlack = Math.max(0, start.top - CHROME);
			const heights: number[][] = [];
			for (const { frames, target } of phases) {
				const phase: number[] = [];
				heights.push(phase);
				for (const k of frames) {
					const fresh = Math.max(0, VH - k - GAP - H - CHROME);
					const lifting = k !== target;
					const limit = heldComposerLimit(held, {
						width: VW,
						height: VH,
						keyboardOverlap: target,
						transcriptSlack: freezeSlack && lifting ? settledSlack : fresh,
					});
					const bound =
						limit === null
							? Number.POSITIVE_INFINITY
							: composerHostBound(limit, GAP, floor);
					H = Math.min(natural, bound, VH - k - GAP - CHROME);
					phase.push(H);
					/* Published only once the lift lands (`publishBox`). */
					if (!lifting)
						held = liftBox(
							VH - k - GAP - H,
							H,
							k,
							composerAtHostCap(H, limit, GAP, floor),
						);
				}
			}
			return heights;
		};
		/* "No a,b,a": within one phase (one keyboard direction) consecutive
		 *  deltas never change sign. A reversal AT a phase boundary is the
		 *  keyboard turning round, which the height should follow. */
		const flips = (phases: number[][]) =>
			phases.reduce((n, phase) => n + phaseFlips(phase), 0);
		const phaseFlips = (heights: number[]) => {
			const deltas = heights
				.slice(1)
				.map((h, i) => Math.sign(h - (heights[i] ?? h)))
				.filter((d) => d !== 0);
			return deltas.slice(1).filter((d, i) => d !== deltas[i]).length;
		};
		const room = VH - KB - GAP - CHROME; // 375
		const roomDown = VH - GAP - CHROME; // 694

		it("a box capped at keyboard-down shrinks monotonically to the room", () => {
			const heights = lift(
				900,
				liftBox(CHROME, roomDown, 0, true),
				[{ frames: ease(0, KB, 15), target: KB }],
				true,
			);
			expect(flips(heights)).toBe(0);
			expect(heights.flat().at(-1)).toBe(room);
		});

		/* Fix 1 is in `heldComposerLimit` itself: the through-the-lift branch
		 *  holds `box.top`, so even a FRESH slack cannot feed back there. */
		it("the through-the-lift branch ignores a fresh slack", () => {
			const heights = lift(
				900,
				liftBox(CHROME, roomDown, 0, true),
				[{ frames: ease(0, KB, 15), target: KB }],
				false,
			);
			expect(flips(heights)).toBe(0);
			expect(heights.flat().at(-1)).toBe(room);
		});

		/* The paste prompt's hide/re-show: the keyboard heads for 0, is
		 *  interrupted at 200 and returns to 319. The re-show is the LIVE branch
		 *  (the store's overlap matches the held box again), so only the
		 *  screen's frozen slack keeps it flat. */
		it("an interrupted 319 → 200 → 319 bounce does not flicker", () => {
			const start = liftBox(CHROME, room, KB, true);
			const phases = [
				{ frames: ease(KB, 200, 6), target: 0 },
				{ frames: ease(200, KB, 8), target: KB },
			];
			const heights = lift(900, start, phases, true);
			expect(flips(heights)).toBe(0);
			expect(heights.flat().at(-1)).toBe(room);
			/* Negative control: the same path with the fresh slack the screen
			 *  passed before this fix alternates. */
			expect(flips(lift(900, start, phases, false))).toBeGreaterThan(0);
		});

		it("an uncapped draft still rides the lift without flicker", () => {
			const heights = lift(
				500,
				liftBox(VH - GAP - 500, 500, 0, false),
				[{ frames: ease(0, KB, 15), target: KB }],
				true,
			);
			expect(flips(heights)).toBe(0);
			expect(heights.flat().at(-1)).toBe(room);
		});
	});
});

describe("sidebarFooterScrolls", () => {
	it("reserves list space on short portrait even before the large-text step", () => {
		/* Actual ordinary-app CI at 320×568 measured listClientHeight=0 at
		 * 100% and 135% with the richer rail. 200% already takes the scroller;
		 * the policy must not make smaller text less reachable than large text. */
		for (const routes of [6, 7]) {
			for (const largeText of [false, true]) {
				expect(
					sidebarFooterScrolls(layoutFor(320, 568), { routes, largeText }),
				).toBe(true);
			}
		}
		/* This is route pressure, not an unconditional compact-phone rule. */
		expect(
			sidebarFooterScrolls(layoutFor(320, 568), {
				routes: 5,
				largeText: false,
			}),
		).toBe(false);
		for (const [width, height] of [
			[390, 844],
			[834, 1112],
			[1112, 834],
		] as const) {
			expect(
				sidebarFooterScrolls(layoutFor(width, height), {
					routes: 7,
					largeText: false,
				}),
			).toBe(false);
		}
	});
	it("scrolls the routes when large text would take the list's height", () => {
		/* The measured case: 320 × 568 at 200 % left the list 60 pt, so the first
		 *  row sat below the fold and two distinct states photographed as one. */
		expect(
			sidebarFooterScrolls(layoutFor(320, 568), { largeText: true, routes: 6 }),
		).toBe(true);
		/* Roomy panes keep the pinned footer even at large text. */
		expect(
			sidebarFooterScrolls(layoutFor(390, 844), { largeText: true, routes: 6 }),
		).toBe(false);
		expect(
			sidebarFooterScrolls(layoutFor(834, 1112), {
				largeText: true,
				routes: 6,
			}),
		).toBe(false);
		/* A rich footer can exhaust this pane even at ordinary text sizes. */
		expect(
			sidebarFooterScrolls(layoutFor(320, 568), {
				largeText: false,
				routes: 6,
			}),
		).toBe(true);
	});

	it("leaves a relay without the inbox on the routes it pinned before (R7-01)", () => {
		/* Five destinations are the shape main ships, and they fit a 568 pt pane at
		 *  large text (measured: the list keeps 116 pt and the row is visible), so a
		 *  relay that does not advertise the inbox must see NO change. */
		expect(
			sidebarFooterScrolls(layoutFor(320, 568), { largeText: true, routes: 5 }),
		).toBe(false);
		for (const height of [640, 667, 700, 844]) {
			expect(
				sidebarFooterScrolls(layoutFor(320, height), {
					largeText: true,
					routes: 5,
				}),
			).toBe(false);
		}
		/* The sixth destination is what crosses the floor on the same pane, and the
		 *  floor is one row per destination above five. */
		expect(pinnedRoutesPaneFloor(5)).toBe(568);
		expect(pinnedRoutesPaneFloor(6)).toBe(628);
		expect(
			sidebarFooterScrolls(layoutFor(320, 640), { largeText: true, routes: 6 }),
		).toBe(false);
	});

	it("preserves rows in short landscape without changing portrait or tablet flow", () => {
		/* `routes` is REQUIRED (code review round 8, R8-05): a default would let a
		 *  stray call silently pick the strictest floor, which is the one case this
		 *  rule exists to leave alone. */
		for (const routes of [5, 6]) {
			expect(sidebarFooterScrolls(layoutFor(844, 390), { routes })).toBe(true);
			expect(sidebarFooterScrolls(layoutFor(568, 320), { routes })).toBe(true);
			for (const [width, height] of [
				[390, 844],
				[320, 568],
				[834, 1112],
				[1112, 834],
			] as const) {
				expect(sidebarFooterScrolls(layoutFor(width, height), { routes })).toBe(
					routes >= 6 && height < pinnedRoutesPaneFloor(routes),
				);
			}
		}
	});
});

describe("layoutFor", () => {
	it("calls a phone compact at every phone size the matrix covers", () => {
		for (const [w, h] of [
			[320, 568],
			[360, 780],
			[390, 844],
			[430, 932],
		] as const) {
			const layout = layoutFor(w, h);
			expect(layout.sizeClass).toBe("compact");
			// A phone is its own measure: a cap would only add margins.
			expect(layout.measure).toBeNull();
			expect(layout.split).toBe(false);
		}
	});

	it("caps the column on a tablet, portrait and landscape differently", () => {
		// The cap is a MEASURE, not a fraction: a wider tablet must not get a wider
		// column, which is the defect the cap exists to prevent.
		const portrait = layoutFor(834, 1112);
		const landscape = layoutFor(1112, 834);
		expect(portrait.sizeClass).toBe("regular");
		expect(portrait.measure).toBe(560);
		expect(landscape.measure).toBe(640);
		expect(landscape.orientation).toBe("landscape");
	});

	it("splits only when there is room in BOTH directions", () => {
		// The rule the brief calls out: 844x390 and 915x412 are landscape phones, wide
		// and short, where two panes are two slivers under the keyboard.
		expect(layoutFor(844, 390).split).toBe(false);
		expect(layoutFor(915, 412).split).toBe(false);
		// And a wide window that is merely short is still not a split.
		expect(layoutFor(1440, SPLIT_MIN_HEIGHT - 1).split).toBe(false);
		// A large tablet is, in both orientations.
		expect(layoutFor(1366, 1024).split).toBe(true);
		expect(layoutFor(1112, 834).split).toBe(true);
		// 834x1112 is regular width but under the split width: one column, capped.
		expect(layoutFor(834, 1112).split).toBe(false);
	});
	it("drives the cap opt-out from the same two values the split uses", () => {
		/* `Screen`'s `capColumn={!split}` reads exactly these, so this pins the pair
		 *  a reviewer argues with: the split sizes DO carry a measure (the cap moves
		 *  from the screen into the detail pane), and every single-column size keeps
		 *  its own — including a landscape phone, which is wide enough to lose the
		 *  cap by accident and must not. */
		/* 1024x768 is read as LANDSCAPE by the width rule (1024 > 768) and therefore
		 *  takes the landscape-tablet measure, not the portrait one. Worth stating:
		 *  the only sizes that split today are LANDSCAPE tablets — a true portrait
		 *  tablet (768x1024) is under `SPLIT_MIN_WIDTH` and stays one column. */
		expect(layoutFor(1024, 768)).toMatchObject({ split: true, measure: 640 });
		expect(layoutFor(1366, 1024)).toMatchObject({ split: true, measure: 640 });
		expect(layoutFor(768, 1024)).toMatchObject({ split: false, measure: 560 });
		expect(layoutFor(844, 390)).toMatchObject({ split: false, measure: 620 });
		expect(layoutFor(390, 844).measure).toBeNull();
	});
});

describe("headerStacks", () => {
	it("stacks at the narrowest phone even at 100 % text", () => {
		/* The width trigger (D1): the busiest header's chrome (248 dp) plus its
		 *  title (106 dp) cannot fit below 354 dp — measured at 320 pt, where the
		 *  title rendered "Ses…" (clientW 72, scrollW 106). */
		expect(headerStacks(1, 320)).toBe(true);
		expect(headerStacks(1, HEADER_STACK_WIDTH - 1)).toBe(true);
	});

	it("keeps one line where the title fits — the sizes the matrix covers", () => {
		expect(headerStacks(1, HEADER_STACK_WIDTH)).toBe(false);
		expect(headerStacks(1, 360)).toBe(false);
		expect(headerStacks(1, 390)).toBe(false);
		expect(headerStacks(1, 430)).toBe(false);
	});

	it("stacks at large text at every width, exactly above the threshold", () => {
		expect(headerStacks(LARGE_TEXT_SCALE, 390)).toBe(false);
		expect(headerStacks(LARGE_TEXT_SCALE + 0.01, 390)).toBe(true);
		expect(headerStacks(2, 320)).toBe(true);
	});

	it("takes the bound a screen passes for its own cluster", () => {
		/* Round 2 (R2-1): a screen whose action cluster is heavier than the kit
		 *  floor passes its live fit as the third argument; callers that pass
		 *  nothing keep the behaviour pinned above. */
		expect(headerStacks(1, 390, 383)).toBe(false);
		expect(headerStacks(1, 390, 397)).toBe(true);
		expect(headerStacks(1, HEADER_STACK_WIDTH)).toBe(false);
	});
});

describe("headerStackWidth", () => {
	/* The round-2 re-derivation (R2-1). The kit floor covers the r1 frame — one
	 *  asks badge; the merged header can carry TWO count badges, and this is the
	 *  live fit the sessions screen passes. Every number is a round-2 probe
	 *  reading; the sum rounds up, so the bound errs toward stacking early. */

	it("reproduces the kit constant for the r1 frame, and floors lighter sets", () => {
		expect(headerStackWidth(null, 4)).toBe(HEADER_STACK_WIDTH);
		expect(headerStackWidth(null, 0)).toBe(HEADER_STACK_WIDTH);
		expect(headerStackWidth(0, 0)).toBe(HEADER_STACK_WIDTH);
		expect(headerStackWidth(99, 0)).toBe(HEADER_STACK_WIDTH);
	});

	it("raises the bound for the merged header's two badges", () => {
		/* Measured before the fix: with both badges at 2-digit counts the title
		 *  clipped at 360 (69/106), 375 (84/106) and 390 (99/106). */
		const both = headerStackWidth(99, 99);
		expect(both).toBe(397);
		for (const width of [360, 375, 390]) {
			expect(headerStacks(1, width, both)).toBe(true);
		}
		expect(headerStacks(1, 430, both)).toBe(false);
	});

	it("keeps 390 single-line at one-digit counts, and fixes 360/375", () => {
		const pair = headerStackWidth(9, 9);
		expect(pair).toBe(383);
		expect(headerStacks(1, 390, pair)).toBe(false);
		expect(headerStacks(1, 375, pair)).toBe(true);
		expect(headerStacks(1, 360, pair)).toBe(true);
	});

	it("widens with further digits rather than clamping", () => {
		expect(headerStackWidth(100, 99)).toBeGreaterThan(headerStackWidth(99, 99));
		expect(headerStackWidth(9, 100)).toBeGreaterThan(headerStackWidth(9, 99));
	});
});

describe("compactChromeFor", () => {
	const screen = (width: number, height: number) => ({ width, height });

	it("is on for a phone physically on its side, at every short landscape size", () => {
		for (const [w, h] of [
			[844, 390],
			[915, 412],
			[568, 320],
		] as const) {
			expect(
				compactChromeFor({ window: screen(w, h), screen: screen(w, h) }),
			).toBe(true);
		}
	});

	it("stays off for portrait phones and portrait tablets", () => {
		for (const [w, h] of [
			[390, 844],
			[320, 568],
			[834, 1112],
		] as const) {
			expect(
				compactChromeFor({ window: screen(w, h), screen: screen(w, h) }),
			).toBe(false);
		}
	});

	it("stays off for a landscape tablet that has the room", () => {
		expect(
			compactChromeFor({
				window: screen(1112, 834),
				screen: screen(1112, 834),
			}),
		).toBe(false);
		expect(
			compactChromeFor({
				window: screen(1366, 1024),
				screen: screen(1366, 1024),
			}),
		).toBe(false);
	});

	it("is NOT fooled by a keyboard-shortened portrait window", () => {
		// 390x844 portrait with the keyboard up: the WINDOW is 390x300 (wider than
		// tall) but the physical screen is still portrait. Deciding from the window
		// would flip the whole screen to the landscape layout on every keystroke.
		expect(
			compactChromeFor({ window: screen(390, 300), screen: screen(390, 844) }),
		).toBe(false);
		expect(
			compactChromeFor({ window: screen(320, 200), screen: screen(320, 568) }),
		).toBe(false);
	});

	it("stays off for a portrait-SHAPED window even on a landscape screen (floating window)", () => {
		expect(
			compactChromeFor({ window: screen(400, 600), screen: screen(1112, 834) }),
		).toBe(false);
	});

	it("keeps the compact form while a landscape keyboard shortens the window further", () => {
		expect(
			compactChromeFor({ window: screen(844, 200), screen: screen(844, 390) }),
		).toBe(true);
	});
});

describe("compact secondary region", () => {
	it("shrinks its share as text grows, inside the 0.27-0.34 band", () => {
		expect(compactChromeShare(1)).toBeCloseTo(0.34);
		expect(compactChromeShare(1.5)).toBeCloseTo(0.305);
		expect(compactChromeShare(2)).toBeCloseTo(0.27);
		expect(compactChromeShare(3)).toBeCloseTo(0.27);
		expect(compactChromeShare(0.5)).toBeCloseTo(0.34);
	});

	it("keeps the transcript at >= 96 pt at 844x390 for 100 %, 150 % and 200 % text", () => {
		// header + composer measured on the rig: 157 / 161 / 177 pt, plus the 4 pt gap.
		for (const [scale, fixed] of [
			[1, 157],
			[1.5, 161],
			[2, 177],
		] as const) {
			const region = Math.round(390 * compactChromeShare(scale));
			expect(390 - fixed - 4 - region).toBeGreaterThanOrEqual(96);
		}
	});

	it("cuts on a row boundary and reports what is hidden", () => {
		expect(snapRegion([49, 72, 52, 44], 400, 24)).toEqual({
			height: 217,
			hidden: 0,
		});
		expect(snapRegion([49, 72, 52, 44], 117, 24)).toEqual({
			height: 49,
			hidden: 3,
		});
		expect(snapRegion([49, 72, 52, 44], 150, 24)).toEqual({
			height: 121,
			hidden: 2,
		});
	});

	it("shows the first row whole when the cap holds it, even if the cue then no longer fits", () => {
		// a wrapped roster header (89 pt) in a 111 pt cap with a 48 pt cue: 111 - 48 = 63 < 89
		expect(snapRegion([89, 44, 52], 111, 48)).toEqual({
			height: 89,
			hidden: 2,
		});
	});

	it("shows neither region nor cue when the cap cannot hold a readable line (UX U3)", () => {
		// the 7.4 pt sliver measured at a 200 pt keyboard-shortened window
		expect(snapRegion([89, 44], 7, 38)).toEqual({ height: 0, hidden: 2 });
		expect(snapRegion([89, 44], 39, 38)).toEqual({ height: 0, hidden: 2 });
		// the 844x200 keyboard-shortened window: a 54 pt cap less the 38 pt cue is 16 pt
		expect(snapRegion([49, 44], 54, 38)).toEqual({ height: 0, hidden: 2 });
	});

	it("only cuts a first row that is taller than the whole cap", () => {
		expect(snapRegion([200, 40], 117, 24)).toEqual({ height: 117, hidden: 1 });
	});

	it("ignores rows that are not rendered", () => {
		expect(snapRegion([0, 49, 0, 52], 117, 24)).toEqual({
			height: 101,
			hidden: 0,
		});
	});
});

describe("regionOrder", () => {
	it("keeps the wide column's order exactly", () => {
		expect(regionOrder(false, false)).toEqual([
			"todos",
			"subagents",
			"working",
		]);
		expect(regionOrder(false, true)).toEqual(["todos", "subagents", "working"]);
	});

	it("leads the compact region with live work, the strip before the tasks list", () => {
		expect(regionOrder(true, false)).toEqual([
			"working",
			"subagents",
			"strip",
			"todos",
		]);
	});

	it("lifts a roster with a failed or parked child above the working line", () => {
		expect(regionOrder(true, true)).toEqual([
			"subagents",
			"working",
			"strip",
			"todos",
		]);
	});
});

describe("composerLimit (D-c: portrait is bounded by the window too)", () => {
	it("answers only when the composer reaches the window's bottom", () => {
		// The recheck's exact frame: 320x568, composer 314.4 + 424.8 = 739.2
		expect(composerLimit(568, 314, 425)).toBe(254);
		expect(composerLimit(844, 470, 400)).toBe(374);
	});

	it("has no answer before the first measurement, or while it still fits", () => {
		expect(composerLimit(568, null, null)).toBe(null);
		// 100 % portrait: the composer still sits inside the window — old behaviour
		expect(composerLimit(568, 380, 60)).toBe(null);
		// 320/200% long draft: 314 + 424 is over the bottom, and stays capped at it
		expect(composerLimit(568, 314, 254)).toBe(254);
	});

	/* QA #206 round 3 Q3: the limit is a feedback loop — the screen measures the
	 *  composer, `composerLimit` answers, the composer paints `composerHostBound` of
	 *  that answer, and the screen measures THAT box. Run the loop exactly as the
	 *  screen and the composer do and require a fixed point: the second pass must
	 *  give the same answer as the first, or the composer oscillates with no input
	 *  (1011 / 639 px at 390x844, Send below the viewport in the 1011 frames). */
	const settle = (
		viewport: number,
		top: number,
		natural: number,
		gap: number,
		passes = 4,
	) => {
		const floor = TOUCH_TARGET.ios;
		let limit: number | null = null;
		const answers: (number | null)[] = [];
		for (let pass = 0; pass < passes; pass++) {
			// The painted box is min(natural, cap); a fitting box sits on the gap.
			const height =
				limit === null
					? natural
					: Math.min(natural, composerHostBound(limit, gap, floor));
			const boxTop =
				height + top + gap <= viewport ? viewport - gap - height : top;
			limit = composerLimit(
				viewport,
				boxTop,
				height,
				composerAtHostCap(height, limit, gap, floor),
			);
			answers.push(limit);
		}
		return answers;
	};

	it("reaches a fixed point once bound (QA numbers: 844 window, top 201)", () => {
		// No inset (web) and a 34 pt home-indicator inset on native.
		expect(settle(844, 201, 1011, 8)).toEqual([643, 643, 643, 643]);
		expect(settle(844, 201, 1011, 42)).toEqual([643, 643, 643, 643]);
	});

	it("reaches a fixed point at 320x568 with a long 200 % draft", () => {
		expect(settle(568, 314, 425, 8)).toEqual([254, 254, 254, 254]);
		expect(settle(568, 314, 425, 42)).toEqual([254, 254, 254, 254]);
	});

	it("lets go only when the content fits again, and stays unbound", () => {
		// A short draft never binds: its bottom-anchored box sits on the gap.
		expect(settle(844, 201, 300, 8)).toEqual([null, null, null, null]);
		// A box held below its cap is not capped, so the limit releases.
		expect(composerAtHostCap(500, 643, 8, TOUCH_TARGET.ios)).toBe(false);
		expect(composerAtHostCap(635, 643, 8, TOUCH_TARGET.ios)).toBe(true);
		expect(composerAtHostCap(635, null, 8, TOUCH_TARGET.ios)).toBe(false);
	});

	it("never returns less than one control target", () => {
		expect(composerLimit(568, 560, 40)).toBe(TOUCH_TARGET.ios);
		expect(composerLimit(568, 700, 10)).toBe(TOUCH_TARGET.ios);
	});
});

describe("composerBudget (UX U1: the actions never scroll away)", () => {
	it("on a tight screen the field gets everything and the extras scroll in what is left", () => {
		// 390 pt screen at 200 %: composer share 0.45 -> 175 pt; receipt line 52; padding 8.
		// An error line (40 pt) is above the field.
		const budget = composerBudget(175, 52, 40, 48, 8);
		// `field` is the CONTENT cap; the field paints cap + its 1px border top and
		// bottom, which is the box the composer's share has to pay for.
		expect(budget).toEqual({ extras: 40, field: 73 });
		const painted = budget.field + FIELD_BORDER_Y + budget.extras + 52 + 8;
		if (painted > 175) throw new Error(`over budget: ${painted} > 175`);
		expect(painted).toBe(175);
	});

	it("never takes the field's touch floor for the extras: they scroll instead", () => {
		// 150 pt of attachments in 115 pt of room: the extras are capped, the field keeps 48
		const budget = composerBudget(175, 52, 150, 48, 8);
		// 46 content + 2 border = the 48 pt touch floor, in the box the screen spends
		expect(budget.field).toBe(48 - FIELD_BORDER_Y);
		expect(budget.field + FIELD_BORDER_Y).toBe(48);
		expect(budget.extras).toBe(115 - 48);
	});

	it("with nothing above the field the field takes the whole remainder", () => {
		expect(composerBudget(175, 52, 0, 48, 8)).toEqual({
			extras: 0,
			field: 115 - FIELD_BORDER_Y,
		});
	});

	it("never spends past the bound for the extras: the controls row outranks the notice (code #211 R3 M1)", () => {
		/* Portrait card: 48 of controls row and gap, 20 of padding. For every
		 *  bound that can hold the field's floor at all (>= 112), field box +
		 *  extras + fixed rows + padding is at most the bound, whatever the
		 *  extras want. A floor for the notice used to add up to 44 px here
		 *  (bound 128, notice 140: 156 spent, the controls row 28 px past the
		 *  window). The notice gets what is left and scrolls. */
		for (let bound = 112; bound <= 400; bound += 1)
			for (const natural of [0, 30, 44, 140, 474]) {
				const budget = composerBudget(bound, 48, natural, 44, 20);
				const spent = budget.field + FIELD_BORDER_Y + budget.extras + 48 + 20;
				expect(spent).toBeLessThanOrEqual(bound);
				expect(budget.field + FIELD_BORDER_Y).toBeGreaterThanOrEqual(44);
			}
		expect(composerBudget(128, 48, 140, 44, 20)).toEqual({
			extras: 16,
			field: 44 - FIELD_BORDER_Y,
		});
		/* The budget has no notice floor to pass any more: seven arguments would
		 *  be the overspend coming back. */
		expect(composerBudget.length).toBe(5);
	});

	it("reserves the dictation row so a recording take cannot push the composer past its share", () => {
		// 175 pt share, 52 receipt, 8 pad, 49 + 8 dictation: only 58 pt left for the field
		const budget = composerBudget(175, 52, 0, 48, 8, 57);
		expect(budget.field).toBe(58 - FIELD_BORDER_Y);
		expect(budget.field + FIELD_BORDER_Y + 52 + 8 + 57).toBeLessThanOrEqual(
			175,
		);
	});

	it("spends a portrait column budget without overspending it", () => {
		// 320x568 / 200 %: limit 254, receipt wrapped to 112, root pad 16, no extras.
		const budget = composerBudget(254, 112, 0, 48, 16);
		const painted = budget.field + FIELD_BORDER_Y + 112 + 16;
		if (painted > 254) throw new Error(`over column: ${painted} > 254`);
		expect(painted).toBe(254);
		expect(budget.field).toBe(254 - 112 - 16 - FIELD_BORDER_Y);
	});

	it("gives the extras their share before the field on a narrow column", () => {
		const budget = composerBudget(254, 112, 80, 48, 16);
		// 126 of room, of which the field's 48 pt floor is reserved: the extras get 78
		expect(budget.extras).toBe(78);
		expect(budget.field).toBe(48 - FIELD_BORDER_Y);
		expect(budget.field + FIELD_BORDER_Y + 112 + 16 + budget.extras).toBe(254);
	});

	it("never shrinks the field below its touch floor, even if the budget is smaller", () => {
		// The floor is a PAINTED floor (min-height on the field's box), so the content
		// cap it translates to is one border shorter.
		expect(composerBudget(90, 52, 30, 48, 8).field).toBe(48 - FIELD_BORDER_Y);
	});

	/* QA #211 round 4 Q7: the failure notice's actions lead the extras on a
	 *  row (or two) of their own, and a cap that lands inside that block showed
	 *  half an action ("Dismiss error" cut by 14 px). */
	it("cuts the extras back to whole action rows, and gives the field the rest", () => {
		/* Room 115, of which 48 is the field's floor: 67 px for extras whose two
		 *  action rows are 96. One whole row shows; the field takes the 19 px. */
		const cut = composerBudget(175, 52, 200, 48, 8, 0, 96);
		expect(cut.extras).toBe(48);
		expect(cut.field + FIELD_BORDER_Y + cut.extras + 52 + 8).toBe(175);
		/* The same budget without leading actions is untouched. */
		expect(composerBudget(175, 52, 200, 48, 8).extras).toBe(67);
		/* A cap that already holds every action row is not snapped... */
		expect(composerBudget(300, 52, 200, 48, 8, 0, 96).extras).toBe(192);
		/* ...and one under a single row is left alone: part of the first
		 *  action beats none, and nothing may be spent past the bound. */
		expect(composerBudget(130, 52, 200, 48, 8, 0, 96).extras).toBe(22);
		/* 320x568 / 200 %, French, QA's 143 px scroller: both rows whole. */
		expect(composerBudget(263, 52, 400, 48, 20, 0, 96).extras).toBe(143);
	});
});

/**
 * D2, final visual audit: the tray is a PHONE surface, and the old inline bands must
 * not survive on a portrait phone. These are the exact widths the store/README
 * captures use, plus the tablet and short-landscape cases that must NOT change.
 */
describe("session status layout", () => {
	it("is a phone at the capture widths and not at tablet", () => {
		for (const width of [360, 390, 430]) {
			expect(sessionStatusLayout(width, false)).toEqual({
				phone: true,
				tray: true,
				inlineSecondary: false,
				statusSheet: true,
			});
		}
		expect(sessionStatusLayout(1024, false).phone).toBe(false);
		// Tablet: inline panels, per-panel open state, no tray.
		expect(sessionStatusLayout(1024, false)).toEqual({
			phone: false,
			tray: false,
			inlineSecondary: true,
			statusSheet: false,
		});
	});

	it("keeps short landscape exactly as it was", () => {
		// Before the phone flag, compact rendered the TRAY, no inline region and the
		// sheet — the tray was designed here. Encoding the opposite turned landscape
		// into a duplicate band with dead panel buttons (R8-1).
		const landscape = sessionStatusLayout(844, true);
		expect(landscape.phone).toBe(false);
		expect(landscape.tray).toBe(true);
		expect(landscape.inlineSecondary).toBe(false);
		expect(landscape.statusSheet).toBe(true);
	});
});

describe("the Computers header stacks before its title clips (PR #122 D10/U13)", () => {
	/* Measured on the round-2 head with Back, "Switch computer" and Refresh: the
	 *  title clipped at 360 (69/138) and 390 (99/138) and fit by 1 px at 430. */
	const full = computersHeaderStackWidth({
		title: "mobile.computers.title.list",
		back: true,
		switcher: true,
		refresh: true,
	});

	it("reproduces the frames' measured fit", () => {
		expect(full).toBe(429);
		/* The title's box at 390 is the viewport minus the rest of the line. */
		expect(390 - (full - 138)).toBe(99);
		expect(430 - (full - 138)).toBe(139);
	});

	it("stacks at every phone width the title clipped at, and not at 430", () => {
		for (const width of [354, 360, 375, 390, 414, 428])
			expect(headerStacks(1, width, full)).toBe(true);
		expect(headerStacks(1, 430, full)).toBe(false);
	});

	it("moves with the controls actually rendered", () => {
		/* Under a 401 Refresh is hidden: 390 measured 170/170, single line. */
		const signedOut = computersHeaderStackWidth({
			title: "mobile.computers.title.list",
			back: true,
			switcher: true,
			refresh: false,
		});
		expect(signedOut).toBe(357);
		expect(headerStacks(1, 390, signedOut)).toBe(false);
		/* The longer set-up title needs more line. */
		expect(
			computersHeaderStackWidth({
				title: "mobile.computers.title.set_up",
				back: true,
				switcher: true,
				refresh: false,
			}),
		).toBeGreaterThan(390);
		/* No controls and no Back: the kit floor, never lower. */
		expect(
			computersHeaderStackWidth({
				title: "mobile.computers.title.list",
				back: false,
				switcher: false,
				refresh: false,
			}),
		).toBe(HEADER_STACK_WIDTH);
	});
});

describe("status tray beside a pending decision", () => {
	// Measured at 844x390, 200 % text (nightly 2026-10-27, S8 approval/populated-long,
	// U-08): the tray's 48 pt row took the column from 338 pt to 290 pt, and the card's
	// pinned Approve/Deny (46-48 pt, shrink-0) ended UNDER the composer. The tray has to
	// yield in short landscape, exactly as the inline region it replaced did (UX U12).
	it("yields to a pending approval or ask in short landscape", () => {
		const landscape = sessionStatusLayout(844, true);
		expect(statusTrayVisible(landscape.tray, true, true)).toBe(false);
	});

	it("returns the moment the decision is answered", () => {
		const landscape = sessionStatusLayout(844, true);
		expect(statusTrayVisible(landscape.tray, true, false)).toBe(true);
	});

	it("stays beside the card on a tall phone, which has the room", () => {
		const portrait = sessionStatusLayout(390, false);
		expect(statusTrayVisible(portrait.tray, false, true)).toBe(true);
	});

	it("never paints where the layout has no tray (tablet)", () => {
		const tablet = sessionStatusLayout(1024, false);
		expect(statusTrayVisible(tablet.tray, false, false)).toBe(false);
		expect(statusTrayVisible(tablet.tray, false, true)).toBe(false);
	});
});

/* The drawer's width rule (design spec 2026-11-06 § 4, sliver revised in review
 * round 1, U1): the page left beside the panel is the platform touch floor, so the
 * scrimmed sliver — the only one-handed close on iOS — is a compliant target. */
const IOS_FLOOR = touchFloorFor("ios");
const OTHER_FLOOR = touchFloorFor("other");

describe("sidebarWidthFor", () => {
	it("reads the platform floors the sliver is sized to", () => {
		expect(IOS_FLOOR).toBe(44);
		expect(OTHER_FLOOR).toBe(48);
	});

	it("gives a 402 pt iPhone a 358 pt panel and a 44 pt close sliver", () => {
		expect(sidebarWidthFor(402, IOS_FLOOR)).toBe(358);
		expect(sidebarWidthFor(402, OTHER_FLOOR)).toBe(354);
	});

	it("keeps the sliver on narrow phones: 320 pt -> 276 (iOS) / 272", () => {
		expect(sidebarWidthFor(320, IOS_FLOOR)).toBe(276);
		expect(sidebarWidthFor(320, OTHER_FLOOR)).toBe(272);
	});

	it("caps landscape and tablets at the ceiling instead of filling the screen", () => {
		for (const floor of [IOS_FLOOR, OTHER_FLOOR]) {
			expect(sidebarWidthFor(844, floor)).toBe(SIDEBAR_TABLET_MAX);
			expect(sidebarWidthFor(1194, floor)).toBe(SIDEBAR_TABLET_MAX);
		}
		expect(sidebarWidthFor(440, IOS_FLOOR)).toBe(396);
		expect(sidebarWidthFor(444, IOS_FLOOR)).toBe(SIDEBAR_TABLET_MAX);
		expect(sidebarWidthFor(448, OTHER_FLOOR)).toBe(SIDEBAR_TABLET_MAX);
	});

	it("leaves at least the touch floor of page at every width above the 240 minimum", () => {
		for (const floor of [IOS_FLOOR, OTHER_FLOOR]) {
			for (let width = SIDEBAR_MIN_WIDTH + floor; width <= 1366; width += 1) {
				expect(width - sidebarWidthFor(width, floor)).toBeGreaterThanOrEqual(
					floor,
				);
			}
		}
	});

	it("lets the 240 minimum win below 284 / 288 pt", () => {
		expect(sidebarWidthFor(280, IOS_FLOOR)).toBe(SIDEBAR_MIN_WIDTH);
		expect(sidebarWidthFor(284, OTHER_FLOOR)).toBe(SIDEBAR_MIN_WIDTH);
	});
});

describe("sameComposerBox (perf audit P15: a no-op measurement is not a new state)", () => {
	const box = {
		top: 314,
		height: 254,
		capped: true,
		viewportWidth: 320,
		viewportHeight: 568,
	};

	it("is true only when every field the limit reads is unchanged", () => {
		expect(sameComposerBox(box, { ...box })).toBe(true);
		expect(sameComposerBox(null, box)).toBe(false);
		expect(sameComposerBox(box, { ...box, top: 313 })).toBe(false);
		expect(sameComposerBox(box, { ...box, height: 255 })).toBe(false);
		/* `capped` alone must register: a capped box ends where a fitting one
		 *  does, so it is the one field geometry cannot stand in for. */
		expect(sameComposerBox(box, { ...box, capped: false })).toBe(false);
		/* The window is part of the value: the same numbers in another window
		 *  are a new measurement the host must take (UX #211 U1). */
		expect(sameComposerBox(box, { ...box, viewportHeight: 500 })).toBe(false);
		expect(sameComposerBox(box, { ...box, viewportWidth: 390 })).toBe(false);
	});

	it("leaves the cap's fixed point exactly where it was", () => {
		/* The guard only skips a state write; it must not round or merge. Fed
		 *  the settled measurement again and again, the limit it produces does
		 *  not move, and a real change still gets through on the next publish. */
		let held: typeof box | null = null;
		let writes = 0;
		const publish = (next: typeof box) => {
			if (sameComposerBox(held, next)) return;
			held = next;
			writes += 1;
		};
		for (let pass = 0; pass < 5; pass += 1) publish({ ...box });
		expect(writes).toBe(1);
		publish({ ...box, capped: false });
		expect(writes).toBe(2);
		expect(held).toEqual({ ...box, capped: false });
	});
});

describe("heldComposerLimit (UX #211 U1: a measurement does not survive a window resize)", () => {
	const floor = TOUCH_TARGET.ios;
	const GAP = 8;
	/* The screen and the composer as they run: the screen holds the last box and
	 *  asks for the limit in the CURRENT window; the composer paints
	 *  min(natural, cap), bottom-anchored on its gap, and publishes that box
	 *  tagged with the window it was measured in. `natural` grows by the notice
	 *  when a send fails. Each call is one render + measure. */
	const rig = () => {
		let held: ComposerBox | null = null;
		const pass = (
			viewport: { width: number; height: number },
			natural: number,
		) => {
			const limit = heldComposerLimit(held, viewport);
			const height =
				limit === null
					? natural
					: Math.min(natural, composerHostBound(limit, GAP, floor));
			held = {
				top: viewport.height - GAP - height,
				height,
				capped: composerAtHostCap(height, limit, GAP, floor),
				viewportWidth: viewport.width,
				viewportHeight: viewport.height,
			};
			return { limit, height };
		};
		return { pass };
	};
	const TALL = { width: 390, height: 844 };
	const SMALL = { width: 320, height: 568 };
	const SHORT = { width: 390, height: 500 };
	const EMPTY = 122; // the empty card: field row + controls + padding
	const NOTICE = 48; // one failure line with its action, plus the block margin

	for (const [name, shrunk] of [
		["390x844 -> 320x568", SMALL],
		["390x844 -> 390x500 (height only)", SHORT],
	] as const)
		it(`shrink then fail keeps the notice's room (${name})`, () => {
			const { pass } = rig();
			expect(pass(TALL, EMPTY)).toEqual({ limit: null, height: EMPTY });
			/* The shrink: the held box is the tall window's (top 714). It must
			 *  not be read against the short window. */
			expect(pass(shrunk, EMPTY)).toEqual({ limit: null, height: EMPTY });
			/* The 503: the composer grows by the notice and still fits. */
			for (let settle = 0; settle < 4; settle += 1)
				expect(pass(shrunk, EMPTY + NOTICE)).toEqual({
					limit: null,
					height: EMPTY + NOTICE,
				});
			/* Grow back: unbound again, with the notice still whole. */
			for (let settle = 0; settle < 3; settle += 1)
				expect(pass(TALL, EMPTY + NOTICE)).toEqual({
					limit: null,
					height: EMPTY + NOTICE,
				});
		});

	it("still binds, and settles, when the content really overflows the new window", () => {
		/* A long draft at 200 % in the small window: the first pass in the new
		 *  window is unbound (no measurement yet), then #206's loop takes over
		 *  from a column top of 314 and holds one answer. */
		const answers: (number | null)[] = [];
		let held: ComposerBox | null = null;
		for (let step = 0; step < 5; step += 1) {
			const limit = heldComposerLimit(held, SMALL);
			const height =
				limit === null
					? 425
					: Math.min(425, composerHostBound(limit, GAP, floor));
			held = {
				top: height + 314 + GAP <= 568 ? 568 - GAP - height : 314,
				height,
				capped: composerAtHostCap(height, limit, GAP, floor),
				viewportWidth: 320,
				viewportHeight: 568,
			};
			answers.push(limit);
		}
		expect(answers).toEqual([null, 254, 254, 254, 254]);
	});

	it("reads a box only in the window it was measured in", () => {
		const box: ComposerBox = {
			top: 201,
			height: 635,
			capped: true,
			viewportWidth: 390,
			viewportHeight: 844,
		};
		expect(heldComposerLimit(box, TALL)).toBe(643);
		expect(heldComposerLimit(box, SMALL)).toBe(null);
		expect(heldComposerLimit(box, { width: 844, height: 844 })).toBe(null);
		expect(heldComposerLimit(null, TALL)).toBe(null);
	});

	/* The pure rule is only as good as its wiring: the screen must tag what it
	 *  holds with the CURRENT window, re-create the callback when the window
	 *  changes (that identity change is what makes the composer measure again),
	 *  and ask through `heldComposerLimit`, never `composerLimit` directly. */
	it("is how the session screen holds and reads the box", () => {
		const screen = readFileSync(
			join(process.cwd(), "app/(app)/session/[id].tsx"),
			"utf8",
		).replace(/\s+/g, " ");
		expect(screen).toContain(
			"const next: ComposerBox = { ...measured, viewportWidth, viewportHeight };",
		);
		expect(screen).toContain("[viewportWidth, viewportHeight], );");
		expect(screen).toContain(
			"limit={heldComposerLimit(composerBox, { width: viewportWidth, height: viewportHeight, keyboardOverlap, transcriptSlack: liftSlack ?? transcriptSlack, })} onMeasure={setComposerBox} onLift={onComposerLift}",
		);
		/* TestFlight 836: the slack is the transcript's OWN measured height (the
		 *  thing that yields), never the composer's or the column's. */
		expect(screen).toContain(
			"const height = Math.round(event.nativeEvent.layout.height); transcriptSlackRef.current = height; setTranscriptSlack(height);",
		);
		/* PR #230 R2 M2: through a lift the slack is the one held when it began,
		 *  released by the composer's settled publish. */
		expect(screen).toContain(
			"lifting ? (held ?? transcriptSlackRef.current) : null",
		);
		/* The overlap is the shared keyboard store's, not a second listener. */
		expect(screen).toContain(
			"const keyboardOverlap = useKeyboardFrame().overlap;",
		);
		expect(screen).not.toMatch(/[^d]composerLimit\(/i);
	});
});

describe("the composer's bound survives chrome that settles after it measured (QA #211 round 3 Q5)", () => {
	const floor = TOUCH_TARGET.ios;
	const GAP = 8;
	type Viewport = { width: number; height: number };
	/* One frame is one render plus, WHEN ONE IS DUE, one measurement — which is
	 *  the whole point: the composer does not measure every frame. It measures
	 *  when its own box changes size (the dock's `onLayout`), when the limit or
	 *  the window changes (`publishBox`'s identity) and when its key changes.
	 *  A frame in which only its TOP moved used to be none of those.
	 *
	 *  `above` is everything over the composer in the column, in px: the composer
	 *  is bottom-anchored on its gap while that leaves room and is pushed down by
	 *  it otherwise (the transcript between them is already 0 pt tall). `band` is
	 *  the height of the row directly above the composer (the activity line and
	 *  its counts), the one fact the screen measures and can put in the key. */
	const rig = () => {
		let held: ComposerBox | null = null;
		let seen: string | null = null;
		const frame = (
			viewport: Viewport,
			natural: number,
			above: number,
			band: number,
		) => {
			const limit = heldComposerLimit(held, viewport);
			const height =
				limit === null
					? natural
					: Math.min(natural, composerHostBound(limit, GAP, floor));
			const top = Math.max(above, viewport.height - GAP - height);
			const trigger = [
				viewport.width,
				viewport.height,
				height,
				limit,
				composerChromeKey({ after: band }),
			].join("|");
			if (trigger !== seen) {
				seen = trigger;
				held = {
					top,
					height,
					capped: composerAtHostCap(height, limit, GAP, floor),
					viewportWidth: viewport.width,
					viewportHeight: viewport.height,
				};
			}
			return { bottom: top + height, height, limit };
		};
		/* A window change whose band settles `lag` frames after the commit: the
		 *  slot above the composer takes its height from a shared value set in
		 *  its own `onLayout`, outside React, so the composer's first frames in
		 *  the new window still see the band the OLD window gave it. */
		const arrive = (
			viewport: Viewport,
			natural: number,
			chrome: number,
			band: { from: number; to: number },
			lag: number,
		) => {
			let last = frame(viewport, natural, chrome + band.from, band.from);
			for (let step = 1; step < 10; step += 1)
				last = frame(
					viewport,
					natural,
					chrome + (step >= lag ? band.to : band.from),
					step >= lag ? band.to : band.from,
				);
			return last;
		};
		return { frame, arrive };
	};
	const SMALL = { width: 320, height: 568 };
	const TALL = { width: 390, height: 844 };
	const WIDE = { width: 1280, height: 720 };
	/* 320x568 at 200 %, a 405-character draft: the field rests at its own six
	 *  line cap (270) over the 48 + 20 of controls row and padding = 338, under
	 *  297 px of header and activity band (QA round 3's own boxes). */
	const NATURAL = 338;
	const ABOVE = 297;

	it("no resize: the draft grows in a settled window and the bound holds", () => {
		const { frame } = rig();
		frame(SMALL, 122, ABOVE, 76);
		let last = frame(SMALL, NATURAL, ABOVE, 76);
		for (let step = 0; step < 4; step += 1)
			last = frame(SMALL, NATURAL, ABOVE, 76);
		expect(last).toEqual({ bottom: 560, height: 263, limit: 271 });
	});

	/* The two outcomes QA measured are the two orders the same race can take.
	 *  band 76 px late by one frame: the only measurement in the new window saw
	 *  a composer that still fit (top 222), so the limit never bound: 635.
	 *  band 55 px late by two: it bound against the early top (242), and the
	 *  cap then held at 318 while the box slid down: 615. */
	for (const [name, from, grow, lag] of [
		["390x844 -> 320x568, unbound when the band lands", TALL, 76, 1],
		[
			"320x480 -> 320x568, unbound when the band lands",
			{ width: 320, height: 480 },
			76,
			1,
		],
		["390x844 -> 320x568, capped against the early top", TALL, 55, 2],
		["1280x720 -> 320x568 (the rig's hop)", WIDE, 76, 1],
		["1280x720 -> 320x568, three frames late", WIDE, 40, 3],
	] as const)
		it(`after a resize the composer ends inside the window (${name})`, () => {
			const { frame, arrive } = rig();
			frame(from, NATURAL, 200, 48);
			frame(from, NATURAL, 200, 48);
			const settled = arrive(
				SMALL,
				NATURAL,
				ABOVE - grow,
				{ from: 0, to: grow },
				lag,
			);
			expect(settled.bottom).toBeLessThanOrEqual(SMALL.height - GAP);
			expect(settled).toEqual({ bottom: 560, height: 263, limit: 271 });
		});

	it("growing back to 390x844 with two images, a draft and a refused send settles on the window, not 15 px past it", () => {
		const { frame, arrive } = rig();
		frame(SMALL, 700, ABOVE, 76);
		frame(SMALL, 700, ABOVE, 76);
		/* Natural 700 over a column top of 297 in the tall window: bound 539
		 *  (QA: 539, bottom 836). The band arrives 15 px taller, two frames in. */
		const settled = arrive(TALL, 700, 282, { from: 0, to: 15 }, 2);
		expect(settled).toEqual({ bottom: 836, height: 539, limit: 547 });
	});

	it("shrink, then type: the bound follows a draft that grows after the window settled", () => {
		const { frame, arrive } = rig();
		frame(TALL, 122, 200, 48);
		expect(arrive(SMALL, 122, ABOVE - 76, { from: 0, to: 76 }, 1).limit).toBe(
			null,
		);
		let last = frame(SMALL, NATURAL, ABOVE, 76);
		for (let step = 0; step < 4; step += 1)
			last = frame(SMALL, NATURAL, ABOVE, 76);
		expect(last).toEqual({ bottom: 560, height: 263, limit: 271 });
	});

	it("a band that opens under a capped composer (a turn starting) re-bounds it", () => {
		const { frame } = rig();
		for (let step = 0; step < 3; step += 1) frame(SMALL, NATURAL, 249, 0);
		let last = frame(SMALL, NATURAL, ABOVE, 48);
		for (let step = 0; step < 4; step += 1)
			last = frame(SMALL, NATURAL, ABOVE, 48);
		expect(last.bottom).toBe(560);
	});

	it("holds one answer once settled: the key is not an input the limit controls (#206)", () => {
		const { frame, arrive } = rig();
		frame(TALL, 1011, 201, 48);
		const first = arrive(TALL, 1011, 201 - 48, { from: 48, to: 48 }, 1);
		expect(first).toEqual({ bottom: 836, height: 635, limit: 643 });
		for (let step = 0; step < 6; step += 1)
			expect(frame(TALL, 1011, 201, 48)).toEqual(first);
	});

	/* Code #211 round 4 m1: the band is not the only thing that can land late.
	 *  The same loop, with the composer's floor (`above`) moved by something the
	 *  key did not see: the header, which sits over the column and so shows up
	 *  as the COLUMN's height, and the secondary region's rows. `late` frames
	 *  in, the facts take their second value; the composer has measured and
	 *  bound by then. */
	const pushed = (
		viewport: Viewport,
		natural: number,
		states: readonly [
			{ above: number; column: number; regions: number },
			{ above: number; column: number; regions: number },
		],
		late: number,
	) => {
		let held: ComposerBox | null = null;
		let seen: string | null = null;
		const bottoms: number[] = [];
		for (let step = 0; step < 12; step += 1) {
			const now = states[step >= late ? 1 : 0];
			const limit = heldComposerLimit(held, viewport);
			const height =
				limit === null
					? natural
					: Math.min(natural, composerHostBound(limit, GAP, floor));
			const top = Math.max(now.above, viewport.height - GAP - height);
			const trigger = [
				height,
				limit,
				composerChromeKey({ column: now.column, regions: now.regions }),
			].join("|");
			if (trigger !== seen) {
				seen = trigger;
				held = {
					top,
					height,
					capped: composerAtHostCap(height, limit, GAP, floor),
					viewportWidth: viewport.width,
					viewportHeight: viewport.height,
				};
			}
			bottoms.push(top + height);
		}
		return bottoms;
	};

	it("a header that goes from one row to two after the composer bound re-bounds it", () => {
		/* 320x568 / 200 %: the header measured 64 on one row and 125 stacked
		 *  (the frame audit's figures for this cell), so the column under it
		 *  goes 504 -> 443 and the composer's floor 236 -> 297. */
		const bottoms = pushed(
			SMALL,
			NATURAL,
			[
				{ above: 236, column: 504, regions: 0 },
				{ above: 297, column: 443, regions: 0 },
			],
			3,
		);
		/* Bound against the early top first (limit 332, box 324, bottom 560). */
		expect(bottoms.slice(1, 3)).toEqual([560, 560]);
		/* One frame pushed (621) is the measurement's own latency; then it
		 *  holds one answer inside the window. Unkeyed, it stayed at 621. */
		expect(bottoms.slice(4)).toEqual(Array(8).fill(560));
	});

	it("an inline panel that grows a row after the composer bound re-bounds it", () => {
		const bottoms = pushed(
			WIDE,
			500,
			[
				{ above: 300, column: 656, regions: 120 },
				{ above: 348, column: 656, regions: 168 },
			],
			3,
		);
		expect(bottoms.slice(1, 3)).toEqual([712, 712]);
		expect(bottoms.slice(4)).toEqual(Array(8).fill(712));
	});

	it("keys on the measured heights above the composer, and only on them", () => {
		expect(composerChromeKey({})).toBe(composerChromeKey({}));
		expect(composerChromeKey({ column: 504 })).not.toBe(
			composerChromeKey({ column: 443 }),
		);
		expect(composerChromeKey({ regions: 120 })).not.toBe(
			composerChromeKey({ regions: 168 }),
		);
		expect(composerChromeKey({ column: 48 })).not.toBe(
			composerChromeKey({ regions: 48 }),
		);
		/* The composer's own measured height is a `RecoveryFacts` field too, and
		 *  must never reach the key: that would be the output asking for its own
		 *  re-measure. */
		expect(
			composerChromeKey({ after: 48, composer: 263 } as { after: number }),
		).toBe(composerChromeKey({ after: 48 }));
		expect(composerChromeKey({ after: 48 })).not.toBe(
			composerChromeKey({ after: 104 }),
		);
		expect(composerChromeKey({ before: 10 })).not.toBe(
			composerChromeKey({ before: 30 }),
		);
		expect(composerChromeKey({ before: 48 })).not.toBe(
			composerChromeKey({ after: 48 }),
		);
	});

	it("is wired into the composer's measure key by the session screen", () => {
		const screen = readFileSync(
			join(process.cwd(), "app/(app)/session/[id].tsx"),
			"utf8",
		).replace(/\s+/g, " ");
		expect(screen).toMatch(
			/measureKey=\{`[^`]*\$\{composerChromeKey\(\{ column: recoveryFacts\.column, before: recoveryFacts\.before, after: recoveryFacts\.after, regions: regionContent \}\)\}`\}/,
		);
	});
});

/**
 * QA #211 round 4 Q6: at 390x844 / 200 % with two images, a long draft and a
 * refused send, in a browser whose scrollbars take layout width, the composer
 * cycled (297.4, 554) -> (297.4, 539) -> (338, 498) with no input.
 *
 * The loop, one frame per step, through the real limit and budget functions:
 *  - the extras' content is a fraction of a px taller than the height the
 *    composer stored for it, so once the budget hands that stored height back
 *    as the cap the scroller overflows and paints its scrollbar;
 *  - the scrollbar takes `gutter` px of width and the notice wraps to one more
 *    line (+41 px), so the stored height grows by a line;
 *  - the cap now holds that line, the scrollbar leaves, the line goes with it,
 *    and for that frame the box is a line SHORT of its bound (498): it reports
 *    "not capped", `composerLimit` lets go, the composer regrows to its natural
 *    554 px past the window, and binds again at 539.
 * That is #206's invariant broken by a new path: the measured input (content
 * height) depended on the output (capped -> scrollbar -> width).
 *
 * The numbers are QA's except ONE that is inferred: the extras' natural height
 * (212.4), chosen so the unbound composer is QA's 554 (20 + 52 + 212.4 + 270).
 * The other two heights and both tops then fall out of the model, which is the
 * evidence that this is the loop QA saw. The sub-pixel part of that height is
 * the model's TRIGGER and is an assumption (QA's host could not be re-read
 * here); the loop's cause, the width the scrollbar takes, does not depend on
 * which trigger first makes the extras overflow.
 */
describe("the extras' scrollbar cannot feed the composer's own measurement (QA #211 round 4 Q6)", () => {
	const floor = TOUCH_TARGET.android;
	const GAP = 8;
	const TALL = { width: 390, height: 844 };
	const ABOVE = 297.4;
	/* Padding 20, controls row 48 + 4, the field's six-line cap at 200 %. */
	const PAD = 20;
	const FIXED = 52;
	const FIELD = 270;
	/* The notice is two lines at the full width and three once `gutter` px
	 *  are gone; a line of `text-body-sm` at 200 % is 41 px. */
	const natural = (width: number) =>
		width >= TALL.width - 16 - 24 ? 212.4 : 253.4;
	const run = (
		gutter: number,
		store: (height: number) => number,
		frames = 24,
	) => {
		let held: ComposerBox | null = null;
		let stored = 0;
		const seen: Array<{ top: number; height: number }> = [];
		const full = TALL.width - 16 - 24;
		for (let step = 0; step < frames; step += 1) {
			const limit = heldComposerLimit(held, TALL);
			const budget =
				limit === null
					? null
					: composerBudget(
							composerHostBound(limit, GAP, floor),
							FIXED,
							stored,
							floor,
							PAD,
						);
			/* The browser's own pass: lay out without the bar, add it if the
			 *  content overflows the cap, and lay out again at what is left. */
			const bar = budget !== null && natural(full) > budget.extras;
			const content = natural(bar ? full - gutter : full);
			const extras =
				budget === null ? content : Math.min(content, budget.extras);
			const field =
				budget === null
					? FIELD
					: Math.min(FIELD, budget.field + FIELD_BORDER_Y);
			const height = Math.round(PAD + FIXED + extras + field);
			const top = Math.round(
				Math.max(ABOVE, TALL.height - GAP - (PAD + FIXED + extras + field)),
			);
			held = {
				top,
				height,
				capped: composerAtHostCap(height, limit, GAP, floor),
				viewportWidth: TALL.width,
				viewportHeight: TALL.height,
			};
			stored = store(content);
			seen.push({ top, height });
		}
		/* The first frame is the unbound mount; what matters is where it rests. */
		return [...new Set(seen.slice(4).map((box) => `${box.top},${box.height}`))];
	};
	const composer = readFileSync(
		join(process.cwd(), "src/features/session/components/composer.tsx"),
		"utf8",
	).replace(/\s+/g, " ");

	it("reproduces QA's three boxes when the scrollbar takes width (the defect)", () => {
		expect(run(15, Math.round).sort()).toEqual(
			["297,539", "297,554", "338,498"].sort(),
		);
	});

	it("settles on the bound once the content's width ignores the scrollbar", () => {
		expect(run(0, Math.round)).toEqual(["297,539"]);
	});

	it("the composer as written settles in one answer", () => {
		/* The fact the model takes from the component, read from its source:
		 *  whether its extras can lose width to a scrollbar. Both halves are
		 *  required, because each covers an engine the other does not: an old
		 *  WebKit ignores `scrollbar-width`, and a width pin alone leaves a
		 *  classic bar painted over the trailing actions. The stored height's
		 *  rounding is the component's own and is not changed by this fix. */
		const pinned =
			composer.includes(
				'showsVerticalScrollIndicator={Platform.OS !== "web"}',
			) &&
			composer.includes(
				"<View style={contentWidth > 0 ? { width: contentWidth } : undefined} > {extras} </View>",
			);
		expect(composer).toContain("setExtrasHeight(Math.round(height))");
		expect(run(pinned ? 0 : 15, Math.round)).toEqual(["297,539"]);
		expect(pinned).toBe(true);
	});
});
