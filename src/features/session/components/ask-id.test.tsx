import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "@/i18n";
import { useUiStore } from "@/state/ui-store";

/**
 * The ask-id chip, MOUNTED, for the one thing a pure test cannot see: which
 * branch a given id takes, what a screen reader is told, and what a press and a
 * hold DO. `ask-chip.test.ts` owns the rules; this owns the control.
 *
 * The DOM is not needed (no geometry, no events — `@/testing/dom-shim` says a
 * press test belongs in the native layer), so the tree is rendered to static
 * markup and the handlers the host component was handed are invoked directly:
 * that is the same call the platform makes on a tap, minus the native
 * recogniser.
 */
const host = vi.hoisted(() => ({
	texts: new Map<string, Record<string, unknown>>(),
	copied: [] as string[],
	ticks: [] as string[],
}));

vi.mock("react-native", () => ({
	Platform: { OS: "ios" },
	Text: (props: Record<string, unknown>) => {
		if (typeof props.testID === "string") host.texts.set(props.testID, props);
		return createElement("span", null, props.children as ReactNode);
	},
	View: (props: { children?: ReactNode }) =>
		createElement("div", null, props.children),
	Pressable: (props: Record<string, unknown>) => {
		if (typeof props.testID === "string") host.texts.set(props.testID, props);
		return createElement(
			"button",
			{ type: "button" },
			(props.children ?? null) as ReactNode,
		);
	},
}));
vi.mock("expo-clipboard", () => ({
	setStringAsync: async (value: string) => {
		host.copied.push(value);
		return true;
	},
}));
vi.mock("@/lib/haptics", () => ({
	haptic: (kind: string) => host.ticks.push(kind),
}));

const { AskChipHostContext } = await import("@/features/session/ask-chip-host");
const { AskIdChip, AskIdFoot } = await import(
	"@/features/session/components/ask-id"
);

const render = (node: ReactNode) => renderToStaticMarkup(node);

/** The handler the platform would call, taken from what the host was handed. */
const handler = (props: Record<string, unknown> | undefined, name: string) => {
	const fn = props?.[name];
	if (typeof fn !== "function") throw new Error(`no ${name} handler`);
	return fn as () => void;
};

const withHost = (
	children: ReactNode,
	facts: Record<string, { status: string; question: string }>,
	open: (id: string) => void,
) =>
	createElement(
		AskChipHostContext.Provider,
		{ value: { facts: new Map(Object.entries(facts)), open } },
		children,
	);

describe("AskIdChip", () => {
	beforeEach(() => {
		host.texts.clear();
		host.copied.length = 0;
		host.ticks.length = 0;
		useUiStore.setState({ toast: null });
	});

	it("names the state, the question and the action to a screen reader", () => {
		const markup = render(
			withHost(
				createElement(AskIdChip, { id: "a-745e" }),
				{ "a-745e": { status: "withdrawn", question: "Settings layout" } },
				() => {},
			),
		);
		const chip = host.texts.get("ask-chip-a-745e");
		expect(chip?.accessibilityLabel).toBe(
			t("mobile.asks.chip.label", {
				id: "a-745e",
				state: t("mobile.asks.chip.withdrawn"),
				question: "Settings layout",
			}),
		);
		expect(markup).toContain("a-745e");
		expect(markup).toContain(t("mobile.asks.chip.withdrawn"));
	});

	it("opens the ask a tap names", () => {
		const opened: string[] = [];
		render(
			withHost(
				createElement(AskIdChip, { id: "a-745e" }),
				{ "a-745e": { status: "open", question: "" } },
				(id) => opened.push(id),
			),
		);
		const chip = host.texts.get("ask-chip-a-745e");
		handler(chip, "onPress")();
		expect(opened).toEqual(["a-745e"]);
	});

	it("copies the id on a hold, with a tick and a toast naming it", () => {
		render(
			withHost(
				createElement(AskIdChip, { id: "a-745e" }),
				{ "a-745e": { status: "open", question: "" } },
				() => {},
			),
		);
		const chip = host.texts.get("ask-chip-a-745e");
		handler(chip, "onLongPress")();
		expect(host.copied).toEqual(["a-745e"]);
		expect(host.ticks).toEqual(["light"]);
		expect(useUiStore.getState().toast?.message).toBe(
			t("mobile.asks.chip.copied", { id: "a-745e" }),
		);
	});

	it("draws an id this session cannot answer for as plain mono, with no dot, and says why on a tap", () => {
		const markup = render(
			withHost(createElement(AskIdChip, { id: "a-9999" }), {}, () => {}),
		);
		const chip = host.texts.get("ask-chip-a-9999");
		expect(chip?.accessibilityLabel).toBe(
			t("mobile.asks.chip.unknown_label", { id: "a-9999" }),
		);
		expect(markup).not.toContain("●");
		handler(chip, "onPress")();
		expect(useUiStore.getState().toast?.message).toBe(
			t("mobile.asks.chip.unknown_label", { id: "a-9999" }),
		);
	});
});

describe("AskIdFoot", () => {
	beforeEach(() => {
		host.texts.clear();
		host.copied.length = 0;
		useUiStore.setState({ toast: null });
	});

	it("copies the id it shows, under a name that says which id", () => {
		render(createElement(AskIdFoot, { askId: "a-e53b" }));
		const box = host.texts.get("ask-id-copy-a-e53b");
		expect(box?.accessibilityLabel).toBe(
			t("mobile.asks.chip.copy_label", { id: "a-e53b" }),
		);
		handler(box, "onPress")();
		expect(host.copied).toEqual(["a-e53b"]);
	});
});
