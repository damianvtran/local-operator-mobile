import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The receiver-swap plugin (`with-android-team-bridge-push.js`, ADR 0010 S2).
 *
 * The transform is driven directly on the manifest shape config-plugins hands
 * it. That AGP's merger really drops Expo's receiver is asserted on every
 * release merged manifest by `scripts/ci/native-config.ts`; this suite pins
 * the part this repository owns, including that our intent filter stays a
 * copy of Expo's (a dropped boot action would stop Expo re-arming scheduled
 * notifications after a reboot).
 */
const require = createRequire(import.meta.url);
const plugin = require("./with-android-team-bridge-push.js") as {
	applyTeamBridgeReceiver: (manifest: Manifest) => Manifest;
	EXPO_RECEIVER: string;
	OUR_RECEIVER: string;
	RECEIVER_ACTIONS: string[];
};

type Receiver = {
	$: Record<string, string>;
	"intent-filter"?: {
		$: Record<string, string>;
		action: { $: { "android:name": string } }[];
	}[];
};
type Manifest = {
	manifest: {
		$?: Record<string, string>;
		application?: { $?: Record<string, string>; receiver?: Receiver[] }[];
	};
};

const base = (): Manifest => ({
	manifest: {
		$: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
		application: [
			{
				$: { "android:name": ".MainApplication" },
				receiver: [{ $: { "android:name": "some.other.Receiver" } }],
			},
		],
	},
});

const NO_APPLICATION = /no <application>/;
const ACTION_NAME = /<action android:name="([^"]+)"/g;

const receivers = (manifest: Manifest) =>
	manifest.manifest.application?.[0]?.receiver ?? [];

describe("applyTeamBridgeReceiver", () => {
	it("declares ours and marks Expo's for removal, keeping other receivers", () => {
		const out = plugin.applyTeamBridgeReceiver(base());
		const names = receivers(out).map((r) => r.$["android:name"]);
		expect(names).toEqual([
			"some.other.Receiver",
			plugin.EXPO_RECEIVER,
			plugin.OUR_RECEIVER,
		]);
		const expo = receivers(out).find(
			(r) => r.$["android:name"] === plugin.EXPO_RECEIVER,
		);
		expect(expo?.$["tools:node"]).toBe("remove");
		expect(out.manifest.$?.["xmlns:tools"]).toBe(
			"http://schemas.android.com/tools",
		);
	});

	it("gives ours Expo's attributes and exact intent filter", () => {
		const ours = receivers(plugin.applyTeamBridgeReceiver(base())).find(
			(r) => r.$["android:name"] === plugin.OUR_RECEIVER,
		);
		expect(ours?.$).toMatchObject({
			"android:enabled": "true",
			"android:exported": "false",
		});
		const filter = ours?.["intent-filter"]?.[0];
		expect(filter?.$["android:priority"]).toBe("-1");
		expect(filter?.action.map((a) => a.$["android:name"])).toEqual(
			plugin.RECEIVER_ACTIONS,
		);
	});

	it("copies the installed expo-notifications receiver filter action for action", () => {
		// The vendored library manifest is the source the copy must track; an
		// Expo bump that adds or drops an action fails here, not on a phone.
		const root = join(fileURLToPath(import.meta.url), "..", "..");
		const xml = readFileSync(
			join(
				root,
				"node_modules/expo-notifications/android/src/main/AndroidManifest.xml",
			),
			"utf8",
		);
		const block = xml.slice(
			xml.indexOf("<receiver"),
			xml.indexOf("</receiver>"),
		);
		expect(block).toContain(".service.NotificationsService");
		const actions = [...block.matchAll(ACTION_NAME)].map((m) => m[1]);
		expect(actions).toEqual(plugin.RECEIVER_ACTIONS);
	});

	it("is idempotent: a second prebuild pass does not duplicate entries", () => {
		const twice = plugin.applyTeamBridgeReceiver(
			plugin.applyTeamBridgeReceiver(base()),
		);
		expect(receivers(twice)).toHaveLength(3);
	});

	it("fails loudly on a manifest with no <application>", () => {
		expect(() => plugin.applyTeamBridgeReceiver({ manifest: {} })).toThrow(
			NO_APPLICATION,
		);
	});
});
