import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The phone's side of ADR 0010 §5's shared fixture (agent-server PR #399,
 * `internal/models/testdata/bridge_push_avatar_fixture.json`, as merged to
 * agent-server main in 08b0cf15 (PR #399), copied byte-for-byte to the native module's androidTest assets so the emulator
 * runner renders the SAME rows).
 *
 * The phone computes neither initials nor tone; it draws what the cloud sends.
 * So what this suite pins is the contract between the fixture and the Kotlin
 * renderer's INPUTS, read from source because Node cannot run Kotlin:
 *  - the palette the tone indexes is core's `_PALETTE_LIGHT`, in order;
 *  - every fixture tone is a valid index, and the native parser's tone bound is
 *    the palette size;
 *  - every person row's initials pass the native parser's rule (≤ 2 code
 *    points, each a Unicode letter or number), and agent rows carry none.
 * The real Kotlin (parse → spec → bitmap pixel) runs on the emulator:
 * `TeamBridgePushTestRunner`'s `fixtureRows` case.
 */
const root = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const moduleDir = join(root, "modules/lop-team-bridge-push/android/src");
const kotlin = (name: string) =>
	readFileSync(
		join(moduleDir, "main/java/dev/localoperator/teambridge", name),
		"utf8",
	);

type FixtureSender = {
	name: string;
	kind: "person" | "agent";
	expect: { initials: string; tone: number };
};
const fixture = JSON.parse(
	readFileSync(
		join(moduleDir, "androidTest/assets/bridge_push_avatar_fixture.json"),
		"utf8",
	),
) as { senders: FixtureSender[]; conversations: unknown[] };

/** core `notification_avatar.py` `_PALETTE_LIGHT` (local-operator origin/main,
 *  read 2026-11-17), as ARGB. */
const CORE_PALETTE_LIGHT = [
	0xff2f6fb3, 0xff8a4fb0, 0xffb0476b, 0xffa8551e, 0xff3d7d3a, 0xff1e7a78,
	0xff5a5fc8, 0xff7a6345,
];

const ARGB_LITERAL = /0x([0-9A-Fa-f]{8})\.toInt\(\)/g;
const EXPO_NOTIFICATIONS_ARTIFACT =
	/host\.exp\.exponent:expo\.modules\.notifications:([0-9.]+)'/;

const kotlinPalette = (): number[] => {
	const source = kotlin("AvatarRenderer.kt");
	const start = source.indexOf("val PALETTE: IntArray = intArrayOf(");
	const block = source.slice(start, source.indexOf("\n  )", start));
	return [...block.matchAll(ARGB_LITERAL)].map((m) =>
		Number.parseInt(m[1] ?? "", 16),
	);
};

const TONES_CONST = /const val TONES = 8\b/;
const NO_IDLE_POOL = /\.connectionPool\(ConnectionPool\(0, /;
const NO_RETRY = /\.retryOnConnectionFailure\(false\)/;
const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/;
const LAUNCHER_EXCLUSION = /setExcludedFromSurfaces|SURFACE_LAUNCHER/;
const SET_ICON = /\.setIcon\(/g;
const GROUP_FACE_BRANCH =
	/if \(push\.conv\?\.group == true\) \{\s*AvatarRenderer\.render\(AvatarRenderer\.CONVERSATION_SPEC,/;
const CONVERSATION_SPEC_DECL =
	/val CONVERSATION_SPEC: Spec = Spec\(CONVERSATION_BACKGROUND, Glyph\.Group\)/;

/** The native parser's initials rule, restated for the fixture check. */
const DRAWABLE = /^[\p{L}\p{N}]{1,2}$/u;

describe("push avatar contract (ADR 0010 §5)", () => {
	it("draws on core's light palette, in tone order", () => {
		expect(kotlinPalette()).toEqual(CORE_PALETTE_LIGHT);
	});

	it("compiles against the installed expo-notifications version (its classes are subclassed)", () => {
		// The delegates override Expo internals; a bump that moves the npm package
		// without the Gradle coordinate would compile against one version and run
		// another. Change both together.
		const gradle = readFileSync(join(moduleDir, "..", "build.gradle"), "utf8");
		const installed = JSON.parse(
			readFileSync(
				// Joined from segments: a literal `…/package.json` path would be
				// read by `fixtures.test.ts` as a corpus fixture reference.
				join(root, "node_modules", "expo-notifications", "package.json"),
				"utf8",
			),
		) as { version: string };
		expect(EXPO_NOTIFICATIONS_ARTIFACT.exec(gradle)?.[1]).toBe(
			installed.version,
		);
	});

	it("publishes conversation shortcuts the platform keeps (QA F1, PR #304)", () => {
		// An excluded-from-launcher shortcut is never stored by ShortcutService
		// (AOSP `ShortcutPackage.pushDynamicShortcut` keeps it only as transient,
		// AppSearch-only state), so on API 33+ no conversation exists and the
		// notification silently demotes to plain MessagingStyle. The emulator
		// runner's `decorateMessaging` case is the device-side check; this pins
		// the source so the regression fails without an emulator.
		const code = kotlin("ConversationShortcuts.kt")
			.split("\n")
			.filter((line) => !COMMENT_LINE.test(line))
			.join("\n");
		expect(code).toContain("pushDynamicShortcut");
		expect(code).toContain(".setLongLived(true)");
		expect(code).not.toMatch(LAUNCHER_EXCLUSION);
	});

	it("gives a group shortcut a fixed conversation face, not the sender's (U7/D3, PR #304)", () => {
		// On API 31+ the shade draws the conversation SHORTCUT's icon on every
		// row naming it. The shortcut is republished per message, so a sender
		// face there made every row of a group show the latest sender. The
		// emulator runner's `decorateMessaging` checks the pixels; this pins the
		// source so the regression fails without an emulator.
		const code = kotlin("ConversationShortcuts.kt")
			.split("\n")
			.filter((line) => !COMMENT_LINE.test(line))
			.join("\n");
		expect(code).toContain(
			".setIcon(IconCompat.createWithBitmap(shortcutFace(push, senderFace)))",
		);
		expect(code.match(SET_ICON)).toHaveLength(1);
		const face = code.slice(
			code.indexOf("fun shortcutFace("),
			code.indexOf("fun publish("),
		);
		expect(face).toMatch(GROUP_FACE_BRANCH);
		// The conversation face is a fixed spec: no sender input reaches it.
		const renderer = kotlin("AvatarRenderer.kt");
		expect(renderer).toMatch(CONVERSATION_SPEC_DECL);
		expect(kotlinPalette()).not.toContain(0xff656056);
	});

	it("fetches every photo on a fresh connection (QA R5 Q10, PR #304)", () => {
		// OkHttp reuses a pooled socket for a GET without probing for the
		// server's close, and retries are off, so a photo push arriving after the
		// server's keep-alive expired failed at once and drew initials (the
		// installed-app proof's heads-up DM, run 44298827622). The emulator
		// runner's `photoFetchAfterServerIdleClose` is the behavioural check;
		// this pins the source so the regression fails without an emulator.
		const code = kotlin("PushAvatarFetcher.kt")
			.split("\n")
			.filter((line) => !COMMENT_LINE.test(line))
			.join("\n");
		expect(code).toMatch(NO_IDLE_POOL);
		expect(code).toMatch(NO_RETRY);
	});

	it("bounds the parsed tone by the palette size", () => {
		expect(kotlin("BridgePushPayload.kt")).toMatch(TONES_CONST);
		expect(CORE_PALETTE_LIGHT).toHaveLength(8);
	});

	it("carries ~30 sender rows covering persons, agents and empty initials", () => {
		expect(fixture.senders.length).toBeGreaterThanOrEqual(30);
		expect(fixture.senders.some((row) => row.kind === "agent")).toBe(true);
		expect(fixture.senders.some((row) => row.expect.initials === "")).toBe(
			true,
		);
	});

	it.each(fixture.senders.map((row) => [row.name, row] as const))(
		"%s: tone indexes the palette and initials are drawable or empty",
		(_name, row) => {
			expect(Number.isInteger(row.expect.tone)).toBe(true);
			expect(row.expect.tone).toBeGreaterThanOrEqual(0);
			expect(row.expect.tone).toBeLessThan(CORE_PALETTE_LIGHT.length);
			if (row.kind === "agent") {
				// An agent's face is the glyph, never its owner's letters.
				expect(row.expect.initials).toBe("");
			} else if (row.expect.initials !== "") {
				expect(row.expect.initials.normalize("NFC")).toMatch(DRAWABLE);
			}
		},
	);
});
