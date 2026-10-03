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
 * Three teardown facts this file encodes, the first two measured in AGENTS.md:
 * signalling the browser PID alone leaves helpers behind (0–5, varying run to
 * run); the sweep must be scoped to our own profile path; and the *reach* of
 * that path-scoped sweep is a PLATFORM DEFAULT, not a property of the pattern.
 * BSD/macOS `pgrep`/`pkill -f` exclude the caller and all its ancestors, while
 * procps-ng (Linux, and therefore every CI runner) includes them and hides the
 * opt-out behind `-A`/`--ignore-ancestors` — a flag the other platform does not
 * have, under a name (`-a`) whose meaning there is the opposite one. Measured on
 * this host by emulating the Linux default: the harness's own `pkill -f
 * <profile>` SIGTERMed `capture.ts` *and* the `run-canary.ts` that spawned it,
 * because both carry `--profile <path>` in argv. So the pattern is never trusted
 * on its own: `matchingPids` enumerates it and subtracts this process's whole
 * ancestry, which makes the reaper's reach identical on both platforms. Then:
 * SIGTERM the process *group* (we spawn detached, so the group is ours and
 * signalling it cannot reach the caller), sweep by exact profile path minus our
 * own tree, and **assert 0 remain** rather than trusting the sweep.
 */

import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { browserWebSocketUrl, connect, sleep } from "./cdp.ts";

/**
 * Where the installed Chrome lives, per platform.
 *
 * `pgrep`/`pkill` are invoked by NAME rather than by an absolute `/usr/bin`
 * path for the same reason: that path is macOS's, and a Linux runner puts them
 * in `/bin`, so a hard-coded prefix would leave the sweep unable to find — or
 * unable to kill — the processes it started.
 *
 * The harness drives the browser the machine already has, in whatever place that
 * platform puts it — a macOS app bundle, a Linux distribution's launcher on
 * PATH. A single hard-coded macOS path meant the capture and audit jobs could
 * only ever run on a developer's laptop, and CI (a Linux runner) failed with
 * "Google Chrome is not installed at /Applications/...".
 *
 * `CHROME_BIN` is honoured first, which is how a runner names a non-standard
 * install; the candidates after it are tried in order.
 */
export function resolveChrome(): { path: string; source: string } | null {
	const override = process.env.CHROME_BIN;
	if (override !== undefined && override !== "" && existsSync(override)) {
		return { path: override, source: "CHROME_BIN" };
	}
	const candidates =
		process.platform === "darwin"
			? [
					"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
					"/Applications/Chromium.app/Contents/MacOS/Chromium",
					`${process.env.HOME ?? ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
				]
			: [
					// A Linux runner's usual installs, in the order a distribution's own
					// packaging would place them.
					"/usr/bin/google-chrome",
					"/usr/bin/google-chrome-stable",
					"/usr/bin/chromium",
					"/usr/bin/chromium-browser",
					"/snap/bin/chromium",
				];
	for (const candidate of candidates) {
		if (candidate !== "" && existsSync(candidate))
			return { path: candidate, source: "platform default" };
	}
	// Last resort: whatever is on PATH, which is how a `chromium` in a container
	// or a version-manager shim is found.
	const found = spawnSync(
		"/usr/bin/env",
		[
			"sh",
			"-c",
			"command -v google-chrome || command -v chromium || command -v chromium-browser",
		],
		{
			encoding: "utf8",
		},
	);
	const path = (found.stdout ?? "").trim().split("\n")[0] ?? "";
	if (path !== "") return { path, source: "PATH" };
	return null;
}

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
export async function launchChrome({
	profile = scratchRoot(),
	extraArgs = [],
	headless = true,
}: {
	profile?: string;
	extraArgs?: string[];
	headless?: boolean;
} = {}) {
	const chrome = resolveChrome();
	if (chrome === null) {
		throw new Error(
			"No Chrome found (a macOS app bundle, a Linux launcher, or CHROME_BIN). The harness " +
				"drives the installed browser only — it must never download or script its own engine.",
		);
	}
	// The profile directory must exist before Chrome starts and before `chrome.pid` is
	// written into it: a caller that passes `--profile` bypasses `scratchRoot()`'s
	// `mkdtempSync`, so without this the first write throws ENOENT with no signal while
	// the detached Chrome it just spawned is left running — the orphan the reap exists
	// to prevent. Created here rather than at one call site, so the next caller that
	// names a profile is covered too.
	mkdirSync(profile, { recursive: true });
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
		// `--disable-gpu` drops the compositor tree this suite never needs
		// (captures go through CDP, not the screen). An earlier revision also set
		// `--disable-dev-shm-usage` and `--disable-extensions` — neither does
		// anything in a fresh throwaway profile on macOS, so they are gone rather
		// than left in as decoration — and a V8 heap cap that no measurement
		// justified. `--single-process`/`--no-zygote`/`--renderer-process-limit`
		// stay out: they change per-target semantics the CDP driving (`Emulation.*`
		// per page, `Target.closeTarget`) depends on.
		"--disable-gpu",
		...extraArgs,
		"about:blank",
	];
	// `detached: true` puts Chrome in its own process group. That is what makes
	// `process.kill(-pid)` safe: the group contains only Chrome and its helpers,
	// never this Node process (which is what a backgrounded `&` would give you).
	const child = spawn(chrome.path, args, {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr = `${stderr}${chunk}`.slice(-4000);
	});
	child.unref();

	// Two pid files, because a sweep run by a LATER process has to answer two
	// questions without guessing: whose profile is this (`owner.pid`, so a live run's
	// Chrome is never touched) and which process to kill (`chrome.pid`). Written before
	// the port wait so a profile that never became ready is still traceable.
	if (child.pid !== undefined) {
		writeFileSync(join(profile, "chrome.pid"), String(child.pid));
		writeFileSync(join(profile, "owner.pid"), String(process.pid));
	}

	const portFile = join(profile, "DevToolsActivePort");
	const deadline = Date.now() + 30_000;
	while (
		!existsSync(portFile) ||
		readFileSync(portFile, "utf8").trim() === ""
	) {
		if (Date.now() > deadline) {
			// A dev-server-less Chrome writes the port file asynchronously; an
			// immediate read gets an empty file and the connect fails
			// intermittently, which reads as a flaky harness. Hence the wait, and
			// hence a loud failure when the wait expires.
			await reap(child.pid, profile);
			throw new Error(
				`Chrome never wrote DevToolsActivePort (30 s). stderr: ${stderr.slice(-800)}`,
			);
		}
		await sleep(150);
	}
	const [firstLine = ""] = readFileSync(portFile, "utf8").split("\n");
	const port = Number(firstLine.trim());
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
			const reaped = await reap(child.pid, profile);
			// Then the profiles a KILLED earlier run left in the same root. `reap` is
			// thorough but it cannot run when this process is killed outright, which is
			// how orphans are made; sweeping the profile's parent root here is what makes
			// the leak self-healing instead of permanent. Live owners are skipped, so a
			// concurrent run sharing the root is never touched.
			const sweep = sweepOrphanChrome(dirname(profile));
			return { ...reaped, sweep };
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
export async function reap(
	pid: number | undefined,
	profile: string,
): Promise<ReapResult> {
	if (pid !== undefined) {
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
		// start ignoring SIGKILL, and the count assertion is what matters. Signalled
		// pid by pid rather than through `pkill -f`: on Linux that pattern reaches
		// the caller's own ancestors, and the ancestors here are the harness (see
		// `matchingPids`).
		signalMatching(profile, escalated ? "SIGKILL" : "SIGTERM");
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
	return {
		survivors: countProcesses(profile),
		profile,
		rounds: escalated ? 2 : 1,
	};
}

/**
 * This process and every ancestor of it, by pid.
 *
 * Walked from `ps` rather than taken from a platform flag, so the caller's own
 * tree is excluded the same way on a macOS laptop and a Linux CI runner. A
 * missing or unreadable ancestor ends the walk: an incomplete chain only ever
 * makes the filter *smaller*, and the pids it would have held are the ones a
 * reaper must never signal.
 */
function ancestry(): Set<number> {
	const chain = new Set<number>([process.pid]);
	let pid = process.ppid;
	for (let hop = 0; hop < 64 && pid > 0 && !chain.has(pid); hop += 1) {
		chain.add(pid);
		const parent = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], {
			encoding: "utf8",
		});
		if (parent.status !== 0) break;
		const next = Number((parent.stdout ?? "").trim());
		if (!Number.isInteger(next) || next <= 0) break;
		pid = next;
	}
	return chain;
}

