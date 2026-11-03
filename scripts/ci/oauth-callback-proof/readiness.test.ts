import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("./", import.meta.url);
const main = readFileSync(new URL("main.swift", root), "utf8");
const runner = readFileSync(new URL("run.sh", root), "utf8");
const probe = readFileSync(new URL("TCPClosureProbe.swift", root), "utf8");
const workflow = readFileSync(
	new URL("../../../.github/workflows/oauth-callback-proof.yml", root),
	"utf8",
);
const AUTOSTART = /self\.start\(\)|\bprepare\(\)/;
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
		source.includes('self.label.text = "Ready \\(self.mode)"') &&
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
			"    bindProvider() // Fixture control only: no auth listener/session/deadline.",
			"    prepare() // Broken control: auth starts before the driver is ready.",
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
		expect(runner).toContain("text: Cancel");
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

	it("separates the static Start tap from system presentation and captures only after browser readiness", () => {
		const start = main.slice(
			main.indexOf("@objc func start()"),
			main.indexOf("func bindProvider()"),
		);
		expect(start).not.toContain("self.prepare()");
		expect(start).toContain('stage = "prepared"');
		expect(runner.indexOf("visible: 'Prepared $mode'")).toBeLessThan(
			runner.indexOf("- runScript: 'begin-$mode.js'"),
		);
		expect(runner.indexOf("- assertVisible: '$title'")).toBeLessThan(
			runner.indexOf("- takeScreenshot: '$mode-browser-ready'"),
		);
		expect(runner).toContain("waitToSettleTimeoutMs: 0");
		expect(runner).toContain("waitForAnimationToEnd:");
		expect(main).toContain('if target == "/begin"');
	});

	it("admits only a current per-mode native result, never a stale PASS receipt", () => {
		const marker = 'if python3 - "$OUT/evidence"';
		const section = runner.slice(runner.indexOf(marker));
		const admission = section.split("<<'PY'\n")[1]?.split("\nPY")[0];
		expect(admission).toBeDefined();
		const directory = mkdtempSync(join(tmpdir(), "oauth-receipt-"));
		try {
			for (const fresh of [true, false]) {
				writeFileSync(
					join(directory, "positive-native.json"),
					JSON.stringify({
						mode: "positive",
						run_id: fresh ? "current" : "old-mode",
						pass: true,
					}),
				);
				const result = spawnSync(
					"python3",
					["-c", admission ?? "", directory, "positive", "0", "current"],
					{ encoding: "utf8" },
				);
				expect(result.status).toBe(fresh ? 0 : 1);
				const receipt = JSON.parse(
					readFileSync(join(directory, "positive.json"), "utf8"),
				);
				expect(receipt.pass).toBe(fresh);
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
		expect(
			runner.indexOf("Fresh native Ready receipt was not observed"),
		).toBeLessThan(runner.indexOf("id: proof.start"));
		expect(main).toContain('"run_id": runId');
		expect(main).toContain("options: .atomic");
	});

	it("uses actual bounded TCP refusal and an open-listener negative control, not NW waiting", () => {
		expect(probe).toContain("Darwin.connect");
		expect(probe).toContain("Darwin.poll");
		expect(probe).toContain("SO_ERROR");
		expect(probe).toContain("timeoutMs: Int32 = 1500");
		expect(main).toContain("control.open == .open, control.closed == .refused");
		expect(main).toContain("pass && outcome == .refused");
		expect(main).not.toContain("NWConnection(host:");
		expect(workflow).toContain("timeout-minutes: 35");
		expect(main).not.toMatch(TIMEOUT_OVERRIDE);
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
