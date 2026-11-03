import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"replay-watchdog-",
		),
	);
	roots.push(root);
	mkdirSync(join(root, "run"));
	return root;
}
function exercise(
	root: string,
	work: string,
	cleanup: string,
	workSeconds: number,
	cleanupSeconds: number,
) {
	const workFile = join(root, "work.cjs"),
		cleanupFile = join(root, "cleanup.cjs");
	writeFileSync(workFile, work);
	writeFileSync(cleanupFile, cleanup);
	const driver =
		"import runpy,json,sys; m=runpy.run_path(sys.argv[1]); result=m['supervise']([sys.argv[2],sys.argv[3]],[sys.argv[2],sys.argv[4]],m['Path'](sys.argv[5]),float(sys.argv[6]),float(sys.argv[7])); print(json.dumps(result))";
	const child = spawnSync(
		"/usr/bin/python3",
		[
			"-c",
			driver,
			join(import.meta.dirname, "retirement-replay-watchdog.py"),
			process.execPath,
			workFile,
			cleanupFile,
			join(root, "run"),
			String(workSeconds),
			String(cleanupSeconds),
		],
		{ encoding: "utf8", timeout: 5000, maxBuffer: 65536 },
	);
	expect(child.status, child.stderr).toBe(0);
	return JSON.parse(child.stdout);
}
it("outer wall-clock watchdog interrupts synchronous Node work, owns/reaps its registered command group and preserves the first cause", () => {
	const root = fixture(),
		run = join(root, "run");
	const script = `const fs=require('node:fs');const {spawn}=require('node:child_process');fs.writeFileSync(${JSON.stringify(join(run, "seed-first-failure.json"))},JSON.stringify({cause:'phase-rejected'}));const owned=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});fs.writeSync(Number(process.env.LO_REPLAY_SUPERVISOR_FD),JSON.stringify({group:owned.pid})+'\\n');while(true){}`;
	const result = exercise(root, script, "process.exit(0)", 0.3, 1);
	expect(result.first.stopReason).toBe("work-deadline");
	expect(result.first.workerReaped).toBe(true);
	expect(result.first.ownedGroupsTerminated).toBe(1);
	expect(result.first.groupsAbsent).toBe(true);
	expect(result.fallback.workerExit).toBe(0);
	expect(result.elapsedMs).toBeLessThan(2000);
	expect(
		JSON.parse(readFileSync(join(run, "seed-first-failure.json"), "utf8")),
	).toEqual({ cause: "phase-rejected" });
}, 6000);
it("cleanup fallback receives only the first cleanup deadline, not another full allowance", () => {
	const root = fixture(),
		run = join(root, "run");
	const cleanupPath = JSON.stringify(join(run, "cleanup-start.json"));
	const work = `const fs=require('node:fs');const at=Date.now();fs.writeFileSync(${cleanupPath},JSON.stringify({at,end:at+350}));while(true){}`;
	const result = exercise(root, work, "while(true){}", 1, 0.35);
	expect(result.first.stopReason).toBe("cleanup-deadline");
	expect(result.fallback.stopReason).toBe("cleanup-deadline");
	expect(result.elapsedMs).toBeLessThan(1000);
	expect(
		JSON.parse(readFileSync(join(run, "cleanup-start.json"), "utf8")).end -
			JSON.parse(readFileSync(join(run, "cleanup-start.json"), "utf8")).at,
	).toBe(350);
}, 6000);

it("actual direct CLI without the required supervisor exits nonzero BEFORE any setup/API/native phase", () => {
	const directory = fixture(),
		target = join(directory, "never-started");
	const result = spawnSync(
		process.execPath,
		[join(import.meta.dirname, "retirement-ui-replay.ts"), "--run", target],
		{
			encoding: "utf8",
			timeout: 5000,
			maxBuffer: 65536,
			env: {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				TMPDIR: process.env.TMPDIR,
				NODE_OPTIONS: "--max-old-space-size=512",
				GIT_CONFIG_SYSTEM: "/dev/null",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_TERMINAL_PROMPT: "0",
			},
		},
	);
	expect(result.status).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toContain("Retained seed replay refused");
	expect(existsSync(target)).toBe(false);
}, 6000);
