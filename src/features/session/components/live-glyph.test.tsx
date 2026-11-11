import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import { buildFoldRun, type FoldRun } from "@/features/session/fold-model";
import { SURFACE } from "@/ui/a11y";
import { FoldBar } from "./fold-bar";
import {
	LIVE_PULSE_FLOOR,
	LIVE_PULSE_PERIOD_MS,
	LiveGlyph,
	liveGlyphMode,
	livePulseUsers,
} from "./live-glyph";
import { ToolRow } from "./tool-row";

/**
 * The live-tool indicator's state → drawing contract (operator feedback: a
 * running row "looks like it's static and not the currently running tool").
 *
 * The Node host is the server renderer (`checkpoint-rail.test.tsx` explains
 * the constraints): no effects commit, so the loop's retain/release is driven
 * by running the registered effect bodies through a `useEffect` seam, with a
 * motion-on control proving the seam catches a retain. The pixels — that a
 * 1 → 0.4 pulse reads on a real panel — belong to the device row.
 */
const seam = vi.hoisted(() => ({
	reduceMotion: false,
	effects: [] as Array<import("react").EffectCallback>,
}));

vi.mock("@/ui/appearance", () => ({
	useReducedMotion: () => seam.reduceMotion,
	useTokenColor: (role: string) => `token:${role}`,
}));

vi.mock("lucide-react-native", () => ({
	Hourglass: () => createElement("span"),
	MessageSquareOff: () => createElement("span"),
	MessagesSquare: () => createElement("span"),
}));

/* ToolRow's markdown renderer pulls native modules the Node host cannot load
 * (`__DEV__`, Flow sources) and only draws an EXPANDED row's body, which no
 * test here opens; the glyph column is the whole subject. */
vi.mock("@/features/session/components/markdown", () => ({
	Markdown: () => null,
}));

vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));

/* The class names are the contract (`text-accent` ink, `bg-accent` tick), and
 * react-native-web's server render turns `className` into atomic CSS, so the
 * host primitives are re-pointed at elements that serialise it as `data-class`
 * (`markdown.test.tsx`'s pattern). `Animated` itself stays react-native-web's:
 * the loop being retained is the real one. */
vi.mock("react-native", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-native")>();
	const { createElement } = await import("react");
	type HostProps = {
		children?: import("react").ReactNode;
		className?: string;
		testID?: string;
	};
	const host =
		(tag: string) =>
		({ children, className, testID }: HostProps) =>
			createElement(
				tag,
				{ "data-class": className, "data-testid": testID },
				children,
			);
	return {
		...actual,
		View: host("div"),
		Text: host("span"),
		Pressable: host("div"),
		ScrollView: host("div"),
		Animated: { ...actual.Animated, View: host("div") },
	};
});

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		useEffect: (fn: import("react").EffectCallback, deps?: unknown[]) => {
			seam.effects.push(fn);
			return actual.useEffect(fn, deps);
		},
	};
});

beforeEach(() => {
	seam.reduceMotion = false;
	seam.effects = [];
});

/** Run every effect the render registered; return their cleanups. */
const commit = (): Array<() => void> =>
	seam.effects
		.map((fn) => fn())
		.filter((cleanup): cleanup is () => void => typeof cleanup === "function");

const tool = (
	over: Partial<TranscriptEntry> & Pick<TranscriptEntry, "id">,
): TranscriptEntry => ({
	kind: "tool",
	text: "",
	tool_call_id: over.id,
	tool_name: "bash",
	tool_state: "done",
	summary: "ls -la",
	intent: "",
	diff_added: 0,
	diff_removed: 0,
	elapsed_s: 3,
	error: "",
	details: {},
	images: [],
	final: true,
	text_complete: true,
	...over,
});

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
	renderToStaticMarkup(node);

const hasPulse = (markup: string) =>
	markup.includes(`data-testid="${SURFACE.traceLivePulse}"`);
const hasTick = (markup: string) =>
	markup.includes(`data-testid="${SURFACE.traceLiveTick}"`);

