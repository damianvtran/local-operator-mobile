import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("./", import.meta.url);
const main = readFileSync(new URL("main.swift", root), "utf8");
const runner = readFileSync(new URL("run.sh", root), "utf8");
const AUTOSTART = /self\.start\(\)/;
const OPTIONAL = /optional:\s*true/;
const TIMEOUT_OVERRIDE = /transport\.timeoutSeconds\s*=/;
const SCREENSHOT = /^- takeScreenshot:\s*(.+)$/gm;
const OUTER_QUOTES = /^['"]|['"]$/g;
const BASENAME = /^[a-zA-Z0-9_.-]+$/;

/** Maestro confines screenshots to --test-output-dir. Shell-expanded absolute
 * destinations can be outside that directory even though both live in evidence.
 * Accept only basenames (with the known mode interpolation), never a root/path. */
function screenshotsStayInOutput(source: string): boolean {
	const names = [...source.matchAll(SCREENSHOT)].map((match) =>
		(match[1] ?? "").replace(OUTER_QUOTES, "").replaceAll("$mode", "positive"),
	);
	return (
		names.length >= 3 &&
		names.every((name) => BASENAME.test(name) && !name.includes(".."))
	);
}

/** Source-contract tripwire, not native execution evidence. The hosted browser
 * proof supplies that evidence; this catches the cold-driver race cheaply before
 * dispatch, including a negative control that restores the original launch timer.
 */
function readinessContract(source: string): boolean {
	const launch = source.slice(
		source.indexOf("func application("),
		source.indexOf("@objc func start()"),
	);
	return (
		source.includes("@objc func start()") &&
		launch.includes('label.text = "Ready \\(mode)"') &&
		launch.includes("#selector(start)") &&
		!AUTOSTART.test(launch)
	);
}

describe("hosted OAuth proof readiness contract", () => {
	it("uses screenshot basenames inside Maestro's configured output directory", () => {
		expect(screenshotsStayInOutput(runner)).toBe(true);
	});

	it("rejects the old absolute screenshot destination even under the evidence root", () => {
		const outside = runner.replaceAll(
			"- takeScreenshot: '",
			"- takeScreenshot: '$OUT/evidence/",
		);
		expect(outside).not.toBe(runner);
		expect(screenshotsStayInOutput(outside)).toBe(false);
	});

	it("leaves launch idle until an observable Ready → Start interaction", () => {
		expect(readinessContract(main)).toBe(true);
		const coldDriverRace = main.replace(
			"    persist()\n    return true",
			"    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.start() }\n    return true",
		);
		expect(coldDriverRace).not.toBe(main);
		expect(readinessContract(coldDriverRace)).toBe(false);
	});

	it("starts the legacy non-delivery observation only after the browser triggers its callback", () => {
		const receive = main.slice(
			main.indexOf("func receiveProvider("),
			main.indexOf("func sendProvider("),
		);
		expect(receive.indexOf("self.callbackAt = Date()")).toBeGreaterThan(0);
		expect(receive.indexOf("DispatchQueue.main.asyncAfter")).toBeGreaterThan(
			receive.indexOf("self.callbackAt = Date()"),
		);
		expect(receive).toContain("self.served && self.callbackAt != nil");
		const legacyOpen = main.slice(
			main.indexOf(
				'if self.mode == "legacy" {',
				main.indexOf("func prepare()"),
			),
			main.indexOf(
				'if self.mode == "timeout" || self.mode == "cancel" {',
				main.indexOf("func prepare()"),
			),
		);
		expect(legacyOpen).not.toContain("asyncAfter");
	});

	it("keeps the real production deadline and drives user cancellation instead of auto-cancelling", () => {
		expect(main).not.toMatch(TIMEOUT_OVERRIDE);
		expect(main).toContain("elapsed >= 295 && elapsed < 330");
		expect(runner).toContain("limit=360000");
		expect(runner).toContain("- tapOn: Cancel");
	});

	it("requires browser readiness/consent and preserves every mode's failures before validation", () => {
		expect(runner.indexOf("visible: 'Ready $mode'")).toBeLessThan(
			runner.indexOf("id: proof.start"),
		);
		expect(runner).not.toMatch(OPTIONAL);
		expect(runner).toContain("visible: 'Continue|$title'");
		expect(runner).toContain("for mode in legacy positive cancel timeout; do");
		expect(runner.indexOf('"$OUT/evidence/$mode-native.json"')).toBeLessThan(
			runner.indexOf('if python3 - "$OUT/evidence"'),
		);
		expect(runner).toContain("else FAILURES=1; fi");
		expect(runner).toContain('exit "$FAILURES"');
		expect(runner).not.toContain("    continue\n");
	});

	it("keeps the binary itself and both browser/return frames, not merely a hash", () => {
		expect(runner).toContain('ditto -c -k --keepParent "$APP"');
		expect(runner).toContain("CallbackProof.app.zip");
		expect(runner).toContain("$mode-browser-ready");
		expect(runner).toContain("$mode-returned");
		expect(main).toContain('"callback_triggered": callbackAt != nil');
		expect(fileURLToPath(root)).toContain("oauth-callback-proof");
	});
});
