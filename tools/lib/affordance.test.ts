import { afterEach, describe, expect, it } from "vitest";

import { CELL_OPENERS } from "../visual/matrix.ts";
import {
	type Affordance,
	affordanceScript,
	describeAffordance,
	describeAffordances,
	narrowAffordances,
	runAffordances,
} from "./affordance.ts";

/**
 * The harness's press, EXECUTED rather than eyeballed.
 *
 * This file exists because the first version of `affordanceScript` shipped a
 * selector without its outer quotes — `querySelector([data-testid="x"])` — and
 * every capture that used it died with `SyntaxError: Invalid left-hand side in
 * assignment`, which is a message about nothing. A compile check plus a stub
 * DOM turns that class of mistake into a failing test here rather than a failed
 * twenty-minute capture run.
 *
 * The stubs are deliberately minimal: what is under test is the SCRIPT (does it
 * quote correctly, does it press the right element, does it type the way React
 * notices), not a browser.
 */

interface StubNode {
	disabled?: boolean;
	value?: string;
	tagName?: string;
	getAttribute: (name: string) => string | null;
	dispatchEvent: (event: { type: string }) => boolean;
	/** Present on the node `stubDom` builds; a test may override it to answer as a
	 *  PARENT answering for a child (the labelled-button case). */
	contains?: (other: unknown) => boolean;
}

interface StubGlobal {
	document?: unknown;
	window?: unknown;
	PointerEvent?: unknown;
	MouseEvent?: unknown;
	Event?: unknown;
	HTMLInputElement?: unknown;
	HTMLTextAreaElement?: unknown;
	getComputedStyle?: unknown;
	requestAnimationFrame?: unknown;
}

const globals = globalThis as StubGlobal;
const saved: StubGlobal = {};

/** A prototype carrying the `value` accessor React's own setter path expects. */
function valueAccessor(): object {
	const proto: Record<string, unknown> = {};
	Object.defineProperty(proto, "value", {
		get(this: { held?: string }): string {
			return this.held ?? "";
		},
		set(this: { held?: string }, next: string): void {
			this.held = next;
		},
		configurable: true,
	});
	return proto;
}

/** The computed style a stubbed node reports. `VISIBLE` is a plain painted box. */
const VISIBLE = {
	opacity: "1",
	visibility: "visible",
	display: "block",
	overflowX: "visible",
	overflowY: "visible",
};

type Box = { left: number; top: number; width: number; height: number };

/**
 * A box in the shape the page's own `getBoundingClientRect` answers with.
 *
 * `right`/`bottom` are DERIVED here rather than typed into every case, and that
 * is not tidiness: the guard compares a control against its clipping ancestors by
 * those two edges, so a stub carrying only `left`/`top`/`width`/`height` makes
 * every edge comparison `undefined`, the clip is never noticed, and the test
 * passes for the wrong reason. (It did: the hidden-clip case below reported
 * `ok-after-scroll` until this existed.)
 */
const domRect = (box: Box): Box & { right: number; bottom: number } => ({
	...box,
	right: box.left + box.width,
	bottom: box.top + box.height,
});

/** One clipping/scrolling ancestor, innermost first. */
interface StubAncestor {
	rect: Box;
	style?: Partial<typeof VISIBLE>;
	/** Given it moves when `scrollIntoView` runs, the browser's own half of a scroll. */
	scrolls?: boolean;
}

/** The box a stubbed control reports, and what is under the point a press lands on. */
interface ReachOptions {
	/** The control's own box. `{0,0,0,0}` is a control with no box at all. */
	rect?: Box;
	/** What `elementFromPoint` answers — the covering surface, when one is wanted. */
	hit?: unknown;
	/** The control's own computed style, over `VISIBLE`. `opacity: "0"` is the
	 *  transparent-but-sized control the older guard pressed. */
	style?: Partial<typeof VISIBLE>;
	/** The control's ancestors, innermost first: the boxes it must fit inside, and
	 *  the ones a scroll would move. */
	ancestors?: StubAncestor[];
	/** Where the control IS after a scroll brought it in — absent means the scroll
	 *  did not help, which is its own case. */
	afterScroll?: Box;
	/**
	 * A sequence of boxes, one per reading, the last repeating: what an entry
	 * animation looks like from the page's side. Used to pin that a verdict is
	 * taken from the SETTLED box rather than from whichever frame the opener
	 * happened to run on (round 3, R15).
	 */
	rects?: Box[];
}

