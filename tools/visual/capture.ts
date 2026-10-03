/**
 * The visual capture harness: serve a web build, drive installed headless
 * Chrome over CDP, and write a reviewable frame matrix.
 *
 * What it produces, for a reviewer or an agent to *look at*:
 *
 *   <out>/frames/<screen>__<state>__<device>__<theme>__<scale>.png
 *   <out>/manifest.json   — per-frame viewport, resolved theme, canvas colour,
 *                           PNG hash, console errors, and the measurements the
 *                           audit consumes
 *   <out>/index.html      — the whole matrix in one page, with the numbers beside
 *                           each frame
 *
 * Three properties that make the frames evidence rather than decoration:
 *
 * 1. **Every frame states its resolved theme and canvas colour**, read back from
 *    the page (`window.__loCapture` plus the *computed* background), never from
 *    what the harness asked for. A theme applied after first paint once produced
 *    two byte-identical "dark" and "light" captures; this line catches that by
 *    comparing the two frames' hashes and comparing each canvas against the
 *    design token for the theme it claims.
 * 2. **The viewport is set with `Emulation.setDeviceMetricsOverride`**, never
 *    `--window-size` — on Chrome 152 that flag clamps width at a 500px floor and
 *    silently loses 87px of height, which is how a frame's size gets assumed.
 * 3. **It reaps what it starts**, by pid, sweeps its own profile, and asserts 0
 *    processes remain. A leaked browser keeps retrying the keychain on the
 *    operator's screen for minutes after the run.
 *
 * Usage:
 *   node tools/visual/capture.ts --dir <web-build> --out <frames-dir> \
 *     [--relay http://127.0.0.1:PORT] [--scenario <name>] [--cells S4/populated,...]
 *     [--devices iphone-15,...] [--themes dark,light] [--scales 100,150,200]
 *     [--consecutive] [--plan] [--yes] [--strict] [--full]
 *     [--cell-timeout <s>] [--deadline <s>]
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bool, csv, num, parseArgs, str } from "../lib/args.ts";
import type { CdpPage } from "../lib/cdp.ts";
import { sleep } from "../lib/cdp.ts";
import { launchChrome } from "../lib/chrome.ts";
import {
	declaredSkipFor,
	type ReadinessIssue,
	readinessIssues,
	seedQuery,
} from "../lib/readiness.ts";
import { serveDir } from "../lib/static-server.ts";
import { DEFAULT_PASSWORD } from "../mock-relay/relay.ts";
import { renderGallery } from "./gallery.ts";
import {
	ALL_DEVICES,
	CI_DEVICES,
	CI_SCALES,
	CORE_DEVICES,
	DEVICES,
	type DeviceProfile,
	MEASURE_PROBE,
	PENDING_CELLS,
	PRE_PAINT_PROBE,
	READINESS_PROBE,
	SCALES,
	SCREEN_ROOTS,
	SCREENS,
	THEMES,
} from "./matrix.ts";

/**
 * Frames whose first screenshot attempt failed and whose retry succeeded, for the
 * WHOLE run: the frame writer and the run's report are different scopes, so this is
 * module state reset per run rather than a local of either.
 */
let screenshotRetries = 0;

/** Frames above this count are refused without `--yes`: a full matrix is minutes. */
const CONFIRM_THRESHOLD = 120;

/**
 * The per-cell budget the DEFAULT whole-run deadline is derived from, in ms, and
 * the floor a small plan still gets.
 *
 * WHY THE DEFAULT IS DERIVED RATHER THAN FIXED. It used to be a flat 900 s, which
 * holds about 400 cells: a `core` run (936 cells) or a dispatched `full` run (3384)
 * was therefore cut off by the harness's own default and reported hundreds of cells
 * as having no frame — a bound firing on a plan it was never sized for, which reads
 * like a finding about the app and is not one. Deriving it from the plan makes the
 * default hold the plan it was computed for, and the number is PRINTED with the
 * plan, so a reviewer can see the bound and argue with it instead of discovering it
 * fifteen minutes in. An explicit `--deadline` is still honoured exactly: a caller
 * who names a bound has a reason for it, and gets a note when it is below the
 * budgeted figure rather than silence.
 *
 * The rate is the one measured on the CI runner: 403 cells in 903 s, 2.24 s/cell. The
 * budget is 3 s/cell — a third more — because the same tool also runs on a laptop under
 * load, where the measured rate is ~3 s/cell: the bound's job is to catch a run that has
 * HUNG, not to race one that is merely slower, and a bound that fires on an ordinary
 * machine is the very defect this replaces. It bounds the RUN, so it is a budget for the
 * whole plan; the per-cell bound is separate (`--cell-timeout`).
 */
const CELL_BUDGET_MS = 3000;
const MIN_DERIVED_DEADLINE_MS = 900_000;

/**
 * How long a cell's declared state is given to APPEAR after the settle window, and
 * how often it is looked for.
 *
 * WHY THIS EXISTS. Readiness used to be a single reading taken `--settle` ms after
 * the page loaded, which silently assumed every scenario's state exists by then.
 * Two do not: `401-mid-session` ends the stream two seconds in (that is the state),
 * and `aborted` is a turn that has to finish before its receipt is painted. At the
 * 1200 ms default both cells were reported `NOT MEASURABLE` — the harness failing
 * its own clock, not the app failing its state — so the run could never be green
 * for a reason that had nothing to do with the app. The alternative (a longer
 * `--settle` for the whole run) is wrong in the other direction: measured
 * 2026-10-03, `--settle 7000` fixes those two and BREAKS `S5/streaming` and
 * `S6/populated`, whose states have already come and gone by then.
 *
 * So the wait is on the EVENT, not the clock: poll for the marker the app declares,
 * stop the moment it appears, and re-stamp the settled frame so the frame shows the
 * state that was waited for. It costs nothing for a cell that is already ready, and
 * it never applies to a DECLARED SKIP (those fail on `marker-gap`, not `marker`) or
 * to a wrong route or a missing root, which are defects whenever they appear.
 */
const STATE_WAIT_MS = 8_000;
const STATE_POLL_MS = 400;

/** The whole-run deadline a plan of `cells` cells is budgeted, in ms. */
const derivedDeadlineMs = (cells: number): number =>
	Math.max(MIN_DERIVED_DEADLINE_MS, Math.ceil(cells * CELL_BUDGET_MS));

/**
 * Whether a cell's issues are all "the declared state has not arrived yet".
 *
 * `marker` is the only issue kind this waits on: the app DECLARES a marker for the
 * state and the frame does not carry it yet. `empty` rides along because it is the
 * same sentence's second half. Everything else — a wrong route, a missing root, a
 * `marker-gap`, a relay the app never asked — is a defect that waiting cannot fix.
 */
const stateStillComing = (issues: ReadonlyArray<{ kind: string }>): boolean =>
	issues.length > 0 &&
	issues.some((issue) => issue.kind === "marker") &&
	issues.every((issue) => issue.kind === "marker" || issue.kind === "empty");

/**
 * Replace the page target after a cell wedged.
 *
 * A fresh target is the only reliable way past a page holding a live stream on a
 * socket the harness no longer controls: closing the old one is what stops it
 * speaking, and the new one starts the next cell from a blank document.
 */
async function recoverPage(
	chrome: Awaited<ReturnType<typeof launchChrome>>,
	page: CdpPage,
): Promise<CdpPage> {
	try {
		await page.send("Target.closeTarget", { targetId: page.targetId });
	} catch {
		// A target wedged beyond answering is closed by the browser when the profile
		// is torn down; the new target is what the next cell needs.
	}
	const next = await chrome.page();
	await next.send("Page.enable");
	await next.send("Runtime.enable");
	await next.send("Page.addScriptToEvaluateOnNewDocument", {
		source: PRE_PAINT_PROBE,
	});
	return next;
}

const sha = (buffer: Buffer): string =>
	createHash("sha256").update(buffer).digest("hex").slice(0, 16);

/**
 * Ask the mock relay which cells and session ids it is currently serving. This
 * is what keeps the harness from carrying a second copy of the scenario list:
 * the relay owns the states, the harness renders them.
 */
async function relayState(
	relayUrl: string | undefined,
): Promise<RelayStateReply | null> {
	if (!relayUrl) return null;
	// Two endpoints, because they answer different questions and only one of them
	// carries the cell list. `/__mock/state` is the live state (scenario, session
	// id, what the run has done); `/__mock/scenarios` is the registry, and each
	// entry's `shows` is the set of cells that state fills. Reading `cells` off
	// `/__mock/state` — which never served it — made the documented `--relay`
	// invocation fail with "no cells to capture".
	const stateRes = await fetch(new URL("/__mock/state", relayUrl));
	if (!stateRes.ok)
		throw new Error(
			`mock relay /__mock/state answered ${stateRes.status}; is it a mock relay?`,
		);
	const state = asRecord(await stateRes.json()) ?? {};

	const registryRes = await fetch(new URL("/__mock/scenarios", relayUrl));
	if (!registryRes.ok)
		throw new Error(
			`mock relay /__mock/scenarios answered ${registryRes.status}`,
		);
	const registry = asRecord(await registryRes.json()) ?? {};
	const scenarios = Array.isArray(registry.scenarios) ? registry.scenarios : [];

	// Every cell any scenario declares, de-duplicated and sorted, so the plan is
	// stable across runs — and the scenario that declares each one is kept, so a
	// reader can tell which state produces a cell.
	const cells = new Map<string, string[]>();
	const entries: RelayStateReply["scenarios"] = {};
	for (const entry of scenarios) {
		const bag = asRecord(entry);
		if (bag === undefined) continue;
		const name = typeof bag.name === "string" ? bag.name : "";
		const shows = asStringArray(bag.shows) ?? [];
		if (name === "" || shows.length === 0) continue;
		entries[name] = {
			name,
			description: typeof bag.description === "string" ? bag.description : "",
			shows,
		};
		for (const cell of shows)
			cells.set(cell, [...(cells.get(cell) ?? []), name]);
	}
	return {
		cells: [...cells.keys()].sort(),
		cellScenarios: Object.fromEntries([...cells.entries()].sort()),
		scenarios: entries,
		sessionId: typeof state.sessionId === "string" ? state.sessionId : null,
		jobId: typeof state.jobId === "string" ? state.jobId : null,
		scenario: typeof state.scenario === "string" ? state.scenario : null,
	};
}

