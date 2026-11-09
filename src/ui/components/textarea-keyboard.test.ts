import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => ({
	os: "ios",
	props: {} as {
		submitBehavior?: string;
		returnKeyType?: string;
		enterKeyHint?: string;
		multiline?: boolean;
		onChangeText?: (value: string) => void;
	},
}));
// Capture the ACTUAL props given to TextInput by Textarea. This substitutes the
// native host only; it does not pretend to exercise an OS keyboard or layout.
vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return field.os;
		},
	},
	View: ({ children }: { children?: unknown }) => children,
	Text: ({ children }: { children?: unknown }) => children,
	TextInput: (props: typeof field.props) => {
		field.props = props;
		return null;
	},
}));
vi.mock("@/ui/appearance", () => ({
	useKeyboardAppearance: () => "dark",
	useTokenColor: () => "#000000",
}));
vi.mock("@/ui/layout", () => ({ TOUCH_FLOOR: 44 }));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));

import { Textarea } from "./textarea";

describe("effective composer keyboard props", () => {
	it.each(["ios", "android"])(
		"keeps a real multiline Return, not an overridden Send key, on %s",
		(os) => {
			field.os = os;
			const submit = vi.fn();
			const change = vi.fn();
			renderToStaticMarkup(
				createElement(Textarea, {
					label: "Synthetic draft",
					value: "line one",
					onChangeText: change,
					onSubmitEditing: submit,
					integrated: true,
					testID: "synthetic-textarea",
				}),
			);
			expect(field.props.multiline).toBe(true);
			expect(field.props.submitBehavior).toBe("newline");
			expect(field.props.returnKeyType).toBe("default");
			// RN gives enterKeyHint precedence; it must not silently restore Send.
			expect(field.props.enterKeyHint).toBeUndefined();
			field.props.onChangeText?.("line one\nline two");
			expect(change).toHaveBeenCalledWith("line one\nline two");
			expect(submit).not.toHaveBeenCalled();
		},
	);
	it("leaves web submission to the existing Enter/Shift+Enter owner", () => {
		field.os = "web";
		renderToStaticMarkup(
			createElement(Textarea, {
				label: "Synthetic draft",
				value: "draft",
				onChangeText: vi.fn(),
				onSubmitEditing: vi.fn(),
				testID: "synthetic-textarea",
			}),
		);
		expect(field.props.submitBehavior).toBeUndefined();
		expect(field.props.returnKeyType).toBe("send");
	});
});
