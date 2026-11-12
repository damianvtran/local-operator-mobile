import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * The Android launcher-label plugin (`with-android-launcher-label.js`).
 *
 * The transform is driven directly, on the `strings.xml` shape Expo's default
 * `withName` hands it ("Local Operator", from `name`). That the plugin's mod
 * really runs AFTER `withName` in a prebuild is a property of Expo's pipeline,
 * proven by `expo config --type introspect` on the PR and asserted on every
 * built APK by `scripts/ci/native-config.ts android-badging`; this suite pins
 * the part this repository owns. `createRequire` because the plugin is
 * CommonJS by necessity (see its header).
 */
const require = createRequire(import.meta.url);
const plugin = require("./with-android-launcher-label.js") as ((
	config: Record<string, unknown>,
	props?: { label?: string },
) => { mods?: { android?: { strings?: unknown } } }) & {
	applyLauncherLabel: (strings: unknown, label: unknown) => StringsXml;
};

const EMPTY_LABEL_ERROR = /non-empty `label`/;

type StringsXml = {
	resources: { string?: { $: { name: string }; _: string }[] };
};

/** What `withName` produces from `name: "Local Operator"`, plus the splash
 *  string the template carries beside it. */
const withNameOutput = (): StringsXml => ({
	resources: {
		string: [
			{ $: { name: "app_name" }, _: "Local Operator" },
			{
				$: { name: "expo_splash_screen_resize_mode", translatable: "false" },
				_: "contain",
			} as { $: { name: string }; _: string },
		],
	},
});

const appName = (xml: StringsXml): string[] =>
	(xml.resources.string ?? [])
		.filter((item) => item.$.name === "app_name")
		.map((item) => item._);

describe("applyLauncherLabel", () => {
	it("replaces the full app name with the launcher label", () => {
		expect(
			appName(plugin.applyLauncherLabel(withNameOutput(), "Operator")),
		).toEqual(["Operator"]);
	});

	it("leaves the other strings alone", () => {
		const result = plugin.applyLauncherLabel(withNameOutput(), "Operator");
		expect(result.resources.string).toContainEqual(
			expect.objectContaining({
				$: expect.objectContaining({ name: "expo_splash_screen_resize_mode" }),
				_: "contain",
			}),
		);
		expect(result.resources.string).toHaveLength(2);
	});

	it("adds app_name when no earlier plugin wrote one", () => {
		expect(
			appName(plugin.applyLauncherLabel({ resources: {} }, "Operator")),
		).toEqual(["Operator"]);
	});

	it.each([undefined, "", "   "])(
		"refuses an empty label rather than ship a nameless icon: %s",
		(label) => {
			expect(() => plugin.applyLauncherLabel(withNameOutput(), label)).toThrow(
				EMPTY_LABEL_ERROR,
			);
		},
	);
});

describe("withAndroidLauncherLabel", () => {
	it("registers a strings.xml mod", () => {
		const config = plugin(
			{ name: "Local Operator", slug: "x" },
			{ label: "Operator" },
		);
		expect(typeof config.mods?.android?.strings).toBe("function");
	});
});
