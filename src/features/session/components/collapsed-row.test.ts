import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The fold primitive's own behaviour: ONE line with a chevron, and a press that
 * opens the body IN PLACE.
 *
 * The two facts this file exists for are the two that make the fold safe:
 *  - the collapsed row shows the summary and NOT the rest of the body (a fold
 *    that still painted the body would be decorative);
 *  - pressing it opens the body and flipping `aria-expanded`, with the state held
 *    by the row itself — nothing tells the transcript, so the list cannot scroll
 *    and the reader does not lose their place.
 *
 * It renders through `react-dom` with a stubbed `react-native` host (the repo's
 * convention for a component whose contract is behaviour rather than pixels).
 */

type PressProps = {
	onPress?: () => void;
	onPressIn?: () => void;
	onPressOut?: () => void;
	accessibilityState?: { expanded?: boolean };
	accessibilityRole?: string;
	accessibilityLabel?: string;
	style?: { minHeight?: number };
};
const presses = vi.hoisted(() => ({
	last: null as PressProps | null,
	/** What the stub Pressable reports to a `({ pressed })` render child. */
	pressed: false,
	/** Every className a host element was drawn with, in render order. */
	classes: [] as { host: string; className: string; style?: unknown }[],
	/** The text scale the stubbed provider reports (D1: 2 = 200 %). */
	scale: 1,
}));

vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({
		effectiveScale: presses.scale,
		scale: presses.scale,
	}),
}));

vi.mock("react-native", async () => {
	const React = await import("react");
	const host =
		(name: string) =>
		({
			children,
			className,
			style,
		}: {
			children?: React.ReactNode;
			className?: string;
			style?: unknown;
		}) => {
			presses.classes.push({ host: name, className: className ?? "", style });
			return children ?? null;
		};
	return {
		Platform: { OS: "web" },
		View: host("View"),
		Text: host("Text"),
		Pressable: (
			props: PressProps & {
				children?:
					| React.ReactNode
					| ((state: { pressed: boolean }) => React.ReactNode);
				className?: string;
			},
		) => {
			presses.last = props;
			presses.classes.push({
				host: "Pressable",
				className: props.className ?? "",
			});
			return typeof props.children === "function"
				? props.children({ pressed: presses.pressed })
				: (props.children ?? null);
		},
		StyleSheet: {
			create: (value: unknown) => value,
			flatten: (v: unknown) => v,
		},
	};
});

const { CollapsedRow } = await import(
	"@/features/session/components/collapsed-row"
);

/** Every string the tree currently carries.
 *
 *  react-dom does NOT always create a text node: for an element with a single
 *  string child it sets `textContent` instead, and a shim that only walks
 *  `childNodes` therefore reads some rows as empty. Both are read here. */
function textOf(node: unknown): string {
	const stub = node as {
		childNodes?: unknown[];
		nodeName?: string;
		textContent?: unknown;
		nodeValue?: unknown;
	};
	if (!stub || typeof stub !== "object") return "";
	const children = stub.childNodes ?? [];
	if (stub.nodeName === "#text") {
		return String(stub.nodeValue ?? stub.textContent ?? "");
	}
	const own =
		children.length === 0 && typeof stub.textContent === "string"
			? stub.textContent
			: "";
	return own + children.map(textOf).join("");
}

const WHITESPACE = /\s+/;

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;

const BODY = "first line of the peer message\nand its second line";

const render = async (open?: boolean, pressed = false) => {
	presses.pressed = pressed;
	presses.last = null;
	presses.classes.length = 0;
	await act(async () =>
		root?.render(
			createElement(
				CollapsedRow,
				/* `children` is required on the props type and supplied as the third
				 *  argument (biome's rule, and React's own): the cast is only for that
				 *  split. */
				{
					glyph: "↔",
					label: "reviewer",
					summary: "first line of the peer message",
					meta: "Reply requested",
					accessibilityLabel: BODY,
				} as unknown as Parameters<typeof CollapsedRow>[0],
				createElement("span", null, BODY),
			),
		),
	);
	if (open === true) {
		await act(async () => presses.last?.onPress?.());
	}
};

beforeEach(() => {
	presses.scale = 1;
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
});