/** Substitute the relay's session id (and a subagent job id) into a route path. */
function resolvePath(path: string, state: RelayStateReply | null): string {
	const sessionId = state?.sessionId ?? "6714def86197";
	const jobId = state?.jobId ?? "job-1";
	return path.replace("{sessionId}", sessionId).replace("{jobId}", jobId);
}

/**
 * Build the planned frame list. Cells come from the relay's scenario registry
 * (`shows`), so a cell is captured because a scenario says it exists — not
 * because a second hand-maintained list in the harness says so.
 */
function buildPlan({
	state,
	cells,
	devices,
	themes,
	scales,
	consecutive,
	unrenderable,
}: BuildPlanOptions): FramePlan[] {
	const plan: FramePlan[] = [];
	const cellsToUse = cells.length ? cells : (state?.cells ?? []);
	if (cellsToUse.length === 0) {
		throw new Error(
			"no cells to capture: pass --cells, or --relay so the mock relay's scenario " +
				"registry can supply them (each scenario declares the cells it fills).",
		);
	}
	for (const cell of cellsToUse) {
		// Split on the *last* slash: a cell is "<screen>/<state>", and a screen may
		// itself be a path (`path:/clean`), so the first slash is not the divider.
		const text = String(cell);
		const slash = text.lastIndexOf("/");
		if (slash <= 0) throw new Error(`cell '${cell}' is not "<screen>/<state>"`);
		const screenId = text.slice(0, slash);
		const stateId = text.slice(slash + 1);
		// `path:/some/route` points a cell at a page that is not one of the app's
		// screens — how the audit's own canary is driven, and how any ad-hoc page
		// gets the whole matrix treatment without editing the screen map.
		const explicitPath = screenId.startsWith("path:")
			? screenId.slice("path:".length)
			: null;
		const screen = explicitPath
			? { label: explicitPath, path: explicitPath }
			: SCREENS[screenId];
		if (!screen) {
			// A cell the relay's registry declares for a screen this harness has no
			// route for is REPORTED, not thrown on: the registry is the relay's and
			// grows independently, so one unrenderable cell must not abort a run that
			// can still capture the other thirty-one. It is listed in the manifest as
			// BLOCKED, which is the same rule the audit applies to a check it cannot
			// answer — a missing cell is never a silent pass.
			unrenderable.push({ cell, reason: `no route for screen '${screenId}'` });
			continue;
		}
		for (const deviceName of devices) {
			const device = DEVICES[deviceName];
			if (!device) throw new Error(`unknown device '${deviceName}'`);
			// The operator's rule: phones carry the 150% case as well, because that
			// is the scale a phone user actually sets; every device carries 100% and
			// 200%, which is the accessibility floor and ceiling.
			const scalesForDevice =
				device.kind === "phone"
					? scales
					: scales.filter((entry) => entry.id !== "150");
			for (const theme of themes) {
				for (const scale of scalesForDevice) {
					plan.push({
						cell,
						screen: screenId,
						screenLabel: screen.label,
						path: screen.path,
						state: stateId ?? "default",
						device: deviceName,
						theme,
						scale,
						deviceSpec: device,
						scaleSpec: scale,
						consecutive,
					});
				}
			}
		}
	}
	return plan;
}

/**
 * The frame's file stem, in the naming ADR 0003 fixes so a diff tool can pair a
 * before-frame with an after-frame: `screen__state__device__theme__scale`.
 * Slashes are folded to `-` because a screen id can be a path, and a frame name
 * containing a path separator would quietly write into a subdirectory.
 */
const frameName = (cell: FramePlan): string =>
	`${cell.screen}__${cell.state}__${cell.device}__${cell.theme}__${cell.scaleSpec.id}`.replace(
		/[/\\:]/g,
		"-",
	);

/**
 * Publish the device profile's safe-area insets two ways.
 *
 * `Emulation.setSafeAreaInsetsOverride` is the real mechanism: it makes the
 * browser resolve `env(safe-area-inset-*)` to the device's values, so an app
 * that reads them behaves exactly as it does on a notched phone. Verified on
 * Chrome 154 — a probe element measuring `env(safe-area-inset-top)` returned the
 * 59 that was set, before and after this file used it.
 *
 * The custom properties are published as well, for a web build that wants the
 * numbers without `env()`. If the CDP method is missing on an older browser the
 * capture carries on with the custom properties alone and says so, because
 * silently reporting 0 insets would make every safe-area frame a false pass.
 */
async function applySafeAreaInsets(
	page: CdpPage,
	device: DeviceProfile,
): Promise<boolean> {
	try {
		await page.send("Emulation.setSafeAreaInsetsOverride", {
			insets: { ...device.insets },
		});
		return true;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.error(
			`  note: Emulation.setSafeAreaInsetsOverride unavailable (${reason}); ` +
				"safe-area frames carry custom properties only, so env()-based layout will read 0",
		);
		return false;
	}
}

/**
 * Capture one cell: set the metrics, navigate, wait for the app to render, and
 * take the screenshot(s). The measurements are taken *after* the screenshot so
 * the numbers and the pixels describe the same moment.
 */
