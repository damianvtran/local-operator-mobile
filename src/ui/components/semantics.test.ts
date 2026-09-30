import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
