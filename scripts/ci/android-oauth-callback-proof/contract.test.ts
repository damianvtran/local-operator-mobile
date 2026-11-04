import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const runner = read("./run.sh");
const realApp = read("./real-app.sh");
const prepareApp = read("./prepare-app.sh");
const activity = read(
	`${"../../../modules/radient-loopback/android/"}src/main/java/dev/localoperator/loopback/OAuthActivity.kt`,
);
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
		// github.workflow names the caller under workflow_call; a callee suffix
		// avoids holding the parent's lane while waiting for its child to start.
		expect(workflow).toContain("}-oauth-callback-proof-");
		expect(workflow).not.toContain("pull_request:");
		expect(workflow).not.toContain("secrets:");
		expect(workflow).not.toContain("environment: release");
		expect(launcher).toContain("inputs.oauth_callback_proof != true");
		expect(launcher).toContain(
			"uses: ./.github/workflows/android-oauth-callback-proof.yml",
		);
	});

	it("stages the compiled APK onto a fresh emulator VM instead of filling its disk with Gradle", () => {
		const runtime = workflow.slice(workflow.indexOf("  browser-native:"));
		expect(runtime).toContain("needs: build-native");
		expect(runtime).toContain("actions/download-artifact@v8");
		expect(runtime).toContain("sha256sum --check artifact-apk.sha256");
		expect(runtime).toContain('test "$ACTUAL" = "$EXPECTED"');
		expect(runtime).not.toContain("./gradlew");
		expect(runtime).not.toContain("pnpm install");
		expect(runner).toContain('APK="$OUT/app-debug.apk"');
		expect(workflow.indexOf("Stage the built APK")).toBeLessThan(
			workflow.indexOf("  browser-native:"),
		);
	});

	it("enables KVM and fails fast before building or starting the emulator", () => {
		const e2e = read("../../../.github/workflows/e2e.yml");
		const start = e2e.indexOf("      - name: Enable KVM");
		const end = e2e.indexOf("      - uses: pnpm/action-setup@v6", start);
		const block = e2e.slice(start, end);
		expect(block).toContain("99-kvm4all.rules");
		expect(block).toContain("Assert the emulator can use KVM");
		const guarded = (source: string) =>
			source.includes(block) &&
			source.indexOf(block) < source.indexOf("pnpm install --frozen-lockfile");
		expect(guarded(workflow)).toBe(true);
		expect(guarded(workflow.replace(block, ""))).toBe(false);
		expect(
			guarded(
				workflow.replace(
					"if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then",
					"if false; then",
				),
			),
		).toBe(false);
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

	it("separates two socket controls from exactly one wrong-state browser rejection", () => {
		expect(proof).toContain("socketProbeRejections = rejected.get()");
		expect(proof).toContain(
			"wrongStateRejections = rejected.get() - socketProbeRejections",
		);
		expect(proof).toContain("wrongStateRejections == 1");
		expect(proof).toContain("/proof-wrong-state");
		const marker = `if python3 - "$OUT/evidence" "$mode" "$DRIVER_EXIT" "$APP_ID" <<'PY'`;
		const validator = runner.split(marker)[1]?.split("\nPY")[0];
		expect(validator).toBeTruthy();
		const root = mkdtempSync(
			join(
				process.env.LOCAL_OPERATOR_SCRATCHPAD ??
					process.env.RUNNER_TEMP ??
					tmpdir(),
				"android-validator-",
			),
		);
		try {
			writeFileSync(
				join(root, "positive-activities.txt"),
				"topResumedActivity=ActivityRecord{dev.proof/dev.localoperator.loopback.OAuthProofActivity}",
			);
			for (const [
				wrongState,
				lateRefused,
				clicked,
				bound,
				retained,
				expected,
			] of [
				[1, true, true, true, false, 0],
				[2, true, true, true, false, 1],
				[1, false, true, true, false, 1],
				[1, true, false, true, false, 1],
				[1, true, true, false, false, 1],
				[1, true, true, true, true, 1],
			] as const) {
				writeFileSync(
					join(root, "positive-activities.txt"),
					"topResumedActivity=ActivityRecord{dev.proof/dev.localoperator.loopback.OAuthProofActivity}" +
						(retained
							? "\n* Hist  #2: com.android.chrome/CustomTabActivity"
							: ""),
				);
				writeFileSync(
					join(root, "positive-native.json"),
					JSON.stringify({
						pass: true,
						provider_clicked: clicked,
						browser_keepalive_bound: bound,
						wrong_state_rejections: wrongState,
						late_refused: lateRefused,
					}),
				);
				const result = spawnSync(
					"python3",
					["-", root, "positive", "0", "dev.proof"],
					{ input: validator, encoding: "utf8" },
				);
				expect(result.status, result.stderr).toBe(expected);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("resets each mode to a proven launcher and suppresses browser first-run/IPH", () => {
		expect(runner).toContain("am force-stop com.android.chrome");
		expect(runner).toContain("KEYCODE_HOME");
		expect(runner).toContain("topResumedActivity=");
		expect(runner).toContain("Fixture reset did not reach launcher");
		expect(runner).toContain(
			"--disable-fre --no-default-browser-check --no-first-run",
		);
		expect(runner).toContain(
			"- assertNotVisible: 'Minimize tab to return to it later'",
		);
		expect(runner).toContain('point: "50%,24%"');
		expect(proof).toContain("width:100%;height:200px");
	});

	it("keeps the native process runnable and closes timeout through its owned activity", () => {
		const guarded = (text: string) =>
			text.includes("CustomTabsClient.bindCustomTabsService") &&
			text.includes("CustomTabsIntent.Builder(session)") &&
			text.includes("android.support.customtabs.extra.KEEP_ALIVE") &&
			text.includes("unbindService(connection)");
		expect(guarded(activity)).toBe(true);
		expect(
			guarded(
				activity.replace(
					"CustomTabsIntent.Builder(session)",
					"CustomTabsIntent.Builder()",
				),
			),
		).toBe(false);
		expect(module).toContain("Intent(activity, OAuthActivity::class.java)");
		expect(
			module.slice(
				module.indexOf("fun requestReturn"),
				module.indexOf("fun managementDestroyed"),
			),
		).not.toContain("Intent(activity, activity.javaClass)");
		expect(activity).toContain("OAuthCoordinator.managementDestroyed(it)");
		expect(manifest).toContain(
			'service android:name=".OAuthKeepAliveService" android:exported="true"',
		);
		expect(manifest).not.toContain("FOREGROUND_SERVICE");
		expect(runner).toContain("limit=360000");
		expect(core).toContain("timeoutSeconds: Long = 300");
	});

	it("requires a provider click before a real image wrong-state request and correct navigation", () => {
		expect(proof).toContain('target.startsWith("/clicked")');
		expect(proof).toContain("const i=new Image()");
		expect(proof).not.toContain("fetch('$badState')");
		expect(proof).toContain("location.assign('$good')");
		expect(runner).toContain("provider-click-not-observed");
	});

	it("launches explicitly and retains immediate and failed-start diagnostics", () => {
		expect(realApp).toContain("- launchApp:\n    clearState: true");
		expect(realApp).toContain("- launchApp:\n    clearState: false");
		expect(realApp).not.toContain('am start -n "$APP_ID/.MainActivity"');
		expect(realApp).toContain('adb shell pidof "$APP_ID"');
		expect(realApp).toContain("adb logcat -d -v threadtime");
		expect(realApp).toContain("capture_app_state negative-complete");
		expect(realApp).toContain("ANDROID_PROOF_BUNDLE_URL=assets://");
	});

	it("also exercises the real Expo provider through failure, retry, picker and cold restore", () => {
		expect(runner).toContain("android-oauth-callback-proof/real-app.sh");
		expect(prepareApp).toContain("signin-app-proof/prepare-entry.ts");
		expect(prepareApp).toContain("--dev true");
		expect(prepareApp).toContain("src/debug/assets/index.android.bundle");
		expect(workflow).toContain("android-oauth-callback-proof/prepare-app.sh");
		expect(realApp).toContain("embedded-bundle.sha256");
		expect(realApp).not.toContain("expo','start");
		expect(realApp).toContain("tools/mock-relay/oauth-fast-path.ts");
		expect(realApp).toContain("tcp:54831 tcp:54831");
		expect(realApp).toContain("id: 'sign-in-try-again'");
		expect(realApp).toContain("id: 'sign-in-diagnostics'");
		expect(realApp).toContain("id: 'computers-screen'");
		expect(realApp).toContain("id: 'conversations-list'");
		expect(realApp).toContain("r['session_pkce_verified']==1");
		expect(realApp).toContain("r['discovery']>p['discovery']");
		expect(realApp).toContain("r['authorize']==2");
		expect(realApp).not.toContain("pm clear");
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