async function captureCell(
	page: CdpPage,
	cell: FramePlan,
	{
		baseUrl,
		state,
		outDir,
		settleMs,
		relayReach,
		seed,
	}: {
		baseUrl: string;
		state: RelayStateReply | null;
		outDir: string;
		settleMs: number;
		/** Null when this run has no relay, so no claim about it is made. */
		relayReach: RelayReach | null;
		/** The web-only seed hook's parameters, when the run was given any. */
		seed: { route: string | null; password: string | null };
	},
): Promise<CaptureRecord> {
	const { deviceSpec: device, scaleSpec } = cell;
	const query = new URLSearchParams({
		"lo-theme": cell.theme,
		"lo-text-scale": String(scaleSpec.factor),
		"lo-reduce-motion": "0",
		"lo-inset-top": String(device.insets.top),
		"lo-inset-bottom": String(device.insets.bottom),
		"lo-inset-left": String(device.insets.left),
		"lo-inset-right": String(device.insets.right),
	});
	// The harness's half of the web-only seed hook (docs/e2e/README.md, option 3):
	// the parameters go on the page so the app side has nothing to invent. Whether the
	// app ADOPTS them is decided by the cell's state markers, not by this line.
	for (const [key, value] of new URLSearchParams(
		seedQuery(seed.route, seed.password),
	)) {
		query.set(key, value);
	}
	const path = resolvePath(cell.path, state);
	const url = `${baseUrl}${path}${path.includes("?") ? "&" : "?"}${query}`;

	const consoleErrors: string[] = [];
	// Console and exception payloads are CDP-shaped, so each field is narrowed
	// rather than assumed: a handler that throws here loses the frame's errors
	// silently, which is worse than reporting an unreadable one.
	const offConsole = page.on("Runtime.consoleAPICalled", (params) => {
		if (params.type !== "error") return;
		const args = Array.isArray(params.args) ? params.args : [];
		consoleErrors.push(
			args.map((argument) => describeConsoleArg(argument)).join(" "),
		);
	});
	const offException = page.on("Runtime.exceptionThrown", (params) => {
		consoleErrors.push(describeException(params.exceptionDetails));
	});

	await page.send("Emulation.setDeviceMetricsOverride", {
		width: device.width,
		height: device.height,
		deviceScaleFactor: device.dpr,
		mobile: true,
		screenWidth: device.width,
		screenHeight: device.height,
	});
	await page.send("Emulation.setEmulatedMedia", {
		// The OS-level signal, so an app that follows `prefers-color-scheme` with
		// no cooperation from this harness still captures correctly.
		features: [
			{ name: "prefers-color-scheme", value: cell.theme },
			{ name: "prefers-reduced-motion", value: "no-preference" },
		],
	});
	await applySafeAreaInsets(page, device);

	// A web build has no single "rendered" event, so the boot budget is a wait on
	// time — the thing §"Wait on the event" warns about. It is bounded and it is
	// *visible*: every frame carries `mountedElements` and `textNodeCount`, so a
	// capture taken too early shows as an empty document in the manifest rather
	// than as a quietly blank screenshot. The load event is awaited first so the
	// consecutive frames below start from the same point in every cell.
	const loaded = new Promise<void>((resolve) => {
		const off = page.on("Page.loadEventFired", () => {
			off();
			resolve();
		});
		setTimeout(resolve, settleMs);
	});
	await page.send("Page.navigate", { url });

	const shots = [];
	const stamp = async (
		suffix: string,
	): Promise<{ file: string; sha: string; bytes: number }> => {
		// `Page.captureScreenshot: Internal error` is transient — it appeared once under
		// fleet load and passed standalone minutes later — and an aborted capture run is
		// indistinguishable from a real failure, so one retry happens before a cell is
		// failed, and the retry is COUNTED rather than hidden: the count lands in the
		// manifest and on stdout, so a load-flaky frame is visible instead of silent.
		let shot: Awaited<ReturnType<typeof page.send>>;
		try {
			shot = await page.send("Page.captureScreenshot", {
				format: "png",
				captureBeyondViewport: false,
			});
		} catch (error) {
			screenshotRetries += 1;
			await sleep(400);
			shot = await page.send("Page.captureScreenshot", {
				format: "png",
				captureBeyondViewport: false,
			});
			console.log(
				`      retried a transient screenshot failure (${(error as Error).message.slice(0, 120)})`,
			);
		}
		const encoded = typeof shot.data === "string" ? shot.data : "";
		if (encoded === "") throw new Error("Chrome returned no screenshot data");
		const buffer = Buffer.from(encoded, "base64");
		const file = `${frameName(cell)}${suffix}.png`;
		writeFileSync(join(outDir, "frames", file), buffer);
		return { file, sha: sha(buffer), bytes: buffer.length };
	};

	await loaded;
	if (cell.consecutive) {
		// Consecutive frames: a first frame that differs from the settled frame is
		// motion the user sees, whether or not it was intended, and a frame whose
		// theme landed after first paint is the same class of defect.
		shots.push(await stamp("-f0"));
		await sleep(250);
		shots.push(await stamp("-f250"));
		await sleep(Math.max(0, settleMs - 250));
		shots.push(await stamp("-settled"));
	} else {
		await sleep(Math.max(0, settleMs - 50));
		shots.push(await stamp(""));
	}
	const measurements = asMeasurements(await page.evaluate(MEASURE_PROBE));
	// If the harness was asked to seed and the page's own route does not carry the
	// parameters, the failure is the HARNESS's, not the app's — the opposite direction
	// from the state markers below, and worth its own sentence so the two are never
	// confused.
	const seededButAbsent =
		seed.route !== null &&
		measurements !== null &&
		!String(measurements.route ?? "").includes("lo-relay=");
	// The readiness reading: which route the app settled on and which screen
	// roots it actually rendered. This is the guard against a green matrix over
	// the wrong screen, which is exactly what the first run of this harness
	// produced before the relay was proxied.
	let readiness: Readiness | null = asReadiness(
		await page.evaluate(READINESS_PROBE),
	);
	let issues: CellIssue[] = readinessIssuesFor(
		cell,
		path,
		readiness,
		relayReach,
	);
	const seedIssue = (): CellIssue => ({
		kind: "seed",
		message:
			`the run was told to seed route '${String(seed.route)}' but the page reports ` +
			`'${String(measurements?.route ?? "")}' without it: the harness's own half of ` +
			"the seed hook failed",
	});
	if (seededButAbsent) issues.push(seedIssue());

	/*
	 * A state that arrives AFTER the settle window: wait for the marker rather than
	 * reporting the state missing at 1200 ms. See `STATE_WAIT_MS` for the two cells
	 * this exists for and for why a longer `--settle` is the wrong repair. The
	 * settled frame is re-stamped once the state is there, because the frame has to
	 * show the state the cell names — a cell that passed the marker rule while its
	 * PNG still held the pre-state would be the harness asserting one thing and
	 * shipping another.
	 */
	if (stateStillComing(issues)) {
		let waitedMs = 0;
		while (waitedMs < STATE_WAIT_MS && stateStillComing(issues)) {
			await sleep(Math.min(STATE_POLL_MS, STATE_WAIT_MS - waitedMs));
			waitedMs += STATE_POLL_MS;
			readiness = asReadiness(await page.evaluate(READINESS_PROBE));
			issues = readinessIssuesFor(cell, path, readiness, relayReach);
			if (seededButAbsent) issues.push(seedIssue());
		}
		if (issues.length === 0) {
			shots[shots.length - 1] = await stamp(cell.consecutive ? "-settled" : "");
		}
	}
	const readinessProblems = issues.map((issue) => issue.message);

	offConsole();
	offException();

	// A DECLARED SKIP, decided by the policy in `lib/readiness.ts` — the app declares no
	// marker for the cell's state and `matrix.ts` names an owner for it — and REFUSED
	// the moment any other issue is present. The "no other issue" clause is the whole
	// guard: with `--no-seed`, a cell whose app never left `/welcome` and never drew its
	// own root was previously a declared skip with the run exiting 0, which made a
	// rotted route or root indistinguishable from unlanded work. `declaredSkipFor`
	// carries the rule so `verify` asserts it without a browser.
	const declaredSkipDecision = declaredSkipFor(
		issues,
		PENDING_CELLS[cell.cell] ?? null,
	);
	const declaredSkip =
		declaredSkipDecision === null
			? null
			: { cell: cell.cell, ...declaredSkipDecision };

	return {
		name: frameName(cell),
		cell: cell.cell,
		screen: cell.screen,
		screenLabel: cell.screenLabel,
		state: cell.state,
		device: cell.device,
		deviceLabel: device.label,
		theme: cell.theme,
		scale: scaleSpec.id,
		viewport: { width: device.width, height: device.height, dpr: device.dpr },
		insets: device.insets,
		path,
		url,
		frames: shots,
		measurements,
		readiness,
		readinessProblems,
		ready: readinessProblems.length === 0,
		declaredSkip,
		consoleErrors,
	};
}

/**
 * A run that must not be read as evidence.
 *
 * Carries the three failure classes by name so a CI step can assert on the kind
 * of failure rather than on a message, and so nothing downstream has to guess
 * whether "some problem" meant a broken theme, an unready cell or two states
 * that rendered identically.
 */
export class CaptureFailure extends Error {
	readonly themeProblems: string[];
	readonly readinessProblems: string[];
	readonly identicalStates: string[];
	/** Chrome processes the run's own teardown left behind; 0 on a clean run. */
	readonly survivors: number;

	constructor(
		message: string,
		failures: {
			themeProblems: string[];
			readinessProblems: string[];
			identicalStates: string[];
			survivors?: number;
		},
	) {
		super(message);
		this.name = "CaptureFailure";
		this.themeProblems = failures.themeProblems;
		this.readinessProblems = failures.readinessProblems;
		this.identicalStates = failures.identicalStates;
		this.survivors = failures.survivors ?? 0;
	}
}

/**
 * Run `promise`, and give up on it after `ms` with a named reason.
 *
 * Every cell is bounded, and the reason is a *value* rather than a thrown
 * message: a cell that never settles must be recorded as a FAILED cell with the
 * deadline it hit, because a capture run that silently skips a cell and one that
 * hangs both leave a reviewer with no frame and no explanation. The timer is
 * unref'd so a resolved promise does not keep the process alive.
 */
