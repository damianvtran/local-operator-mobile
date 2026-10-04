import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Badge } from "@/ui/components/badge";
import { Heading } from "@/ui/components/heading";
import { Segmented } from "@/ui/components/segmented";

/**
 * What assistive technology is told, read from the DOM the web target renders.
 *
 * react-native-web silently drops some React Native accessibility props
 * (`accessibilityState`) and defaults others (a level-less heading is `<h1>`), so
 * a component that is correct for the native props can still be mute or wrong on
 * the web build. These tests render through the same react-native-web the export
 * uses and assert the attributes a screen reader reads.
 */

type Tag = { name: string; attrs: Record<string, string> };

const START_TAG = /<([a-z0-9]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s=>/]+)(?:="([^"]*)")?/g;

/** Every start tag in the rendered markup, with its attributes. Static markup from
 * react-dom is well-formed and quotes every value, so a scan is enough and no DOM
 * library has to be added for three assertions. */
const tags = (element: unknown): Tag[] =>
	[...renderToStaticMarkup(element as never).matchAll(START_TAG)].map((m) => ({
		name: m[1] ?? "",
		attrs: Object.fromEntries(
			[...(m[2] ?? "").matchAll(ATTRIBUTE)].map((a) => [
				a[1] ?? "",
				a[2] ?? "",
			]),
		),
	}));

const withRole = (element: unknown, role: string): Tag[] =>
	tags(element).filter((tag) => tag.attrs.role === role);

const OPTIONS = [
	{ value: "system", label: "System", testID: "s" },
	{ value: "light", label: "Light", testID: "l" },
	{ value: "dark", label: "Dark", testID: "d" },
];

const segmented = (value: string) =>
	h(Segmented as never, {
		label: "Theme",
		testID: "theme",
		value,
		onChange: () => undefined,
		options: OPTIONS,
	});

describe("segmented control on the web target", () => {
	it("says which option is chosen, and only that one", () => {
		for (const chosen of ["system", "dark"]) {
			const radios = withRole(segmented(chosen), "radio");
			expect(radios.map((r) => r.attrs["aria-checked"])).toEqual(
				OPTIONS.map((o) => String(o.value === chosen)),
			);
		}
	});
});

describe("Heading", () => {
	it("renders the outline level it is given, not h1 for everything", () => {
		const levels = [1, 2, 3] as const;
		const rendered = levels.map((level) => {
			const [el] = withRole(
				h(Heading as never, { level, className: "" }, "x"),
				"heading",
			);
			return [el?.name, el?.attrs["aria-level"]];
		});
		expect(rendered).toEqual([
			["h1", "1"],
			["h2", "2"],
			["h3", "3"],
		]);
	});
});

describe("Badge", () => {
	it("announces the call site's name, not the bare numeral", () => {
		/* The sessions header's unread badge renders only a number, so the call
		 * site supplies the name (in the row's own vocabulary: "new"). The
		 * numeral is that name's rendering and leaves the tree with it. */
		const badge = h(Badge as never, {
			label: "2",
			tone: "danger",
			mono: true,
			accessibilityLabel: "2 new conversations",
		});
		const named = tags(badge).filter(
			(tag) => tag.attrs["aria-label"] === "2 new conversations",
		);
		expect(named.length).toBeGreaterThan(0);
		expect(tags(badge).some((tag) => tag.attrs["aria-hidden"] === "true")).toBe(
			true,
		);
	});

	it("keeps an unnamed badge's label in the accessibility tree", () => {
		/* Other call sites pass words that ARE the name; nothing changes for
		 * them — no name is invented and no label is hidden. */
		const badge = h(Badge as never, { label: "Recommended" });
		expect(
			tags(badge).every((tag) => tag.attrs["aria-label"] === undefined),
		).toBe(true);
		expect(
			tags(badge).every((tag) => tag.attrs["aria-hidden"] !== "true"),
		).toBe(true);
	});
});
