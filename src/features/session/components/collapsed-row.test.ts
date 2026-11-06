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
const presses = vi.hoisted(() => ({ last: null as PressProps | null }));

vi.mock("react-native", async () => {
	const React = await import("react");
	const passthrough = ({ children }: { children?: React.ReactNode }) =>
		children ?? null;
	return {
		Platform: { OS: "web" },
		View: passthrough,
		Text: passthrough,
		Pressable: (props: PressProps & { children?: React.ReactNode }) => {
			presses.last = props;
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

let dom: DomShim | null = null;
let root: ReturnType<typeof createRoot> | null = null;

const BODY = "first line of the peer message\nand its second line";

const render = async (open?: boolean) => {
	presses.last = null;
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
