import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Animated } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CheckpointEntry, CheckpointManifest } from "@/contracts";
import { STATE_MARKER, SURFACE } from "@/ui/a11y";
import { CheckpointRail } from "./checkpoint-rail";

/**
 * The checkpoint rail's DRAWN tree, per state — the half of the rail that no
 * other suite can see.
 *
 * WHY THIS FILE EXISTS. The rail currently paints on native only: its
 * visibility is driven by the transcript's scroll velocity, and
 * `transcript-presence.ts:148-153` records that react-native-web 0.21 emits
 * only `onScroll`, so `onScrollBeginDrag`/`onMomentumScrollBegin` — the
 * signals that summon the rail — never fire on the web target. The repo's only
 * visual harness is that web target, so until now the rail had NO automated
 * coverage of what it draws: the markers below were asserted by DOM capture,
 * and a regression in the drawing branch would surface as a missing tick on a
 * device rather than as a red pipeline. This suite pins the component's own
 * state→drawing contract in Node, where CI runs it on every PR.
 *
 * WHAT THE NODE HOST CAN AND CANNOT DO (this shapes every test here, and the
 * two stubs below exist because of it). `vitest.config.ts` runs
 * `environment: "node"` with `react-native` aliased to `react-native-web`, the
 * repo's convention (`src/features/team-bridge/message-delivery.test.tsx`)
 * being `renderToStaticMarkup`, i.e. the server renderer. Two consequences:
 *
 *  - NO LAYOUT PASS runs, so `onLayout` never fires and the component's own
 *    `trackPt` stays 0. Its marks are laid out only for a positive track
 *    (`trackPt > 0 ? decimateRailMarks(...) : []`), so a plain render draws an
 *    EMPTY rail surface in every marks state. The `useState` stub below is
 *    what a layout pass would otherwise supply — a test-side stub, deliberately
 *    not a production prop or `testID`, so `src/` keeps a single rendering path.
 *  - NO EFFECTS RUN, so the reduced-motion branch (the `Animated.loop` at
 *    `checkpoint-rail.tsx:307-333`) never executes and a negative assertion
 *    about it would pass vacuously. The `useEffect` stub records the effect
 *    bodies the component registers and this suite invokes them, so what is
 *    asserted is the REAL branch with the REAL `Animated` — and each negative
 *    is paired with a motion-on control that proves the spy catches a loop.
 *
 * Both stubs spread the actual module, so every hook the component calls is
 * genuinely React's; only the two seam values are supplied (the initial track
 * height, and the effect bodies' execution).
 *
 * WHAT IS STILL UNPROVEN, and belongs to the device rather than here: the
 * actual pixels — glyph legibility at 8 pt on a real panel, where the marks
 * land against the iOS scroll indicator, and the fade timing while the thumb
 * travels. None of that is reachable without a simulator (ADR 0003).
 */

/**
 * Hook seams. `vi.hoisted` so the `vi.mock` factories below — hoisted above
 * every import — can close over them.
 */
const seam = vi.hoisted(() => ({
	/** What a layout pass would have reported; 0 means "no layout yet". */
	trackPt: 0,
	/** Every hook call the component makes, in registration order. */
	calls: [] as unknown[],
	/** The reader's motion preference, as `useReducedMotion` would answer it. */
	reduceMotion: false,
	/** Reset per render: the component's own `useState` calls in order. */
	stateCalls: 0,
}));

/* The Node host has no native appearance provider, so the shared appearance
 * module is stubbed to its two outputs: the preference (which reads
 * `AccessibilityInfo`, a native API) and the token colours. The component's
 * response to those — the whole subject here — still runs for real. */
vi.mock("@/ui/appearance", () => ({
	useReducedMotion: () => seam.reduceMotion,
	useTokenColor: (role: string) => `token:${role}`,
}));

/* The Node SSR host has no native SVG/Flow loader. Stub only the icon
 * boundary; each glyph keeps a DOM handle so the drawn tree can be counted. */
