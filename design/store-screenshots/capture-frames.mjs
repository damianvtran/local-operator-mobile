#!/usr/bin/env node
/**
 * Take the nine app captures the iPhone 6.9-inch listing frames are made of.
 *
 * WHAT THIS IS: the `design/store-screenshots/frames.json` entries driven through
 * the ONE capture harness this repository has (`tools/visual/capture.ts`), which
 * serves the web build and drives installed headless Chrome against the mock relay.
 * It is a driver, not a second stack: every frame here is the app rendering a real
 * relay answer, and the harness's own gate is what decides whether the frame is
 * evidence (a cell that did not reach the state it names is refused, not shipped).
 *
 * WHY IT IS A SCRIPT rather than nine documented commands: each frame names a
 * scenario and a seed as well as a cell, and a hand-typed command per frame is
 * nine places for the set to drift from `frames.json` — the file the RENDER step
 * reads. The set is data in one place; both steps read it.
 *
 *     pnpm export:web                        # writes dist/, which --dir points at
 *     node design/store-screenshots/capture-frames.mjs
 *     node design/preview/capture.mjs --target frames
 *
 * The first command builds the app, the second writes
 * `design/store-screenshots/app-captures/<device>/<slug>.png` (committed: the
 * render step needs them, and committing them is what makes the listing PNGs
 * checkable byte-for-byte without a relay), and the third composes the frames.
 *
 * STARTING THE RELAY IS THIS SCRIPT'S JOB — one per run, on `--port 0`, reaped on
 * the way out either way. `--relay <url>` uses a relay somebody else started
 * instead (CI, or a debug session) and then leaves it alone.
 */

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const arg = (name, fallback = null) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? true);
};

const set = JSON.parse(readFileSync(join(here, "frames.json"), "utf8"));
const buildDir = resolve(repoRoot, arg("dir", "dist"));
if (!existsSync(join(buildDir, "index.html"))) {
	console.error(
		`no web build at ${buildDir}: run \`pnpm export:web\` first (it writes dist/), ` +
			"or pass --dir <path>.",
	);
	process.exit(2);
}

const scratchBase =
	process.env.LOCAL_OPERATOR_SCRATCHPAD ?? process.env.TMPDIR ?? "/tmp";
const scratch = `${scratchBase.replace(/\/$/, "")}/lo-mobile-store-${process.pid}`;
mkdirSync(scratch, { recursive: true });

/* ---- the relay ---------------------------------------------------------- */

