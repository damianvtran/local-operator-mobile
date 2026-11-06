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
	accessibilityState?: { expanded?: boolean };
	accessibilityRole?: string;
	accessibilityLabel?: string;
};
const presses = vi.hoisted(() => ({
	last: null as PressProps | null,
	/** Every className a host element was drawn with, in render order. */
	classes: [] as { host: string; className: string }[],
}));

vi.mock("react-native", async () => {
	const React = await import("react");
	const host =
		(name: string) =>
		({
			children,
			className,
		}: {
			children?: React.ReactNode;
			className?: string;
		}) => {
			presses.classes.push({ host: name, className: className ?? "" });
			return children ?? null;
		};
	return {
		Platform: { OS: "web" },
		View: host("View"),
		Text: host("Text"),
		Pressable: (
			props: PressProps & { children?: React.ReactNode; className?: string },
		) => {
			presses.last = props;
			presses.classes.push({
				host: "Pressable",
				className: props.className ?? "",
			});
			return props.children ?? null;
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

const render = async (open?: boolean) => {
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
	it("repeats the bar's border, padding, glyph column and gap", async () => {
		await render(true);
		const words = (className: string) => new Set(className.split(WHITESPACE));
		const pressable = presses.classes.find((c) => c.host === "Pressable");
		const bar = presses.classes.find(
			(c) =>
				c.host === "View" && words(c.className).has("border-border-control"),
		);
		const glyph = presses.classes.find(
			(c) => c.host === "Text" && words(c.className).has("w-4"),
		);
		const body = presses.classes.find(
			(c) => c.host === "View" && words(c.className).has("border-transparent"),
		);
		const spacer = presses.classes.find(
			(c) => c.host === "View" && c.className === "w-4 shrink-0",
		);
		expect(pressable && bar && glyph && body && spacer).toBeTruthy();
		// Horizontal start of the text = border + padding + glyph column + gap.
		expect(words(bar?.className ?? "").has("border")).toBe(true);
		expect(words(body?.className ?? "").has("border")).toBe(true);
		for (const token of ["px-2.5", "gap-1.5"]) {
			expect(words(pressable?.className ?? "").has(token)).toBe(true);
			expect(words(body?.className ?? "").has(token)).toBe(true);
		}
		expect(words(glyph?.className ?? "").has("shrink-0")).toBe(true);
	});
});
