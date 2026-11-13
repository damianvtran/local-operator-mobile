import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Input } from "@/ui/components/input";
import { DirectionProvider, useComposedDir } from "@/ui/direction";

/**
 * `Input.placeholderDir` (M3 S2a, designer source preflight): the Urdu password
 * placeholder opens with a Latin token, and react-native-web's `dir="auto"`
 * reads the field's VALUE, never its placeholder — so the empty field's hint
 * laid out left-to-right on an RTL page. The opt-in states the page direction
 * ONLY while the value is empty; anything typed keeps the field exactly as it
 * was, so the password's own base, caret and masking are untouched.
 *
 * Rendered through react-native-web under the real `DirectionProvider`, the
 * `section-header.test.ts` pattern; real-path QA owns the device frame.
 */
/* `@/ui/appearance` reaches native token plumbing Node cannot parse; colour and
 * keyboard appearance are irrelevant to the direction under test. */
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000",
	useKeyboardAppearance: () => "default",
}));

/** A Latin-initial hint, the shape of the Urdu password placeholder. */
const HINT = "Tunnel پاس ورڈ";

/** The composition site: a screen that reads the page direction for the hint. */
const ComposedField = ({ value }: { value: string }) => {
	const composed = useComposedDir();
	return h(Input, {
		label: "Password",
		value,
		onChangeText: () => {},
		placeholder: HINT,
		placeholderDir: composed,
		secureTextEntry: true,
		testID: "password",
	});
};

const render = (children: ReactNode, direction: "ltr" | "rtl"): string =>
	renderToStaticMarkup(
		h(DirectionProvider, { direction, locale: "ur", children }),
	);

/** The `<input …>` opening tag alone: the label `Text` carries its own `dir`. */
const inputTag = (markup: string): string => {
	const at = markup.indexOf("<input");
	expect(at, "an <input> is rendered").toBeGreaterThan(-1);
	return markup.slice(at, markup.indexOf(">", at) + 1);
};

describe("Input: placeholderDir applies only while the field is empty", () => {
	it("rtl, empty value: the hint's field states dir=rtl", () => {
		const tag = inputTag(render(h(ComposedField, { value: "" }), "rtl"));
		expect(tag).toContain('dir="rtl"');
		expect(tag).not.toContain('dir="auto"');
	});

	it("rtl, Latin typed value: no dir from placeholderDir (inferred base kept)", () => {
		const tag = inputTag(render(h(ComposedField, { value: "hunter2" }), "rtl"));
		expect(tag).not.toContain('dir="rtl"');
		expect(tag).toContain('dir="auto"');
	});

	it("rtl, mixed value: no dir from placeholderDir", () => {
		const tag = inputTag(
			render(h(ComposedField, { value: "pass کلید" }), "rtl"),
		);
		expect(tag).not.toContain('dir="rtl"');
		expect(tag).toContain('dir="auto"');
	});

	it("rtl, cleared back to empty: the dir is applied again", () => {
		const typed = inputTag(render(h(ComposedField, { value: "x" }), "rtl"));
		const cleared = inputTag(render(h(ComposedField, { value: "" }), "rtl"));
		expect(typed).not.toContain('dir="rtl"');
		expect(cleared).toContain('dir="rtl"');
	});

	it("ltr, empty value: the composed direction is empty, so nothing changes", () => {
		const tag = inputTag(render(h(ComposedField, { value: "" }), "ltr"));
		expect(tag).toContain('dir="auto"');
		expect(tag).not.toContain('dir="rtl"');
	});

	it("a caller that passes no placeholderDir keeps the inferred base: the opt-in is real", () => {
		const tag = inputTag(
			render(
				h(Input, {
					label: "Address",
					value: "",
					onChangeText: () => {},
					placeholder: HINT,
					testID: "url",
				}),
				"rtl",
			),
		);
		expect(tag).toContain('dir="auto"');
	});
});
