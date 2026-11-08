import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckpointEntry, CheckpointManifest } from "@/contracts";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The transience of the transcript's two scroll-linked cues — design items 8 and
 * 10, which are the operator's two reports:
 *
 *  - "add fades into the top and bottom when the conversation scrolls … similar
 *    to the mobile relay which has that";
 *  - "maybe remove the line ticks along the side, only have them present if the
 *    thumb is held to scroll fast … so that they don't constantly take space".
 *
 * THREE LAYERS, ALL EXERCISED:
 *  1. `edgeFadeLevels` — the fades are absent at their own extreme and absent
 *     entirely when there is nothing to scroll (the acceptance rule is measured
 *     on it, so it is stated as arithmetic rather than as a tween).
 *  2. `createScrollPresence` — the rail's signal: nothing at rest, up while the
 *     offset moves or a thumb holds it, gone `RAIL_LINGER_MS` after it settles.
 *  3. The rail itself, with a real presence object: its drawn opacity follows the
 *     signal, which is the wiring item 10 asks for.
 */

const animated = vi.hoisted(() => ({
	/** Every opacity an `Animated.View` was given, in order. */
	opacities: [] as number[],
	/** The last animated value handed to a view, so a test can read what the tween
	 *  actually did rather than what the last render happened to start with. */
	value: null as { __getValue(): number } | null,
}));

vi.mock("react-native", async () => {
	const React = await import("react");
	const passthrough = ({ children }: { children?: React.ReactNode }) =>
		children ?? null;
	class Value {
		private current: number;
		constructor(initial: number) {
			this.current = initial;
		}
		setValue(next: number) {
			this.current = next;
		}
		__getValue() {
			return this.current;
		}
	}
	const record = (style: { opacity?: unknown } | undefined) => {
		const opacity = style?.opacity;
		if (typeof opacity === "number") animated.opacities.push(opacity);
		else if (opacity instanceof Value) {
			animated.value = opacity;
			animated.opacities.push(opacity.__getValue());
		}
	};
	return {
		Platform: { OS: "web" },
		View: passthrough,
		Text: passthrough,
		Pressable: passthrough,
		ScrollView: passthrough,
		StyleSheet: {
			create: (value: unknown) => value,
			flatten: (v: unknown) => v,
		},
		Animated: {
			Value,
			View: (props: {
				children?: React.ReactNode;
				style?: { opacity?: unknown };
			}) => {
				record(props.style);
				return props.children ?? null;
			},
			timing: (
				value: InstanceType<typeof Value>,
				config: { toValue: number },
			) => ({
				start: () => value.setValue(config.toValue),
			}),
			sequence: () => ({ start() {}, stop() {} }),
			loop: () => ({ start() {}, stop() {} }),
		},
	};
});

/* The fade's gradient stops, as the band hands them to the SVG — recorded per
 *  band so the order can be asserted on the drawing, not only on the helper. */
const svg = vi.hoisted(() => ({
	stops: [] as { offset: string; stopOpacity: number }[],
}));
vi.mock("react-native-svg", async () => {
	const passthrough = ({ children }: { children?: unknown }) =>
		(children ?? null) as never;
	return {
		__esModule: true,
		default: passthrough,
		Defs: passthrough,
		LinearGradient: passthrough,
		Rect: () => null,
		Stop: (props: { offset: string; stopOpacity: number }) => {
			svg.stops.push({ offset: props.offset, stopOpacity: props.stopOpacity });
			return null;
		},
	};
});

vi.mock("lucide-react-native", () => {
	const icon = () => null;
	return {
		Check: icon,
		CircleAlert: icon,
		CircleDot: icon,
		CircleSlash: icon,
	};
});
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000000",
	useReducedMotion: () => false,
}));
vi.mock("@/ui/variants", () => ({
	cx: (...values: unknown[]) => values.filter(Boolean).join(" "),
	SKELETON_PULSE_MS: 1200,
}));

const {
	createScrollPresence,
	edgeFadeLevels,
	edgeFadeStops,
	RAIL_FAST_PT_PER_MS,
	RAIL_LINGER_MS,
	TRANSCRIPT_FADE_PT,
} = await import("@/features/session/transcript-presence");
const { CheckpointRail, RAIL_PEAK_OPACITY } = await import(
	"@/features/session/components/checkpoint-rail"
);
const { TranscriptEdgeFades } = await import(
	"@/features/session/components/transcript-edge-fades"
);

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