vi.mock("lucide-react-native", () => ({
	CircleAlert: () => createElement("span", { "data-glyph": "alert" }),
	CircleDot: () => createElement("span", { "data-glyph": "dot" }),
	CircleSlash: () => createElement("span", { "data-glyph": "slash" }),
}));

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		// `trackPt` is the component's FIRST `useState` (it is the root of this
		// render, so its hooks run before any child's), and its initial value is
		// 0. Overriding that one value is a layout pass in a host that has none;
		// that it took effect is self-verifying — every marks assertion below
		// fails without it.
		useState: <T,>(initial: T) => {
			const pair = actual.useState(initial);
			seam.calls.push(["useState", initial]);
			seam.stateCalls += 1;
			return (
				seam.stateCalls === 1 && seam.trackPt > 0
					? [seam.trackPt, pair[1]]
					: pair
			) as typeof pair;
		},
		// Registered bodies are kept so this suite can run them; the real hook
		// still runs, so a host that DID commit effects would behave identically.
		useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
			seam.calls.push(["useEffect", fn]);
			return actual.useEffect(fn, deps);
		},
	};
});

const tick = (
	over: Partial<CheckpointEntry> & { id: string; seq: number },
): CheckpointEntry => ({
	kind: "user",
	turn: 1,
	ts: 1_700_000_000,
	text: over.id,
	outcome: null,
	naming: null,
	...over,
});

const manifest = (
	over: Partial<CheckpointManifest> = {},
): CheckpointManifest => ({
	session_id: "s",
	index: { state: "ready", built_at: 1 },
	checkpoints: [],
	...over,
});

/** Three ticks spread over seq 3..8, so their fractions are 0, 2/5 and 1. */
const TICKS = [
	tick({ id: "a", seq: 3 }),
	tick({ id: "b", seq: 5, kind: "completion", outcome: "complete" }),
	tick({ id: "c", seq: 8 }),
];

/** A track tall enough that every mark clears the glyph threshold. */
const TRACK_PT = 300;

type RenderOptions = {
	manifest: CheckpointManifest | null;
	readFailed?: boolean;
	loadedIds?: ReadonlySet<string>;
	/** Run the component's effects, as a committing host would. */
	commit?: boolean;
	trackPt?: number;
	reduceMotion?: boolean;
};

const renderRail = ({
	manifest: held,
	readFailed = false,
	loadedIds = new Set<string>(),
	commit = false,
	trackPt = 0,
	reduceMotion = false,
}: RenderOptions): string => {
	seam.calls.length = 0;
	seam.stateCalls = 0;
	seam.trackPt = trackPt;
	seam.reduceMotion = reduceMotion;
	const html = renderToStaticMarkup(
		createElement(CheckpointRail, { manifest: held, readFailed, loadedIds }),
	);
	if (commit) for (const [, fn] of effects()) (fn as () => void)();
	return html;
};

const effects = () =>
	seam.calls.filter((call) => (call as unknown[])[0] === "useEffect") as Array<
		[string, () => void | (() => void)]
	>;

/** How many times `needle` occurs in the drawn markup. */
const times = (html: string, needle: string) => html.split(needle).length - 1;

/** How many nodes carry an `id` produced by the app's a11y tables. */
const count = (html: string, id: string) => times(html, `data-testid="${id}"`);

const marker = (state: keyof typeof STATE_MARKER.session) => {
	const id = STATE_MARKER.session[state];
	return id === undefined
		? (() => {
				throw new Error(`unknown rail marker ${state}`);
			})()
		: id;
};

/** The rail surface's own markup, or `""` when the rail draws nothing. */
const surfaceMarkup = (html: string): string => {
	const at = html.indexOf(`data-testid="${SURFACE.checkpointRail}"`);
	if (at < 0) return "";
	const open = html.indexOf(">", at);
	return html.slice(open + 1);
};

type Box = { top: number; width: number; height: number };

const measurements = (style: string, prop: string): number => {
	const found = new RegExp(`(?:^|;)${prop}:(-?[\\d.]+)px`).exec(style);
	return found?.[1] === undefined ? Number.NaN : Number(found[1]);
};

/** Every painted box inside the rail surface, in draw order. */
const boxes = (html: string): Box[] =>
	[...surfaceMarkup(html).matchAll(/<div[^>]*style="([^"]+)"/g)]
		.map((match) => match[1] ?? "")
		.map((style) => ({
			top: measurements(style, "top"),
			width: measurements(style, "width"),
			height: measurements(style, "height"),
		}));

/* The three drawn forms, told apart by the height each paints at: the
 * building liveness bar (2.5 pt), a dash mark (1 pt), and a glyph's 8 pt
 * armour, which the failure state's head mark shares with any glyph-form
 * tick. Filtering by height keeps the assertions about SHAPES rather than
 * about DOM order. */
