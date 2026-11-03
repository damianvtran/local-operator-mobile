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
	cleanupOnly = false,
	bootstrap = false,
) {
	const workFile = join(root, "work.cjs"),
		cleanupFile = join(root, "cleanup.cjs");
	writeFileSync(workFile, work);
	writeFileSync(cleanupFile, cleanup);
	// Test-only Popen boundary waits for registration, not a fresh work clock.
	// The original deadline starts BEFORE this wait and is never reset. This
	// avoids assuming a cold Node process initializes inside a 200/300ms fixture.
	const driver = `import runpy,json,sys,time,os,signal
m=runpy.run_path(sys.argv[1]);real=m['subprocess'].Popen
ready=m['Path'](sys.argv[5])/'registered-worker.ready'
def start(argv,**kwargs):
 child=real(argv,**kwargs)
 if sys.argv[9]=='1' and argv[1]==sys.argv[3]:
  end=time.monotonic()+3
  while not ready.exists():
   if child.poll() is not None: raise AssertionError('Fixture exited before registration')
   if time.monotonic()>=end:
    os.killpg(child.pid,signal.SIGKILL);child.wait();raise AssertionError('Bounded fixture bootstrap failed')
   time.sleep(0.005)
 return child
m['subprocess'].Popen=start
result=m['supervise']([sys.argv[2],sys.argv[3]],[sys.argv[2],sys.argv[4]],m['Path'](sys.argv[5]),float(sys.argv[6]),float(sys.argv[7]),sys.argv[8]=='1')
print(json.dumps(result))
`;
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
			cleanupOnly ? "1" : "0",
			bootstrap ? "1" : "0",
		],
		{ encoding: "utf8", timeout: 5000, maxBuffer: 65536 },
	);
	expect(child.status, child.stderr).toBe(0);
	return JSON.parse(child.stdout);
}
it("outer wall-clock watchdog interrupts synchronous Node work, owns/reaps its registered command group and preserves the first cause", () => {
	const root = fixture(),
		run = join(root, "run");
	const script = `const fs=require('node:fs');const {spawn}=require('node:child_process');fs.writeFileSync(${JSON.stringify(join(run, "seed-first-failure.json"))},JSON.stringify({cause:'phase-rejected'}));const owned=spawn(process.execPath,[${JSON.stringify(join(import.meta.dirname, "retirement-replay-child.cjs"))},process.execPath,'-e','setInterval(()=>{},1000)'],{detached:true,stdio:['pipe','ignore','ignore']});fs.writeSync(Number(process.env.LO_REPLAY_SUPERVISOR_FD),JSON.stringify({group:owned.pid})+'\\n');fs.writeFileSync(${JSON.stringify(join(run, "registered-worker.ready"))},'registered');owned.stdin.end('G');while(true){}`;
	const result = exercise(root, script, "process.exit(0)", 0.3, 1, false, true);
	expect(result.first.stopReason).toBe("work-deadline");
	expect(result.first.workerReaped).toBe(true);
	expect(result.first.ownedGroupsTerminated).toBe(1);
	expect(result.first.groupsAbsent).toBe(true);
	expect(result.fallback.workerExit).toBe(0);
	expect(result.elapsedMs).toBeGreaterThanOrEqual(300);
	expect(result.elapsedMs).toBeLessThan(5000);
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
				// Match the augmented ProcessEnv without broad host-secret inheritance.
				NODE_ENV: process.env.NODE_ENV,
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
	expect(result.stderr).toMatch(
		/^Retained seed replay refused; inspect sanitized evidence$/m,
	);
	expect(result.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
	expect(existsSync(target)).toBe(false);
}, 6000);

it.each(["deadline", "phase-rejected"])(
	"work watchdog followed by real always-cleanup preserves %s, original exit and every export",
	(cause) => {
		const root = fixture(),
			run = join(root, "run"),
			evidence = join(run, "evidence");
		// First cause is known initial state; its existence must not depend on
		// winning a sub200ms Node-startup race under host load.
		if (cause !== "deadline")
			writeFileSync(
				join(run, "seed-first-failure.json"),
				JSON.stringify({ cause: "phase-rejected", message: "PRIVATE_TOKEN" }),
			);
		const first = exercise(root, "while(true){}", "process.exit(0)", 0.2, 2);
		expect(first.first.workerExit).toBe(-9);
		expect(first.first.stopReason).toBe("work-deadline");
		const bytes = readFileSync(join(evidence, "watchdog-run.json"));
		exercise(root, "process.exit(0)", "process.exit(0)", 0.2, 2, true);
		expect(readFileSync(join(evidence, "watchdog-run.json"))).toEqual(bytes);
		expect(
			JSON.parse(
				readFileSync(join(evidence, "watchdog-cleanup-1.json"), "utf8"),
			).first.workerExit,
		).toBe(0);
		expect(
			JSON.parse(readFileSync(join(evidence, "first-failure.json"), "utf8")),
		).toEqual({ cause });
		for (const name of [
			"watchdog-run.json",
			"watchdog-cleanup-1.json",
			"first-failure.json",
		])
			expect(readFileSync(join(evidence, name), "utf8")).not.toContain(
				"PRIVATE_TOKEN",
			);
	},
	6000,
);

it("exact production Python watchdog launches bare Node24 through the entire import chain and reaches harmless cleanup main", () => {
	const directory = fixture(),
		run = join(directory, "run");
	const result = spawnSync(
		"/usr/bin/python3",
		[
			join(import.meta.dirname, "retirement-replay-watchdog.py"),
			"--mode",
			"cleanup",
			"--root",
			run,
		],
		{
			encoding: "utf8",
			timeout: 5000,
			maxBuffer: 65536,
			env: {
				// Match the augmented ProcessEnv without broad host-secret inheritance.
				NODE_ENV: process.env.NODE_ENV,
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
	expect(result.status, result.stderr).toBe(0);
	expect(result.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
	expect(
		JSON.parse(readFileSync(join(run, "replay-cleanup.json"), "utf8")),
	).toEqual({ cleanupComplete: true, inventoryAbsent: true });
	const receipt = JSON.parse(
		readFileSync(join(run, "evidence/watchdog-cleanup-1.json"), "utf8"),
	);
	expect(receipt.first.workerExit).toBe(0);
	expect(receipt.first.workerReaped).toBe(true);
	expect(existsSync(join(run, "creation-intent.json"))).toBe(false);
}, 6000);