const MANIFEST: CheckpointManifest = {
	session_id: "s",
	index: { state: "ready", built_at: 1 },
	checkpoints: [tick({ id: "a", seq: 1 }), tick({ id: "b", seq: 2 })],
};

describe("the edge fades", () => {
	const levels = (offsetY: number, contentPt = 1000, viewportPt = 400) =>
		edgeFadeLevels({ offsetY, contentPt, viewportPt });

	it("draws nothing when the content does not scroll", () => {
		expect(levels(0, 300, 400)).toEqual({ top: 0, bottom: 0 });
		expect(
			edgeFadeLevels({ offsetY: 0, contentPt: 400, viewportPt: 400 }),
		).toEqual({ top: 0, bottom: 0 });
	});

	it("is unfaded at the top extreme", () => {
		expect(levels(0)).toEqual({ top: 0, bottom: 1 });
	});

	it("is unfaded at the bottom extreme", () => {
		expect(levels(600)).toEqual({ top: 1, bottom: 0 });
	});

	it("ramps each edge over the band height rather than snapping", () => {
		expect(TRANSCRIPT_FADE_PT).toBe(24);
		expect(levels(12).top).toBeCloseTo(0.5, 5);
		expect(levels(588).bottom).toBeCloseTo(0.5, 5);
	});

	it("is fully faded at both edges in the middle of a long conversation", () => {
		expect(levels(300)).toEqual({ top: 1, bottom: 1 });
	});

	it("clamps an offset past the end instead of inverting a face", () => {
		expect(levels(9000)).toEqual({ top: 1, bottom: 0 });
		expect(levels(-50)).toEqual({ top: 0, bottom: 1 });
	});
});

describe("the edge fades' direction (design round 1, D1)", () => {
	it("is opaque at the screen edge and clear toward the content", () => {
		// Gradients run top → bottom: offset 0 is the band's top.
		expect(edgeFadeStops("top")).toEqual([1, 0]); // top band: edge first
		expect(edgeFadeStops("bottom")).toEqual([0, 1]); // bottom band: edge last
	});

	it("draws both bands with that stop order", async () => {
		svg.stops.length = 0;
		const dom = installDomShim();
		vi.stubGlobal("requestAnimationFrame", () => 0);
		const root = createRoot(dom.container as Element);
		await act(async () => root.render(createElement(TranscriptEdgeFades)));
		// Top band renders first, then the bottom band; two stops each.
		expect(svg.stops).toEqual([
			{ offset: "0", stopOpacity: 1 },
			{ offset: "1", stopOpacity: 0 },
			{ offset: "0", stopOpacity: 0 },
			{ offset: "1", stopOpacity: 1 },
		]);
		await act(async () => root.unmount());
		dom.dispose();
		vi.unstubAllGlobals();
	});
});