describe("one collapsed line", () => {
	it("shows the label, the summary, the meta and a closed chevron — not the body", async () => {
		await render();
		const text = textOf(dom?.container);
		expect(text).toContain("reviewer");
		expect(text).toContain("first line of the peer message");
		expect(text).toContain("Reply requested");
		expect(text).toContain("▸");
		expect(text).not.toContain("second line");
	});

	it("is a button that says it is closed, and names the whole body", async () => {
		await render();
		expect(presses.last?.accessibilityRole).toBe("button");
		expect(presses.last?.accessibilityState).toEqual({ expanded: false });
		expect(presses.last?.accessibilityLabel).toBe(BODY);
	});

	it("opens in place on a press: the body appears, the chevron turns", async () => {
		await render(true);
		const text = textOf(dom?.container);
		expect(text).toContain("second line");
		expect(text).toContain("▾");
		expect(presses.last?.accessibilityState).toEqual({ expanded: true });
	});

	it("closes again on a second press", async () => {
		await render(true);
		await act(async () => presses.last?.onPress?.());
		expect(textOf(dom?.container)).not.toContain("second line");
		expect(presses.last?.accessibilityState).toEqual({ expanded: false });
	});
});

describe("open state owned by the caller (round 1, Q5 / U6 / U2)", () => {
	const renderControlled = async (
		open: boolean,
		onToggle: (next: boolean) => void,
		action?: unknown,
	) => {
		await act(async () =>
			root?.render(
				createElement(
					CollapsedRow,
					{
						glyph: "↳",
						summary: "first line of the peer message",
						open,
						onToggle,
						action,
					} as unknown as Parameters<typeof CollapsedRow>[0],
					createElement("span", null, BODY),
				),
			),
		);
	};

	it("draws what the caller says and asks it for the next state", async () => {
		const asked: boolean[] = [];
		await renderControlled(true, (next) => asked.push(next));
		// Open because the caller said so — no press happened.
		expect(textOf(dom?.container)).toContain("second line");
		await act(async () => presses.last?.onPress?.());
		expect(asked).toEqual([false]);
		// The row did not flip itself: the caller has not re-rendered it closed.
		expect(textOf(dom?.container)).toContain("second line");
	});

	it("keeps an action on the bar whether the row is open or not (R1-3)", async () => {
		const action = createElement("span", null, "open");
		await renderControlled(false, () => {}, action);
		expect(textOf(dom?.container)).toContain("open");
		await renderControlled(true, () => {}, action);
		expect(textOf(dom?.container)).toContain("open");
	});
});

describe("the expanded body starts on the bar's text column (design round 1, D3)", () => {
	it("repeats the bar's padding, glyph column and gap", async () => {
		await render(true);
		const words = (className: string) => new Set(className.split(WHITESPACE));
		/* The bar's line is the Pressable's render child — the one View drawn
		 *  with the summary's flex row. */
		const bar = presses.classes.find(
			(c) => c.host === "View" && words(c.className).has("items-center"),
		);
		const glyph = presses.classes.find(
			(c) => c.host === "Text" && words(c.className).has("w-4"),
		);
		const body = presses.classes.find(
			(c) => c.host === "View" && words(c.className).has("pb-1"),
		);
		const spacer = presses.classes.find(
			(c) => c.host === "View" && c.className === "w-4 shrink-0",
		);
		expect(bar && glyph && body && spacer).toBeTruthy();
		/* Horizontal start of the text, both places, 24 pt inside the row: the
		 *  body's `px-0` + 16 pt spacer + `gap-2`, and the bar's 16 pt glyph
		 *  slot + its pressable's `ps-2` — the glyph now stands OUTSIDE the
		 *  pressable (PR #223 CI, U-41), so the gap became the button's inset. */
		expect(words(bar?.className ?? "").has("ps-2")).toBe(true);
		for (const token of ["px-0", "gap-2"]) {
			expect(words(body?.className ?? "").has(token)).toBe(true);
		}
		expect(
			presses.classes.some(
				(c) => c.host === "View" && c.className === "w-4 shrink-0",
			),
		).toBe(true);
		expect(words(glyph?.className ?? "").has("shrink-0")).toBe(true);
	});
});