const livenessBoxes = (html: string) =>
	boxes(html).filter((box) => box.height === 2.5);

const dashBoxes = (html: string) =>
	boxes(html).filter((box) => box.height === 1);

const headGlyphBoxes = (html: string) =>
	boxes(html).filter((box) => box.height === 8);

afterEach(() => {
	vi.restoreAllMocks();
	seam.reduceMotion = false;
});

describe("CheckpointRail building state", () => {
	it("draws the liveness head mark at the head, and a settled rail draws none", () => {
		const building = renderRail({
			manifest: manifest({
				index: { state: "building", built_at: null },
				checkpoints: TICKS,
			}),
			trackPt: TRACK_PT,
		});
		/* `HEAD_Y_PT - 1.25` on a 2.5 pt bar: the centre sits at HEAD_Y_PT = 6 pt,
		 * clear of the first seq-placed mark at `RAIL_INSET_PT` (10 pt). */
		expect(livenessBoxes(building)).toEqual([
			{ top: 4.75, width: 6, height: 2.5 },
		]);
		expect(count(building, marker("rail-building"))).toBe(1);

		const settled = renderRail({
			manifest: manifest({ checkpoints: TICKS }),
			trackPt: TRACK_PT,
		});
		expect(livenessBoxes(settled)).toEqual([]);
		expect(count(settled, marker("rail-building"))).toBe(0);
	});

	it("keeps the previous scan's marks painting under the liveness mark", () => {
		/* The documented design: "the building state keeps the previous marks
		 * painting under a pulsing liveness mark". So the SAME marks land in the
		 * SAME places with a liveness bar above them — building adds a mark, it
		 * never replaces the rail with a loading shape. */
		const settled = renderRail({
			manifest: manifest({ checkpoints: TICKS }),
			trackPt: TRACK_PT,
		});
		const building = renderRail({
			manifest: manifest({
				index: { state: "building", built_at: null },
				checkpoints: TICKS,
			}),
			trackPt: TRACK_PT,
		});
		expect(dashBoxes(building)).toEqual(dashBoxes(settled));
		expect(dashBoxes(building)).toEqual([
			{ top: 9.5, width: 3, height: 1 },
			{ top: 121.5, width: 5, height: 1 },
			{ top: 289.5, width: 3, height: 1 },
		]);
		expect(livenessBoxes(building)).toHaveLength(1);
	});

	it("lays marks out by seq across the track, not by frame count", () => {
		/* The rail's whole reason for taking the route over the loaded window:
		 * `y = inset + fraction * (track - 2 * inset)` with the fraction taken
		 * from `seq` over the manifest's own range. A component that painted the
		 * three ticks evenly would pass the count checks above and still lie. */
		const html = renderRail({
			manifest: manifest({ checkpoints: TICKS }),
			trackPt: TRACK_PT,
		});
		expect(dashBoxes(html).map((box) => box.top)).toEqual([9.5, 121.5, 289.5]);
		expect(dashBoxes(html)).toHaveLength(TICKS.length);
	});
});

describe("CheckpointRail reduced motion", () => {
	it("keeps the liveness mark drawn and static, and starts no loop", () => {
		const loop = vi.spyOn(Animated, "loop");
		const setValue = vi.spyOn(Animated.Value.prototype, "setValue");

		const html = renderRail({
			manifest: manifest({
				index: { state: "building", built_at: null },
				checkpoints: TICKS,
			}),
			trackPt: TRACK_PT,
			commit: true,
			reduceMotion: true,
		});

		/* Still drawn — reduce-motion quietens the mark, it does not delete the
		 * fact that a scan is in flight. */
		expect(livenessBoxes(html)).toHaveLength(1);
		/* U-13: nothing may loop for a reader who asked for stillness. */
		expect(loop).not.toHaveBeenCalled();
		/* And it is pinned static rather than left wherever a previous run put
		 * it, so a reader who turns motion off mid-scan sees a settled mark. */
		expect(setValue).toHaveBeenCalledWith(1);
	});

	it("CONTROL: with motion on, the same effect body does start exactly one loop", () => {
		/* Without this, the assertion above would pass on a renderer that never
		 * ran the effect at all — which is exactly the trap this host sets. */
		const loop = vi.spyOn(Animated, "loop");
		renderRail({
			manifest: manifest({
				index: { state: "building", built_at: null },
				checkpoints: TICKS,
			}),
			trackPt: TRACK_PT,
			commit: true,
			reduceMotion: false,
		});
		expect(loop).toHaveBeenCalledTimes(1);
	});

	it("starts no loop for a settled rail, whatever the preference", () => {
		const loop = vi.spyOn(Animated, "loop");
		renderRail({
			manifest: manifest({ checkpoints: TICKS }),
			trackPt: TRACK_PT,
			commit: true,
		});
		expect(loop).not.toHaveBeenCalled();
	});
});