describe("the rail's presence signal", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	/** One frame of scroll at `ptPerMs`, the way `onScroll` reports it at
	 *  `scrollEventThrottle={16}`. Fake timers drive `Date.now`, which is the
	 *  presence's default clock. */
	const FRAME_MS = 16;
	const scrollFrames = (
		presence: ReturnType<typeof createScrollPresence>,
		from: number,
		frames: number,
		ptPerMs: number,
	): number => {
		let y = from;
		presence.noteMovement(y);
		for (let frame = 0; frame < frames; frame += 1) {
			vi.advanceTimersByTime(FRAME_MS);
			y += ptPerMs * FRAME_MS;
			presence.noteMovement(y);
		}
		return y;
	};

	it("draws nothing at rest", () => {
		const presence = createScrollPresence();
		expect(presence.readVisible()).toBe(false);
		const seen: boolean[] = [];
		presence.subscribe((visible) => seen.push(visible));
		vi.advanceTimersByTime(RAIL_LINGER_MS * 4);
		expect(seen).toEqual([]);
		presence.dispose();
	});

	it("lingers about a second (TestFlight 578)", () => {
		expect(RAIL_LINGER_MS).toBe(1000);
	});

	it("comes up for a FAST drag and goes a linger after it settles", () => {
		const presence = createScrollPresence();
		const seen: boolean[] = [];
		presence.subscribe((visible) => seen.push(visible));
		presence.setHeld(true);
		scrollFrames(presence, 0, 3, RAIL_FAST_PT_PER_MS * 2);
		expect(presence.readVisible()).toBe(true);
		presence.setHeld(false);
		vi.advanceTimersByTime(RAIL_LINGER_MS - 1);
		expect(presence.readVisible()).toBe(true);
		vi.advanceTimersByTime(1);
		expect(presence.readVisible()).toBe(false);
		expect(seen).toEqual([true, false]);
		presence.dispose();
	});

	it("never comes up for a reading-speed drag, however long", () => {
		/* TestFlight 578: the rail rose for every drag, so ~25 ticks sat over
		 *  the text through ordinary reading. Below the speed gate it must not. */
		const presence = createScrollPresence();
		const seen: boolean[] = [];
		presence.subscribe((visible) => seen.push(visible));
		presence.setHeld(true);
		scrollFrames(presence, 0, 200, RAIL_FAST_PT_PER_MS / 2);
		presence.setHeld(false);
		presence.setCoasting(true);
		scrollFrames(presence, 2000, 50, RAIL_FAST_PT_PER_MS / 4);
		presence.setCoasting(false);
		expect(seen).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
		presence.dispose();
	});

	it("a held thumb alone never summons it", () => {
		const presence = createScrollPresence();
		presence.setHeld(true);
		vi.advanceTimersByTime(RAIL_LINGER_MS * 10);
		expect(presence.readVisible()).toBe(false);
		presence.dispose();
	});

	it("ignores same-millisecond deliveries rather than reading them as infinite speed", () => {
		const presence = createScrollPresence();
		presence.setHeld(true);
		presence.noteMovement(0);
		presence.noteMovement(500);
		expect(presence.readVisible()).toBe(false);
		// The next real interval measures against the FIRST sample: 4 pt in 16 ms.
		vi.advanceTimersByTime(FRAME_MS);
		presence.noteMovement(4);
		expect(presence.readVisible()).toBe(false);
		presence.dispose();
	});

	it("never shows for a scroll the app made (the tail pin while a turn streams)", () => {
		/* Round 1, U3 / m2 / Q4: `pinTail` → `scrollToOffset` reaches `onScroll`
		 *  like any other offset, once per streamed growth. With no drag and no
		 *  momentum, none of it is the reader's, so the rail stays down for the
		 *  whole stream — even when the growth is fast. */
		const presence = createScrollPresence();
		const seen: boolean[] = [];
		presence.subscribe((visible) => seen.push(visible));
		for (let growth = 1; growth <= 40; growth += 1) {
			presence.noteMovement(1000 + growth * 400);
			vi.advanceTimersByTime(16);
		}
		expect(presence.readVisible()).toBe(false);
		expect(seen).toEqual([]);
		presence.dispose();
	});

	it("stays up while a fast flick coasts, and lingers from the moment it stops", () => {
		const presence = createScrollPresence();
		presence.setHeld(true);
		const y = scrollFrames(presence, 0, 2, RAIL_FAST_PT_PER_MS * 3);
		presence.setHeld(false);
		presence.setCoasting(true);
		// 3 s of glide, decelerating well below the gate: a summoned rail holds.
		for (let step = 1; step <= 30; step += 1) {
			presence.noteMovement(y + step * 4);
			vi.advanceTimersByTime(100);
		}
		expect(presence.readVisible()).toBe(true);
		presence.setCoasting(false);
		vi.advanceTimersByTime(RAIL_LINGER_MS - 1);
		expect(presence.readVisible()).toBe(true);
		vi.advanceTimersByTime(1);
		expect(presence.readVisible()).toBe(false);
		presence.dispose();
	});

	it("does not restart the linger for a repeated offset", () => {
		/* Round 1, m3 / Q3 / U8; made honest in round 2, Q10. A stationary list
		 *  whose scroll view keeps re-delivering the same offset must not hold
		 *  the rail up: outside a gesture the offset is discarded by the gesture
		 *  gate, so the re-emits below never re-arm the linger. */
		const presence = createScrollPresence();
		presence.setHeld(true);
		scrollFrames(presence, 0, 2, RAIL_FAST_PT_PER_MS * 2);
		presence.setHeld(false);
		for (let tick = 1; tick <= 4; tick += 1) {
			vi.advanceTimersByTime((RAIL_LINGER_MS - 100) / 4);
			presence.noteMovement(64);
		}
		vi.advanceTimersByTime(100);
		expect(presence.readVisible()).toBe(false);
		presence.dispose();
	});

	it("lets a drag that catches a glide end it (no momentum end needed)", () => {
		/* Round 2, U11 / m-r2-3: a finger that stops a flick does not reliably
		 *  get `onMomentumScrollEnd` first. Without `setHeld(true)` clearing the
		 *  glide, `coasting` stays true after the catch and no linger ever arms
		 *  again — the rail is stuck up. */
		const presence = createScrollPresence();
		presence.setHeld(true);
		scrollFrames(presence, 0, 2, RAIL_FAST_PT_PER_MS * 2);
		presence.setHeld(false);
		presence.setCoasting(true);
		// The reader catches the glide; the momentum end never arrives.
		presence.setHeld(true);
		presence.noteMovement(300);
		presence.setHeld(false);
		vi.advanceTimersByTime(RAIL_LINGER_MS);
		expect(presence.readVisible()).toBe(false);
		presence.dispose();
	});

	it("once summoned, stays up for as long as a thumb holds it", () => {
		const presence = createScrollPresence();
		presence.setHeld(true);
		scrollFrames(presence, 0, 2, RAIL_FAST_PT_PER_MS * 2);
		expect(presence.readVisible()).toBe(true);
		vi.advanceTimersByTime(RAIL_LINGER_MS * 10);
		expect(presence.readVisible()).toBe(true);
		presence.setHeld(false);
		vi.advanceTimersByTime(RAIL_LINGER_MS);
		expect(presence.readVisible()).toBe(false);
		presence.dispose();
	});

	it("leaves no timer behind when disposed mid-linger", () => {
		const presence = createScrollPresence();
		presence.setHeld(true);
		scrollFrames(presence, 0, 2, RAIL_FAST_PT_PER_MS * 2);
		presence.setHeld(false);
		expect(vi.getTimerCount()).toBe(1);
		presence.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("the rail draws only while the transcript moves", () => {
	let dom: DomShim | null = null;
	let root: ReturnType<typeof createRoot> | null = null;

	beforeEach(() => {
		animated.opacities.length = 0;
		animated.value = null;
		dom = installDomShim();
		vi.stubGlobal("requestAnimationFrame", () => 0);
		vi.stubGlobal("cancelAnimationFrame", () => {});
		root = createRoot(dom.container as Element);
	});
	afterEach(async () => {
		await act(async () => root?.unmount());
		root = null;
		dom?.dispose();
		dom = null;
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("renders the marks at opacity 0 at rest, and the subtle peak while the list moves fast", async () => {
		let clock = 0;
		const presence = createScrollPresence(() => clock);
		await act(async () =>
			root?.render(
				createElement(CheckpointRail, {
					manifest: MANIFEST,
					readFailed: false,
					loadedIds: new Set(["a", "b"]),
					presence,
				}),
			),
		);
		// At rest: the drawn column exists but is invisible — no tick in the frame.
		expect(animated.value?.__getValue()).toBe(0);
		await act(async () => {
			presence.setHeld(true);
			presence.noteMovement(0);
			clock += 16;
			presence.noteMovement(16 * RAIL_FAST_PT_PER_MS * 2);
		});
		// The tween ran on the value the view holds, with no re-render in between,
		// and it peaks low (TestFlight 578), never at full ink.
		expect(RAIL_PEAK_OPACITY).toBeLessThan(1);
		expect(animated.value?.__getValue()).toBe(RAIL_PEAK_OPACITY);
		presence.dispose();
	});

	it("keeps the marks permanently visible (at the subtle peak) when no presence is supplied", async () => {
		await act(async () =>
			root?.render(
				createElement(CheckpointRail, {
					manifest: MANIFEST,
					readFailed: false,
					loadedIds: new Set(["a", "b"]),
				}),
			),
		);
		expect(animated.opacities.at(-1)).toBe(RAIL_PEAK_OPACITY);
	});
});