/**
 * Build the page-side environment one script run needs, and record it.
 *
 * The stubbed node is REACHABLE by default — a 40×40 box with itself under the
 * press point — because every action now runs the reader's own test first (a
 * non-zero box and `elementFromPoint` inside the element). A test that wants the
 * unreachable answer passes a zero box or a different element under the point.
 * Until this stub existed those calls were simply absent, which is how the old
 * script could press a covered control: it never asked.
 */
function stubDom(
	node: StubNode | null,
	reach: ReachOptions = {},
): {
	events: string[];
	nodes: string[];
	scrolled: number[];
	ancestors: Array<{ scrollTop: number; scrollLeft: number }>;
} {
	const events: string[] = [];
	const nodes: string[] = [];
	const scrolled: number[] = [];
	/* The events are recorded where they are CONSTRUCTED, which is also where they
	 *  are dispatched — the script builds one per press and dispatches it once, so
	 *  a constructor-side record is the press sequence in order. */
	const record = (type: string) => {
		events.push(type);
		return { type };
	};
	saved.document = globals.document;
	saved.window = globals.window;
	saved.PointerEvent = globals.PointerEvent;
	saved.MouseEvent = globals.MouseEvent;
	saved.Event = globals.Event;
	saved.HTMLInputElement = globals.HTMLInputElement;
	saved.HTMLTextAreaElement = globals.HTMLTextAreaElement;
	saved.getComputedStyle = globals.getComputedStyle;
	saved.requestAnimationFrame = globals.requestAnimationFrame;

	const rect = reach.rect ?? { left: 0, top: 0, width: 40, height: 40 };
	/* The annotation is load-bearing: `contains` names the object it belongs to, so
	 *  without it the initializer is circular and TypeScript refuses the whole
	 *  stub rather than the one member. */
	type Reachable = StubNode & {
		getBoundingClientRect: () => {
			left: number;
			top: number;
			width: number;
			height: number;
		};
		scrollIntoView: () => void;
		contains: (other: unknown) => boolean;
	};
	/* The ancestors, each carrying its own box and style, so a test can place the
	 *  control under a clipping box or inside a scroll region. The browser's half of
	 *  a scroll is simulated on the ones marked `scrolls`. */
	const ancestors = (reach.ancestors ?? []).map((ancestor) => ({
		rect: ancestor.rect,
		style: { ...VISIBLE, ...ancestor.style },
		scrollTop: 0,
		scrollLeft: 0,
		getBoundingClientRect: () => domRect(ancestor.rect),
		movesOnScroll: ancestor.scrolls === true,
	}));

	const styleOf = new Map<unknown, Partial<typeof VISIBLE>>();
	const reachable: Reachable | null =
		node === null
			? null
			: {
					getBoundingClientRect: () =>
						domRect(
							scrolled.length > 0 && reach.afterScroll
								? reach.afterScroll
								: rect,
						),
					scrollIntoView: () => {
						scrolled.push(1);
						/* A real `scrollIntoView` moves the scrollers AND, when the
						 *  control needs it, the document — which is the offset the
						 *  restore has to cover (round 3, Q6). */
						const scrolling = (
							globals.document as {
								scrollingElement?: { scrollTop: number; scrollLeft: number };
							}
						)?.scrollingElement;
						if (scrolling) {
							scrolling.scrollTop = 500;
							scrolling.scrollLeft = 7;
						}
						for (const ancestor of ancestors) {
							if (!ancestor.movesOnScroll) continue;
							ancestor.scrollTop = 100;
							ancestor.scrollLeft = 10;
						}
					},
					contains: (other: unknown) => other === reachable,
					...node,
				};

	if (reachable) {
		styleOf.set(reachable, { ...VISIBLE, ...reach.style });
		/* The chain runs innermost-first, so each node's parent is the next ancestor
		 *  and the last one's is null — which is what ends the script's walk. */
		const chain = [reachable, ...ancestors];
		for (const [index, entry] of chain.entries()) {
			(entry as { parentElement?: unknown }).parentElement =
				chain[index + 1] ?? null;
		}
		for (const ancestor of ancestors) styleOf.set(ancestor, ancestor.style);
	}

	/*
	 * THE HIT TEST ANSWERS THE WAY A BROWSER DOES: a point outside the viewport is
	 * nothing, and an element clipped away by an ancestor resolves to that ancestor.
	 * A stub that always answered "the element" made every off-screen control look
	 * reachable in place — so `ok-after-scroll` and the hidden-clip refusal could
	 * not be distinguished from `ok` here, which is exactly what these cases test.
	 */
	const clippedAway = (): boolean => {
		const r = reachable?.getBoundingClientRect();
		if (!r) return false;
		for (const ancestor of ancestors) {
			const overflow = ancestor.style.overflowY ?? "visible";
			if (overflow === "visible") continue;
			const outer = ancestor.rect;
			if (
				r.top + r.height <= outer.top ||
				r.top >= outer.top + outer.height ||
				r.left + r.width <= outer.left ||
				r.left >= outer.left + outer.width
			)
				return true;
		}
		return false;
	};

	globals.document = {
		querySelector: (selector: string) => {
			nodes.push(selector);
			return reachable;
		},
		elementFromPoint: (x: number, y: number) => {
			if ("hit" in reach) return reach.hit;
			if (x < 0 || y < 0 || x > 400 || y > 800) return null;
			if (clippedAway()) return ancestors[0] ?? null;
			return reachable;
		},
		documentElement: {
			clientWidth: 400,
			clientHeight: 800,
			scrollTop: 0,
			scrollLeft: 0,
		},
		scrollingElement: { scrollTop: 0, scrollLeft: 0 },
	};
	globals.getComputedStyle = (element: unknown) =>
		styleOf.get(element) ?? VISIBLE;
	/* The settle loop is two frames per reading. Real timers, zero delay: the
	 *  stubbed box does not move, so two readings agree immediately. */
	globals.requestAnimationFrame = (callback: (time: number) => void) =>
		setTimeout(() => callback(0), 0) as unknown as number;
	globals.window = {};
	globals.PointerEvent = class {
		constructor(public type: string) {
			record(type);
		}
	};
	globals.MouseEvent = class {
		constructor(public type: string) {
			record(type);
		}
	};
	globals.Event = class {
		constructor(public type: string) {
			record(type);
		}
	};
	/* An ACCESSOR on the prototype, because that is what the script reaches for:
	 *  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set`.
	 *  A data property has no `set`, and a class FIELD puts the descriptor on the
	 *  instance — either stub would make the script throw rather than type. */
	globals.HTMLInputElement = { prototype: valueAccessor() };
	globals.HTMLTextAreaElement = { prototype: valueAccessor() };
	return { events, nodes, scrolled, ancestors };
}

