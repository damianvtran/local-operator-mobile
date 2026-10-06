import { afterEach, describe, expect, it } from "vitest";

import {
	type Affordance,
	affordanceScript,
	describeAffordance,
	describeAffordances,
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

/** The box a stubbed control reports, and what is under the point a press lands on. */
interface ReachOptions {
	/** The control's own box. `{0,0,0,0}` is a control with no box at all. */
	rect?: { left: number; top: number; width: number; height: number };
	/** What `elementFromPoint` answers — the covering surface, when one is wanted. */
	hit?: unknown;
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
): { events: string[]; nodes: string[]; scrolled: number[] } {
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
	const reachable: Reachable | null =
		node === null
			? null
			: {
					getBoundingClientRect: () => rect,
					scrollIntoView: () => scrolled.push(1),
					contains: (other: unknown) => other === reachable,
					...node,
				};

	globals.document = {
		querySelector: (selector: string) => {
			nodes.push(selector);
			return reachable;
		},
		elementFromPoint: () => ("hit" in reach ? reach.hit : reachable),
	};
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
	return { events, nodes, scrolled };
}

function restore(): void {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete (globals as Record<string, unknown>)[key];
		else (globals as Record<string, unknown>)[key] = value;
	}
}

/** Run one script the way `page.evaluate` does: as an expression, by value. */
function run(script: string): unknown {
	/* The script is an IIFE, so the expression's value IS the result: one call, and
	 *  the second `()` this used to carry called the string it returned. */
	const factory = new Function(`return (${script})`) as () => unknown;
	return factory();
}

afterEach(restore);

describe("the affordance script", () => {
	it("compiles as an expression, whatever the id contains", () => {
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

	it("addresses the control by its declared id", () => {
		const { nodes } = stubDom(null);
		expect(run(affordanceScript({ click: "projects-new" }))).toBe("missing");
		expect(nodes).toEqual(['[data-testid="projects-new"]']);
	});

	it("quotes an id that contains a quote, rather than ending the selector", () => {
		const { nodes } = stubDom(null);
		run(affordanceScript({ click: 'a"b' }));
		expect(nodes).toEqual(['[data-testid="a\\"b"]']);
	});

	it("presses with the whole pointer+mouse+click sequence", () => {
		/* React Native Web resolves a press through the responder system, which a
		 *  bare `click` does not drive — that is the whole reason the sequence is
		 *  spelled out rather than left to `element.click()`. */
		const { events } = stubDom({
			getAttribute: () => null,
			dispatchEvent: () => true,
		});
		expect(run(affordanceScript({ click: "projects-new" }))).toBe("ok");
		expect(events).toEqual([
			"pointerdown",
			"mousedown",
			"pointerup",
			"mouseup",
			"click",
		]);
	});

	it("reports a disabled control as inert, not as missing", () => {
		const { events } = stubDom({
			disabled: true,
			getAttribute: () => null,
			dispatchEvent: () => true,
		});
		expect(run(affordanceScript({ click: "x" }))).toBe("inert");
		expect(events).toEqual([]);
	});

	it("scrolls the control into view before pressing it", () => {
		/* A control below the fold is one a reader reaches by scrolling, so the
		 *  action does what the reader does. Measured through the stub rather than
		 *  assumed: the press that lands after a scroll is the reader's own
		 *  sequence, and it is the difference between `ok` and `unreachable` for
		 *  every control on a screen taller than its window. */
		const { events, scrolled } = stubDom({
			getAttribute: () => null,
			dispatchEvent: () => true,
		});
		expect(run(affordanceScript({ click: "projects-new" }))).toBe("ok");
		expect(scrolled).toHaveLength(1);
		expect(events).toHaveLength(5);
	});

	it("reports a control with no box as unreachable, and does not press it", () => {
		/* THE DEFECT THIS PINS (review round 1, R1): `dispatchEvent` delivers
		 *  straight to the target, so the first version of this script pressed a
		 *  zero-size control and reported `ok`. A frame of that state is a frame of
		 *  something no reader could have reached. */
		const { events } = stubDom(
			{ getAttribute: () => null, dispatchEvent: () => true },
			{ rect: { left: 0, top: 0, width: 0, height: 0 } },
		);
		expect(run(affordanceScript({ click: "covered" }))).toBe("unreachable");
		expect(events).toEqual([]);
	});

	it("reports a control something else is drawn over as unreachable", () => {
		/* The shape a second modal leaves: the control is in the page, enabled and
		 *  sized, and the point a press would land on belongs to the surface on top
		 *  of it. This is the class the audit's U-08 overlap rule catches by hand and
		 *  the opener could previously press straight through. */
		const { events } = stubDom(
			{ getAttribute: () => null, dispatchEvent: () => true },
			{ hit: { tagName: "DIV" } },
		);
		expect(run(affordanceScript({ click: "under-a-modal" }))).toBe(
			"unreachable",
		);
		expect(events).toEqual([]);
	});

	it("accepts a press whose point lands on a descendant of the control", () => {
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
		expect(run(affordanceScript({ click: "labelled" }))).toBe("ok");
		expect(events).toHaveLength(5);
	});

	it("reports a non-field as not-a-field rather than throwing", () => {
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
			run(affordanceScript({ type: { testID: "not-a-field", text: "x" } })),
		).toBe("not-a-field");
		expect(events).toEqual([]);
	});

	it("types through the native value setter and one input event", () => {
		const { events } = stubDom({
			tagName: "INPUT",
			getAttribute: () => null,
			dispatchEvent: () => true,
		});
		expect(
			run(
				affordanceScript({
					type: { testID: "project-create-name", text: "vendor-sso-cutover" },
				}),
			),
		).toBe("ok");
		/* ONE event, and it is `input`: a second (`change`) would fire a second
		 *  React update, and an app listening to `onChange` sees both as one. */
		expect(events).toEqual(["input"]);
	});

	it("describes an action in one phrase, for a manifest or a failure", () => {
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
	});
});
