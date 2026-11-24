// node:test only — the design-kit job installs no node dependencies, so these
// run there with plain `node --test` next to capture-diagnostics.test.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { rendererLine, rendererVersion } from "./capture-diagnostics.mjs";
import { onDiskVersion, recordedRenderers, rendererDrift } from "./renderer-drift.mjs";

const script = new URL("./renderer-drift.mjs", import.meta.url).pathname;

const withDiagnostics = (passes, run) => {
	const directory = mkdtempSync(join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "renderer-drift-test-"));
	try {
		for (const [name, renderer] of Object.entries(passes)) {
			mkdirSync(join(directory, name));
			if (renderer !== undefined) writeFileSync(join(directory, name, "renderer.json"), JSON.stringify({ renderer }));
		}
		return run(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
};

test("the version reads the same from CDP's product and the binary's --version", () => {
	assert.equal(rendererVersion("HeadlessChrome/157.0.8103.80"), "157.0.8103.80");
	assert.equal(rendererVersion("Google Chrome 157.0.8103.80 \n"), "157.0.8103.80");
	assert.equal(rendererVersion(undefined), null);
	assert.equal(rendererVersion("Chrome"), null);
});

test("every --check prints one renderer line, and an unreadable answer says unavailable", () => {
	assert.equal(
		rendererLine({ product: "HeadlessChrome/157.0.8103.80", graphics: { skiaBackendType: "GraphiteDawnMetal" } }),
		"renderer: HeadlessChrome/157.0.8103.80 skiaBackendType=GraphiteDawnMetal",
	);
	assert.equal(rendererLine({ product: "HeadlessChrome/157.0.8103.80", graphics: {} }), "renderer: HeadlessChrome/157.0.8103.80 skiaBackendType=unknown");
	for (const facts of [null, undefined, { unavailable: true }, {}, { product: null }]) {
		assert.equal(rendererLine(facts), "renderer: unavailable");
	}
});

// The incident shape: the two passes of one job on different builds (run evidence
// in the PR body: 156.0.8078.80 then 157.0.8103.80).
test("FAILS when a pass rendered with a build other than the frozen one, naming every version", () => withDiagnostics({
	"all-101": { product: "HeadlessChrome/156.0.8078.80" },
	"frames-202": { product: "HeadlessChrome/157.0.8103.80" },
}, (directory) => {
	const verdict = rendererDrift({ frozen: "Google Chrome 156.0.8078.80", records: recordedRenderers(directory) });
	assert.equal(verdict.ok, false);
	assert.match(verdict.message, /the capture renderer changed mid-job; the gate's verdict would be meaningless/);
	for (const version of ["156.0.8078.80", "157.0.8103.80"]) assert.ok(verdict.message.includes(version));
}));

test("FAILS when both passes agree with each other but not with the frozen copy", () => {
	const records = [{ pass: "all", run: "all-1", version: "158.0.8127.36" }, { pass: "frames", run: "frames-2", version: "158.0.8127.36" }];
	assert.equal(rendererDrift({ frozen: "Google Chrome 157.0.8103.79", records }).ok, false);
});

test("FAILS closed when the frozen version itself is unreadable", () => {
	for (const frozen of [undefined, "", "Google Chrome"]) {
		const verdict = rendererDrift({ frozen, records: [] });
		assert.equal(verdict.ok, false);
		assert.match(verdict.message, /unreadable/);
	}
});

test("passes when every recorded pass matches the frozen build", () => withDiagnostics({
	"all-101": { product: "HeadlessChrome/157.0.8103.80" },
	"frames-202": { product: "HeadlessChrome/157.0.8103.80" },
}, (directory) => {
	const verdict = rendererDrift({ frozen: "Google Chrome 157.0.8103.80", records: recordedRenderers(directory) });
	assert.equal(verdict.ok, true);
	assert.equal(verdict.warning, null);
}));

test("a pass with no recorded renderer warns but never fails on its own", () => withDiagnostics({
	"all-101": { unavailable: true },
	"frames-202": undefined,
	"unrelated": { product: "HeadlessChrome/1.2.3.4" },
}, (directory) => {
	const records = recordedRenderers(directory);
	assert.deepEqual(records.map((r) => r.run), ["all-101", "frames-202"]);
	const verdict = rendererDrift({ frozen: "Google Chrome 157.0.8103.80", records });
	assert.equal(verdict.ok, true);
	assert.match(verdict.warning, /all and frames pass/);
}));

test("the CLI exits 1 with an ::error:: on drift and 0 when the renderer held", () => {
	for (const [frames, status] of [["157.0.8103.80", 0], ["158.0.8127.36", 1]]) {
		withDiagnostics({
			"all-1": { product: "HeadlessChrome/157.0.8103.80" },
			"frames-2": { product: `HeadlessChrome/${frames}` },
		}, (directory) => {
			const child = spawnSync(process.execPath, [script, directory, "Google Chrome 157.0.8103.80"], { encoding: "utf8", timeout: 5000 });
			assert.equal(child.status, status, child.stdout + child.stderr);
			if (status) assert.match(child.stdout, /^::error::the capture renderer changed mid-job/m);
		});
	}
});

// PR #355 run 44855933617: the copy itself was updated in place mid-job. A stub
// "binary" stands in for the frozen copy so the on-disk re-read is exercised for
// real (execFileSync of a path), with no browser.
const withStubBinary = (output, run, status = 0) => {
	const directory = mkdtempSync(join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "renderer-drift-bin-"));
	try {
		const binary = join(directory, "Google Chrome");
		writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(output)}\nexit ${status}\n`);
		chmodSync(binary, 0o755);
		return run(binary);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
};

const held = [{ pass: "all", run: "all-1", version: "157.0.8103.79" }, { pass: "frames", run: "frames-2", version: "157.0.8103.79" }];

test("the on-disk re-read reads a binary's first --version line, and null when it will not run", () => {
	withStubBinary("Google Chrome 157.0.8103.79 ", (binary) => assert.equal(onDiskVersion(binary), "Google Chrome 157.0.8103.79 "));
	withStubBinary("boom", (binary) => assert.equal(onDiskVersion(binary), null), 3);
	assert.equal(onDiskVersion("/nonexistent/Google Chrome"), null);
});

test("FAILS when every pass held but the copy on disk changed after them", () => {
	const verdict = rendererDrift({ frozen: "Google Chrome 157.0.8103.79 ", records: held, onDisk: "Google Chrome 157.0.8103.80 " });
	assert.equal(verdict.ok, false);
	assert.match(verdict.message, /modified on disk during the job; the freeze did not hold/);
	assert.ok(verdict.message.includes("on-disk copy now 157.0.8103.80"));
});

test("FAILS when CDP recorded nothing but the copy on disk changed (independent of CDP)", () => {
	const records = [{ pass: "all", run: "all-1", version: null }, { pass: "frames", run: "frames-2", version: null }];
	assert.equal(rendererDrift({ frozen: "Google Chrome 157.0.8103.79", records, onDisk: "Google Chrome 158.0.8127.36" }).ok, false);
});

test("FAILS closed when the copy on disk no longer reports a version", () => {
	for (const onDisk of [null, "", "Google Chrome"]) {
		const verdict = rendererDrift({ frozen: "Google Chrome 157.0.8103.79", records: held, onDisk });
		assert.equal(verdict.ok, false);
		assert.match(verdict.message, /no longer reports a version on disk/);
	}
});

test("passes when the passes and the on-disk copy all still match; not checked when no binary is given", () => {
	const verdict = rendererDrift({ frozen: "Google Chrome 157.0.8103.79 ", records: held, onDisk: "Google Chrome 157.0.8103.79 " });
	assert.equal(verdict.ok, true);
	assert.match(verdict.message, /on-disk copy now 157\.0\.8103\.79/);
	assert.doesNotMatch(rendererDrift({ frozen: "Google Chrome 157.0.8103.79", records: held }).message, /on-disk/);
});

test("the CLI re-reads the frozen binary it is given and exits 1 when the copy moved", () => {
	withDiagnostics({
		"all-1": { product: "HeadlessChrome/157.0.8103.79" },
		"frames-2": { product: "HeadlessChrome/157.0.8103.79" },
	}, (directory) => {
		for (const [disk, status] of [["Google Chrome 157.0.8103.79 ", 0], ["Google Chrome 157.0.8103.80 ", 1]]) {
			withStubBinary(disk, (binary) => {
				const child = spawnSync(process.execPath, [script, directory, "Google Chrome 157.0.8103.79 ", binary], { encoding: "utf8", timeout: 10000 });
				assert.equal(child.status, status, child.stdout + child.stderr);
				if (status) assert.match(child.stdout, /^::error::the frozen capture renderer was modified on disk/m);
				else assert.match(child.stdout, /on-disk copy now 157\.0\.8103\.79/);
			});
		}
	});
});

test("the design-kit job freezes Chrome before any use and checks drift after the listing gate", () => {
	const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
	const design = workflow.slice(workflow.indexOf("  design-kit:"), workflow.indexOf("  ci-gate:"));
	const at = (name) => design.indexOf(`      - name: ${name}\n`);
	const freeze = at("Freeze the capture renderer for the whole job");
	assert.ok(freeze >= 0);
	// Nothing before the freeze may touch Chrome, and nothing after it may name the
	// mutable /Applications bundle as the binary to run.
	assert.doesNotMatch(design.slice(0, freeze), /Google Chrome/);
	assert.doesNotMatch(design.slice(freeze).split("\n      - name:").slice(1).join(""), /\/Applications\/Google/);
	assert.ok(design.slice(freeze).includes('frozen_bin="$frozen/Contents/MacOS/Google Chrome"'));
	assert.ok(design.slice(freeze).includes('echo "CHROME=$frozen_bin" >> "$GITHUB_ENV"'));
	const drift = at("The capture renderer did not change mid-job");
	assert.ok(drift > at("The committed listing frames re-render identically"));
	assert.match(design.slice(drift), /node design\/preview\/renderer-drift\.mjs "\$RUNNER_TEMP\/listing-render-diagnostics" "\$CAPTURE_CHROME_VERSION" "\$CHROME"/);
	// Review R1-2: only after a successful freeze and a listing step that ran.
	assert.match(design.slice(drift), /if: \$\{\{ !cancelled\(\) && steps\.freeze\.outcome == 'success' && \(steps\.listing\.outcome == 'success' \|\| steps\.listing\.outcome == 'failure'\) \}\}/);
	assert.match(design.slice(freeze), /^        id: freeze$/m);
	assert.match(design.slice(at("The committed listing frames re-render identically")), /^        id: listing$/m);
	// Run 44855933617: a copy alone was updated in place. Both locks, the smoke
	// launch of the LOCKED copy, and the unlock at job end must stay.
	const freezeStep = design.slice(freeze, design.indexOf("\n      - ", freeze + 1));
	assert.match(freezeStep, /launchctl bootout "gui\/\$\(id -u\)\/\$label"/);
	assert.match(freezeStep, /sudo -n launchctl bootout "system\/\$label"/);
	assert.match(freezeStep, /pgrep -fl -i "\$updater"/);
	const lock = freezeStep.indexOf('chflags -R uchg "$frozen_dir"');
	assert.ok(lock > 0 && lock < freezeStep.indexOf("--dump-dom about:blank"));
	assert.ok(at("Unlock the frozen capture renderer") > drift);
	assert.match(design.slice(at("Unlock the frozen capture renderer")), /if: always\(\)\n        run: chflags -R nouchg "\$RUNNER_TEMP\/chrome-frozen"/);
});
