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
	RAIL_LINGER_MS,
	TRANSCRIPT_FADE_PT,
} = await import("@/features/session/transcript-presence");
const { CheckpointRail } = await import(
	"@/features/session/components/checkpoint-rail"
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

describe("the rail's presence signal", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("draws nothing at rest", () => {
		const presence = createScrollPresence();
		expect(presence.readVisible()).toBe(false);
		const seen: boolean[] = [];
		presence.subscribe((visible) => seen.push(visible));
		vi.advanceTimersByTime(RAIL_LINGER_MS * 4);
		expect(seen).toEqual([]);
		presence.dispose();
	});

	it("comes up when the offset moves and goes after it settles", () => {
		const presence = createScrollPresence();
		const seen: boolean[] = [];
		presence.subscribe((visible) => seen.push(visible));
		presence.noteMovement(40);
		expect(presence.readVisible()).toBe(true);
		vi.advanceTimersByTime(RAIL_LINGER_MS - 1);
		expect(presence.readVisible()).toBe(true);
		vi.advanceTimersByTime(1);
		expect(presence.readVisible()).toBe(false);
		expect(seen).toEqual([true, false]);
		presence.dispose();
	});

	it("stays up while the offset keeps moving, and ignores a repeated offset", () => {
		const presence = createScrollPresence();
		const seen: boolean[] = [];
		presence.subscribe((visible) => seen.push(visible));
		presence.noteMovement(10);
		vi.advanceTimersByTime(RAIL_LINGER_MS / 2);
		presence.noteMovement(20);
		vi.advanceTimersByTime(RAIL_LINGER_MS / 2);
		expect(presence.readVisible()).toBe(true);
		// A platform that re-delivers the same event must not restart the linger.
		presence.noteMovement(20);
		vi.advanceTimersByTime(RAIL_LINGER_MS);
		expect(presence.readVisible()).toBe(false);
		expect(seen).toEqual([true, false]);
		presence.dispose();
	});

	it("stays up for as long as a thumb holds it", () => {
		const presence = createScrollPresence();
		presence.setHeld(true);
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
		presence.noteMovement(5);
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

	it("renders the marks at opacity 0 at rest, and 1 while the list moves", async () => {
		const presence = createScrollPresence();
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
		await act(async () => presence.noteMovement(30));
		// The tween ran on the value the view holds, with no re-render in between.
		expect(animated.value?.__getValue()).toBe(1);
		presence.dispose();
	});

	it("keeps the marks permanently visible when no presence is supplied", async () => {
		await act(async () =>
			root?.render(
				createElement(CheckpointRail, {
					manifest: MANIFEST,
					readFailed: false,
					loadedIds: new Set(["a", "b"]),
				}),
			),
		);
		expect(animated.opacities.at(-1)).toBe(1);
	});
});
