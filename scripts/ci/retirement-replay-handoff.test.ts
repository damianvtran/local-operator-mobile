import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { REPLAY_POLICY } from "./retirement-replay-policy.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function producer() {
	// Actual bare Node producer, not Vitest's transpiler and not a chosen fixture
	// token. Keep generated values in memory/stdin only; assert coarse results.
	const code = `import {GrantSession,Deadline} from ${JSON.stringify(new URL("./retirement-replay-core.ts", import.meta.url).href)};const value=new GrantSession('seed-replay',new Deadline(300000),async()=>{throw new Error('unused fixture');},()=>Date.now()+300000);process.stdout.write(JSON.stringify({session:value.id,bearer:value.bearer}));`;
	const child = spawnSync(
		process.execPath,
		["--input-type=module", "-e", code],
		{
			encoding: "utf8",
			timeout: 5000,
			maxBuffer: 65536,
			env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=512" },
		},
	);
	expect(child.status, child.stderr).toBe(0);
	return JSON.parse(child.stdout) as { session: string; bearer: string };
}
function prepare(value: { session: string; bearer: string }) {
	const root = mkdtempSync(join(tmpdir(), "replay-wire-handoff-"));
	roots.push(root);
	const driver = `import json,sys,runpy,plistlib\nfrom pathlib import Path\nroot=Path(sys.argv[1]); fixture=runpy.run_path(sys.argv[2]);api=fixture['API']; fixture['products'](root)\n(root/'setup-receipt.json').write_text(json.dumps({'runnerSourceSHA':'c'*40,'compileOutcome':'not-started'}));api['package'](root)\nwork=root/'replay';work.mkdir()\nwith api['tarfile'].open(root/'runner-products.tar.gz') as archive: archive.extractall(work)\nvalue=json.load(sys.stdin);private=root/'private.json';private.write_text(json.dumps({'LO_REPLAY_MODE':'seed-replay','LO_REPLAY_CONTROL':'http://127.0.0.1:23456/rpc','LO_REPLAY_SESSION':value['session'],'LO_REPLAY_BEARER':value['bearer'],'LO_REPLAY_RUNNER_SOURCE':'c'*40}));private.chmod(0o600)\noutput=work/'Products/private.xctestrun'\ntry:\n api['prepare'](work,private,output)\n prepared=plistlib.loads(output.read_bytes());target=prepared['RetirementSystemAlert']\n assert target['TestHostPath'].startswith('__TESTROOT__/') and target['TestBundlePath'].startswith('__TESTHOST__/')\n assert all(target[field]['LO_REPLAY_SESSION']==value['session'] and target[field]['LO_REPLAY_BEARER']==value['bearer'] for field in ('EnvironmentVariables','TestingEnvironmentVariables'))\n print(json.dumps({'accepted':True,'outputPresent':output.exists()}))\nexcept ValueError:\n print(json.dumps({'accepted':False,'outputPresent':output.exists()}))\n`;
	const child = spawnSync(
		"/usr/bin/python3",
		[
			"-c",
			driver,
			root,
			join(import.meta.dirname, "retirement-replay-products.test.py"),
		],
		{
			input: JSON.stringify(value),
			encoding: "utf8",
			timeout: 5000,
			maxBuffer: 65536,
		},
	);
	expect(child.status, child.stderr).toBe(0);
	return JSON.parse(child.stdout);
}
it("actual generated session reaches real Python prepare under one exact policy", () => {
	const value = producer();
	expect(value.session.length).toBe(REPLAY_POLICY.sessionBytes * 2);
	expect(value.bearer.length).toBe(REPLAY_POLICY.bearerBytes * 2);
	expect(prepare(value)).toEqual({ accepted: true, outputPresent: true });
});
it.each([
	"short-session",
	"long-session",
	"legacy-session",
	"short-bearer",
	"long-bearer",
])("real preparation refuses %s without producing a configuration", (kind) => {
	const value = producer();
	if (kind === "short-session") value.session = value.session.slice(0, -2);
	if (kind === "long-session") value.session += "aa";
	if (kind === "legacy-session") value.session = "a".repeat(32);
	if (kind === "short-bearer") value.bearer = value.bearer.slice(0, -2);
	if (kind === "long-bearer") value.bearer += "aa";
	expect(prepare(value)).toEqual({ accepted: false, outputPresent: false });
});
it("project-generated Swift consumes the same strict policy", () => {
	const root = mkdtempSync(join(tmpdir(), "replay-wire-project-"));
	roots.push(root);
	const output = join(root, "Runner.xcodeproj");
	const child = spawnSync(
		"/usr/bin/python3",
		[
			"-c",
			"import runpy,sys;from pathlib import Path;runpy.run_path(sys.argv[1])['project'](Path(sys.argv[2]))",
			join(import.meta.dirname, "retirement-ui-setup.py"),
			output,
		],
		{ encoding: "utf8", timeout: 5000 },
	);
	expect(child.status, child.stderr).toBe(0);
	const source = readFileSync(join(root, "ReplayPolicy.swift"), "utf8");
	expect(source).toContain(`sessionBytes = ${REPLAY_POLICY.sessionBytes}`);
	expect(source).toContain(`bearerBytes = ${REPLAY_POLICY.bearerBytes}`);
	expect(
		readFileSync(
			new URL("./retirement-ui/ReplayHostClient.swift", import.meta.url),
			"utf8",
		),
	).toContain("ReplayPolicy.hex(id, bytes: ReplayPolicy.sessionBytes)");
});