/**
 * The pids whose command line mentions `profile`, minus this process and its
 * ancestors — the only safe way to read a *pattern* as a set of targets.
 */
function matchingPids(profile: string): number[] {
	const result = spawnSync("pgrep", ["-f", profile], { encoding: "utf8" });
	if (result.status !== 0) return []; // pgrep exits 1 when nothing matches: the good case.
	const excluded = ancestry();
	return (result.stdout ?? "")
		.split("\n")
		.map((line) => Number(line.trim()))
		.filter((pid) => Number.isInteger(pid) && pid > 0 && !excluded.has(pid));
}

/** Signal every process matching `profile` that is not this process or an ancestor. */
function signalMatching(
	profile: string,
	signal: "SIGTERM" | "SIGKILL",
): number {
	let signalled = 0;
	for (const pid of matchingPids(profile)) {
		try {
			process.kill(pid, signal);
			signalled += 1;
		} catch {
			// Exited between the scan and the signal: nothing left to do.
		}
	}
	return signalled;
}

/**
 * Reap what a KILLED capture attempt left behind, and report what still matches.
 *
 * `pids` are pids THIS run created — never a pid found by name — and each is only
 * signalled after `kill -0` says it is alive, so a recycled pid is never touched.
 * The sweep that follows is by exact profile path, which reaches a `detached` Chrome
 * (one that did not die with the parent that was killed) and any surviving child
 * carrying the same path in its argv. `sweepOrphanChrome` cannot serve here: it skips
 * a profile whose recorded owner is still alive, which is exactly the surviving-child
 * case this has to close.
 */