describe("a folded row is a quiet line, not a card (design round 3, D4)", () => {
	/* Anything that draws an edge, a fill or a corner at rest. The first
	 *  rendered frames showed the card version reading heavier than the notice
	 *  lines above it. */
	const CHROME = /^(border|bg-|rounded)/;

	it("draws no border, fill or radius at rest, open or closed", async () => {
		for (const open of [false, true]) {
			await render(open);
			const chrome = presses.classes.flatMap((c) =>
				c.className.split(WHITESPACE).filter((word) => CHROME.test(word)),
			);
			expect(chrome).toEqual([]);
		}
	});

	it("tints only while pressed", async () => {
		const tinted = () =>
			presses.classes.some((c) =>
				c.className.split(WHITESPACE).includes("bg-row-hover"),
			);
		await render(false);
		expect(tinted()).toBe(false);
		/* The wash is the ROW's (glyph slot + button), lifted out of the
		 *  pressable since the glyph left it (PR #223 CI, U-41/U-08): it follows
		 *  the button's press-in and press-out. */
		presses.classes.length = 0;
		await act(async () => presses.last?.onPressIn?.());
		expect(tinted()).toBe(true);
		const wash = presses.classes.find((c) =>
			c.className.split(WHITESPACE).includes("bg-row-hover"),
		);
		expect(wash?.className.split(WHITESPACE)).toContain("items-baseline");
		presses.classes.length = 0;
		await act(async () => presses.last?.onPressOut?.());
		expect(tinted()).toBe(false);
	});

	it("keeps the touch floor as its minimum height", async () => {
		await render();
		expect(presses.last?.style?.minHeight).toBeGreaterThanOrEqual(44);
	});
});

describe("the label never starves the summary (design round 1 of PR 223, D1)", () => {
	const words = (className: string) => new Set(className.split(WHITESPACE));
	const labelOf = () =>
		presses.classes.find(
			(c) => c.host === "Text" && words(c.className).has("text-meta"),
		);
	/** The label + summary column only the stacked layout draws. */
	const stackOf = () =>
		presses.classes.find(
			(c) => c.host === "View" && c.className === "min-w-0 flex-1",
		);

	it("caps the label with a STYLE at normal text (the class never applied on web)", async () => {
		await render();
		expect(labelOf()?.style).toEqual({ maxWidth: "50%" });
		expect(words(labelOf()?.className ?? "").has("max-w-1/2")).toBe(false);
		expect(stackOf()).toBeUndefined();
	});

	it("stacks label over summary at large text, each one line on the text rail", async () => {
		presses.scale = 2;
		await render();
		expect(stackOf()).toBeDefined();
		expect(labelOf()?.style).toBeUndefined();
		const text = textOf(dom?.container);
		expect(text).toContain("reviewer");
		expect(text).toContain("first line of the peer message");
		// The summary no longer flexes beside the label: it owns its line.
		const summary = presses.classes.find(
			(c) => c.host === "Text" && words(c.className).has("text-body-sm"),
		);
		expect(words(summary?.className ?? "").has("flex-1")).toBe(false);
	});

	it("a label-less row (a folded long notice) keeps `flex-1` on its summary at large text (R2-1)", async () => {
		presses.scale = 2;
		presses.classes.length = 0;
		await act(async () =>
			root?.render(
				createElement(
					CollapsedRow,
					{
						glyph: "·",
						summary:
							"a long notice that must shrink rather than push the chevron off",
						meta: "woken",
						accessibilityLabel: "notice",
					} as unknown as Parameters<typeof CollapsedRow>[0],
					createElement("span", null, "body"),
				),
			),
		);
		expect(stackOf()).toBeUndefined();
		const summary = presses.classes.find(
			(c) => c.host === "Text" && words(c.className).has("text-body-sm"),
		);
		expect(words(summary?.className ?? "").has("flex-1")).toBe(true);
		expect(words(summary?.className ?? "").has("min-w-0")).toBe(true);
		// Not stacked, so the line stays centred in the touch floor.
		const line = presses.classes.find(
			(c) =>
				c.host === "View" &&
				words(c.className).has("flex-row") &&
				words(c.className).has("ps-2"),
		);
		expect(words(line?.className ?? "").has("items-center")).toBe(true);
	});

	it("stacked: glyph and chevron key to the first line, on-scale, not between the two (Q2-2)", async () => {
		presses.scale = 2;
		await render();
		const line = presses.classes.find(
			(c) =>
				c.host === "View" &&
				words(c.className).has("flex-row") &&
				words(c.className).has("ps-2"),
		);
		expect(words(line?.className ?? "").has("items-start")).toBe(true);
		expect(words(line?.className ?? "").has("items-center")).toBe(false);
		const glyph = presses.classes.find(
			(c) => c.host === "Text" && words(c.className).has("w-4"),
		);
		expect(glyph).toBeDefined();
		/* PR #223 CI: `pt-0.5` (2 pt) failed U-42 at 200 %. The glyph keys to
		 * the label's line through the baseline-aligned slot instead — no
		 * padding, so nothing off `space.scale`. */
		expect(words(glyph?.className ?? "").has("pt-0.5")).toBe(false);
		const slotRow = presses.classes.find(
			(c) => c.host === "View" && words(c.className).has("items-baseline"),
		);
		expect(slotRow).toBeDefined();
	});
});
