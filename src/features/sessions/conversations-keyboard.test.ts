import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const policyPattern = /keyboardShouldPersistTaps="([^"]+)"/;
const native = readFileSync(
	resolve(
		root,
		"node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js",
	),
	"utf8",
);
const body = native
	.split("_handleStartShouldSetResponderCapture:")[1]
	?.split("(e: GestureResponderEvent) => {")[1]
	?.split("\n    };")[0];
if (!body)
	throw new Error(
		"installed native ScrollView capture handler boundary changed",
	);
// Execute the installed framework path, not a restated policy predicate. This
// proves responder interception with a dismissible keyboard, not native UI.
const capture = runInNewContext(`(function(e) { ${body} })`, {
	__DEV__: false,
	TextInputState: { isTextInput: () => false },
}) as (this: unknown, event: { target: object }) => boolean;
const intercepts = (keyboardShouldPersistTaps?: string) =>
	capture.call(
		{
			props: { keyboardShouldPersistTaps },
			_isAnimating: () => false,
			_softKeyboardIsDetached: () => false,
			_keyboardIsDismissible: () => true,
		},
		{ target: {} },
	);

describe("focused-search footer taps", () => {
	it("reproduces native first-tap interception and exercises the handled policy", () => {
		expect(intercepts()).toBe(true);
		expect(intercepts("handled")).toBe(false);
	});
	it("the real pane forwards handled so a footer button gets the first tap", () => {
		const pane = readFileSync(
			resolve(import.meta.dirname, "conversations-pane.tsx"),
			"utf8",
		);
		const props =
			pane.split("<FlatList")[1]?.split("contentContainerClassName")[0] ?? "";
		const policy = props.match(policyPattern)?.[1];
		expect(policy).toBe("handled");
		expect(intercepts(policy)).toBe(false);
	});
});
