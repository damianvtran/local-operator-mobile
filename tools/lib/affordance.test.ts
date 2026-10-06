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

/** Build the page-side environment one script run needs, and record it. */
function stubDom(node: StubNode | null): { events: string[]; nodes: string[] } {
	const events: string[] = [];
	const nodes: string[] = [];
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

	globals.document = {
		querySelector: (selector: string) => {
			nodes.push(selector);
			return node;
		},
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
	return { events, nodes };
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
