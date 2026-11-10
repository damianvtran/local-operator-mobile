import type React from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingAsk } from "@/contracts";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The ask bar above the composer (operator feedback, TestFlight build 753:
 * "make it so that timed out questions don't show up as a bar like this, and
 * maybe improve the position/placement, it looks ugly").
 *
 * Units run in Node, so `react-native` is a pass-through that records the
 * Pressable's props (its name, test id and press) and the class names drawn.
 * Geometry is a rendered-frame question, not a unit one.
 */

const probe = vi.hoisted(() => ({
	pressables: [] as Array<{
		testID?: string;
		accessibilityLabel?: string;
		accessibilityHint?: string;
		onPress?: () => void;
		className?: string;
	}>,
	classes: [] as string[],
}));

vi.mock("react-native", async () => {
	const React = await import("react");
	return {
		View: ({
			children,
			className,
		}: {
			children?: React.ReactNode;
			className?: string;
		}) => {
			if (className) probe.classes.push(className);
			return React.createElement("div", null, children ?? null);
		},
		Text: ({
			children,
			className,
		}: {
			children?: React.ReactNode;
			className?: string;
		}) => {
			if (className) probe.classes.push(className);
			return React.createElement("span", null, children ?? null);
		},
		Pressable: (props: {
			children: (state: { pressed: boolean }) => React.ReactNode;
			testID?: string;
			accessibilityLabel?: string;
			accessibilityHint?: string;
			onPress?: () => void;
			className?: string;
		}) => {
			probe.pressables.push(props);
			if (props.className) probe.classes.push(props.className);
			return React.createElement(
				"button",
				null,
				props.children({ pressed: false }),
			);
		},
	};
});
vi.mock("@/ui/layout", () => ({ TOUCH_FLOOR: 44 }));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));

/** Any of the old card's border classes. */
const CARD_BORDER = /\bborder\b|border-accent-border|border-hairline/;

const { AskBar } = await import("@/features/session/components/ask-bar");
const { SURFACE } = await import("@/ui/a11y");

const ask = (
	id: string,
	status: string,
	question: string,
	created = 1,
): PendingAsk =>
	({
		ask_id: id,
		status,
		created_at: created,
		questions: [{ question }],
	}) as unknown as PendingAsk;

let shim: DomShim;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	shim = installDomShim();
	root = createRoot(shim.container as Element);
	probe.pressables = [];
	probe.classes = [];
});
afterEach(() => {
	act(() => root.unmount());
	shim.dispose();
});

type Node = {
	nodeValue?: string | null;
	textContent?: string | null;
	childNodes: Node[];
};
/* The DOM shim writes a lone string child as `textContent`, so both are read
 *  (the same walker as `working-line.test.ts`). */
const textOf = (node: Node): string =>
	node.childNodes.length === 0
		? (node.nodeValue ?? node.textContent ?? "")
		: node.childNodes.map(textOf).join("");

const draw = (asks: PendingAsk[] | undefined, onOpen = () => {}) => {
	act(() => root.render(createElement(AskBar, { asks, onOpen })));
	return textOf(shim.container as unknown as Node);
};

describe("AskBar (build 753)", () => {
	it("paints nothing for a queue of only timed-out asks", () => {
		const text = draw([
			ask("t1", "timed_out", "May I remove the clean build?"),
			ask("t2", "timed_out", "Which branch?"),
		]);
		expect(probe.pressables).toHaveLength(0);
		expect(text).toBe("");
	});

	it("paints one row for one pending ask among timed-out ones, naming only the waiting question", () => {
		let opened = 0;
		const text = draw(
			[
				ask("t1", "timed_out", "Old lapsed question", 0),
				ask("o1", "open", "Ship it today?", 2),
			],
			() => {
				opened += 1;
			},
		);
		expect(probe.pressables).toHaveLength(1);
		const bar = probe.pressables[0];
		if (bar === undefined) throw new Error("no bar drawn");
		/* Test id, accessible name and hint are unchanged. */
		expect(bar.testID).toBe(SURFACE.askBar);
		expect(bar.accessibilityLabel).toBe("1 question waiting");
		expect(bar.accessibilityHint).toBe("Show the questions");
		/* Visible: glyph, short count, the waiting question, chevron. */
		expect(text).toBe("?1 question· Ship it today?▸");
		bar.onPress?.();
		expect(opened).toBe(1);
	});

	it("is borderless at rest: no card border or resting wash", () => {
		draw([ask("o1", "open", "Ship it today?")]);
		const drawn = probe.classes.join(" ");
		expect(drawn).not.toMatch(CARD_BORDER);
		expect(drawn).not.toContain("bg-accent-wash");
		expect(drawn).not.toContain("bg-surface");
	});

	it("paints nothing for no asks or a missing list", () => {
		draw([]);
		draw(undefined);
		expect(probe.pressables).toHaveLength(0);
	});
});
