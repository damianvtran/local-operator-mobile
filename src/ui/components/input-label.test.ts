import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Input } from "@/ui/components/input";

/**
 * `Input.labelHidden`: a field whose placeholder and neighbouring control
 * already say what it is (the Past screen's search beside its Search button)
 * does not paint its label a second time above it — but the label stays the
 * field's accessible name, because a placeholder is never the only label
 * (docs/design/components.md § 4) and disappears as soon as the reader types.
 *
 * Rendered through react-native-web, the `input.test.ts` pattern.
 */
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000",
	useKeyboardAppearance: () => "default",
}));

const LABEL = "Search past sessions";

const render = (labelHidden?: boolean): string =>
	renderToStaticMarkup(
		h(Input, {
			label: LABEL,
			labelHidden,
			value: "",
			onChangeText: () => {},
			placeholder: "Words or title",
			testID: "search",
		}),
	);

/** The visible text nodes: everything outside a tag, minus whitespace. */
const visibleText = (markup: string): string =>
	markup
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

describe("Input: labelHidden", () => {
	it("paints the label above the field by default", () => {
		expect(visibleText(render())).toContain(LABEL);
	});

	it("does not paint the label when hidden, and keeps it as the field's name", () => {
		const markup = render(true);
		expect(visibleText(markup)).not.toContain(LABEL);
		expect(markup).toContain(`aria-label="${LABEL}"`);
	});
});