describe("liveGlyphMode", () => {
	it("pulses a live glyph, holds a static mark under Reduce Motion, and leaves the rest still", () => {
		expect(liveGlyphMode(true, false)).toBe("pulse");
		expect(liveGlyphMode(true, true)).toBe("static-live");
		expect(liveGlyphMode(false, false)).toBe("still");
		expect(liveGlyphMode(false, true)).toBe("still");
	});

	it("matches the relay's lo-pulse: 1.2 s, floor 0.4 (not the text shimmer's 0.72)", () => {
		expect(LIVE_PULSE_PERIOD_MS).toBe(1200);
		expect(LIVE_PULSE_FLOOR).toBe(0.4);
	});
});

describe("LiveGlyph", () => {
	it("draws the pulse and takes one share of the shared loop when live", () => {
		const markup = html(
			createElement(LiveGlyph, {
				glyph: "⟳",
				inkClass: "text-accent",
				live: true,
			}),
		);
		expect(hasPulse(markup)).toBe(true);
		expect(hasTick(markup)).toBe(false);
		const before = livePulseUsers.users();
		const cleanups = commit();
		expect(livePulseUsers.users()).toBe(before + 1);
		for (const cleanup of cleanups) cleanup();
		expect(livePulseUsers.users()).toBe(before);
	});

	it("draws a static accent tick, and starts no loop, under Reduce Motion", () => {
		seam.reduceMotion = true;
		const markup = html(
			createElement(LiveGlyph, {
				glyph: "⟳",
				inkClass: "text-accent",
				live: true,
			}),
		);
		expect(hasTick(markup)).toBe(true);
		expect(hasPulse(markup)).toBe(false);
		expect(markup).toContain("bg-accent");
		const before = livePulseUsers.users();
		commit();
		expect(livePulseUsers.users()).toBe(before);
	});

	it("draws neither, and starts no loop, when not live", () => {
		const markup = html(
			createElement(LiveGlyph, {
				glyph: "✓",
				inkClass: "text-success",
				live: false,
			}),
		);
		expect(hasPulse(markup)).toBe(false);
		expect(hasTick(markup)).toBe(false);
		const before = livePulseUsers.users();
		commit();
		expect(livePulseUsers.users()).toBe(before);
	});
});

describe("ToolRow carries the indicator only while running", () => {
	it.each([
		["running", true],
		["composing", false],
		["queued", false],
		["done", false],
		["failed", false],
	] as const)("%s → live %s", (state, live) => {
		const markup = html(
			createElement(ToolRow, {
				entry: tool({
					id: `t-${state}`,
					tool_state: state,
					final: state !== "running",
				}),
			}),
		);
		expect(hasPulse(markup)).toBe(live);
		expect(hasTick(markup)).toBe(false);
	});

	it("a running row under Reduce Motion gets the static tick instead", () => {
		seam.reduceMotion = true;
		const markup = html(
			createElement(ToolRow, {
				entry: tool({ id: "t-rm", tool_state: "running" }),
			}),
		);
		expect(hasTick(markup)).toBe(true);
		expect(hasPulse(markup)).toBe(false);
	});
});

describe("FoldBar carries the indicator while it holds a running call", () => {
	const fold = (states: TranscriptEntry["tool_state"][]): FoldRun => {
		const run = buildFoldRun(
			states.map((state, i) => tool({ id: `f${i}`, tool_state: state })),
			{},
		);
		if (run === null) throw new Error("fixture did not fold");
		return run;
	};
	const bar = (run: FoldRun, open = false) =>
		html(
			createElement(FoldBar, {
				foldKey: run.key,
				fold: run,
				open,
				onToggle: () => {},
			}),
		);

	it("closed over a running call → pulse", () => {
		expect(hasPulse(bar(fold(["done", "done", "running"])))).toBe(true);
	});

	it("closed over a running call under Reduce Motion → static tick", () => {
		seam.reduceMotion = true;
		const markup = bar(fold(["done", "done", "running"]));
		expect(hasTick(markup)).toBe(true);
		expect(hasPulse(markup)).toBe(false);
	});

	it("open → the row below carries it, the bar stays still", () => {
		const markup = bar(fold(["done", "done", "running"]), true);
		expect(hasPulse(markup)).toBe(false);
		expect(hasTick(markup)).toBe(false);
	});

	it("only composing/queued → dim and still, like ToolRow", () => {
		const markup = bar(fold(["done", "done", "composing"]));
		expect(hasPulse(markup)).toBe(false);
		expect(markup).not.toContain("text-accent");
	});

	it("settled → still", () => {
		expect(hasPulse(bar(fold(["done", "done", "done"])))).toBe(false);
	});
});
