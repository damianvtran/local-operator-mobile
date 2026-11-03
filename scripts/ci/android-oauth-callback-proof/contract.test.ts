import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const runner = read("./run.sh");
const workflow = read(
	"../../../.github/workflows/android-oauth-callback-proof.yml",
);
const launcher = read("../../../.github/workflows/android.yml");
const moduleRoot = "../../../modules/radient-loopback/android/";
const core = read(
	`${moduleRoot}src/main/java/dev/localoperator/loopback/LoopbackAuthSession.kt`,
);
const module = read(
	`${moduleRoot}src/main/java/dev/localoperator/loopback/RadientLoopbackModule.kt`,
);
const manifest = read(`${moduleRoot}src/main/AndroidManifest.xml`);
const debugManifest = read(`${moduleRoot}src/debug/AndroidManifest.xml`);
const proof = read(
	`${moduleRoot}src/debug/java/dev/localoperator/loopback/OAuthProofActivity.kt`,
);
const SHOT = /^\s*- takeScreenshot:\s*['"]?([^'"\n]+)['"]?$/gm;
const BASENAME = /^[a-zA-Z0-9$_.-]+$/;

/** Cheap source-contract tripwires only. Real Kotlin compilation and browser /
 * TCP / activity delivery are the separate manual hosted acceptance matrix. */
describe("Android OAuth native-proof contract", () => {
	it("never creates an automatic extra emulator wave or enters signing", () => {
		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).toContain("workflow_call:");
		expect(workflow).not.toContain("pull_request:");
		expect(workflow).not.toContain("secrets:");
		expect(workflow).not.toContain("environment: release");
		expect(launcher).toContain("inputs.oauth_callback_proof != true");
		expect(launcher).toContain(
			"uses: ./.github/workflows/android-oauth-callback-proof.yml",
		);
	});

	it("requires an installed versioned browser and on-device provider before cases", () => {
		expect(runner.indexOf("pm list packages com.android.chrome")).toBeLessThan(
			runner.indexOf("for mode in positive"),
		);
		expect(runner).toContain("browser-version.txt");
		expect(runner).toContain("browser-providers.txt");
		expect(runner).not.toContain("10.0.2.2");
		expect(proof).toContain('text = "Ready $mode"');
		expect(proof).toContain("if (!started)");
	});

	it("keeps debug lifecycle controls out of the Release manifest and checks the built result", () => {
		expect(debugManifest).toContain("OAuthProofControlReceiver");
		expect(manifest).not.toContain("OAuthProofControlReceiver");
		expect(workflow).toContain(":app:processReleaseMainManifest");
		expect(workflow).toContain("source-only absence is not proof");
	});

	it("uses bounded literal-loopback sockets and never embeds a code/state in the return intent", () => {
		expect(core).toContain(
			'ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))',
		);
		expect(core).toContain("bytes.size() < 4096");
		expect(core).toContain("client.soTimeout = 5000");
		expect(core).toContain("5, TimeUnit.SECONDS");
		expect(core).toContain("timeoutSeconds: Long = 300");
		expect(core).toContain("MessageDigest.isEqual");
		expect(module).toContain(
			'"intent://oauth-return#Intent;scheme=$packageName.oauth;package=$packageName;end"',
		);
		expect(proof).toContain("wrong-state");
		expect(proof).toContain("method:'POST'");
		expect(proof).toContain("rejected.get() == 6");
	});

	it("captures screenshots only inside the configured driver output, including failures", () => {
		const names = [...runner.matchAll(SHOT)].map((match) => match[1] ?? "");
		expect(names.length).toBe(4);
		expect(
			names.every((name) => BASENAME.test(name) && !name.includes("..")),
		).toBe(true);
		expect(runner).toContain("$mode-native.json");
		expect(runner).toContain("auth_tab_retained");
		expect(runner).toContain('exit "$FAILURES"');
		expect(runner).toContain("callback-proof-debug.apk");
	});
});