export function reapAttempt(
	profile: string,
	pids: number[],
): { killed: number[]; survivors: number } {
	const killed: number[] = [];
	for (const pid of pids) {
		if (!isAlive(pid)) continue;
		try {
			process.kill(pid, "SIGKILL");
			killed.push(pid);
		} catch {
			// Died between the liveness check and the signal: nothing left to do.
		}
	}
	for (let round = 0; round < 2; round += 1) signalMatching(profile, "SIGKILL");
	// A retry reuses the same profile path, and Chrome refuses to start — or starts as a
	// second instance of the one that died — when the previous run's Singleton lock and
	// socket are still there. Clearing them is what makes the reused path safe. Only
	// `Singleton*` entries are touched; the rest of the profile is left alone.
	try {
		for (const name of readdirSync(profile)) {
			if (String(name).startsWith("Singleton")) {
				rmSync(join(profile, String(name)), { recursive: true, force: true });
			}
		}
	} catch {
		// No profile on disk: nothing to clear.
	}
	return { killed, survivors: countProcesses(profile) };
}

/**
 * Whether a killed capture may be retried: only when nothing from the attempt
 * survives. Retrying into a profile something still holds is how two browsers end
 * up writing one `--out`.
 */
export function mayRetry(survivors: number): boolean {
	return survivors === 0;
}

/**
 * Count live processes matching our profile path. `pgrep -f <profile>` is scoped
 * to a path unique to this run, which is what keeps the sweep from reaching any
 * other Chrome — including the operator's. Never sweep by program name.
 *
 * The ancestry filter in `matchingPids` is what makes the count mean "processes
 * OTHER than the ones doing the reaping": without it a Linux runner counts its
 * own harness, so the count could never reach 0 and `reap` would loop to its
 * deadline on a teardown that had actually succeeded.
 */