async function withDeadline<T>(
	promise: Promise<T>,
	ms: number,
	what: string,
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expiry = new Promise<{ ok: false; reason: string }>((resolve) => {
		timer = setTimeout(
			() =>
				resolve({
					ok: false,
					reason: `${what} did not complete within ${ms} ms`,
				}),
			ms,
		);
		timer.unref?.();
	});
	try {
		const winner = await Promise.race([
			promise.then(
				(value) => ({ ok: true as const, value }),
				/*
				 * A cell that THROWS is the same kind of event as one that overruns, and it
				 * used to be the run's own death instead: a `Page.navigate` that stalls past
				 * CDP's 30 s command timeout rejects, the rejection went straight through this
				 * race, and the process exited from inside `captureCell` with a stack trace and
				 * NO manifest at all — the out directory held frames and no summary, so a
				 * 45-minute job reported nothing about what it had measured. Measured
				 * 2026-10-03: the documented 72-cell command died this way on entry 39, twice,
				 * and again on a stashed tree. The caller already knows what to do with a cell
				 * that did not complete — abandon it BY NAME, then open a fresh page so the
				 * next cell cannot inherit a wedged one — so the rejection is turned into that
				 * same shape here rather than being left to unwind the run.
				 */
				(error: unknown) => ({
					ok: false as const,
					reason: `${what} threw: ${error instanceof Error ? error.message : String(error)}`,
				}),
			),
			expiry,
		]);
		return winner;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/** What the measurement probe reports, narrowed from the page's reply. */
export interface Measurements {
	reported?: {
		theme?: string;
		scale?: number;
		reduceMotion?: boolean;
		themeSource?: string;
		insets?: Record<string, string>;
	};
	canvasColor?: string | null;
	rootBackground?: string | null;
	rootFontSize?: string | null;
	documentScrollWidth?: number;
	documentClientWidth?: number;
	bodyScrollWidth?: number;
	textNodeCount?: number;
	medianTextHeight?: number | null;
	route?: string;
	title?: string;
	mountedElements?: number;
}

/** Narrow the measurement probe's reply; a non-object is reported as no reading. */
function asMeasurements(value: unknown): Measurements | null {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const bag = value as Record<string, unknown>;
	const reported =
		typeof bag.reported === "object" &&
		bag.reported !== null &&
		!Array.isArray(bag.reported)
			? (bag.reported as Record<string, unknown>)
			: undefined;
	const text = (key: string): string | null | undefined =>
		typeof bag[key] === "string" ? bag[key] : null;
	const count = (key: string): number | undefined =>
		typeof bag[key] === "number" ? bag[key] : undefined;
	return {
		reported:
			reported === undefined
				? undefined
				: {
						theme:
							typeof reported.theme === "string" ? reported.theme : undefined,
						scale:
							typeof reported.scale === "number" ? reported.scale : undefined,
						themeSource:
							typeof reported.themeSource === "string"
								? reported.themeSource
								: undefined,
					},
		canvasColor: text("canvasColor"),
		rootBackground: text("rootBackground"),
		rootFontSize: text("rootFontSize"),
		documentScrollWidth: count("documentScrollWidth"),
		documentClientWidth: count("documentClientWidth"),
		bodyScrollWidth: count("bodyScrollWidth"),
		textNodeCount: count("textNodeCount"),
		medianTextHeight:
			typeof bag.medianTextHeight === "number" ? bag.medianTextHeight : null,
		route: text("route") ?? undefined,
		title: text("title") ?? undefined,
		mountedElements: count("mountedElements"),
	};
}

/** One console argument as text, from its string value, its description, or its type. */
function describeConsoleArg(value: unknown): string {
	if (typeof value !== "object" || value === null)
		return typeof value === "string" ? value : String(value);
	const bag = value as Record<string, unknown>;
	for (const key of ["value", "description", "type"]) {
		if (typeof bag[key] === "string") return bag[key];
	}
	return "unprintable console argument";
}

/** A thrown exception as text, from the CDP `exceptionDetails` shape. */
function describeException(details: unknown): string {
	if (typeof details !== "object" || details === null)
		return "uncaught exception";
	const bag = details as Record<string, unknown>;
	const exception =
		typeof bag.exception === "object" && bag.exception !== null
			? (bag.exception as Record<string, unknown>)
			: {};
	if (typeof exception.description === "string") return exception.description;
	if (typeof bag.text === "string") return bag.text;
	return "uncaught exception";
}

/** The readiness reading, narrowed from the page's own `unknown` reply. */
interface Readiness {
	path: string;
	/** Every `data-testid` in the DOM, rendered or not: what a state MARKER is judged on. */
	testIds: string[];
	/**
	 * The ids whose element is actually RENDERED (non-zero box, no `display:none` /
	 * `visibility:hidden` on it or an ancestor). A ROOT is judged on these, because the
	 * root IS the screen; a marker is judged on `testIds`, because the app's derived
	 * state markers are zero-size by design and a marker asserts what the screen shows
	 * rather than an affordance a person taps. See `lib/readiness.ts`.
	 */
	visibleTestIds: string[];
	text: string;
	elementCount: number;
}

function asReadiness(value: unknown): Readiness | null {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const bag = value as Record<string, unknown>;
	const ids = Array.isArray(bag.testIds)
		? bag.testIds.filter((id): id is string => typeof id === "string")
		: [];
	return {
		path: typeof bag.path === "string" ? bag.path : "",
		testIds: ids,
		visibleTestIds: Array.isArray(bag.visibleTestIds)
			? bag.visibleTestIds.filter((id): id is string => typeof id === "string")
			: // An older page that does not report the filtered list is treated as having no
				// VISIBLE ids rather than as having all of them: that fails the root check, which
				// is the safe direction, and it cannot make the marker rule pass on an absence of
				// information because the marker is judged on `testIds`, which such a page does
				// report.
				[],
		text: typeof bag.text === "string" ? bag.text : "",
		elementCount: typeof bag.elementCount === "number" ? bag.elementCount : 0,
	};
}

/**
 * Why a cell is not ready, in the order a reader needs to hear it.
 *
 * A missing reading is itself a failure: the probe runs in the page, so nothing
 * coming back means the frame was taken from a page the harness could not read. It
 * gets its own kind so a declared skip can never cover it.
 */
type CellIssue =
	| ReadinessIssue
	| { kind: "reading"; message: string }
	| { kind: "seed"; message: string };

function readinessIssuesFor(
	cell: FramePlan,
	path: string,
	readiness: Readiness | null,
	relay: RelayReach | null,
): CellIssue[] {
	if (readiness === null)
		return [
			{ kind: "reading", message: "the page returned no readiness reading" },
		];
	// The rules — affirmative state marker, the `*-empty` prohibition and the relay
	// reach — live in `lib/readiness.ts`, where both directions can be asserted
	// without a browser. What stays here is the frame's own facts.
	return readinessIssues({
		screen: cell.screen,
		state: cell.state,
		askedPath: path,
		actualPath: readiness.path,
		root: SCREEN_ROOTS[cell.screen],
		presentIds: readiness.testIds,
		visibleIds: readiness.visibleTestIds,
		relayRegistryBacked: relay?.registryBacked ?? false,
		relayReached: relay?.reached ?? false,
	});
}

/**
 * Pin the relay to the scenario that serves this cell.
 *
 * Without this the harness read `/__mock/state` and `/__mock/scenarios` and then
 * captured every cell against whatever single scenario the relay happened to be
 * started with — so a cell labelled `S8/approval` could render an unrelated state
 * and still pass. A state label is a claim about what the relay serves; this is
 * what makes it true.
 */
async function selectScenario(
	relayUrl: string,
	scenario: string,
): Promise<void> {
	const res = await fetch(new URL("/__mock/scenario", relayUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ scenario }),
	});
	if (!res.ok) {
		throw new Error(
			`the mock relay refused to switch to scenario '${scenario}' (${res.status}): ` +
				"the cell cannot be captured in the state it declares",
		);
	}
}

/** How many requests the relay has served, for the per-cell reach check. */
async function relayRequestCount(relayUrl: string): Promise<number | null> {
	try {
		const res = await fetch(new URL("/__mock/state", relayUrl));
		if (!res.ok) return null;
		const bag = asRecord(await res.json());
		// `/__mock/state`'s `requests` counts every request the relay served, so a
		// page that reached it and asked only `/healthz` is counted. It used to be
		// the transcript's length, which holds only the recorded routes — reading
		// that made a reachable relay look unreachable.
		const requests = bag?.requests;
		return typeof requests === "number" ? requests : null;
	} catch {
		return null;
	}
}

/** Whether the app reached the relay while this cell was being captured. */
interface RelayReach {
	/** The cell was declared by a scenario in the relay's registry. */
	registryBacked: boolean;
	/** The relay's served-request count grew while the cell rendered. */
	reached: boolean;
}

