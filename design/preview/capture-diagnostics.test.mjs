import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createDiagnostics, rendererFacts, retainSafely } from "./capture-diagnostics.mjs";

const fixture = (run) => {
	const directory = mkdtempSync(join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "listing-diagnostics-test-"));
	try {
		const fresh = join(directory, "synthetic.png");
		// Valid 1x1 synthetic PNG: no browser, native runtime or decoder required.
		writeFileSync(fresh, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
		run(directory, fresh);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
};
const metrics = { strict: 19, beyondFuzz: 19, largest: 19, fuzz: 1, stale: true };

// GitHub rejects runner.* before creating jobs if it occurs in job-level env.
// Keep the same artifact directory on the two capture steps, where it is valid.
// This narrow contract complements the actual forge parser; it is not a YAML parser.
test("diagnostic runner context is step-local and the failure upload stays narrowly scoped", () => {
	const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
	const design = workflow.slice(workflow.indexOf("  design-kit:"), workflow.indexOf("  ci-gate:"));
	assert.ok(design.includes("    steps:"));
	assert.doesNotMatch(design.slice(0, design.indexOf("    steps:")), /\$\{\{\s*runner\./);
	for (const name of ["Preview sheet and feature graphic re-render identically", "The committed listing frames re-render identically"]) {
		const start = design.indexOf(`      - name: ${name}\n`);
		assert.ok(start >= 0);
		const end = design.indexOf("\n      - name:", start + 1);
		const step = design.slice(start, end < 0 ? undefined : end);
		assert.match(step, /        env:\n          CAPTURE_DIAGNOSTICS_DIR: \$\{\{ runner.temp \}\}\/listing-render-diagnostics/);
	}
	assert.match(design, /name: Upload listing renderer diagnostics even when the gate fails\n        if: always\(\)/);
	assert.match(design, /path: \$\{\{ runner.temp \}\}\/listing-render-diagnostics\//);
});

test("both invocations and every surface retain distinct actuals; only stale frames get deltas", () => fixture((directory, fresh) => {
	let differences = 0;
	for (const invocation of ["all", "frames"]) {
		const retain = createDiagnostics({ directory, invocation, renderer: rendererFacts(), fonts: {},
			makeDifference: (_a, _b, output) => { differences++; writeFileSync(output, "synthetic delta"); } });
		for (const surface of ["appstore-iphone-6.9", "appstore-ipad-13", "play-phone"]) {
			retain({ surface, slug: "01-session-transcript", fresh, reference: fresh,
				metrics: { ...metrics, stale: surface !== "appstore-iphone-6.9" } });
			const files = readdirSync(join(directory, `${invocation}-${process.pid}`, surface, "01-session-transcript"));
			assert.ok(files.includes("actual.png"));
			assert.equal(files.includes("delta.png"), surface !== "appstore-iphone-6.9");
		}
	}
	assert.equal(differences, 4);
}));

test("artifact allowlists reject private paths and omit secret-bearing metadata fields", () => fixture((directory, fresh) => {
	const secret = "DO_NOT_UPLOAD_SYNTHETIC_SECRET";
	const renderer = rendererFacts({ product: "Chrome/test", commandLine: secret }, {
		gpu: { devices: [{ deviceString: "synthetic GPU", privateField: secret }], auxAttributes: { glRenderer: "synthetic backend", privateField: secret } }, privateField: secret,
	});
	const retain = createDiagnostics({ directory, invocation: "frames", renderer, fonts: {}, makeDifference: () => {} });
	assert.throws(() => retain({ surface: "../../HOME", slug: "01-session-transcript" }), /whitelist/);
	assert.throws(() => retain({ surface: "play-phone", slug: "09-sign-in" }), /whitelist/);
	retain({ surface: "play-phone", slug: "01-session-transcript", fresh, reference: fresh,
		metrics: { ...metrics, stale: false, privateField: secret }, faces: [
			{ family: "Figtree", status: "loaded", weight: "300 900", url: secret }, { family: secret },
		] });
	const run = join(directory, `frames-${process.pid}`);
	const metadata = readFileSync(join(run, "renderer.json"), "utf8") + readFileSync(join(run, "play-phone/01-session-transcript/comparison.json"), "utf8");
	assert.ok(!metadata.includes(secret));
	assert.ok(!metadata.includes(process.env.HOME));
	assert.match(metadata, /synthetic backend/);
}));

test("a stale frame without a decoder retains explicit unavailability, not a fictitious delta", () => fixture((directory, fresh) => {
	const retain = createDiagnostics({ directory, invocation: "frames", renderer: {}, fonts: {},
		makeDifference: () => { assert.fail("a missing decoder cannot render a delta"); } });
	const previous = process.exitCode;
	try {
		process.exitCode = 1;
		retain({ surface: "appstore-ipad-13", slug: "01-session-transcript", fresh, reference: fresh,
			metrics: { strict: null, beyondFuzz: null, largest: null, fuzz: 1, stale: true } });
		const target = join(directory, `frames-${process.pid}`, "appstore-ipad-13/01-session-transcript");
		assert.deepEqual(JSON.parse(readFileSync(join(target, "delta-status.json"))), {
			available: false, reason: "image-decoder-unavailable",
		});
		assert.ok(!readdirSync(target).includes("delta.png"));
		assert.deepEqual(readFileSync(join(target, "actual.png")), readFileSync(fresh));
		assert.deepEqual(readFileSync(join(target, "reference.png")), readFileSync(fresh));
		assert.equal(process.exitCode, 1);
	} finally {
		process.exitCode = previous;
	}
}));

test("diagnostic failure leaves both passing and failing exit statuses untouched, with no secret output", () => {
	const previous = process.exitCode;
	try {
		for (const status of [0, 1]) {
			process.exitCode = status;
			const warnings = [];
			retainSafely(() => { throw new Error("SYNTHETIC_SECRET"); }, {}, (text) => warnings.push(text));
			assert.equal(process.exitCode, status);
			assert.deepEqual(warnings, ["listing diagnostics: evidence incomplete (gate verdict unchanged)"]);
		}
	} finally {
		process.exitCode = previous;
	}
});

test("failure evidence survives child exit without changing the failing exit status", () => fixture((directory, fresh) => {
	const module = new URL("./capture-diagnostics.mjs", import.meta.url).href;
	const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
		import { createDiagnostics } from ${JSON.stringify(module)};
		import { copyFileSync } from 'node:fs';
		process.exitCode = 1;
		const retain = createDiagnostics({ directory: ${JSON.stringify(directory)}, invocation: 'frames', renderer: {}, fonts: {}, makeDifference: (a,b,out) => copyFileSync(a,out) });
		retain({ surface: 'appstore-ipad-13', slug: '01-session-transcript', fresh: ${JSON.stringify(fresh)}, reference: ${JSON.stringify(fresh)}, metrics: ${JSON.stringify(metrics)} });
	`], { encoding: "utf8", timeout: 5000 });
	assert.equal(child.status, 1, child.stderr);
	const path = join(directory, `frames-${child.pid}`, "appstore-ipad-13/01-session-transcript");
	assert.deepEqual(readFileSync(join(path, "actual.png")), readFileSync(fresh));
	assert.equal(JSON.parse(readFileSync(join(path, "comparison.json"))).stale, true);
	assert.ok(readdirSync(path).includes("delta.png"));
}));