function restore(): void {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete (globals as Record<string, unknown>)[key];
		else (globals as Record<string, unknown>)[key] = value;
	}
}

/** The page's reply, parsed the way `runAffordances` parses it.
 *
 *  AWAITED, because every script is now an `async` IIFE: the reader's approach
 *  waits for the layout to stop moving before it measures (round 3, R15), and the
 *  page's `Runtime.evaluate` is called with `awaitPromise`. */
async function answer(script: string): Promise<{ result: string; pre?: Box }> {
	return JSON.parse(String(await run(script))) as { result: string; pre?: Box };
}

/** Run one script the way `page.evaluate` does: as an expression, by value. */
async function run(script: string): Promise<unknown> {
	/* The script is an IIFE, so the expression's value IS the result: one call, and
	 *  the second `()` this used to carry called the string it returned. */
	const factory = new Function(`return (${script})`) as () => unknown;
	return await (factory() as Promise<unknown>);
}

afterEach(restore);

describe("the affordance script", () => {
	it("compiles as an expression, whatever the id contains", async () => {
		/* The bug this pins: a selector spliced in unquoted is a SyntaxError, and
		 *  the page reports it as an arithmetic error rather than as a bad
		 *  selector. `new Function` is the cheapest compile check available. */
		const hostile: Affordance[] = [
			{ click: "projects-new" },
			{ click: 'a"b' },
			{ click: "a\\b" },
			{ click: "project-milestone-toggle-ship/v2" },
			{ type: { testID: 'a"b', text: 'he said "hi"' } },
			{ type: { testID: "x", text: "line\nbreak" } },
		];
		for (const action of hostile) {
			expect(
				() => new Function(`return (${affordanceScript(action)})`),
			).not.toThrow();
		}
	});

	it("addresses the control by its declared id", async () => {
		const { nodes } = stubDom(null);
		expect(
			(await answer(affordanceScript({ click: "projects-new" }))).result,
		).toBe("missing");
		expect(nodes).toEqual(['[data-testid="projects-new"]']);
	});

	it("quotes an id that contains a quote, rather than ending the selector", async () => {
		const { nodes } = stubDom(null);
		await run(affordanceScript({ click: 'a"b' }));
		expect(nodes).toEqual(['[data-testid="a\\"b"]']);
	});

	it("presses with the whole pointer+mouse+click sequence", async () => {
		/* React Native Web resolves a press through the responder system, which a
		 *  bare `click` does not drive — that is the whole reason the sequence is
		 *  spelled out rather than left to `element.click()`. */
		const { events } = stubDom({
			getAttribute: () => null,
			dispatchEvent: () => true,
		});
		expect(
			(await answer(affordanceScript({ click: "projects-new" }))).result,
		).toBe("ok");
		expect(events).toEqual([
			"pointerdown",
			"mousedown",
			"pointerup",
			"mouseup",
			"click",
		]);
	});

	it("reports a disabled control as inert, not as missing", async () => {
		const { events } = stubDom({
			disabled: true,
			getAttribute: () => null,
			dispatchEvent: () => true,
		});
		expect((await answer(affordanceScript({ click: "x" }))).result).toBe(
			"inert",
		);
		expect(events).toEqual([]);
	});

	it("leaves a control that is already on screen where it is", async () => {
		/* The scroll is a REPAIR, not a routine: `scrollIntoView({block: "center"})`
		 *  moves a scroller even when the control is fully visible, which is how an
		 *  earlier version of this guard scrolled eight of nine real cells to the
		 *  centre and took frames of a page no reader would have been looking at
		 *  (Q5). An on-screen control is pressed in place. */
		const { events, scrolled } = stubDom({
			getAttribute: () => null,
			dispatchEvent: () => true,
		});
		const reply = await answer(affordanceScript({ click: "projects-new" }));
		expect(reply.result).toBe("ok");
		expect(scrolled).toHaveLength(0);
		expect(events).toHaveLength(5);
	});

	it("scrolls an off-screen control in, answers ok-after-scroll with its resting box, and puts the scroll back", async () => {
		/* A control below the fold is one a reader reaches by scrolling, so the
		 *  action does what the reader does — but the answer SAYS so, carrying where
		 *  the control was, and the scroll is restored afterwards so the frame is of
		 *  the resting page again. Without the distinct answer, "the reader could not
		 *  see this control" would read as a pass, which is the class a declared
		 *  `UNSCROLLED_CONTROLS` entry now fails by name. */
		const { events, scrolled, ancestors } = stubDom(
			{ getAttribute: () => null, dispatchEvent: () => true },
			{
				rect: { left: 0, top: 900, width: 40, height: 40 },
				afterScroll: { left: 0, top: 300, width: 40, height: 40 },
				ancestors: [
					{
						rect: { left: 0, top: 0, width: 400, height: 800 },
						style: { overflowY: "auto" },
						scrolls: true,
					},
				],
			},
		);
		const reply = await answer(affordanceScript({ click: "projects-new" }));
		expect(reply.result).toBe("ok-after-scroll");
		expect(reply.pre).toEqual({ x: 0, y: 900, w: 40, h: 40 });
		expect(scrolled).toHaveLength(1);
		expect(events).toHaveLength(5);
		const scroller = ancestors[0];
		expect(scroller?.scrollTop).toBe(0);
		expect(scroller?.scrollLeft).toBe(0);
	});

	it("reports a control that scrolling cannot bring in as unreachable", async () => {
		const { events } = stubDom(
			{ getAttribute: () => null, dispatchEvent: () => true },
			{ rect: { left: 0, top: 900, width: 40, height: 40 } },
		);
		expect(
			(await answer(affordanceScript({ click: "never-in-view" }))).result,
		).toBe("unreachable");
		expect(events).toEqual([]);
	});

	it("refuses a control only a HIDDEN box's programmatic scroll could reveal", async () => {
		/* `scrollIntoView` reaches into an `overflow: hidden` ancestor a reader
		 *  cannot scroll, so the press would land on a control no reader could bring
		 *  into view — measured as a real leak of the older guard (`scrollTop` 0→140
		 *  then pressed, `ok`). */
		const { events } = stubDom(
			{ getAttribute: () => null, dispatchEvent: () => true },
			{
				rect: { left: 0, top: 900, width: 40, height: 40 },
				afterScroll: { left: 0, top: 300, width: 40, height: 40 },
				ancestors: [
					{
						rect: { left: 0, top: 0, width: 400, height: 800 },
						style: { overflowY: "hidden" },
					},
				],
			},
		);
		expect(
			(await answer(affordanceScript({ click: "clipped-away" }))).result,
		).toBe("unreachable");
		expect(events).toEqual([]);
	});

	it("refuses a control nothing paints, on itself or on an ancestor", async () => {
		/* `opacity: 0` is a sized, hit-testable, invisible control — transparent is
		 *  not visible, and the older guard pressed it and reported `ok`. */
		const onElement = stubDom(
			{ getAttribute: () => null, dispatchEvent: () => true },
			{ style: { opacity: "0" } },
		);
		expect((await answer(affordanceScript({ click: "faded" }))).result).toBe(
			"unreachable",
		);
		expect(onElement.events).toEqual([]);

		const onAncestor = stubDom(
			{ getAttribute: () => null, dispatchEvent: () => true },
			{
				ancestors: [
					{
						rect: { left: 0, top: 0, width: 400, height: 800 },
						style: { opacity: "0" },
					},
				],
			},
		);
		expect(
			(await answer(affordanceScript({ click: "inside-a-faded-box" }))).result,
		).toBe("unreachable");
		expect(onAncestor.events).toEqual([]);
	});

	it("retries the not-ready answers and stops on the terminal ones", async () => {
		/* THE RETRY RULE, pinned because it is asymmetric on purpose: `missing`,
		 *  `inert` and `unreachable` are all "not yet" (an element arriving, a
		 *  control React has not re-rendered, a control covered while a scrim
		 *  animates), while `not-a-field` is a DOM fact and `ok` is the landing.
		 *  `unreachable` used to break the poll on its first reading, which is the
		 *  flake class this test now refuses. */
		const script = affordanceScript({ click: "join" });
		const page = (replies: string[]) => {
			let index = 0;
			return {
				calls: () => index,
				evaluate: async () => replies[Math.min(index++, replies.length - 1)],
			};
		};
		return (async () => {
			const flaky = page([
				JSON.stringify({ result: "unreachable" }),
				JSON.stringify({ result: "unreachable" }),
				JSON.stringify({ result: "ok" }),
			]);
			const landed = await runAffordances(flaky as never, [{ click: "join" }], {
				waitMs: 50,
				pollMs: 1,
			});
			expect(landed[0]?.result).toBe("ok");
			expect(flaky.calls()).toBe(3);

			/* `not-a-field` is terminal: the poll must not spend its bound on it. */
			const terminal = page([JSON.stringify({ result: "not-a-field" })]);
			const answered = await runAffordances(
				terminal as never,
				[{ type: { testID: "x", text: "y" } }],
				{ waitMs: 50, pollMs: 1 },
			);
			expect(answered[0]?.result).toBe("not-a-field");
			expect(terminal.calls()).toBe(1);
			expect(script).toContain("scrollIntoView");
		})();
	});

	it("reports a control with no box as unreachable, and does not press it", async () => {
		/* THE DEFECT THIS PINS (review round 1, R1): `dispatchEvent` delivers
		 *  straight to the target, so the first version of this script pressed a
		 *  zero-size control and reported `ok`. A frame of that state is a frame of
		 *  something no reader could have reached. */
		const { events } = stubDom(
			{ getAttribute: () => null, dispatchEvent: () => true },
			{ rect: { left: 0, top: 0, width: 0, height: 0 } },
		);
		expect((await answer(affordanceScript({ click: "covered" }))).result).toBe(
			"unreachable",
		);
		expect(events).toEqual([]);
	});

	it("reports a control something else is drawn over as unreachable", async () => {
		/* The shape a second modal leaves: the control is in the page, enabled and
		 *  sized, and the point a press would land on belongs to the surface on top
		 *  of it. This is the class the audit's U-08 overlap rule catches by hand and
		 *  the opener could previously press straight through. */
		const { events } = stubDom(
			{ getAttribute: () => null, dispatchEvent: () => true },
			{ hit: { tagName: "DIV" } },
		);
		expect(
			(await answer(affordanceScript({ click: "under-a-modal" }))).result,
		).toBe("unreachable");
		expect(events).toEqual([]);
	});

	it("accepts a press whose point lands on a descendant of the control", async () => {
		/* A button's own box is under its label as often as under nothing: the label
		 *  is a child of the pressable, so `elementFromPoint` answers the `<Text>`.
		 *  Requiring identity rather than containment would report every labelled
		 *  control unreachable — which is why this case is asserted rather than
		 *  assumed. */
		const child = { tagName: "SPAN" };
		const { events } = stubDom(
			{
				getAttribute: () => null,
				dispatchEvent: () => true,
				contains: (other: unknown) => other === child,
			},
			{ hit: child },
		);
		expect((await answer(affordanceScript({ click: "labelled" }))).result).toBe(
			"ok",
		);
		expect(events).toHaveLength(5);
	});

	it("reports a non-field as not-a-field rather than throwing", async () => {
		/* `setter.call(el, …)` against a `div` throws `Illegal invocation` INSIDE
		 *  the page, which aborted the whole run instead of answering — a cell's id
		 *  pointing at the wrong kind of element is a cell problem, and it has its
		 *  own answer. */
		const { events } = stubDom({
			tagName: "DIV",
			getAttribute: () => null,
			dispatchEvent: () => true,
		});
		expect(
			(
				await answer(
					affordanceScript({ type: { testID: "not-a-field", text: "x" } }),
				)
			).result,
		).toBe("not-a-field");
		expect(events).toEqual([]);
	});

	it("types through the native value setter and one input event", async () => {
		const { events } = stubDom({
			tagName: "INPUT",
			getAttribute: () => null,
			dispatchEvent: () => true,
		});
		expect(
			(
				await answer(
					affordanceScript({
						type: { testID: "project-create-name", text: "vendor-sso-cutover" },
					}),
				)
			).result,
		).toBe("ok");
		/* ONE event, and it is `input`: a second (`change`) would fire a second
		 *  React update, and an app listening to `onChange` sees both as one. */
		// FOCUS FIRST, THEN ONE INPUT EVENT (review round 4, U3): the app's own states are
		// built on focus — the milestone form shows its slash rule while the field is
		// being typed in — so a cell that only sets the value reaches a state the reader
		// never sees, and cannot fail on what it claims to check.
		expect(events).toEqual(["focus", "focusin", "input"]);
	});

	it("holds a press for the cell's duration and releases it, as ONE outcome", async () => {
		/* THE ACTION THIS FILE WAS MISSING, and the reason round 3's BLOCKER was
		 *  invisible to every gate: `onLongPress` fires on a timer WHILE the finger
		 *  is down, so no amount of clicking reaches a gesture the app renders. The
		 *  pair is asserted here as one action — the down, the wait, the release —
		 *  and the outcome is the DOWN's verdict, so a manifest carries the gesture
		 *  rather than how it was made. */
		const { events, nodes } = stubDom({
			getAttribute: () => null,
			dispatchEvent: () => true,
		});
		const page = { evaluate: async (script: string) => await run(script) };
		const landed = await runAffordances(
			page as never,
			[{ hold: { testID: "session-row-abc", ms: 5 } }],
			{ waitMs: 50, pollMs: 1 },
		);

		expect(landed[0]?.result).toBe("ok");
		expect(nodes).toEqual([
			'[data-testid="session-row-abc"]',
			'[data-testid="session-row-abc"]',
		]);
		expect(events).toEqual([
			"pointerdown",
			"mousedown",
			"pointerup",
			"mouseup",
			"click",
		]);
	});

	it("takes its verdict from the SETTLED box, not from the frame it ran on", async () => {
		/* ROUND 3, R15. The description field's box ends at y 564 of a 568 pt phone
		 *  and the sheet RISES 40 pt on entry, so the same press read "on screen" or
		 *  "needed a scroll" depending on the animation frame — the frames were
		 *  byte-identical and the label was not. The approach waits for two frames
		 *  with the same box, so the verdict is a fact about the layout the reader
		 *  ends up looking at. */
		const animating = stubDom(
			{ getAttribute: () => null, dispatchEvent: () => true },
			{
				/* Down in the fold while the sheet rises, then at rest on screen. */
				rects: [
					{ left: 0, top: 900, width: 40, height: 40 },
					{ left: 0, top: 900, width: 40, height: 40 },
					{ left: 0, top: 300, width: 40, height: 40 },
					{ left: 0, top: 300, width: 40, height: 40 },
				],
			},
		);
		expect(
			(await answer(affordanceScript({ click: "rising-field" }))).result,
		).toBe("ok");
		expect(animating.scrolled).toHaveLength(0);
	});

	it("puts the DOCUMENT's scroll back too, not only the scrollers", async () => {
		/* Round 3, Q6: the walk collects `overflow: auto|scroll` ancestors, so a
		 *  press that moves the document was left displaced — latent on this app,
		 *  whose root leaves the document unscrollable, and wrong against the
		 *  property all the same. */
		const { events } = stubDom(
			{ getAttribute: () => null, dispatchEvent: () => true },
			{ rect: { left: 0, top: 900, width: 40, height: 40 } },
		);
		await answer(affordanceScript({ click: "below-the-fold" }));

		const scrolling = (
			globalThis as {
				document?: {
					scrollingElement?: { scrollTop: number; scrollLeft: number };
				};
			}
		).document?.scrollingElement;
		expect(scrolling?.scrollTop).toBe(0);
		expect(scrolling?.scrollLeft).toBe(0);
		expect(events).toHaveLength(0);
	});

	it("narrows every action the MATRIX declares, so no re-drive runs with an empty list", () => {
		/* THE GUARD FOR A SILENT NO-OP (round 3, found during the fold). The audit re-drives
		 *  a cell by replaying the openers the manifest recorded, so an action shape the
		 *  narrowing does not know is DROPPED — the re-drive then presses nothing at all,
		 *  which surfaces as `state-not-reproduced` and reads like the app's defect. That is
		 *  exactly what happened when `hold` was added: `S15/menu-open` re-driven with an
		 *  empty action list, three times, before the cause was read off the narrowing.
		 *  Asserting the SHAPES would not have caught it; asserting the matrix's own
		 *  declarations does, and it catches the next new shape on the day it lands. */
		const declared = Object.entries(CELL_OPENERS).flatMap(([cell, actions]) =>
			actions.map((action) => ({ cell, action })),
		);
		expect(declared.length).toBeGreaterThan(0);
		/* DEEP, not just "something came back" (review round 4, Q2): a length check passes
		 *  when a new FIELD on an existing kind is silently dropped — the same loss with a
		 *  smaller footprint (measured: an `{ hold: { testID, ms, button: "right" } }`
		 *  entry narrows to a `hold` without its button and nothing fails). Round-tripping
		 *  the value closes it: the guard compares the matrix's declarations as DATA. */
		const lost = declared.filter(
			({ action }) =>
				JSON.stringify(narrowAffordances([action])) !==
				JSON.stringify([action]),
		);
		expect(lost).toEqual([]);
		// And the shapes round-trip as themselves, not merely as "something".
		expect(narrowAffordances([{ hold: { testID: "row", ms: 1200 } }])).toEqual([
			{ hold: { testID: "row", ms: 1200 } },
		]);
		expect(
			narrowAffordances([{ click: "a" }, { type: { testID: "b", text: "c" } }]),
		).toEqual([{ click: "a" }, { type: { testID: "b", text: "c" } }]);
		// A malformed entry is still dropped rather than thrown on.
		expect(
			narrowAffordances([{ hold: { testID: "row" } }, "nonsense", 7]),
		).toEqual([]);
	});

	it("describes an action in one phrase, for a manifest or a failure", async () => {
		expect(describeAffordance({ click: "projects-new" })).toBe(
			"click projects-new",
		);
		expect(
			describeAffordance({
				type: { testID: "project-create-name", text: "x" },
			}),
		).toBe("type project-create-name");
		expect(describeAffordances([{ click: "a" }, { click: "b" }])).toBe(
			"click a, click b",
		);
		expect(describeAffordances([])).toBe("");
		expect(
			describeAffordance({ hold: { testID: "session-row-abc", ms: 600 } }),
		).toBe("hold session-row-abc 600ms");
		expect(
			describeAffordance({ hold: { testID: "session-row-abc", ms: 600 } }),
		).toBe("hold session-row-abc 600ms");
	});
});