/** Compare each frame's claimed theme against the token canvas and its twin. */
function verifyThemes(
	records: CaptureRecord[],
	canvasTokens: Record<string, { canvas: string | null }> | null,
): string[] {
	const problems = [];
	const byStem = new Map();
	for (const record of records) {
		const stem = `${record.cell}__${record.device}__${record.scale}`;
		const bucket = byStem.get(stem) ?? {};
		bucket[record.theme] = record;
		byStem.set(stem, bucket);
	}
	for (const [stem, bucket] of byStem) {
		for (const theme of ["dark", "light"]) {
			const record = bucket[theme];
			if (!record) continue;
			const expected = canvasTokens?.[theme]?.canvas ?? null;
			record.problems = [];
			// The per-record fields the gallery and the report both read: what the
			// page *resolved*, what actually rendered, and what the token says it
			// should have been. Never what the harness asked for.
			record.resolvedTheme = record.measurements?.reported?.theme ?? null;
			record.canvasColor = record.measurements?.canvasColor ?? null;
			record.expectedCanvas = expected;
			record.themeApplied = null;
			record.themeCheck = {
				expectedCanvas: expected,
				resolvedTheme: record.resolvedTheme,
				themeSource: record.measurements?.reported?.themeSource ?? null,
				canvasMatchesToken: expected
					? rgbEquals(record.canvasColor, expected)
					: null,
			};
			const note = (message: string): void => {
				record.problems.push(message);
				problems.push(`${stem}: ${message}`);
			};
			if (record.resolvedTheme !== theme) {
				record.themeApplied = false;
				note(
					`requested theme '${theme}' but the page resolved '${record.resolvedTheme}'`,
				);
			}
			if (record.themeCheck.canvasMatchesToken === false) {
				record.themeApplied = false;
				note(
					`theme '${theme}' rendered canvas ${record.canvasColor} but the token for that theme is ${expected}`,
				);
			}
			if (
				record.themeCheck.canvasMatchesToken === true &&
				record.themeApplied === null
			) {
				record.themeApplied = true;
			}
			if ((record.measurements?.mountedElements ?? 0) < 5) {
				note(
					`only ${record.measurements?.mountedElements ?? 0} elements mounted — the frame is (nearly) blank, so its hash proves nothing`,
				);
			}
		}
		// The defect class this line exists for: both themes rendered identically.
		if (bucket.dark && bucket.light) {
			const identical =
				bucket.dark.frames[0].sha === bucket.light.frames[0].sha;
			bucket.dark.themeCheck.twinIdentical = identical;
			bucket.light.themeCheck.twinIdentical = identical;
			if (identical) {
				const message = `the dark and light frames are byte-identical (${bucket.dark.frames[0].sha}) — the theme is not reaching the render, so neither frame is evidence`;
				bucket.dark.problems.push(message);
				bucket.light.problems.push(message);
				bucket.dark.themeApplied = false;
				bucket.light.themeApplied = false;
				problems.push(`${stem}: ${message}`);
			}
		}
	}
	return problems;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

const asStringArray = (value: unknown): string[] | undefined =>
	Array.isArray(value) && value.every((entry) => typeof entry === "string")
		? (value as string[])
		: undefined;

/** What `buildPlan` needs to enumerate frames. */
interface BuildPlanOptions {
	state: RelayStateReply | null;
	/** Collected, not thrown: see the note in the loop below. */
	unrenderable: Array<{ cell: string; reason: string }>;
	cells: string[];
	devices: string[];
	themes: string[];
	scales: Array<{ id: string; factor: number }>;
	consecutive: boolean;
}

/** One planned frame: the cell, its device, theme and text scale. */
interface FramePlan {
	cell: string;
	screen: string;
	screenLabel: string;
	path: string;
	state: string;
	device: string;
	theme: string;
	scale: { id: string; factor: number };
	deviceSpec: DeviceProfile;
	scaleSpec: { id: string; factor: number };
	consecutive: boolean;
}

/**
 * What the harness reads off the mock relay.
 *
 * `cells` is derived from the registry (`/__mock/scenarios` → `scenarios[].shows`)
 * because that is where the mock states live; the live `/__mock/state` supplies
 * the session id and the current scenario.
 */
interface RelayStateReply {
	cells: string[];
	/** Which scenarios declare each cell, for a reader asking "what state is this?". */
	cellScenarios?: Record<string, string[]>;
	sessionId: string | null;
	jobId: string | null;
	scenario: string | null;
	scenarios: Record<
		string,
		{ name: string; description: string; shows: string[] }
	>;
}

/**
 * Cells that declare different states but produced the same bytes.
 *
 * The check is deliberately cross-cell rather than per-cell: two *themes* of one
 * cell being identical is already caught by the twin check, while two *states*
 * of one screen being identical is the separate, harder-to-notice failure — the
 * app ignored the state and rendered one screen for all of them.
 *
 * Compared on the settled frame, which is the one a reviewer looks at.
 */
function findIdenticalStates(records: CaptureRecord[]): string[] {
	const bySha = new Map<string, CaptureRecord[]>();
	for (const record of records) {
		const frame = record.frames[record.frames.length - 1];
		if (frame === undefined) continue;
		const key = `${frame.sha}`;
		bySha.set(key, [...(bySha.get(key) ?? []), record]);
	}
	const problems: string[] = [];
	for (const [shaDigest, group] of bySha) {
		const states = new Set(
			group.map((record) => `${record.screen}/${record.state}`),
		);
		if (states.size < 2) continue;
		// A DECLARED SKIP is not evidence for the state it names, so a group made ONLY of
		// skipped cells rendering one image is the known gap, not a finding: the 29 skips
		// on this head are one placeholder screen between them, and reporting that as
		// "different states, one image" three times is noise a reviewer has to re-derive.
		//
		// The check keeps every tooth that matters: one EVIDENTIAL cell is enough to
		// report the group, so a measured cell that collapses onto a skipped one — or two
		// measured cells that collapse onto each other — is still caught.
		if (!group.some((record) => record.declaredSkip === null)) continue;
		problems.push(
			`${[...states].join(" = ")} rendered identically (${shaDigest}) on ${group[0]?.device ?? "?"}`,
		);
	}
	return problems;
}

/** `rgb(a, b, c)`/`#rrggbb` → lowercase hex, so a computed colour can meet a token. */
function rgbEquals(
	computed: string | null | undefined,
	hex: string | null | undefined,
): boolean | null {
	if (!computed || !hex) return null;
	const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(computed);
	if (!match) return computed.toLowerCase() === hex.toLowerCase();
	const toHex = (n: string | undefined): string =>
		Number(n ?? "0")
			.toString(16)
			.padStart(2, "0");
	return (
		`#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}` ===
		hex.toLowerCase()
	);
}

/** Read the design tokens' canvas per theme, so a frame can be checked against them. */
function canvasTokens(
	tokensPath: string | undefined,
): Record<string, { canvas: string | null }> | null {
	if (!tokensPath || !existsSync(tokensPath)) return {};
	// Absent tokens are not a failure: the design kit lands in its own change, and
	// a capture run that cannot read the token file should still produce frames —
	// it just cannot make the token-comparison half of the theme check, and says
	// so rather than inventing a colour to compare against.
	if (!existsSync(tokensPath)) return null;
	const tokens = JSON.parse(readFileSync(tokensPath, "utf8"));
	const tokensBag: unknown = tokens;
	if (typeof tokensBag !== "object" || tokensBag === null) return null;
	const color = (tokensBag as Record<string, unknown>).color;
	const surface =
		typeof color === "object" && color !== null
			? (color as Record<string, unknown>).surface
			: undefined;
	const canvas =
		typeof surface === "object" && surface !== null
			? (surface as Record<string, unknown>).canvas
			: undefined;
	if (typeof canvas !== "object" || canvas === null) return null;
	const pick = (theme: string): string | null => {
		const value = (canvas as Record<string, unknown>)[theme];
		return typeof value === "string" ? value : null;
	};
	return { dark: { canvas: pick("dark") }, light: { canvas: pick("light") } };
}

/**
 * Everything a capture run takes. `tier` is recorded in the manifest so a report
 * can say which sample produced it: a `ci` or `core` run is not a full-matrix
 * result, and a cell that was not captured is BLOCKED rather than passed.
 */
export interface CaptureOptions {
	dir: string;
	out: string;
	relay?: string | undefined;
	cells: string[];
	tier: "ci" | "core" | "full";
	devices: string[];
	themes: string[];
	scales: Array<{ id: string; factor: number }>;
	consecutive: boolean;
	settleMs: number;
	/** Hard bound per cell; a cell that exceeds it is a FAILED cell, not a hang. */
	cellTimeoutMs: number;
	/**
	 * Hard bound for the whole run, checked between cells. `null` means the caller
	 * did not name one, so `runCapture` derives it from the plan's size; the
	 * effective value is what the manifest records.
	 */
	deadlineMs: number | null;
	tokens: string;
	plan: boolean;
	yes: boolean;
	strict: boolean;
	profile?: string | undefined;
	port: number;
	/**
	 * The web-only seed hook's parameters (docs/e2e/README.md, option 3). The harness
	 * puts them on the page; the app side that would adopt them is not built, so a cell
	 * they do not reach still fails by name. `runCapture` DEFAULTS both for a `--relay`
	 * run — the served origin and the mock relay's own default password — because a seed
	 * naming the relay's own origin is refused by the browser before the app can
	 * authenticate, and that run looks green while every frame is a fallback screen.
	 */
	seed: { route: string | null; password: string | null };
	/**
	 * Do not seed the page at all, even though a relay was given.
	 *
	 * There is no other way to ask for "a live relay the page was never pointed at": an
	 * empty `--seed-route` is what means "use the default". `verify` needs exactly that
	 * state to prove the relay-reach rule still refuses a cell the app never asked the
	 * relay about.
	 */
	noSeed?: boolean;
}

/** One captured cell and everything the audit and the gallery read off it. */
export interface CaptureRecord {
	name: string;
	cell: string;
	screen: string;
	screenLabel: string;
	state: string;
	device: string;
	deviceLabel: string;
	theme: string;
	scale: string;
	viewport: { width: number; height: number; dpr: number };
	insets: { top: number; bottom: number; left: number; right: number };
	path: string;
	url: string;
	frames: Array<{ file: string; sha: string; bytes: number }>;
	measurements: Measurements | null;
	readiness: Readiness | null;
	readinessProblems: string[];
	ready: boolean;
	/**
	 * Set when the cell's state is a DECLARED SKIP: the app declares no marker for it
	 * AND `matrix.ts` `PENDING_CELLS` names the dependency it waits on. A skipped cell
	 * is NOT evidence and NOT a finding: it is excluded from `notMeasurableCells` and
	 * reported with its owner. Its own `readinessProblems` are still recorded, so the
	 * per-cell detail is not lost — it is only not counted as a measurement gap.
	 */
	declaredSkip: { cell: string; owner: string; reason: string } | null;
	consoleErrors: string[];
	/**
	 * Whether the text-scale dimension was LIVE for this frame's cell, and the
	 * ratio it was judged on. `null` means the run did not capture both scales for
	 * this key, so the frame cannot answer a large-text question either way — which
	 * is a different statement from "measured at 100 %".
	 */
	scaleLive?: boolean | null;
	scaleRatio?: number | null;
	resolvedTheme?: string | null;
	canvasColor?: string | null;
	expectedCanvas?: string | null;
	themeApplied?: boolean | null;
	themeCheck?: Record<string, unknown>;
	problems?: string[];
}

export async function runCapture(options: CaptureOptions) {
	const outDir = options.out;
	mkdirSync(join(outDir, "frames"), { recursive: true });
	const state = await relayState(options.relay);
	if (state !== null && state.cells.length === 0) {
		throw new Error(
			`the mock relay at ${options.relay} declares no cells: /__mock/scenarios returned no ` +
				"scenario with a `shows` list, so there is nothing to capture",
		);
	}

	const unrenderable: Array<{ cell: string; reason: string }> = [];
	const plan = buildPlan({
		state,
		cells: options.cells,
		unrenderable,
		devices: options.devices,
		themes: options.themes,
		scales: options.scales,
		consecutive: options.consecutive,
	});
	const framesPerCell = options.consecutive ? 3 : 1;
	const plannedFrames = plan.length * framesPerCell;

	/*
	 * The bound the run will actually hold, and the note when the caller's own
	 * bound cannot hold it. Printed BEFORE anything is launched so a bound that
	 * will truncate is a stated diagnosis at minute zero rather than a surprise
	 * at minute fifteen — which is exactly how the CI job's first real capture
	 * run failed: 900 s against a 962-cell plan, reported only when it fired.
	 */
	const budgetMs = derivedDeadlineMs(plan.length);
	const deadlineMs = options.deadlineMs ?? budgetMs;

	console.log(
		`capture plan: ${plan.length} cells × ${framesPerCell} frame(s) = ${plannedFrames} frames`,
	);
	console.log(
		`  screens: ${[...new Set(plan.map((c) => c.screen))].sort().join(", ")}`,
	);
	console.log(
		`  devices: ${[...new Set(plan.map((c) => c.device))].join(", ")}`,
	);
	console.log(
		`  themes:  ${[...new Set(plan.map((c) => c.theme))].join(", ")}`,
	);
	console.log(
		`  scales:  ${[...new Set(plan.map((c) => c.scaleSpec.id))].join(", ")}`,
	);
	console.log(`  out:     ${outDir}`);
	console.log(
		`  deadline: ${Math.round(deadlineMs / 1000)} s` +
			(options.deadlineMs === null
				? ` (derived from the plan at ${CELL_BUDGET_MS} ms/cell; pass --deadline to override)`
				: " (explicit)"),
	);
	if (options.deadlineMs !== null && options.deadlineMs < budgetMs) {
		console.log(
			`note: --deadline ${Math.round(options.deadlineMs / 1000)} s is below this plan's ` +
				`${Math.round(budgetMs / 1000)} s budget; cells still unvisited when it fires are ` +
				"reported as having no frame rather than silently skipped.",
		);
	}
	if (options.plan) {
		for (const cell of plan) console.log(`   ${frameName(cell)}`);
		return { planned: plannedFrames, plan, dryRun: true };
	}
	if (plannedFrames > CONFIRM_THRESHOLD && !options.yes) {
		throw new Error(
			`${plannedFrames} frames is above the ${CONFIRM_THRESHOLD}-frame confirmation threshold. ` +
				"Add --yes to run it, or narrow with --cells/--devices/--themes/--scales.",
		);
	}

	// The relay is proxied at the SAME origin as the build, so the app's own
	// configured route reaches it. Without this every relay-backed cell rendered
	// an app with no route and five different states produced one identical image.
	const server = await serveDir(options.dir, {
		port: options.port ?? 0,
		proxy: options.relay,
	});
	/*
	 * WHICH ORIGIN the seed names, and why it is not the relay's.
	 *
	 * The page is served from `server.url` and the relay is proxied there, so the
	 * app's configured route IS this origin. Seeding the mock relay's own origin
	 * instead makes every relay request cross-origin, the mock sends no CORS headers,
	 * and the browser rejects the fetch before the app can authenticate — measured:
	 * the app renders "The relay could not be reached" and EVERY relay-backed cell is
	 * a fallback screen while the seed parameters look correct. That failure is worth
	 * a default rather than a paragraph, because it is silent: the run is green, the
	 * frames exist, and nothing in them is evidence.
	 *
	 * `--seed-route` therefore OVERRIDES; omitted, a relay run seeds the served origin
	 * (and a run with no `--relay` seeds nothing — the relay paths are not proxied, so
	 * the origin has no relay behind it). The password defaults to the mock relay's own
	 * documented constant for the same reason: a seeded run without one renders an
	 * unauthenticated page and every cell fails for the credential rather than the route.
	 */
	const seed = options.noSeed
		? { route: null, password: null }
		: {
				route:
					options.seed.route ??
					(options.relay === undefined ? null : server.url),
				password: options.seed.password ?? DEFAULT_PASSWORD,
			};
	if (options.seed.route !== null && options.relay === undefined) {
		console.log(
			"note: --seed-route was given without --relay, so the relay's paths are NOT " +
				"proxied at the seed's origin; the app will report the route as unreachable.",
		);
	}
	const chrome = await launchChrome({ profile: options.profile });
	const tokens = canvasTokens(options.tokens);
	const records: CaptureRecord[] = [];
	screenshotRetries = 0;
	let reaped: Awaited<ReturnType<typeof chrome.close>> | null = null;
	/** Cells that produced no frame, and why — never a silent skip. */
	const abandoned: Array<{ cell: string; reason: string }> = [...unrenderable];
	/** What a reviewer must not read as a captured matrix. */
	const cellsCaptured = plan.length - unrenderable.length;
	const startedAt = Date.now();
	let index = 0;

	try {
		let page = await chrome.page();
		await page.send("Page.enable");
		await page.send("Runtime.enable");
		await page.send("Page.addScriptToEvaluateOnNewDocument", {
			source: PRE_PAINT_PROBE,
		});

		for (const cell of plan) {
			index += 1;
			if (Date.now() - startedAt > deadlineMs) {
				// The overall bound: a run that would exceed its job's own timeout stops
				// accounting for itself and reports what it captured, rather than being
				// killed with nothing written. Measured in CI: the step ran past a
				// 45-minute job timeout and produced no artifacts at all.
				abandoned.push({
					cell: cell.cell,
					reason: `the run passed its ${Math.round(deadlineMs / 1000)} s deadline with ${plan.length - index + 1} cell(s) left`,
				});
				break;
			}
			// Pin the relay to this cell's state before rendering it, and count what the
			// relay serves while it renders. A registry-declared cell whose requests
			// did not grow is a cell the app rendered without asking the relay for
			// anything — which is exactly the "passed while showing the wrong state"
			// case, so it is a readiness failure rather than a green frame.
			let relayReach: RelayReach | null = null;
			const registryBacked =
				options.relay !== undefined &&
				Object.hasOwn(state?.cellScenarios ?? {}, cell.cell);
			if (registryBacked && options.relay !== undefined) {
				const scenario = state?.cellScenarios?.[cell.cell]?.[0];
				if (scenario !== undefined)
					await selectScenario(options.relay, scenario);
			}
			const requestsBefore =
				options.relay === undefined
					? null
					: await relayRequestCount(options.relay);

			// The per-cell bound. A cell whose page never settles used to hang the
			// whole run; it now fails with the deadline that expired, and the next cell
			// proceeds.
			const attempted = await withDeadline(
				captureCell(page, cell, {
					baseUrl: server.url,
					state: state ?? null,
					outDir,
					settleMs: options.settleMs,
					relayReach,
					seed,
				}),
				options.cellTimeoutMs,
				`cell ${cell.cell} on ${cell.device}/${cell.theme}/${cell.scale.id}`,
			);
			if (!attempted.ok) {
				abandoned.push({ cell: cell.cell, reason: attempted.reason });
				console.log(
					`[${index}/${plan.length}] ${cell.cell} on ${cell.device} — FAILED: ${attempted.reason}`,
				);
				// The page may be wedged with a live stream; a fresh target keeps the
				// next cell from inheriting it.
				page = await recoverPage(chrome, page);
				continue;
			}
			const record = attempted.value;
			if (options.relay !== undefined) {
				const requestsAfter = await relayRequestCount(options.relay);
				relayReach = {
					registryBacked,
					reached:
						requestsBefore === null || requestsAfter === null
							? registryBacked === false
							: requestsAfter > requestsBefore,
				};
				// The readiness guard ran inside `captureCell`, before this count was
				// available, so the reach problem is appended here where the relay can
				// be asked what it served. It is a covered kind for a declared skip (the
				// app cannot ask a relay for a state it does not render), so appending it
				// never turns a skip into a failure — the skip's own decision is made in
				// `captureCell`, where a route or root problem would have blocked it.
				const reachIssues = readinessIssuesFor(
					cell,
					record.path ?? "",
					record.readiness,
					relayReach,
				).map((issue) => issue.message);
				for (const problem of reachIssues) {
					if (
						problem.includes("no request to the mock relay") &&
						!record.readinessProblems.includes(problem)
					) {
						record.readinessProblems = [...record.readinessProblems, problem];
						record.ready = false;
					}
				}
			}
			records.push(record);
			const mark = record.themeCheck?.themeSource === "os" ? "os" : "q";
			console.log(
				`[${index}/${plan.length}] ${record.name}  ` +
					`theme=${record.measurements?.reported?.theme}(${mark}) ` +
					`canvas=${record.measurements?.canvasColor} ` +
					`els=${record.measurements?.mountedElements} ` +
					`text=${record.measurements?.medianTextHeight}px ` +
					`${record.consoleErrors.length ? `errors=${record.consoleErrors.length} ` : ""}` +
					`${record.frames[0]?.bytes ?? 0}b ${record.frames[0]?.sha ?? "no-frame"}`,
			);
			if (record.consoleErrors.length) {
				for (const error of record.consoleErrors.slice(0, 3))
					console.log(`      console: ${error.slice(0, 200)}`);
			}
		}
	} finally {
		reaped = await chrome.close();
		await server.close();
	}

	// The two-part teardown guarantee is only true if the run that ended normally says
	// so: this used to discard the count the reap returned while the header claimed the
	// tool "asserts 0 processes remain". Now the number is printed, and a non-zero count
	// is a failure of the run rather than a note a reader has to notice.
	const survivors = reaped?.survivors ?? 0;
	const sweptOrphans = reaped?.sweep?.swept.length ?? 0;
	const skippedLive = reaped?.sweep?.skipped.length ?? 0;
	console.log(
		`  teardown: ${survivors} process(es) left by this run, ` +
			`${sweptOrphans} orphan(s) from earlier runs reaped, ` +
			`${skippedLive} live owner(s) left alone` +
			(screenshotRetries > 0
				? `, ${screenshotRetries} screenshot retr(y|ies)`
				: ""),
	);

	const themeProblems = verifyThemes(records, tokens);
	const reflow = records
		.filter((r) => r.frames.length > 2)
		.map((r) => {
			const first = r.frames[0];
			const settled = r.frames[r.frames.length - 1];
			return {
				name: r.name,
				firstVsSettled:
					first !== undefined &&
					settled !== undefined &&
					first.sha !== settled.sha,
			};
		})
		.filter((entry) => entry.firstVsSettled);

	const scaleCheck = verifyTextScale(records);

	// The per-cell half of the scale guard, and the reason it exists: the app does
	// NOT read the `?lo-text-scale` query parameter — its type roles multiply the
	// browser's ROOT FONT SIZE — so a run can render every "200 %" cell at 100 %
	// and still produce a full matrix of confident rows. A run-level median hides
	// exactly that case, because one responsive screen lifts it while another
	// screen's cell is inert. So each pair is judged on its own, and an inert cell
	// is FAILED BY NAME rather than averaged away.
	const inertScale = new Map(
		(scaleCheck.perCell ?? [])
			.filter((entry) => !entry.live)
			.map((entry) => [entry.key, entry]),
	);
	for (const record of records) {
		const key = `${record.screen}__${record.state}__${record.device}__${record.theme}`;
		const judged = (scaleCheck.perCell ?? []).find(
			(entry) => entry.key === key,
		);
		record.scaleLive = judged?.live ?? null;
		record.scaleRatio = judged?.ratio ?? null;
		if (record.scale === "200" && judged !== undefined && !judged.live) {
			record.readinessProblems = [
				...record.readinessProblems,
				`the text did not scale: median text ${String(record.measurements?.medianTextHeight ?? 0)}px at 200% ` +
					`against ${String(judged.ratio)}x the 100% cell (needs ≥${String(scaleCheck.liveMinRatio)}x), ` +
					"so this cell measures 100% and cannot answer a large-text question",
			];
			record.ready = false;
		}
	}
	void inertScale;

	// A cell that did not reach its own screen is not evidence, and a set of cells
	// that produced one identical image is the specific failure this guard exists
	// for: before the relay was proxied, five `S4` states rendered the
	// unauthenticated screen and the matrix looked complete.
	//
	// A DECLARED SKIP is pulled out of that set on purpose: its state is a named,
	// owned dependency the app marks with nothing yet, so its frame was never going
	// to be evidence and counting it as a measurement GAP would report a known gap as
	// an instrument failure. It is still reported, with its owner, and it still has no
	// marker — `PENDING_CELLS` cannot make a working cell look unmeasured, because the
	// skip is honoured only while the app declares no marker for the state.
	const unready = records.filter(
		(record) => !record.ready && record.declaredSkip === null,
	);
	const skipped = records.filter((record) => record.declaredSkip !== null);
	const readinessProblems = unready.map(
		(record) => `${record.name}: ${record.readinessProblems.join("; ")}`,
	);
	const identicalCells = findIdenticalStates(records);

	// The manifest is what the audit and the gallery both read, so it carries the
	// facts each of them needs by name rather than a shape they must infer.
	const summary = {
		meta: {
			generatedAt: new Date().toISOString(),
			capturedAt: new Date().toISOString(),
			durationMs: Date.now() - startedAt,
			buildDir: resolve(options.dir),
			repoRoot: resolve(new URL("../../", import.meta.url).pathname),
			relay: options.relay ?? null,
			scenario: state?.scenario ?? null,
			plannedFrames,
			framesPerCell,
			tier: options.tier,
			cellsPlanned: plan.length,
			cellsCaptured,
			cellTimeoutMs: options.cellTimeoutMs,
			deadlineMs,
			devicesCaptured: options.devices,
			themeTokens: tokens ?? null,
			textScaleVerdict: scaleCheck.verdict,
			textScaleLive: scaleCheck.live === true,
			// The teardown reading, in the artifact as well as on stdout: a run that left
			// processes is visible without re-reading a terminal.
			teardown: {
				survivors: reaped?.survivors ?? null,
				orphansReaped: reaped?.sweep?.swept.length ?? 0,
				liveOwnersSkipped: reaped?.sweep?.skipped.length ?? 0,
				screenshotRetries,
			},
			// Which cells were measured against a LIVE dimension, by name. A report
			// that only carried the run-level verdict let a reader take every "200 %"
			// row at face value while some of them were rendered at 100 %.
			textScaleLiveCells: (scaleCheck.perCell ?? [])
				.filter((entry) => entry.live)
				.map((entry) => entry.key),
			textScaleInertCells: (scaleCheck.perCell ?? [])
				.filter((entry) => !entry.live)
				.map((entry) => entry.key),
			// Pairs the plan asked for both scales of, against the pairs the guard could
			// actually judge: the difference is the coverage this run does NOT have.
			textScalePairsPlanned: new Set(
				plan.map(
					(cell) =>
						`${cell.screen}__${cell.state}__${cell.device}__${cell.theme}`,
				),
			).size,
			textScalePairsMeasured: (scaleCheck.perCell ?? []).length,
			deviceProfile: DEVICES,
			scaleProfile: SCALES,
			screens: SCREENS,
		},
		themeProblems,
		readinessProblems,
		/** Cells with no frame: unrenderable screens and cells that hit a deadline. */
		abandonedCells: abandoned,
		identicalStates: identicalCells,
		unreadyCells: unready.map((record) => record.name),
		/**
		 * Cells whose state is a named, owned dependency rather than a failure.
		 *
		 * Separate from `notMeasurableCells` because the two answer different
		 * questions: a not-measurable cell is a frame that cannot be evidence, and its
		 * reasons are findings; a declared skip is a state this head does not have yet,
		 * and its reason is a ticket. The audit reads this list to mark the cell's rows
		 * BLOCKED-with-an-owner instead of counting them as a gap.
		 */
		declaredSkips: skipped.map((record) => record.declaredSkip),
		declaredSkipCells: skipped.map((record) => record.name),
		/**
		 * Per-cell measurability, by name, in one place.
		 *
		 * A clean-looking frame matrix is NOT coverage, and the difference has to be
		 * readable without cross-checking anything: a cell whose declared state was
		 * never reached cannot answer a design, UX or rubric question about that
		 * state, and its frame is the app's fallback screen. `ready` is the per-frame
		 * flag; these two lists are the report's own summary of it.
		 */
		measurableCells: records
			.filter((record) => record.ready)
			.map((record) => record.name),
		notMeasurableCells: unready.map((record) => ({
			cell: record.name,
			why: record.readinessProblems,
		})),
		coverageNote: [
			unready.length === 0
				? "every captured cell reached the state it declares"
				: `${unready.length} of ${records.length} cells did NOT reach the state they declare: their frames show the app's fallback screen and must not be read as evidence about those states`,
			skipped.length === 0
				? null
				: `${skipped.length} more are DECLARED SKIPS — states this head does not render yet, each with its owner in 'declaredSkips'`,
		]
			.filter((line): line is string => line !== null)
			.join("; "),
		textScaleCheck: scaleCheck,
		postPaintReflow: reflow,
		records,
	};
	writeFileSync(
		join(outDir, "manifest.json"),
		`${JSON.stringify(summary, null, 2)}\n`,
	);
	writeFileSync(join(outDir, "index.html"), renderGallery(summary));

	console.log("");
	console.log(
		`captured ${records.length} cells / ${records.length * framesPerCell} frames in ` +
			`${(summary.meta.durationMs / 1000).toFixed(1)} s`,
	);
	console.log(`frames that changed after first paint: ${reflow.length}`);
	console.log(`text-scale dimension: ${scaleCheck.verdict}`);
	if (themeProblems.length) {
		console.log(`THEME PROBLEMS (${themeProblems.length}):`);
		for (const problem of themeProblems) console.log(`  - ${problem}`);
	} else {
		console.log(
			"theme problems: none — every frame's resolved theme and canvas match its cell, and no dark/light pair is identical",
		);
	}
	if (readinessProblems.length) {
		console.log(`UNREADY CELLS (${readinessProblems.length}):`);
		for (const problem of readinessProblems) console.log(`  - ${problem}`);
	} else {
		// Never `records.length/length`: with declared skips pulled out of the unready
		// set, "every cell reached the screen it names" would print `38/38 measurable` on
		// a head where 29 of them are known gaps — the exact over-claim this line exists
		// to prevent.
		const measured = records.length - skipped.length;
		console.log(
			`readiness: every captured cell reached the screen it names (${measured} measured, ` +
				`${skipped.length} declared skip(s))`,
		);
	}
	if (unready.length > 0) {
		console.log(
			`NOT MEASURABLE: ${unready.length} of ${records.length} cells — their frames are the app's fallback screen, not the declared state`,
		);
	}
	if (skipped.length > 0) {
		console.log(
			`DECLARED SKIPS (${skipped.length}) — states this head does not render, each with an owner:`,
		);
		for (const entry of skipped)
			console.log(
				`  - ${String(entry.declaredSkip?.cell)}: ${String(entry.declaredSkip?.owner)}`,
			);
	}
	if (identicalCells.length) {
		console.log(
			`IDENTICAL STATES (${identicalCells.length}): cells that declare different states produced the same bytes`,
		);
		for (const entry of identicalCells) console.log(`  - ${entry}`);
	}

	const strict = options.strict !== false;
	if (abandoned.length) {
		console.log(
			`CELLS WITH NO FRAME (${abandoned.length}) — each is BLOCKED, never a silent pass:`,
		);
		for (const entry of abandoned)
			console.log(`  - ${entry.cell}: ${entry.reason}`);
	}
	const blocking =
		themeProblems.length +
		readinessProblems.length +
		identicalCells.length +
		abandoned.length;
	// A run that leaves processes behind has not finished, whatever its frames look
	// like: "a run that ends normally leaves nothing behind, and proves it in its own
	// output" is the README's claim, so the number has to be able to fail the run that
	// made it. It is checked OUTSIDE the `blocking` gate on purpose: a clean matrix that
	// leaks a browser is exactly the case this must catch, and `blocking` deliberately
	// does not count survivors — so nesting the two let a leak exit 0 (round 3, found
	// independently by review and QA). `survivors` is declared once, above, where the
	// run reports its teardown.
	if (survivors !== 0) {
		readinessProblems.push(
			`${survivors} Chrome process(es) survived this run's teardown for ` +
				`'${reaped?.profile ?? "the run profile"}': the run did not clean up after itself`,
		);
	}
	const blockingWithSurvivors = blocking + (survivors === 0 ? 0 : 1);
	if (strict && blockingWithSurvivors > 0) {
		throw new CaptureFailure(
			`${themeProblems.length} theme problem(s), ${readinessProblems.length} unready cell(s), ` +
				`${identicalCells.length} identical-state pair(s), ${abandoned.length} cell(s) with no frame, ` +
				`${survivors} surviving process(es); ` +
				`see ${join(outDir, "manifest.json")}`,
			{
				themeProblems,
				readinessProblems,
				identicalStates: identicalCells,
				survivors,
			},
		);
	}
	return summary;
}

/**
 * Does the text-scale dimension actually do anything? An instrument whose scale
 * dimension silently does nothing produces three identical frames per cell and
 * looks like a pass. This measures the median rendered text height at each scale
 * and reports the observed ratio, so the *dimension* can be shown to work before
 * any U-04 finding is trusted.
 */
function verifyTextScale(records: CaptureRecord[]) {
	const perDevice = new Map();
	for (const record of records) {
		const key = `${record.screen}__${record.state}__${record.device}__${record.theme}`;
		const bucket = perDevice.get(key) ?? {};
		bucket[record.scale] = record.measurements?.medianTextHeight ?? 0;
		perDevice.set(key, bucket);
	}
	const ratios = [];
	for (const [key, bucket] of perDevice) {
		if (bucket["100"] && bucket["200"])
			ratios.push({ key, ratio: bucket["200"] / bucket["100"] });
	}
	if (ratios.length === 0) {
		// Nothing to conclude, and `live` stays false so no large-text verdict can
		// be drawn from a run that only ever rendered one scale.
		return {
			verdict: "not measured (needs both 100% and 200% in one run)",
			ratios: [],
			live: false,
		};
	}
	const middle = ratios.map((r) => r.ratio).sort((a, b) => a - b)[
		Math.floor(ratios.length / 2)
	];
	// A missing middle is the "could not tell" case, not a scale of 1: the
	// dimension is reported inert rather than assumed live.
	const median = middle ?? 0;
	// The bar is 1.9, not "more than 1.2": a cell at 1.3x is not a 200 % cell, and
	// treating it as one is how an inert dimension acquires coverage. 2 is what the
	// matrix asks for; 1.9 tolerates the sub-pixel rounding of a wrapped line.
	const LIVE_MIN_RATIO = 1.9;
	const perCell = ratios.map((entry) => ({
		key: entry.key,
		ratio: Number(entry.ratio.toFixed(3)),
		live: entry.ratio >= LIVE_MIN_RATIO,
	}));
	const works = median >= LIVE_MIN_RATIO;
	const inertCells = perCell.filter((entry) => !entry.live);
	return {
		medianObservedRatio: Number(median.toFixed(3)),
		expected: 2,
		liveMinRatio: LIVE_MIN_RATIO,
		live: works && inertCells.length === 0,
		perCell,
		verdict: works
			? `scale dimension is live across ${perCell.length - inertCells.length}/${perCell.length} measured pairs (median ${median.toFixed(2)}x at 200%)`
			: `scale dimension is INERT (median ${median.toFixed(2)}x at 200%) — three frames per cell ` +
				"are effectively one, so any U-04 'no clipping at 200%' result from this run is meaningless",
		ratios,
	};
}

/* -------------------------------------------------------------------- CLI -- */

const isMain =
	process.argv[1] &&
	import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (isMain) {
	const { flags } = parseArgs(process.argv.slice(2));
	const repoRoot = new URL("../../", import.meta.url).pathname;
	const dir = str(flags, "dir", undefined);
	const out = str(flags, "out", undefined);
	if (bool(flags, "help") || !dir || !out) {
		console.log(
			[
				"usage: node tools/visual/capture.ts --dir <web-build> --out <frames-dir> [options]",
				"",
				"  Both --dir and --out are required: a default output path inside the",
				"  repository would write a frame tree into it, and frames never belong in",
				"  the repository (ADR 0003).",
				"",
				"  --dir <path>        the built web target to serve (expo export --platform web)",
				"  --out <path>        where frames/, manifest.json and index.html go",
				"  --seed-route <url>  point a web build at one relay by putting the app's own",
				"  --seed-password <pw> parameters (lo-relay, lo-relay-password, lo-relay-insecure)",
				"                      on every page. #11's webRelayOverride() reads them, so a",
				"                      seeded run is how a relay-backed cell becomes measurable.",
				"                      DEFAULTS for a --relay run: the route is the origin the build",
				"                      is served from (the relay is proxied there; the mock's own",
				"                      origin is cross-origin and its fetches are refused), and the",
				"                      password is the mock relay's DEFAULT_PASSWORD.",
				"  --no-seed           do not seed the page at all, even with --relay: the state a",
				"                      run needs to prove the app was NOT pointed at the relay",
				"  --relay <url>       mock relay base URL; supplies the scenario list and session ids",
				"  --cells <a/b,...>   explicit screen/state cells (default: whatever the relay declares)",
				"  --cell-timeout <s>  hard bound per cell; a cell that exceeds it FAILS with that reason (default 45)",
				"  --deadline <s>      hard bound for the whole run. Default: derived from the plan",
				"                      (2500 ms/cell, floor 900 s) so a bound always holds its own plan;",
				"                      a smaller explicit bound is honoured and noted. Cells still",
				"                      unvisited when it fires are reported as having no frame",
				"  --tier <name>       the sample to capture: ci | core (default) | full",
				"                        ci    296 cells — every declared cell, 2 device profiles,",
				"                              both themes, scales 100 and 200 (~11 min) — the CI job's",
				"                        core  962 cells — the 5 `core` profiles, both themes, all",
				"                              three scales",
				"                        full  3572 cells — all 19 profiles",
				"  --devices <names>   comma list. Default: the tier's profiles (ci 2, core 5 by",
				"                      default, --full for all 19)",
				"  --themes <names>    default dark,light",
				"  --scales <ids>      default 100,150,200 (the `ci` tier defaults to 100,200)",
				"  --consecutive       also capture a +250 ms and a settled frame per cell",
				"  --settle <ms>       boot budget before the first frame (default 1200)",
				"  --tokens <path>     tokens.json, to check each frame's canvas against its theme",
				"  --plan              print the frame list and exit without capturing",
				"  --yes               allow a run above the confirmation threshold",
				"  --no-strict         report theme problems without failing the run",
				"  --full              every device × theme × scale cell (matrix.ts `full` tier: 19 profiles)",
			].join("\n"),
		);
		process.exit(dir && out ? 0 : 2);
	}
	// An empty `--scales` means "the tier's defaults": the matrix's scale dimension is
	// the one that catches a transcript row clipping its tool result, so it is on by
	// default rather than opt-in.
	const scaleIds = csv(flags, "scales");
	// Which devices a run covers. `core` is the sample the operator's rule asks to be
	// run first — smallest phone, a typical phone, phone landscape, a tablet in each
	// orientation — `ci` is the bounded sample the per-push job takes (matrix.ts
	// `CI_DEVICES`, ~11 minutes), and `--full` covers every size. `--devices`
	// overrides any of them.
	//
	// An unknown tier is an ERROR rather than a silent fall back to `core`: a typo'd
	// `--tier ci` that quietly ran 962 cells would spend ~36 minutes on a capture the
	// caller did not ask for, and the whole point of naming the sample is that the
	// run you get is the one you asked for.
	const tierFlag = bool(flags, "full") ? "full" : str(flags, "tier", "core");
	if (tierFlag !== "ci" && tierFlag !== "core" && tierFlag !== "full") {
		console.error(
			`unknown --tier '${tierFlag}': the samples are ci, core and full ` +
				"(tools/visual/matrix.ts)",
		);
		process.exit(2);
	}
	const tier: "ci" | "core" | "full" = tierFlag;
	const requestedDevices = csv(flags, "devices");
	const defaultDevices =
		tier === "full" ? ALL_DEVICES : tier === "ci" ? CI_DEVICES : CORE_DEVICES;
	const defaultScaleIds = tier === "ci" ? CI_SCALES : SCALES.map((s) => s.id);
	const effectiveScaleIds = scaleIds.length ? scaleIds : defaultScaleIds;
	const deadlineFlag = str(flags, "deadline", undefined);
	const summary = await runCapture({
		dir,
		out,
		relay: str(flags, "relay", undefined),
		cells: csv(flags, "cells"),
		tier,
		devices: requestedDevices.length ? requestedDevices : defaultDevices,
		themes: csv(flags, "themes").length ? csv(flags, "themes") : THEMES,
		scales: SCALES.filter((s) => effectiveScaleIds.includes(s.id)),
		consecutive: bool(flags, "consecutive"),
		settleMs: num(flags, "settle", 1200),
		// The web build's own relay-override parameters: the harness puts the app's
		// `lo-relay*` names on the page, and #11's `webRelayOverride()` adopts them.
		seed: {
			route: str(flags, "seed-route", "") || null,
			password: str(flags, "seed-password", "") || null,
		},
		noSeed: bool(flags, "no-seed"),
		// Bounds, in the CLI because CI's job timeout is not this tool's business:
		// a cell that never settles must fail that cell, and a run that would outlive
		// its job must stop accounting for itself and write what it has.
		cellTimeoutMs: num(flags, "cell-timeout", 45) * 1000,
		// Absent means "derive it from the plan" — see CELL_BUDGET_MS. An explicit
		// value is honoured as given, including one small enough to truncate: the run
		// then prints the budgeted figure beside it rather than pretending they match.
		deadlineMs:
			deadlineFlag === undefined ? null : num(flags, "deadline", 900) * 1000,
		tokens:
			str(flags, "tokens", join(repoRoot, "design", "tokens", "tokens.json")) ??
			join(repoRoot, "design", "tokens", "tokens.json"),
		plan: bool(flags, "plan"),
		yes: bool(flags, "yes"),
		strict: !bool(flags, "no-strict"),
		profile: str(flags, "profile", undefined),
		port: num(flags, "port", 0),
	});
	if ("dryRun" in summary && summary.dryRun) process.exit(0);
}
