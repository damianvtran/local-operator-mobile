import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * The iOS silent-push completion backstop (`with-ios-background-fetch-deadline.js`,
 * expo/expo#52878, agent review R1 M1).
 *
 * Driven on the published Expo SDK 57 AppDelegate template, both before and
 * after `ios.enableSceneSupport` rewrites its class line, because the order the
 * two plugins' AppDelegate mods run in is Expo's, not ours. That the override
 * reaches the GENERATED project is asserted on every iOS CI build by
 * `scripts/ci/native-config.ts ios-app-delegate`; that it compiles, by the
 * simulator build itself.
 */
const require = createRequire(import.meta.url);
const plugin = require("./with-ios-background-fetch-deadline.js") as {
	applyFetchDeadline: (source: string) => string;
	MARKER: string;
	DEADLINE_SECONDS: number;
};

/** expo/expo `templates/expo-template-bare-minimum/ios/HelloWorld/AppDelegate.swift`
 *  on `sdk-57`, the parts the transform touches. */
const TEMPLATE = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
}
`;
const SCENE_TEMPLATE = TEMPLATE.replace(
	"class AppDelegate: ExpoAppDelegate {",
	"class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
);

/** The block the plugin inserts, so the rest can be compared to the input. */
const INSERTED_BLOCK =
	/\n {2}\/\/ lop-background-fetch-deadline[\s\S]*?\n {2}}\n\n/;
const UNEXPECTED_DELEGATE = /Expo SDK 57 Swift AppDelegate/;
const ALREADY_OVERRIDES = /already overrides/;
const CLEAR_BUDGET = /export const BUDGET_MS = ([\d_]+);/;
const OUTBOX_BUDGET = /export const OUTBOX_WAKE_BUDGET_MS = ([\d_]+);/;

const countOf = (haystack: string, needle: string): number =>
	haystack.split(needle).length - 1;

describe("with-ios-background-fetch-deadline", () => {
	it.each([
		["the stock template", TEMPLATE],
		["the scene-support template", SCENE_TEMPLATE],
	])(
		"adds one completion override inside AppDelegate in %s",
		(_label, source) => {
			const out = plugin.applyFetchDeadline(source);
			expect(countOf(out, "didReceiveRemoteNotification userInfo")).toBe(1);
			const appDelegate = out.slice(
				out.indexOf("class AppDelegate"),
				out.indexOf("class ReactNativeDelegate"),
			);
			expect(appDelegate).toContain(`// ${plugin.MARKER}:`);
			// Calls through to Expo, which aggregates every subscriber's result…
			expect(appDelegate).toContain(
				"super.application(application, didReceiveRemoteNotification: userInfo, fetchCompletionHandler: completeOnce)",
			);
			// …and completes on its own at the deadline, at most once.
			expect(appDelegate).toContain(
				`asyncAfter(deadline: .now() + ${plugin.DEADLINE_SECONDS})`,
			);
			expect(appDelegate).toContain("guard !once.done else { return }");
			// The rest of the template is untouched.
			expect(out.replace(INSERTED_BLOCK, "")).toBe(source);
		},
	);

	it("is idempotent, so a re-run prebuild does not add a second override", () => {
		const once = plugin.applyFetchDeadline(SCENE_TEMPLATE);
		expect(plugin.applyFetchDeadline(once)).toBe(once);
	});

	it("fails the prebuild rather than guess on an unexpected AppDelegate", () => {
		expect(() =>
			plugin.applyFetchDeadline("class AppDelegate: UIResponder {}\n"),
		).toThrow(UNEXPECTED_DELEGATE);
		// A second owner of the method would not compile; merge it by hand.
		expect(() =>
			plugin.applyFetchDeadline(
				SCENE_TEMPLATE.replace(
					"  var window: UIWindow?\n",
					"  var window: UIWindow?\n  override func application(_ a: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any]) {}\n",
				),
			),
		).toThrow(ALREADY_OVERRIDES);
	});

	it("keeps the deadline above the JS task's budgets and below iOS's 30 s", () => {
		// The invariant the deadline names (see the plugin's header): a task that
		// runs normally reports first, and iOS still gets its answer in time.
		const budgets = [
			readFileSync("src/notifications/background-clear.ts", "utf8").match(
				CLEAR_BUDGET,
			)?.[1],
			readFileSync("src/features/session/outbox.ts", "utf8").match(
				OUTBOX_BUDGET,
			)?.[1],
		].map((value) => Number(value?.replaceAll("_", "")) / 1000);
		for (const budget of budgets) {
			expect(budget).toBeGreaterThan(0);
			expect(plugin.DEADLINE_SECONDS).toBeGreaterThan(budget);
		}
		expect(plugin.DEADLINE_SECONDS).toBeLessThan(30);
	});

	it("is registered in app.config.ts", () => {
		expect(readFileSync("app.config.ts", "utf8")).toContain(
			'"./plugins/with-ios-background-fetch-deadline.js"',
		);
	});
});
