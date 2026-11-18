import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFINE, MARKER, patchSeam, proofEntry } from "./prepare.ts";

const UNEXPECTED = /Unexpected/;
const INSERTED = /\t\/\/ LOP_INSTALLED[\s\S]*?\t\t};\n/;
const seam = readFileSync(
	join(__dirname, "../../../src/testing/team-bridge-fixture.ts"),
	"utf8",
);

describe("installed-app proof: job-local candidate edits", () => {
	it("adds exactly one define-gated Android branch before the web gate", () => {
		const out = patchSeam(seam);
		expect(out.split(MARKER)).toHaveLength(3); // comment + returned marker
		expect(out).toContain(
			`process.env.${DEFINE} === "54832" && Platform.OS === "android"`,
		);
		expect(out).toContain(
			'baseUrl: "http://127.0.0.1:54832/mock-hub/populated"',
		);
		// The original web seam is kept verbatim after the inserted branch.
		expect(out.replace(INSERTED, "")).toBe(seam);
	});

	it("fails closed on an already-patched or moved seam", () => {
		expect(() => patchSeam(patchSeam(seam))).toThrow(UNEXPECTED);
		expect(() =>
			patchSeam(
				seam.replace(
					"export function teamBridgeFixture() {",
					"export function fixture() {",
				),
			),
		).toThrow(UNEXPECTED);
	});

	it("generates an entry that only adds the define-gated marker", () => {
		const entry = proofEntry("expo-router/entry");
		expect(entry).toContain(`process.env.${DEFINE} === "54832"`);
		expect(entry.trim().endsWith('require("expo-router/entry");')).toBe(true);
	});
});

describe("installed-app proof: preflight refusals", () => {
	// The refusals are pure over extracted facts; exercising them through the
	// real module keeps the negative controls honest without an SDK.
	const run = (script: string) =>
		execFileSync("python3", ["-c", script], {
			cwd: __dirname,
			encoding: "utf8",
		});
	const base = `
import importlib.util
s = importlib.util.spec_from_file_location("p", "preflight.py"); p = importlib.util.module_from_spec(s); s.loader.exec_module(p)
sha = "a" * 40
tree = 'E: instrumentation (line=11)\\n  A: android:targetPackage(0x01010021)="com.localoperator.mobile" (Raw: "x")\\n'
facts = dict(source_sha=sha, app_apk_sha256="1", driver_apk_sha256="2", bundle_sha256="3",
             app_package="com.localoperator.mobile", driver_package="com.localoperator.mobile.test",
             driver_xmltree=tree, app_signers=["k"], driver_signers=["k"], bundle_has_fixture=True)
manifest = {k: v for k, v in facts.items() if k != "driver_xmltree"}
`;
	it("passes the matching baseline", () => {
		expect(run(`${base}\nprint(p.check(manifest, facts, sha))`).trim()).toBe(
			"[]",
		);
	});
	it.each([
		["wrong source SHA", `p.check(manifest, facts, "b" * 40)`],
		[
			"missing fixture",
			`p.check(manifest, {**facts, "bundle_has_fixture": False}, sha)`,
		],
		[
			"cross-app driver",
			`p.check(manifest, {**facts, "driver_xmltree": tree.replace("com.localoperator.mobile", "com.example.other")}, sha)`,
		],
		[
			"driver is not signed",
			`p.check(manifest, {**facts, "driver_signers": ["other"]}, sha)`,
		],
	])("refuses %s", (name, call) => {
		const out = run(
			`${base}\nbad = ${call}\nprint(any(b.startswith(${JSON.stringify(name)}) for b in bad))`,
		);
		expect(out.trim()).toBe("True");
	});
});