export function countProcesses(profile: string): number {
	return matchingPids(profile).length;
}

/**
 * Reap Chrome a KILLED run left behind, and the profile directories with it.
 *
 * `reap()` is the normal path and it is thorough, but it cannot run when this process
 * is killed outright (SIGKILL, a cancelled job): Chrome is spawned `detached`, so it
 * does not die with its parent and re-parents to pid 1, holding the profile and its
 * memory for as long as the machine is up. Measured 2026-09-30: four such browsers,
 * four to seven hours old, from cancelled `doc-commands` gate runs, each still running
 * the throwaway profile of a run that had finished.
 *
 * So the sweep is what a LATER run does about it, and it is deliberately both:
 *  - conservative about ownership — a profile whose `owner.pid` is still alive is
 *    skipped, so two runs sharing a root never kill each other;
 *  - scoped to the profile path, never to "chrome" by name: an unscoped name match is
 *    how one session's teardown killed another session's processes.
 *
 * The pid-reuse guard matters as much as the kill: a recorded pid can belong to an
 * unrelated process by the time the sweep runs, so the process is only signalled when
 * its own command line still carries this profile path.
 *
 * @param root a directory to search for `chrome-*` profiles at any depth (bounded).
 */
export function sweepOrphanChrome(root: string): {
	swept: number[];
	profiles: string[];
	skipped: string[];
} {
	const swept: number[] = [];
	const profiles: string[] = [];
	const skipped: string[] = [];
	const stack: Array<{ dir: string; depth: number }> = [
		{ dir: root, depth: 0 },
	];
	while (stack.length > 0) {
		const { dir, depth } = stack.pop() as { dir: string; depth: number };
		let entries: string[] = [];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const child = join(dir, entry);
			// A PROFILE is recognised before anything else, and it is a directory: checked
			// the other way round, `chrome-*` is pushed as a directory to descend into and
			// every profile is silently skipped — which is exactly what a first revision
			// did, and what the two-direction assertion in `verify` exists to catch.
			if (!entry.startsWith("chrome-")) {
				if (depth < 3 && !entry.startsWith(".")) {
					try {
						if (statSync(child).isDirectory()) {
							stack.push({ dir: child, depth: depth + 1 });
						}
					} catch {
						/* unreadable entry: not ours to reason about */
					}
				}
				continue;
			}
			let chromePid = 0;
			let ownerPid = 0;
			try {
				chromePid = Number(
					readFileSync(join(child, "chrome.pid"), "utf8").trim(),
				);
				ownerPid = Number(
					readFileSync(join(child, "owner.pid"), "utf8").trim(),
				);
			} catch {
				// A profile with no recorded owner predates the pid files. Its Chrome
				// cannot be identified safely, so it is reported rather than killed.
				if (countProcesses(child) > 0) skipped.push(child);
				continue;
			}
			if (isAlive(ownerPid)) {
				skipped.push(child);
				continue;
			}
			if (countProcesses(child) > 0 && isAlive(chromePid)) {
				signalMatching(child, "SIGKILL");
				if (countProcesses(child) > 0) signalMatching(child, "SIGKILL");
				swept.push(chromePid);
			}
			if (countProcesses(child) === 0) {
				try {
					rmSync(child, { recursive: true, force: true });
					profiles.push(child);
				} catch {
					/* a profile the OS is still holding: next sweep */
				}
			}
		}
	}
	return { swept, profiles, skipped };
}

/** True when a pid exists (`kill -0`), which is all the owner check needs. */
function isAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** What a teardown sweep observed, returned so a caller can assert on it. */
export interface ReapResult {
	survivors: number;
	profile: string;
	rounds: number;
	/** Orphans from KILLED earlier runs in the same root, reaped alongside this one. */
	sweep?: { swept: number[]; profiles: string[]; skipped: string[] };
}