/** Start a mock relay on an ephemeral port and return { url, stop() }. */
const startRelay = async () => {
	const child = spawn(
		process.execPath,
		[join(repoRoot, "tools/mock-relay/relay.ts"), "--port", "0"],
		{ cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
	);
	const url = await new Promise((resolveUrl, rejectUrl) => {
		let out = "";
		const timer = setTimeout(
			() => rejectUrl(new Error(`the mock relay did not report a port:\n${out}`)),
			30_000,
		);
		/* The relay prints its own line to STDERR (its stdout is empty), so both
		 * streams are read: a port parsed off the wrong one is a 30 s hang that
		 * looks like a relay failure. */
		const read = (chunk) => {
			out += String(chunk);
			const match = /mock-relay listening (http:\/\/[^\s]+)/.exec(out);
			if (match) {
				clearTimeout(timer);
				resolveUrl(match[1]);
			}
		};
		child.stdout.on("data", read);
		child.stderr.on("data", read);
		child.on("exit", (code) =>
			rejectUrl(new Error(`the mock relay exited (${code}) before listening:\n${out}`)),
		);
	});
	return {
		url,
		stop: () =>
			new Promise((done) => {
				child.on("exit", () => done(null));
				child.kill("SIGTERM");
			}),
	};
};

const externalRelay = arg("relay", null);
const relay = externalRelay === null ? await startRelay() : null;
const relayUrl = externalRelay ?? relay.url;

/* ---- one capture per frame ---------------------------------------------- */

const failures = [];
try {
	for (const frame of set.frames) {
		const out = join(scratch, frame.slug);
		mkdirSync(out, { recursive: true });
		const args = [
			join(repoRoot, "tools/visual/capture.ts"),
			"--dir",
			buildDir,
			"--out",
			out,
			"--devices",
			set.capture.device,
			"--themes",
			set.capture.theme,
			"--scales",
			set.capture.scale,
			"--cells",
			frame.cell,
		];
		/* A frame that shows the app BEFORE a computer is connected must not be
		 * seeded at all: the seed is what makes the app skip sign-in. */
		if (frame.seed === false) {
			args.push("--no-seed");
		} else {
			args.push("--relay", relayUrl);
			/* The world is named, never inferred from registry order: the frames are
			 * read by a person, and the corpus's default world for these cells says
			 * "Hello from the mock provider". */
			if (frame.scenario) args.push("--scenario", frame.scenario);
		}
		const ran = spawnSync(process.execPath, args, { cwd: repoRoot });
		const manifestPath = join(out, "manifest.json");
		if (!existsSync(manifestPath)) {
			failures.push(`${frame.slug}: the harness wrote no manifest (${frame.cell})`);
			console.error(ran.stderr?.trim() || "");
			continue;
		}
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		const record = manifest.records.find((r) => r.cell === frame.cell);
		if (record === undefined || record.frames.length === 0) {
			failures.push(`${frame.slug}: no frame for cell ${frame.cell}`);
			continue;
		}
		const visible = record.readiness?.visibleTestIds ?? [];
		const missing = (frame.expect ?? []).filter((id) => !visible.includes(id));
		if (missing.length > 0) {
			failures.push(
				`${frame.slug}: ${frame.cell} did not render ${missing.join(", ")}`,
			);
			continue;
		}
		/* The harness's own verdict on the FRAME, not just the state: a cell can be
		 * `ready` and still have painted no theme (a transparent canvas is what the
		 * probe reports when the app never settled). The harness exits 1 for it and
		 * the wrapper used to copy the frame anyway, which is a plausible-looking
		 * blank in a store asset — QA round 1, Q4's adjacent gap. */
		/* The run above captured exactly one cell, so every theme problem in its
		 * manifest belongs to this frame. */
		const themeProblems = manifest.themeProblems ?? [];
		if (themeProblems.length > 0) {
			failures.push(`${frame.slug}: ${record.cell} — ${themeProblems.join("; ")}`);
			continue;
		}
		/* A cell whose STATE marker the app does not declare (sign-in: docs/e2e/README,
		 * "nine empty markers") is captured but reported NOT MEASURABLE. The frame is
		 * still the real screen — the harness lists what it SAW, which is how the
		 * screen root above is checked — so the gap is named here rather than hidden,
		 * and anything else the harness refused stays a failure. */
		if (!record.ready) {
			const onlyMarkerGaps = (record.readinessProblems ?? []).every((problem) =>
				/no .*-state marker is in the DOM/.test(problem),
			);
			if (!onlyMarkerGaps) {
				failures.push(
					`${frame.slug}: ${frame.cell} was refused — ${record.readinessProblems.join("; ")}`,
				);
				continue;
			}
			console.log(
				`${frame.slug}: captured without a state marker (the app declares none for ` +
					`${record.state}); the screen root is on the frame`,
			);
		}
		const from = join(out, "frames", record.frames[0].file);
		const to = join(here, set.capture.dir, `${frame.slug}.png`);
		mkdirSync(dirname(to), { recursive: true });
		copyFileSync(from, to);
		const png = readFileSync(to);
		const width = png.readUInt32BE(16);
		const height = png.readUInt32BE(20);
		const ok =
			width === set.capture.pixels.width && height === set.capture.pixels.height;
		console.log(
			`${frame.slug}: ${width}x${height} from ${record.cell} @ ${record.pinnedScenario ?? "(no scenario)"}` +
				`${ok ? "" : ` — PROBLEM: expected ${set.capture.pixels.width}x${set.capture.pixels.height}`}`,
		);
		if (!ok) failures.push(`${frame.slug}: ${width}x${height} is not the capture size`);
	}
} finally {
	if (relay !== null) await relay.stop();
}

if (failures.length > 0) {
	console.error(`\n${failures.length} frame(s) not captured:`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log(
	`\n${set.frames.length} app captures written to design/store-screenshots/${set.capture.dir}/`,
);
