/**
 * Launch and reap the *installed* Google Chrome, headless, for CDP work.
 *
 * The recipe is local-operator `AGENTS.md` §"Capturing a browser surface:
 * headless Chrome, never a window", and each flag in it earns its place:
 *
 *   --headless=new            A window would steal the operator's focus. New
 *                             headless is the same binary with no window, so
 *                             CDP, screenshots and synthetic input all work.
 *   --user-data-dir=<own>     A throwaway profile. The directory is created
 *                             under this session's scratchpad, never `/tmp`
 *                             (shared with ~25 sibling sessions, reaped after
 *                             three days) — and the path is what scopes the
 *                             teardown sweep to our Chrome and never the
 *                             operator's.
 *   --remote-debugging-port=0 Let Chrome pick a port and publish it in
 *                             `DevToolsActivePort`; a fixed port collides.
 *   --use-mock-keychain       Without this a scratch-HOME Chrome cannot
 *                             encrypt its cookie store and macOS raises a
 *                             "Keychain Not Found" dialog on the operator's
 *                             screen. `--password-store=basic` is the
 *                             Linux-side equivalent and is harmless here.
 *   --no-first-run            Suppresses the first-run UI that otherwise
 *     --no-default-browser-check  opens real windows.
 *
 * Two teardown facts this file encodes, both measured in AGENTS.md:
 * signalling the browser PID alone leaves helpers behind (0–5, varying run to
 * run), and the sweep must be scoped to our own profile path. So: SIGTERM the
 * process *group* (we spawn detached, so the group is ours and signalling it
 * cannot reach the caller), then sweep by exact profile path, then **assert 0
 * remain** rather than trusting the sweep.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserWebSocketUrl, connect, sleep } from "./cdp.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Where a throwaway profile goes: this session's scratchpad, else the OS temp dir. */
export function scratchRoot() {
	const base = process.env.LOCAL_OPERATOR_SCRATCHPAD;
	const root = base && existsSync(base) ? base : tmpdir();
	return mkdtempSync(join(root, "chrome-"));
}

/**
 * Start headless Chrome with a fresh profile and return a handle.
 * `viewport` is applied per page over CDP, never with `--window-size`: on
 * Chrome 152 that flag clamps width at a 500px floor and loses 87px of height,
 * silently, which is how a frame's dimensions get assumed rather than set.
 */
export async function launchChrome({ profile = scratchRoot(), extraArgs = [], headless = true } = {}) {
	if (!existsSync(CHROME)) {
		throw new Error(
			`Google Chrome is not installed at ${CHROME}. The harness drives the `
			+ "installed browser only — it must never download or script its own engine.",
		);
	}
	const args = [
		...(headless ? ["--headless=new"] : []),
		`--user-data-dir=${profile}`,
		"--remote-debugging-port=0",
		"--use-mock-keychain",
		"--password-store=basic",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-networking",
		"--disable-component-update",
		"--disable-features=Translate,MediaRouter",
		...extraArgs,
		"about:blank",
	];
	// `detached: true` puts Chrome in its own process group. That is what makes
	// `process.kill(-pid)` safe: the group contains only Chrome and its helpers,
	// never this Node process (which is what a backgrounded `&` would give you).
	const child = spawn(CHROME, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr = `${stderr}${chunk}`.slice(-4000);
	});
	child.unref();

	const portFile = join(profile, "DevToolsActivePort");
	const deadline = Date.now() + 30_000;
	while (!existsSync(portFile) || readFileSync(portFile, "utf8").trim() === "") {
		if (Date.now() > deadline) {
			// A dev-server-less Chrome writes the port file asynchronously; an
			// immediate read gets an empty file and the connect fails
			// intermittently, which reads as a flaky harness. Hence the wait, and
			// hence a loud failure when the wait expires.
			await reap(child.pid, profile);
			throw new Error(`Chrome never wrote DevToolsActivePort (30 s). stderr: ${stderr.slice(-800)}`);
		}
		await sleep(150);
	}
	const port = Number(readFileSync(portFile, "utf8").split("\n")[0].trim());
	const browserWsUrl = await browserWebSocketUrl(port).catch(async (error) => {
		await reap(child.pid, profile);
		throw error;
	});
	const client = await connect(browserWsUrl);

	return {
		pid: child.pid,
		port,
		profile,
		client,
		async page(url = "about:blank") {
			return client.newPage(url);
		},
		async close() {
			await client.close();
			return reap(child.pid, profile);
		},
	};
}

/**
 * Stop Chrome, sweep this run's own profile, and report what survived.
 *
 * The single-sweep shape is not enough, and a measured leak is why: one run's
 * `close()` reported 0 survivors and its profile directory was removed, yet five
 * processes wearing that profile path were still alive a moment later. A
 * headless Chrome tree finishes spawning helpers asynchronously, so a helper can
 * appear *after* the sweep that was supposed to catch it — and a leaked browser
 * keeps reaching for the keychain on the operator's screen for minutes.
 *
 * So: SIGTERM the group, then sweep and re-count on a bounded loop, escalating to
 * SIGKILL, and only stop when two consecutive counts are 0 or the deadline
 * passes. The caller still asserts the returned count is 0.
 */
export async function reap(pid, profile) {
	if (pid) {
		try {
			process.kill(-pid, "SIGTERM");
		} catch {
			// Already gone, or we never owned the group: fall through to the pid.
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				/* already exited */
			}
		}
	}
	await sleep(1200);

	const deadline = Date.now() + 8000;
	let survivors = countProcesses(profile);
	let cleanRounds = survivors === 0 ? 1 : 0;
	let escalated = false;
	while (Date.now() < deadline && cleanRounds < 2) {
		// SIGKILL on the second round: a helper that ignored SIGTERM will not
		// start ignoring SIGKILL, and the count assertion is what matters.
		spawnSync("/usr/bin/pkill", escalated ? ["-9", "-f", profile] : ["-f", profile]);
		escalated = true;
		await sleep(900);
		survivors = countProcesses(profile);
		cleanRounds = survivors === 0 ? cleanRounds + 1 : 0;
	}

	try {
		rmSync(profile, { recursive: true, force: true });
	} catch {
		// A helper still holding a file makes this fail; the process count is the
		// assertion that matters, and the caller reports it.
	}
	return { survivors: countProcesses(profile), profile, rounds: escalated ? 2 : 1 };
}

/**
 * Count live processes matching our profile path. `pgrep -f <profile>` is scoped
 * to a path unique to this run, which is what keeps the sweep from reaching any
 * other Chrome — including the operator's. Never sweep by program name.
 */
export function countProcesses(profile) {
	const result = spawnSync("/usr/bin/pgrep", ["-f", profile], { encoding: "utf8" });
	if (result.status !== 0) return 0; // pgrep exits 1 when nothing matches: the good case.
	return result.stdout.split("\n").filter((line) => line.trim() !== "").length;
}