describe("CheckpointRail failure state", () => {
	it("draws one announced danger glyph at the head, never an empty rail", () => {
		const html = renderRail({
			manifest: manifest({ index: { state: "error", built_at: null } }),
		});
		/* The rail DRAWS — an overlay with nothing in it would be the "no
		 * checkpoints" claim the error state must never make. */
		expect(count(html, SURFACE.checkpointRail)).toBe(1);
		expect(
			html.match(/aria-label="Checkpoints couldn&#x27;t be read"/g),
		).toHaveLength(1);
		expect(times(html, 'data-glyph="alert"')).toBe(1);
		expect(count(html, marker("rail-error"))).toBe(1);
	});

	it("keeps the previous scan's ticks under the failure glyph", () => {
		const html = renderRail({
			manifest: manifest({
				index: { state: "error", built_at: null },
				checkpoints: TICKS,
			}),
			trackPt: TRACK_PT,
		});
		expect(dashBoxes(html)).toHaveLength(TICKS.length);
		expect(headGlyphBoxes(html)).toEqual([{ top: 2, width: 8, height: 8 }]);
		/* ONE head glyph: the announcement is a single fact, not one per mark. */
		expect(times(html, 'aria-label="Checkpoints couldn&#x27;t be read"')).toBe(
			1,
		);
	});
});

describe("CheckpointRail states that draw nothing", () => {
	it("draws no rail surface while waiting for a first answer", () => {
		const html = renderRail({ manifest: null });
		expect(surfaceMarkup(html)).toBe("");
		expect(count(html, marker("rail-empty"))).toBe(0);
	});

	it("draws no rail surface when the read failed with no manifest held", () => {
		const html = renderRail({ manifest: null, readFailed: true });
		expect(surfaceMarkup(html)).toBe("");
	});

	it("draws no rail surface for a genuinely empty manifest, and says so", () => {
		const html = renderRail({ manifest: manifest({ checkpoints: [] }) });
		expect(surfaceMarkup(html)).toBe("");
		/* The marker is how the empty rail is still a claim rather than a
		 * silence — kept out of the `-empty` suffix deliberately (a11y.ts). */
		expect(count(html, marker("rail-empty"))).toBe(1);
		expect(count(html, marker("rail"))).toBe(0);
	});
});

describe("CheckpointRail's capture markers", () => {
	/* The contract the web audit's cells read. `rail` means "the manifest is
	 * ready and ticks are painted"; `rail-deep` refines it to "at least one
	 * mark is for a row this device does not hold". */
	it("a building rail is marked building and deep, never ready", () => {
		const html = renderRail({
			manifest: manifest({
				index: { state: "building", built_at: null },
				checkpoints: TICKS,
			}),
		});
		expect(count(html, marker("rail-building"))).toBe(1);
		expect(count(html, marker("rail-deep"))).toBe(1);
		/* A building frame must not satisfy the populated cell's claim. */
		expect(count(html, marker("rail"))).toBe(0);
	});

	it("a settled deep rail is marked ready and deep, never building", () => {
		const html = renderRail({
			manifest: manifest({ checkpoints: TICKS }),
		});
		expect(count(html, marker("rail"))).toBe(1);
		expect(count(html, marker("rail-deep"))).toBe(1);
		expect(count(html, marker("rail-building"))).toBe(0);
	});

	it("a rail whose every mark is on screen is not marked deep", () => {
		/* `rail-deep` is a claim about the loaded window, not a constant: with
		 * every tick's row held, the same manifest is a shallow rail. */
		const html = renderRail({
			manifest: manifest({ checkpoints: TICKS }),
			loadedIds: new Set(TICKS.map((entry) => entry.id)),
		});
		expect(count(html, marker("rail"))).toBe(1);
		expect(count(html, marker("rail-deep"))).toBe(0);
	});
});
