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
 *     [--relay http://127.0.0.1:PORT] [--scenario <name>] [--cells S15/populated,...]
 *     [--devices iphone-15,...] [--themes dark,light] [--scales 100,150,200]
 *     [--consecutive] [--plan] [--yes] [--strict] [--full]
 *     [--cell-timeout <s>] [--deadline <s>]
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bool, csv, num, parseArgs, str } from "../lib/args.ts";
import type { CdpPage } from "../lib/cdp.ts";
import { sleep } from "../lib/cdp.ts";
import { launchChrome } from "../lib/chrome.ts";
import { freshPage, withDeadline } from "../lib/page.ts";
import {
	declaredSkipFor,
	type ReadinessIssue,
	readinessIssues,
	STATE_POLL_MS,
	STATE_WAIT_MS,
	seedQuery,
	stateStillComing,
} from "../lib/readiness.ts";
import { selectScenario } from "../lib/relay.ts";
import { serveDir } from "../lib/static-server.ts";
import { DEFAULT_PASSWORD } from "../mock-relay/relay.ts";
import { renderGallery } from "./gallery.ts";
import { findIdenticalFrames } from "./identical-states.ts";
import {
	ALL_DEVICES,
	CI_DEVICES,
	CI_SCALES,
	CONTENT_PROBE,
	CORE_DEVICES,
	DEVICES,
	type DeviceProfile,
	describeDeviceCoverage,
	deviceCoverage,
	MEASURE_PROBE,
	PENDING_CELLS,
	READINESS_PROBE,
	SCALES,
	SCREEN_ROOTS,
	SCREENS,
	THEMES,
} from "./matrix.ts";
import {
	type CanvasTokens,
	canvasComparable,
	canvasTokens,
} from "./theme-tokens.ts";

/**
 * Frames whose first screenshot attempt failed and whose retry succeeded, for the
 * WHOLE run: the frame writer and the run's report are different scopes, so this is
 * module state reset per run rather than a local of either.
 */
let screenshotRetries = 0;

/**
 * Cells whose settled frame had to be retaken because the readings moved across it,
 * for the WHOLE run — module state for `screenshotRetries`' reason, and printed so
 * the retry is visible rather than silent.
 */
let settledRetakes = 0;

/**
 * Frames above this count are refused without `--yes`: a full matrix is minutes.
 *
 * WHAT IT IS FOR, and what it is deliberately NOT bound to. It is a RUNAWAY guard,
 * not a size policy: it catches a plan far larger than any sample this harness
 * offers (an inflated cell registry, a cell list copied from another tree), and it
 * is why a big run is always something the caller typed `--yes` for. It sits BELOW
 * every tier on purpose — `ci` plans 272 cells, `core` 884, `full` 3196 — so none of
 * them starts by accident; the CI job passes `--yes` for exactly that reason. It is
 * NOT tied to the default tier, so it must not be raised to "let the default run": a
 * documented invocation that plans the whole `core` tier is a 33-minute command, and
 * the defect is the invocation, not the bound. Deriving it from the plan the way
 * `CELL_BUDGET_MS` is derived would be circular — the guard would then never fire —
 * so it stays a constant, and this comment is what it is derived from.
 */
const CONFIRM_THRESHOLD = 120;

/**
 * The per-cell budget the DEFAULT whole-run deadline is derived from, in ms, and
 * the floor a small plan still gets.
 *
 * WHY THE DEFAULT IS DERIVED RATHER THAN FIXED. It used to be a flat 900 s, which
 * holds about 400 cells: a `core` run (884 cells) or a dispatched `full` run (3196)
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
 * How many times the settled frame may be retaken while its readings keep moving.
 *
 * Three, not one: the race this closes is a state ARRIVING, so the first retake
 * usually lands after it — but a cell that changes twice (a banner, then its text)
 * would still ship a frame the manifest misdescribes at two. Bounded, because a cell
 * whose readings never agree must not cost the run: it keeps its last frame and last
 * reading, which is what the harness did before the retake existed.
 */
const SETTLED_UNIT_TAKES = 3;

/** One reading of a cell: the harness's verdict on it, and what it is showing. */
interface CellState {
	readiness: Readiness | null;
	/** The `CONTENT_PROBE` digest, taken with the readiness reading. */
	content: string;
}

/** The whole-run deadline a plan of `cells` cells is budgeted, in ms. */
const derivedDeadlineMs = (cells: number): number =>
	Math.max(MIN_DERIVED_DEADLINE_MS, Math.ceil(cells * CELL_BUDGET_MS));

const sha = (buffer: Buffer): string =>
	createHash("sha256").update(buffer).digest("hex").slice(0, 16);

/**
 * Ask the mock relay which cells and session ids it is currently serving. This
 * is what keeps the harness from carrying a second copy of the scenario list:
 * the relay owns the states, the harness renders them.
 */
async function relayState(
	relayUrl: string | undefined,
	/** The same bound the cells use. The pre-flight is a `fetch` too, and a relay that
	 * accepts and never answers hung the whole run before it had planned a cell —
	 * measured by QA as rc 124 against their own bound with no manifest written. */
	timeoutMs: number,
): Promise<RelayStateReply | null> {
	if (!relayUrl) return null;
	// Two endpoints, because they answer different questions and only one of them
	// carries the cell list. `/__mock/state` is the live state (scenario, session
	// id, what the run has done); `/__mock/scenarios` is the registry, and each
	// entry's `shows` is the set of cells that state fills. Reading `cells` off
	// `/__mock/state` — which never served it — made the documented `--relay`
	// invocation fail with "no cells to capture".
	//
	// BOTH ARE BOUNDED, and a timeout is a refusal rather than a hang: a capture that
	// cannot plan is a run that must say so, not one that sits until its job is killed.
	const stateCall = await withDeadline(
		fetch(new URL("/__mock/state", relayUrl)),
		timeoutMs,
		`the mock relay's /__mock/state`,
	);
	if (!stateCall.ok)
		throw new Error(`${stateCall.reason}; is it a mock relay?`);
	const stateRes = stateCall.value;
	if (!stateRes.ok)
		throw new Error(
			`mock relay /__mock/state answered ${stateRes.status}; is it a mock relay?`,
		);
	const state = asRecord(await stateRes.json()) ?? {};

	const registryCall = await withDeadline(
		fetch(new URL("/__mock/scenarios", relayUrl)),
		timeoutMs,
		`the mock relay's /__mock/scenarios`,
	);
	if (!registryCall.ok) throw new Error(registryCall.reason);
	const registryRes = registryCall.value;
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
	} else {
		await sleep(Math.max(0, settleMs - 50));
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
	/**
	 * The two readings that must describe the same moment as the settled frame.
	 *
	 * Read together, and read as a pair by every caller below: the readiness probe is
	 * the harness's verdict on WHICH state the app is showing (route, screen roots,
	 * state markers) and the content probe is WHAT it is showing, and a frame is only
	 * evidence for a cell when both were true of that frame.
	 */
	const readState = async (): Promise<CellState> => ({
		readiness: asReadiness(await page.evaluate(READINESS_PROBE)),
		// Cheap (one evaluate) and read with the readiness reading, never after the
		// frame — see `IDENTICAL_FRAME_EXEMPTIONS` for why a byte comparison alone is
		// not enough to call two frames a collapse.
		content: digestContent(asContent(await page.evaluate(CONTENT_PROBE))),
	});
	/** The cell's verdict for one reading, as the messages a report prints. */
	const verdictOf = (reading: CellState): CellIssue[] => {
		const found = readinessIssuesFor(cell, path, reading.readiness, relayReach);
		if (seededButAbsent)
			found.push({
				kind: "seed",
				message:
					`the run was told to seed route '${String(seed.route)}' but the page reports ` +
					`'${String(measurements?.route ?? "")}' without it: the harness's own half of ` +
					"the seed hook failed",
			});
		return found;
	};
	/** Everything about the cell that must hold still across the settled frame. */
	const fingerprintOf = (reading: CellState): string =>
		`${reading.content}\u0000${verdictOf(reading)
			.map((issue) => issue.message)
			.join("\u0000")}`;

	let reading = await readState();
	let issues = verdictOf(reading);

	/*
	 * A state that arrives AFTER the settle window: wait for the marker rather than
	 * reporting the state missing at 1200 ms. See `STATE_WAIT_MS` for the two cells
	 * this exists for and for why a longer `--settle` is the wrong repair.
	 */
	let waitedMs = 0;
	while (waitedMs < STATE_WAIT_MS && stateStillComing(issues)) {
		await sleep(Math.min(STATE_POLL_MS, STATE_WAIT_MS - waitedMs));
		waitedMs += STATE_POLL_MS;
		reading = await readState();
		issues = verdictOf(reading);
	}

	/*
	 * STAMP, THEN CONFIRM THE READINGS DID NOT MOVE ACROSS THE FRAME.
	 *
	 * WHY THIS LOOP EXISTS. The settled frame used to be stamped BEFORE the readiness
	 * and content probes, and re-stamped only when the marker was still missing — so a
	 * state arriving between the frame and the probes shipped a PNG of the PRE-state
	 * under a manifest entry that said the cell was in the state it names. That is the
	 * "asserting one thing and shipping another" the marker rule exists to prevent,
	 * and it is not only a wrong frame: the identical-state check then sees "same
	 * bytes, different content" across two cells and hands the reviewer the
	 * camera-limit branch, whose repair is a signed declaration that would be FALSE.
	 *
	 * Measured 2026-10-03: this race is why 2 of 3 runs of the exact `ci` command
	 * exited 1 on an undeclared `S5/error = S5/populated` pair — the error cell's
	 * settled PNG was the populated screen while its content reading carried the 401
	 * banner, at two different devices.
	 *
	 * So the frame is retaken until two CONSECUTIVE readings agree: the reading was
	 * taken, the frame was stamped, and the reading is taken again. Agreement means
	 * nothing moved across the frame, which is what makes the manifest's claim about
	 * the cell true of the PNG it points at; disagreement means the frame was taken on
	 * the wrong side of a change, so it is retaken and checked again.
	 *
	 * A cell that never agrees is one whose readings genuinely keep changing — the
	 * animated spinner, the virtualized transcript window — and it keeps the LAST frame
	 * and the LAST reading rather than failing: a state that will not hold still is not
	 * a readiness defect, and the frame still carries the state it declares. Those
	 * cells are COUNTED (`settledRetakes`, printed with the run's summary) so the retry
	 * is visible rather than silent, the way a transient screenshot retry already is.
	 */
	const settleSuffix = cell.consecutive ? "-settled" : "";
	shots.push(await stamp(settleSuffix));
	let fingerprint = fingerprintOf(reading);
	let retakes = 0;
	for (;;) {
		reading = await readState();
		const next = fingerprintOf(reading);
		if (next === fingerprint) break;
		fingerprint = next;
		retakes += 1;
		if (retakes >= SETTLED_UNIT_TAKES) break;
		shots[shots.length - 1] = await stamp(settleSuffix);
	}
	if (retakes > 0) settledRetakes += 1;
	issues = verdictOf(reading);
	const readiness = reading.readiness;
	const contentDigest = reading.content;
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
		contentDigest,
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
 * A relay call the cell depends on, under the cell's own bound.
 *
 * The pin and the two request counts are the only `fetch`es in the cell loop, and they
 * used to sit OUTSIDE `withDeadline`: a relay that died mid-run threw `fetch failed`
 * straight through the loop, so the run ended with a stack trace and NO manifest at all —
 * the shape W6 removed for a cell whose PAGE hangs, left standing for a cell whose RELAY
 * goes away (QA round 1 reproduced it on this head and on `origin/main` by killing the
 * relay mid-run). The failure is returned as a value so the caller can account for the
 * cell by name instead of the run by crash.
 */
async function relayStep<T>(
	run: () => Promise<T>,
	ms: number,
	what: string,
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
	const result = await withDeadline(run(), ms, what);
	if (result.ok) return result;
	// Say what was OBSERVED rather than what it probably means: this path covers a
	// relay that accepted and never answered as well as one that is gone, and the two
	// want different fixes (a hung relay is not a departed one).
	return { ok: false, reason: `the relay did not answer: ${result.reason}` };
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
	/**
	 * The colour scheme the RENDERER resolved (`matchMedia('(prefers-color-scheme: dark)')`),
	 * not the one the cell asked for — the two differ when the emulation was not applied.
	 */
	resolvedColorScheme?: string | null;
	rootBackground?: string | null;
	rootFontSize?: string | null;
	documentScrollWidth?: number;
	documentClientWidth?: number;
	bodyScrollWidth?: number;
	textNodeCount?: number;
	medianTextHeight?: number | null;
	/**
	 * Every distinct text size the page rendered, with how many text nodes carried
	 * it. The scale guard turns these into ROLES by dividing by `rootFontSizePx`.
	 *
	 * A histogram rather than a second median on purpose: a median is a total, so a
	 * single role that did not scale hides behind a body-dominated middle, and a
	 * role that STARTS scaling (the correct fix) drags the median while every role
	 * grew correctly. Judging each role against its own 100 % counterpart needs the
	 * sizes, not their middle.
	 */
	textRoleSizes?: Array<{ px: number; count: number }> | null;
	/** The root font size in px the page rendered under — the divisor that turns an
	 * absolute size into the scale-invariant role. */
	rootFontSizePx?: number | null;
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
		resolvedColorScheme: text("resolvedColorScheme"),
		rootBackground: text("rootBackground"),
		rootFontSize: text("rootFontSize"),
		documentScrollWidth: count("documentScrollWidth"),
		documentClientWidth: count("documentClientWidth"),
		bodyScrollWidth: count("bodyScrollWidth"),
		textNodeCount: count("textNodeCount"),
		medianTextHeight:
			typeof bag.medianTextHeight === "number" ? bag.medianTextHeight : null,
		textRoleSizes: Array.isArray(bag.textRoleSizes)
			? bag.textRoleSizes
					.map((entry) => {
						const row =
							typeof entry === "object" && entry !== null
								? (entry as Record<string, unknown>)
								: {};
						return { px: Number(row.px), count: Number(row.count) };
					})
					.filter(
						(row) =>
							Number.isFinite(row.px) &&
							row.px > 0 &&
							Number.isFinite(row.count) &&
							row.count > 0,
					)
			: null,
		rootFontSizePx:
			typeof bag.rootFontSizePx === "number" && bag.rootFontSizePx > 0
				? bag.rootFontSizePx
				: null,
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

/** What `CONTENT_PROBE` reports, narrowed from the page's own reply. */
interface CellContent {
	text: string;
	labels: string;
}

function asContent(value: unknown): CellContent {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return { text: "", labels: "" };
	const bag = value as Record<string, unknown>;
	return {
		text: typeof bag.text === "string" ? bag.text : "",
		labels: typeof bag.labels === "string" ? bag.labels : "",
	};
}

/**
 * The digest the identical-frame check compares, over the CONTENT of a cell.
 *
 * Text and labels are hashed as two fields rather than concatenated so a cell whose
 * text moved into an accessibility label cannot digest the same as one that rendered it.
 * An empty reading is a digest too — two cells that both reported nothing are the same
 * content, which is the direction that keeps the check's teeth.
 */
function digestContent(content: CellContent): string {
	return createHash("sha256")
		.update(content.text)
		.update("\u0000")
		.update(content.labels)
		.digest("hex")
		.slice(0, 16);
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

/** What the theme check found, and whether its canvas half could run at all. */
interface ThemeCheckReport {
	/** One entry per problem, as the summary and the strict gate read them. */
	problems: string[];
	/** Frames whose canvas was compared against the token's. */
	canvasCompared: number;
	/** Frames that had no token canvas to be compared against. */
	canvasUncompared: number;
	/** Why the canvas half did not cover every frame, or `null` when it did. */
	canvasReason: string | null;
}

/** Compare each frame's claimed theme against the token canvas and its twin. */
function verifyThemes(
	records: CaptureRecord[],
	tokens: CanvasTokens,
): ThemeCheckReport {
	const problems = [];
	let canvasCompared = 0;
	let canvasUncompared = 0;
	/** The themes the tokens left without a canvas, so the report can name them. */
	const themesWithoutCanvas = new Set<string>();
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
			const expected = tokens.perTheme?.[theme]?.canvas ?? null;
			// Counted, not inferred later: `canvasMatchesToken` is `null` both when the
			// comparison ran and agreed and when it never ran at all, and the summary must
			// not read the second as the first. The test is `canvasComparable` — the SAME one
			// the verdict below uses, never a second test of its own: an empty-string token
			// counted as compared here while the verdict skipped it is how the all-clear got
			// printed over zero comparisons.
			if (!canvasComparable(expected)) {
				canvasUncompared += 1;
				themesWithoutCanvas.add(theme);
			} else {
				canvasCompared += 1;
			}
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
				canvasMatchesToken: canvasComparable(expected)
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
			/*
			 * The scheme the RENDERER resolved, which `reported.theme` above is not: the pre-paint
			 * probe resolves THAT from the `lo-theme` query first, so it reports what the harness
			 * ASKED for. `Emulation.setEmulatedMedia` is a separate CDP call, and the app's
			 * preference is `system`, so a driver that passes the query without the emulation
			 * renders the other scheme while `themeSource` still reads `query` — the parity lane
			 * caught exactly that and re-ran its frames. Refuse the cell by name instead (the same
			 * way a cell whose state marker never arrived is refused) rather than let a light cell
			 * pass as evidence while its frame is a dark twin of the dark cell's.
			 */
			const scheme = record.measurements?.resolvedColorScheme ?? null;
			record.themeCheck.resolvedColorScheme = scheme;
			if (record.measurements !== null && scheme !== theme) {
				record.themeApplied = false;
				note(
					scheme === null
						? `the page reported no resolved colour scheme, so nothing shows this frame rendered '${theme}'`
						: `the cell asks for '${theme}' but the page resolved prefers-color-scheme '${scheme}': the theme query was applied but the scheme the app reads was not, so this frame is not evidence for '${theme}'`,
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
	return {
		problems,
		canvasCompared,
		canvasUncompared,
		// A reason is carried whenever the canvas half could not run at all, and whenever
		// it ran but left frames uncompared. Only `null` — every frame compared — lets the
		// summary claim that every frame's canvas matches its cell.
		canvasReason:
			tokens.reason ??
			(canvasUncompared === 0
				? null
				: `the tokens carry no canvas for ${[...themesWithoutCanvas].sort().join(" / ")}`),
	};
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
	 * A digest of what the cell is SHOWING, read without the viewport (`CONTENT_PROBE`):
	 * the screen reader's view of it. It is the second opinion the identical-frame check
	 * asks for before it calls two byte-identical frames a collapse — see
	 * `IDENTICAL_FRAME_EXEMPTIONS`, and `IDENTICAL_FRAME_COINCIDENCES` for the composed
	 * case where the content is allowed to agree.
	 */
	contentDigest: string;
	/**
	 * Set when the cell's state is a DECLARED SKIP: the app declares no marker for it
	 * AND `matrix.ts` `PENDING_CELLS` names the dependency it waits on. A skipped cell
	 * is NOT evidence and NOT a finding: it is excluded from `notMeasurableCells` and
	 * reported with its owner. Its own `readinessProblems` are still recorded, so the
	 * per-cell detail is not lost — it is only not counted as a measurement gap.
	 */
	declaredSkip: { cell: string; owner: string; reason: string } | null;
	/**
	 * The relay scenario this cell's state comes from (the first scenario whose `shows`
	 * declares it), or null for a cell no scenario declares (an ad-hoc `path:` page).
	 *
	 * Recorded because the mock relay holds ONE scenario at a time: the audit re-drives
	 * this cell and must pin the same one, or it renders the state the PREVIOUS cell left
	 * behind and measures that under this cell's name.
	 */
	pinnedScenario?: string | null;
	consoleErrors: string[];
	/**
	 * Whether the text-scale dimension was LIVE for this frame's cell, and — on the
	 * 200 % frame only — the roles that failed. `null` means the run did not capture
	 * both scales for this key, so the frame cannot answer a large-text question
	 * either way — which is a different statement from "measured at 100 %".
	 *
	 * `scaleProblems` replaces the single `scaleRatio` the guard used to record: a
	 * ratio was the reading of one number (the cell median), and the judgement is now
	 * made role by role, so what a reader needs is which roles failed, not a middle.
	 * The judgement is a fact about the PAIR, which is why `scaleLive` is on both
	 * frames, but its evidence is about the 200 % frame, which is why the problems and
	 * the notes are on that one alone.
	 */
	scaleLive?: boolean | null;
	scaleProblems?: string[] | null;
	/** Sizes the 200 % frame showed and the 100 % frame did not — reported, never a
	 * failure by itself, and carried on the 200 % frame for the same reason as
	 * `scaleProblems`. See `judgeTextScale` for why the two frames cannot tell a
	 * frozen node from a size a layout introduces or resizes to at the larger scale. */
	scaleNotes?: string[] | null;
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
	/*
	 * A REFUSAL IN THE PRE-FLIGHT ALSO ACCOUNTS FOR ITSELF.
	 *
	 * `relayState` is bounded now, so a relay that accepts and never answers refuses in one
	 * bound instead of hanging until the job is killed — but it refused with NOTHING written,
	 * which is the same "the run left no account of itself" shape the cell path was fixed
	 * for. A refusal is a fact about the run, so it goes into the manifest the job uploads:
	 * `records` is empty because no cell was planned, and `meta.preflightRefusal` names the
	 * reason. The error is re-thrown, so the exit code is still a refusal — the file is a
	 * record, not a recovery.
	 */
	/*
	 * A REFUSAL THAT STOPS THE RUN STILL ACCOUNTS FOR ITSELF.
	 *
	 * Three things can stop a capture before any cell is planned or captured: a relay
	 * that does not answer the pre-flight, a relay that declares no cells, and a browser
	 * that cannot open a page. All three used to `throw` with NOTHING written, which is
	 * the same "the run left no account of itself" shape the cell path and the relay path
	 * were fixed for — QA round 4 hit it at startup: `Target.createTarget did not answer
	 * within 30000 ms`, rc 1, no manifest. So each one records a manifest naming itself
	 * and then throws, which keeps the exit code a refusal and gives the job something to
	 * upload.
	 *
	 * `phase` is where it stopped, because the three want different fixes and a reader of
	 * the artifact should not have to infer which one happened.
	 */
	const refuse = (phase: string, reason: string): void => {
		writeFileSync(
			join(outDir, "manifest.json"),
			`${JSON.stringify(
				{
					meta: {
						refused: true,
						refusedAt: phase,
						refusal: reason,
						buildDir: resolve(options.dir),
						relay: options.relay ?? null,
						out: outDir,
					},
					themeProblems: [],
					readinessProblems: [
						`the run refused to start at ${phase}: ${reason}`,
					],
					abandonedCells: [],
					identicalStates: [],
					identicalStateUndeclared: [],
					identicalStateExemptions: [],
					identicalStateCoincidences: [],
					records: [],
				},
				null,
				2,
			)}
`,
		);
	};
	let state: RelayStateReply | null;
	try {
		state = await relayState(options.relay, options.cellTimeoutMs);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		refuse("the relay pre-flight", reason);
		throw error;
	}
	if (state !== null && state.cells.length === 0) {
		const reason =
			`the mock relay at ${options.relay} declares no cells: /__mock/scenarios returned no ` +
			"scenario with a `shows` list, so there is nothing to capture";
		refuse("the plan", reason);
		throw new Error(reason);
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
	 * run failed: 900 s against the 910-cell plan the `core` default held at the time,
	 * reported only when it fired.
	 */
	const budgetMs = derivedDeadlineMs(plan.length);
	const deadlineMs = options.deadlineMs ?? budgetMs;

	/*
	 * THE PLAN'S DEVICE SET — what this run INTENDS to cover, printed beside the plan it
	 * belongs to. The tier selects a SAMPLE of the declared device matrix (the per-push
	 * job's `ci` is 2 of 19 profiles), and a run that printed only its `devices:` list read
	 * as "the app is fine" over an assertion about two viewports.
	 *
	 * It is the INTENT, not the coverage claim. The claim is computed from the RECORDS after
	 * the loop, because a run handed fewer frames than it planned — a fired `--deadline`, a
	 * cell that never settled — must not go on claiming the plan: `--devices
	 * iphone-se,tablet-landscape --deadline 1` captured 1 of its 2 cells and still said
	 * "2 of 19 declared profiles captured", which is this PR's own defect in the field it
	 * adds. Both lists are read from `matrix.ts` (what is declared), so neither can drift
	 * from it.
	 */
	const plannedCoverage = deviceCoverage([
		...new Set(plan.map((c) => c.device)),
	]);

	console.log(
		`capture plan: ${plan.length} cells × ${framesPerCell} frame(s) = ${plannedFrames} frames`,
	);
	console.log(
		`  screens: ${[...new Set(plan.map((c) => c.screen))].sort().join(", ")}`,
	);
	console.log(
		plannedCoverage.notCaptured.length === 0
			? `  devices planned: all ${plannedCoverage.declared.length} declared profiles (${plannedCoverage.captured.join(", ")})`
			: `  devices planned: ${plannedCoverage.captured.join(", ")} — ` +
					`${plannedCoverage.captured.length} of ${plannedCoverage.declared.length} declared profiles, ` +
					`the other ${plannedCoverage.notCaptured.length} not in this run's plan`,
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
	// BOUNDED because it is the FIRST step of the run — ahead of the plan, the browser
	// and the manifest — so a step that parks here leaves nothing on disk to say what
	// happened. What the bound reports is `serveDir`'s own throw, not the named refusal
	// the cell class gets: an occupied port still ends the run with
	// `the static server threw: listen EADDRINUSE …` and no manifest, which is right —
	// there is no plan yet, so there is no cell list to account for. It is the silent
	// version of that failure the bound removes.
	const served = await withDeadline(
		serveDir(options.dir, {
			port: options.port ?? 0,
			proxy: options.relay,
		}),
		options.cellTimeoutMs,
		"the static server",
	);
	if (!served.ok) throw new Error(served.reason);
	const server = served.value;
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
	/*
	 * BOUNDED, with a floor above `launchChrome`'s own 30 s wait for the port file: a
	 * browser that starts far enough to be connected to and then never answers a CDP call
	 * hangs HERE, before the two `chrome.page()` sites get a chance — measured with a stub
	 * that writes `DevToolsActivePort` and then accepts and never replies: the run sat for
	 * 180 s and wrote nothing. Bounding the launch turns that into the same named refusal
	 * as the rest of this class.
	 */
	const launched = await withDeadline(
		launchChrome({ profile: options.profile }),
		Math.max(45_000, options.cellTimeoutMs),
		"the browser's debug port",
	);
	if (!launched.ok) {
		const reason = `no browser came up: ${launched.reason}`;
		refuse("the browser", reason);
		throw new Error(reason);
	}
	const chrome = launched.value;
	/*
	 * Declared here, assigned INSIDE the run's own `try` below. A `--tokens` path that is a
	 * directory or malformed JSON throws from `canvasTokens` (`readFileSync` / `JSON.parse`),
	 * and this read used to sit between `launchChrome` and the `try` — so the throw escaped
	 * before the `finally` and leaked the Chrome instance this run had just started (found by
	 * QA). Inside the `try`, the `finally` closes the browser and the static server before the
	 * error propagates, so a crash cannot leave either behind.
	 */
	let tokens: CanvasTokens;
	const records: CaptureRecord[] = [];
	screenshotRetries = 0;
	settledRetakes = 0;
	let reaped: Awaited<ReturnType<typeof chrome.close>> | null = null;
	/** Cells that produced no frame, and why — never a silent skip. */
	const abandoned: Array<{ cell: string; reason: string }> = [...unrenderable];
	const startedAt = Date.now();
	let index = 0;

	try {
		tokens = canvasTokens(options.tokens);
		/*
		 * EVERY CELL OPENS ITS OWN TARGET — see `freshPage` for why a reused one
		 * eventually cannot commit a navigation at all. There is deliberately no
		 * separate "first target" step: the first cell's recycle closes nothing and
		 * opens a page exactly as every later cell does, so the loop has one shape and
		 * a wedged cell needs no recovery path of its own.
		 */
		let page: CdpPage | null = null;

		for (const cell of plan) {
			index += 1;
			/* One abandonment path, so every reason a cell has no frame is recorded and printed
			 * the same way. */
			const abandonCell = (reason: string): void => {
				abandoned.push({ cell: cell.cell, reason });
				console.log(
					`[${index}/${plan.length}] ${cell.cell} on ${cell.device} — FAILED: ${reason}`,
				);
			};
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
			/*
			 * A target that has never held a stream, for this cell. A browser that has
			 * stopped answering is a NAMED refusal rather than a throw: the rest of the
			 * plan is abandoned BY NAME and the loop breaks, so the run still writes a
			 * manifest that accounts for every cell it did not capture.
			 */
			const fresh = await freshPage(chrome, page, options.cellTimeoutMs);
			if (!fresh.ok) {
				for (const rest of plan.slice(index - 1))
					abandoned.push({ cell: rest.cell, reason: fresh.reason });
				console.log(
					`  ${fresh.reason} — the ${plan.length - index + 1} cell(s) left are BLOCKED`,
				);
				break;
			}
			page = fresh.page;
			// Pin the relay to this cell's state before rendering it, and count what the
			// relay serves while it renders. A registry-declared cell whose requests
			// did not grow is a cell the app rendered without asking the relay for
			// anything — which is exactly the "passed while showing the wrong state"
			// case, so it is a readiness failure rather than a green frame.
			let relayReach: RelayReach | null = null;
			const registryBacked =
				options.relay !== undefined &&
				Object.hasOwn(state?.cellScenarios ?? {}, cell.cell);
			const relay = options.relay;
			/*
			 * The scenario that serves this cell, kept so the RECORD carries it.
			 *
			 * The mock relay holds ONE scenario at a time, so a cell's state is a fact about
			 * the pin as much as about the URL: the audit re-drives these cells later, and a
			 * re-drive that does not put the relay back into this scenario renders whatever the
			 * previous cell left behind — a state the cell does not name, measured under its
			 * name. See `tools/audit/audit.ts`.
			 */
			const cellScenario = registryBacked
				? (state?.cellScenarios?.[cell.cell]?.[0] ?? null)
				: null;
			if (cellScenario !== null && relay !== undefined) {
				// Bounded like the cell itself: a pin whose relay is gone abandons THIS cell.
				const pinned = await relayStep(
					() => selectScenario(relay, cellScenario),
					options.cellTimeoutMs,
					`pinning ${cellScenario} for ${cell.cell}`,
				);
				if (!pinned.ok) {
					abandonCell(pinned.reason);
					continue;
				}
			}
			const countBefore = await relayStep(
				() =>
					relay === undefined
						? Promise.resolve(null)
						: relayRequestCount(relay),
				options.cellTimeoutMs,
				`reading the relay's request count for ${cell.cell}`,
			);
			if (!countBefore.ok) {
				abandonCell(countBefore.reason);
				continue;
			}
			const requestsBefore = countBefore.value;

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
				abandonCell(attempted.reason);
				// The next cell opens its own target, so a page left wedged with a live
				// stream is closed by that recycle rather than inherited here.
				continue;
			}
			const record = attempted.value;
			// The scenario travels WITH the cell, for the same reason the seed travels with
			// the run (see `meta.seed`): the audit re-drives this URL, and the relay has to be
			// back in the state the cell names before it does.
			record.pinnedScenario = cellScenario;
			if (relay !== undefined) {
				/* Bounded for the same reason as the count before it, and here the frame is already
				 * captured: a relay that dies now costs this cell its REACH fact (`null` already means
				 * "could not count", and the fact is resolved as unreached for a registry cell) rather
				 * than the whole run its manifest. */
				const countAfter = await relayStep(
					() => relayRequestCount(relay),
					options.cellTimeoutMs,
					`reading the relay's request count after ${cell.cell}`,
				);
				const requestsAfter = countAfter.ok ? countAfter.value : null;
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
				: "") +
			(settledRetakes > 0
				? `, ${settledRetakes} cell(s) whose settled frame was retaken to agree with its readings`
				: ""),
	);

	const themeReport = verifyThemes(records, tokens);
	const themeProblems = themeReport.problems;
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
	// and still produce a full matrix of confident rows. A run-level verdict hides
	// exactly that case, because one responsive screen lifts it while another
	// screen's cell is inert. So each pair is judged on its own, and an inert cell
	// is FAILED BY NAME rather than averaged away.
	const judgedByKey = new Map(
		(scaleCheck.perCell ?? []).map((entry) => [entry.key, entry]),
	);
	for (const record of records) {
		const key = `${record.screen}__${record.state}__${record.device}__${record.theme}`;
		const judged = judgedByKey.get(key);
		record.scaleLive = judged?.live ?? null;
		// The judgement is ABOUT the 200 % frame, so the problems and the notes are
		// attached to IT and not to its 100 % sibling: a note that reads "… at 200 % …"
		// on the 100 % record tells a manifest reader the wrong frame (CI measured one
		// note per pair landing on 192 records, both frames of each of 96 pairs).
		record.scaleProblems =
			record.scale === "200" ? (judged?.problems ?? null) : null;
		record.scaleNotes = record.scale === "200" ? (judged?.notes ?? null) : null;
		if (record.scale === "200" && judged !== undefined && !judged.live) {
			record.readinessProblems = [
				...record.readinessProblems,
				`the text did not scale with the root font size: ${judged.problems.join("; ")} — ` +
					"every type role must grow by the cell's own factor, so this cell cannot " +
					"answer a large-text question",
			];
			record.ready = false;
		}
	}

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
	const {
		collapses: identicalCells,
		undeclared: identicalUndeclared,
		exemptions: identicalExemptions,
		coincidences: identicalCoincidences,
	} = findIdenticalFrames(records);

	// The manifest is what the audit and the gallery both read, so it carries the
	// facts each of them needs by name rather than a shape they must infer.
	/*
	 * WHAT THIS RUN CAPTURED, IN ITS OWN WORDS — from the RECORDS, i.e. from the frames that
	 * exist, never from the plan. A record is pushed for every cell the loop reached, and a
	 * cell that produced no frame is in `abandoned` instead, so filtering on `frames.length`
	 * makes the claim describe the evidence a reader can actually open. A profile the plan
	 * named whose cells all died (or died before their first frame) is therefore NOT captured,
	 * and the shortfall is stated rather than absorbed.
	 */
	const coverage = deviceCoverage([
		...new Set(
			records.filter((record) => record.frames.length > 0).map((r) => r.device),
		),
	]);
	/**
	 * WHAT THE RUN CAPTURED — from the RECORDS, i.e. from the frames that exist, and never
	 * from the plan. `plan.length - unrenderable.length` was a plan-derived number wearing a
	 * captured name: a run whose deadline fired before the first cell reported
	 * `cellsCaptured: 330` in its manifest while its own console said `captured 0 cells`.
	 * Nothing read the field, which is exactly how such a number waits to be trusted.
	 *
	 * It is the ONLY count of them, and the filter is the claim's own definition — a cell is
	 * captured when there is a frame to open — rather than `records.length`. There is no
	 * "attempted" field and no separate frame total, because both would be names for this one:
	 * `captureCell` either throws (the cell then being named in `abandonedCells` with its
	 * reason) or returns having pushed at least one frame, `records.push` is the only record
	 * site, and a settled-frame retake REPLACES its frame — so reached and captured are the
	 * same cells, and the frames are `cellsCaptured x framesPerCell`. A field, or a sentence,
	 * for a state that cannot occur is how the next reader learns something false.
	 */
	const cellsCaptured = records.filter(
		(record) => record.frames.length > 0,
	).length;
	/** Profiles the plan named that produced no frame at all — the gap the claim must show. */
	const plannedWithoutFrames = plannedCoverage.captured.filter(
		(device) => !coverage.captured.includes(device),
	);

	const summary = {
		meta: {
			generatedAt: new Date().toISOString(),
			capturedAt: new Date().toISOString(),
			durationMs: Date.now() - startedAt,
			buildDir: resolve(options.dir),
			repoRoot: resolve(new URL("../../", import.meta.url).pathname),
			relay: options.relay ?? null,
			scenario: state?.scenario ?? null,
			/*
			 * THE SEED, AS THIS RUN APPLIED IT, because the audit re-drives these cells and
			 * must put the SAME parameters back on the page.
			 *
			 * It is RUN-WIDE and lives in `meta` for that reason: `seed` is computed once
			 * above the loop and handed to every cell, so a per-cell copy would carry one
			 * fact in two hundred places and let them disagree. The audit's `cellQuery()`
			 * rebuilt each cell's URL from the theme/scale/insets fields and never carried
			 * `lo-relay*`, so a relay-backed cell whose state exists only BECAUSE the app
			 * was pointed at a relay was re-driven against an unseeded app and measured as
			 * its own fallback screen — the vacuous green this record removes.
			 *
			 * `origin` is what makes `route` usable by a re-drive: the default seed route is
			 * THIS run's own origin, and the audit serves the same build on its own port, so
			 * it must re-derive that route rather than reuse a dead one. An explicit
			 * `--seed-route` names some other origin and is kept verbatim.
			 */
			seed: {
				applied: seed.route !== null,
				password: seed.password,
				route: seed.route,
				origin: server.url,
			},
			plannedFrames,
			framesPerCell,
			tier: options.tier,
			cellsPlanned: plan.length,
			cellsCaptured,
			cellTimeoutMs: options.cellTimeoutMs,
			deadlineMs,
			devicesCaptured: options.devices,
			/**
			 * The device bound, by name, in the artifact: what the RUN CAPTURED out of the profiles
			 * `matrix.ts` declares, and what it did not. It is computed from the records' frames,
			 * so a run that captured fewer frames than it planned does not claim the plan here;
			 * `devicePlanned` below carries the intent separately, so a reader can tell a shortfall
			 * from a narrow `--devices`.
			 */
			deviceCoverage: coverage,
			deviceCoverageNote: describeDeviceCoverage(coverage),
			devicePlanned: plannedCoverage.captured,
			// `perTheme` is written as-is: this field's shape is unchanged, so nothing that
			// reads the manifest moves under a fix about reporting.
			themeTokens: tokens.perTheme,
			textScaleVerdict: scaleCheck.verdict,
			textScaleLive: scaleCheck.live === true,
			// The teardown reading, in the artifact as well as on stdout: a run that left
			// processes is visible without re-reading a terminal.
			teardown: {
				survivors: reaped?.survivors ?? null,
				orphansReaped: reaped?.sweep?.swept.length ?? 0,
				liveOwnersSkipped: reaped?.sweep?.skipped.length ?? 0,
				screenshotRetries,
				settledRetakes,
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
		/**
		 * Byte-identical frames whose declared states differ, whose content differs too, and
		 * which nothing has declared: a camera limit nobody has signed for. Blocking, and
		 * listed apart from the collapses so the manifest's own wording matches what was
		 * measured.
		 */
		identicalStateUndeclared: identicalUndeclared,
		/**
		 * Byte-identical frames whose declared states differ in CONTENT: a limit of the
		 * camera (the differing content is below the fold), declared by name in
		 * `IDENTICAL_FRAME_EXEMPTIONS` with its reason. Reported, never failing — and only
		 * reachable for a pair that IS declared, so this list cannot grow quietly.
		 */
		identicalStateExemptions: identicalExemptions,
		/**
		 * Byte-identical frames whose declared states a device composes into ONE view
		 * (`IDENTICAL_FRAME_COINCIDENCES`): here the same bytes AND the same content are
		 * the correct rendering — every cell reaches its own root and marker inside the
		 * one view. Reported, never failing, and only reachable for a pair the matrix
		 * declares with its reason.
		 */
		identicalStateCoincidences: identicalCoincidences,
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
		`captured ${cellsCaptured} cells / ${cellsCaptured * framesPerCell} frames in ` +
			`${(summary.meta.durationMs / 1000).toFixed(1)} s`,
	);
	// The bound, restated where the run's verdict is read: the frames above are a sample of
	// the declared matrix, and which part of it is missing is a fact about this run rather
	// than something a reader has to infer from the plan it no longer has in front of them.
	console.log(describeDeviceCoverage(coverage));
	if (plannedWithoutFrames.length > 0) {
		// The plan and the claim disagree, so say so where the claim is read: this is the
		// sentence that used to overstate the run.
		console.log(
			`  the plan named ${plannedCoverage.captured.length} profile(s) (${plannedCoverage.captured.join(", ")}); ` +
				`${plannedWithoutFrames.join(", ")} produced no frame in this run`,
		);
	}
	console.log(`frames that changed after first paint: ${reflow.length}`);
	console.log(`text-scale dimension: ${scaleCheck.verdict}`);
	if (scaleCheck.notedPairs > 0) {
		// "Reported as such rather than silently counted": a size only the 200 % frame
		// shows is named here, and each pair carries its own `notes` in the manifest.
		// It is NOT a failure — see `judgeTextScale` for why two frames cannot tell a
		// frozen node from a size the layout introduces at this scale.
		console.log(
			`  text-scale notes: ${scaleCheck.notedPairs} pair(s) show a size only at 200% — ` +
				"a node that did not move with the root font size, or a layout that introduced it " +
				"at this scale; named, not failed",
		);
	}
	if (themeProblems.length) {
		console.log(`THEME PROBLEMS (${themeProblems.length}):`);
		for (const problem of themeProblems) console.log(`  - ${problem}`);
	} else if (themeReport.canvasReason === null) {
		console.log(
			"theme problems: none — every frame's resolved theme and canvas match its cell, and no dark/light pair is identical",
		);
	}
	// The theme check has two halves, and only the first can run without tokens: the
	// theme the page RESOLVED, and the canvas it painted against the design token for
	// that theme. When the second half cannot be made, printing nothing would leave the
	// run's silence to be read as a pass — the shape `UNREADY CELLS` and `CELLS WITH NO
	// FRAME` below exist to refuse. So the skip is NAMED, with how much of the matrix
	// went uncompared and what the comparison needs, the way `tools/mock-relay/verify.ts`
	// names a check the environment cannot run. It is a report, not a failure: absent
	// tokens never failed a run here, and a canvas that IS compared and disagrees still
	// lands in `THEME PROBLEMS` and still fails. The sentence above is deliberately NOT
	// printed in this branch — it claims every frame's canvas "match[es]" its cell, which
	// for an uncompared frame is a measurement nobody made.
	if (themeReport.canvasReason !== null) {
		// `canvasUncompared`/`canvasCompared` count RECORDS — cells, not frames. Call them
		// that: the same page's own `N of M cell(s)` is what this line has to agree with, and
		// a `--consecutive` run has three frames per cell, so `frame(s)` here was wrong by a
		// factor of three on exactly the runs whose frame count is largest.
		console.log(
			`THEME CHECK INCOMPLETE (${themeReport.canvasUncompared} of ${themeReport.canvasUncompared + themeReport.canvasCompared} cell(s) uncompared) — the canvas-vs-token half did NOT run for those cells:`,
		);
		console.log(`  - ${themeReport.canvasReason}`);
		console.log(
			"  - the comparison needs a canvas per theme in a tokens file: pass `--tokens <path>` to run it",
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
			`IDENTICAL STATES (${identicalCells.length}): cells that declare different states produced the same bytes AND the same content`,
		);
		for (const entry of identicalCells) console.log(`  - ${entry}`);
	}
	if (identicalUndeclared.length) {
		console.log(
			`UNDECLARED IDENTICAL FRAMES (${identicalUndeclared.length}): the same bytes with DIFFERENT content — a camera limit, and one nothing has declared as a camera limit`,
		);
		for (const entry of identicalUndeclared) console.log(`  - ${entry}`);
	}
	if (identicalExemptions.length) {
		console.log(
			`EXEMPT IDENTICAL FRAMES (${identicalExemptions.length}): byte-identical frames whose declared states DIFFER in content, each declared in matrix.ts IDENTICAL_FRAME_EXEMPTIONS — a limit of the camera, not a collapse`,
		);
		for (const entry of identicalExemptions) console.log(`  - ${entry}`);
	}
	if (identicalCoincidences.length) {
		console.log(
			`ONE VIEW, TWO STATES (${identicalCoincidences.length}): byte-identical frames whose cells the app composes into one view at that device, each declared in matrix.ts IDENTICAL_FRAME_COINCIDENCES — every cell still reaches its own root and marker`,
		);
		for (const entry of identicalCoincidences) console.log(`  - ${entry}`);
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
		identicalUndeclared.length +
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
				`${identicalCells.length} identical-state collapse(s), ${identicalUndeclared.length} undeclared identical-state pair(s), ${abandoned.length} cell(s) with no frame, ` +
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
 * dimension silently does nothing produces identical frames at both scales and
 * looks like a pass. This compares the text a cell renders at 200 % against the
 * same text at 100 %, PER TYPE ROLE, and fails the cell by name when a role did
 * not grow by the factor the cell declares.
 *
 * TWO PRECONDITIONS, CHECKED BEFORE ANY SIZE IS COMPARED, because every size below is a
 * fraction of the frame's OWN root: the 200 % root must be the declared factor's
 * multiple of the 100 % root (a page pinning `font-size: … !important` renders both
 * frames at 100 %, and judged against itself that pair reads live — which is the defeat
 * this guard exists to catch), and only text that RENDERS counts as a role (`display:
 * none`, and an inline `<script>`'s source text, report a font size without painting
 * one). Both are asserted rather than assumed — see `judgeTextScale`.
 *
 * WHY PER ROLE AND NOT A MEDIAN OVER THE CELL.
 *
 * The first version reduced a cell to the median rendered text box at each scale
 * and required the ratio to clear 1.9. A median is a property of the cell's
 * COMPOSITION as much as of its scaling: when a node that rendered at a fixed size
 * starts following the scale — the correct fix for a missing type role — the mix of
 * sizes changes, the median moves, and the ratio can FALL below the bar while every
 * role scaled exactly 2x. That is the app getting better and the metric getting
 * worse, measured on `S15/loading__tablet-landscape__200`: fifteen text nodes, all
 * scaling exactly 2x, whose median fell from 2.00x to 1.852x once the composer's
 * `＋` and `Connect a computer` were given their type roles. The same total hides
 * one inert role behind a body-dominated middle.
 *
 * A ROLE IS THE TEXT'S SIZE RELATIVE TO THE ROOT. The harness drives the root font
 * size, so a role that follows it has the SAME size-in-rem at both scales and only
 * its px size doubles; a role that ignores it (authored in px, or a fixed default)
 * keeps its px size and so changes rem. Keying on the rem size is therefore the
 * composition-insensitive identity, and "present at 200 %" already means "grew by the
 * cell's factor". A cell is live when every role the 100 % frame rendered is present
 * in the 200 % frame; a size the 200 % frame shows that no 100 % role explains is
 * NAMED in `notes`, never counted toward the verdict.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Node COUNTS are not compared (see
 * `judgeTextScale`: a layout may add or drop a node carrying a role that scaled), and
 * a 100 % role with no scaled counterpart is a note rather than a failure, because two
 * frames cannot tell a node frozen at a coinciding size from one the layout drops or
 * resizes at the larger scale. What the guard still fails is a ROLE that did not
 * scale: a page whose body copy never grows, a hardcoded px heading beside rem
 * paragraphs, a wholly px page.
 *
 * THAT CONCESSION IS THE COMMON CASE, NOT A CORNER. Measured on this harness's own
 * `ci` capture: 96 of 136 pairs carry such a note (every one naming a 14 px node) and
 * all 136 read live — so a live tier run says every ROLE grew, never that no text is
 * frozen. The rubric (`docs/ux/audit-rubric.md`) and the e2e README carry the same
 * number and the same reading, so neither tells a softer story than the check.
 */
function verifyTextScale(records: CaptureRecord[]) {
	const perDevice = new Map();
	for (const record of records) {
		const key = `${record.screen}__${record.state}__${record.device}__${record.theme}`;
		const bucket = perDevice.get(key) ?? {};
		bucket[record.scale] = roleReading(record);
		perDevice.set(key, bucket);
	}
	const perCell = [];
	for (const [key, bucket] of perDevice) {
		const at100 = bucket["100"];
		const at200 = bucket["200"];
		// A pair with no roles on either side (no text, or a frame from before this
		// probe) is NOT a live dimension: it is left out so the run reports the pair as
		// missing coverage rather than as passed.
		if (at100?.histogram.size && at200?.histogram.size) {
			perCell.push(
				judgeTextScale(
					key,
					at100.histogram,
					at200.histogram,
					at100.rootPx,
					at200.rootPx,
				),
			);
		}
	}
	perCell.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	if (perCell.length === 0) {
		// Nothing to conclude, and `live` stays false so no large-text verdict can
		// be drawn from a run that only ever rendered one scale.
		return {
			verdict: "not measured (needs both 100% and 200% in one run)",
			perCell: [],
			notedPairs: 0,
			live: false,
		};
	}
	const inertCells = perCell.filter((entry) => !entry.live);
	const notedCells = perCell.filter((entry) => entry.notes.length > 0);
	return {
		expected: 2,
		live: inertCells.length === 0,
		perCell,
		/**
		 * Pairs with a role the 100 % frame did not have: a size the 200 % frame shows
		 * that no 100 % role explains. Reported, never failing — see `judgeTextScale`.
		 * Carried here as a count so the run can say it out loud instead of burying it
		 * in `perCell`, because "reported as such" is the whole point of keeping the
		 * signal: a frozen node named, not a cell failed for it.
		 */
		notedPairs: notedCells.length,
		verdict:
			inertCells.length === 0
				? `scale dimension is live across ${perCell.length}/${perCell.length} measured pairs (every type role grew by the cell's own factor)`
				: `scale dimension is INERT on ${inertCells.length}/${perCell.length} measured pairs — a cell ` +
					"whose text did not grow by its declared factor renders at 100% under a 200% label, so any " +
					"U-04 'no clipping at 200%' result from it is meaningless",
	};
}

/**
 * A frame's text roles: each distinct `font-size / rootFontSize` with how many text
 * nodes carried it, plus the root font size they were read against.
 *
 * `null` is the "cannot tell" case, not a pass: a frame captured before this probe,
 * or one whose page never set a root font size, is left out of `perCell`, so the
 * pair shows up as missing coverage rather than as a live dimension. Returning the
 * root WITH the histogram is what lets the caller pass that root on as a number
 * rather than defaulting it at the call site — a default can never fire here (the
 * root is checked below) and only reads as if a 16 px fallback might be applied.
 */
function roleReading(
	record: CaptureRecord,
): { histogram: Map<number, number>; rootPx: number } | null {
	const sizes = record.measurements?.textRoleSizes ?? null;
	const root = record.measurements?.rootFontSizePx ?? null;
	if (!sizes || !root || root <= 0) return null;
	const histogram = new Map<number, number>();
	for (const { px, count } of sizes) {
		// Four decimals, not three: `14 / 32` is `0.4375`, and rounding that to three
		// (`0.438`) would render it as `7.01px` in a message and, worse, could merge two
		// distinct roles. The quotient is exactly equal across scales for a role that
		// follows the root, so this only has to survive the browser's own sub-pixel
		// readings, not invent a tolerance.
		const rem = Math.round((px / root) * 10000) / 10000;
		histogram.set(rem, (histogram.get(rem) ?? 0) + count);
	}
	return { histogram, rootPx: root };
}

/** One cell's per-role comparison, naming every role that did not line up. */
function judgeTextScale(
	key: string,
	at100: Map<number, number>,
	at200: Map<number, number>,
	rootPx100: number,
	rootPx200: number,
) {
	const px = (rem: number) => Math.round(rem * rootPx100 * 100) / 100;
	// THE PRECONDITION, CHECKED FIRST, because everything below divides each frame by ITS
	// OWN root. That is right only while the harness's scale input actually reached the
	// page: a page that pins its root (`html { font-size: 16px !important }` beats the
	// inline root the harness writes) renders BOTH frames at 100 %, and a frame judged
	// against itself is trivially "every role grew". That is the exact defeat this guard
	// exists to catch — and the median it replaced did catch it (1.00x, FAIL) — so the
	// root relationship is asserted here rather than assumed. A pair whose 200 % root is
	// not the declared factor cannot answer a large-text question, whatever its sizes say.
	const expectedRoot200 = rootPx100 * 2; // the declared % the guard pairs: 100 then 200
	if (Math.abs(rootPx200 - expectedRoot200) > 0.5)
		return {
			key,
			live: false,
			problems: [
				`the harness's root font size did not take effect: the 200% frame renders with a root of ${rootPx200}px against ${rootPx100}px at 100% (expecting ${expectedRoot200}px), so both frames were rendered at the same scale and this pair cannot answer a large-text question`,
			],
			notes: [],
		};
	// The whole page frozen: the 200 % frame renders the 100 % frame's sizes exactly.
	// Reported as that single fact rather than as per-role diffs, which is both
	// truer and what a reader wants first.
	if (sameSizes(at100, at200, rootPx100)) {
		return {
			key,
			live: false,
			problems: [
				`the 200% frame renders the same text sizes as the 100% frame (${[
					...at100,
				]
					.map(([rem, count]) => `${px(rem)}px x${count}`)
					.sort()
					.join(", ")})`,
			],
			notes: [],
		};
	}
	// THE TWO WAYS A ROLE CAN BE ABSENT FROM THE 200 % FRAME ARE NOT THE SAME, and the
	// guard separates them because the frames can:
	//
	//   * the role is still there at its OLD size — a node that ignored the root font
	//     size. This is a role that did not scale, and the cell FAILS on it. In rem
	//     terms that node's key halves (its px held while the root doubled), which is
	//     exactly the `rem / 2` lookup below.
	//   * the role is absent from the 200 % frame entirely — a layout that drops a label at
	//     200 %, a state that settled differently between the two frames, OR a node
	//     RESIZED to a size the factor does not produce (`calc()`/`clamp()`/an `em` under a
	//     fixed-px parent). Reported in `notes`, never failed: it is not a statement about
	//     type, and failing it would fail a correct app for its responsive design
	//     (measured: the sibling PR's own `S4/idle__tablet-landscape__dark` 100 % frame
	//     renders a 15 px `label` role its 200 % frame does not, and no scaling is wrong
	//     there). The three causes are named in the note itself, because two frames cannot
	//     tell them apart.
	//
	// NODE COUNTS ARE NOT COMPARED for the same reason: a layout may add or drop a node
	// whose role DID scale, and a count rule marked 88 of main's 272 `ci` cells UNREADY
	// on exactly that (its only frozen sizes were single 14 px nodes; every cell's roles
	// had scaled counterparts).
	const problems: string[] = [];
	const notes: string[] = [];
	// A size the 200 % frame shows is expressed in THAT frame's px, which is what a
	// reader sees in a screenshot (`px(rem) * 2`). Reporting it in the 100 % frame's
	// scale would name a size nothing renders at — a frozen 14 px node would be filed
	// as "7px text", which is the opposite of the honest reading.
	const px200 = (rem: number) => Math.round(rem * rootPx100 * 2 * 100) / 100;
	for (const [rem, count] of at100) {
		// `hasApprox` on BOTH halves of the question: the scaled lookup was exact while the
		// frozen one allowed a tolerance, so a role that scaled but whose four-decimal
		// quotient drifted was filed as absent rather than as scaled.
		if (hasApprox(at200, rem)) continue; // scaled — its 200 % px is twice its 100 % px
		if (hasApprox(at200, rem / 2))
			problems.push(
				`the ${px(rem)}px role (${count} node(s)) did not scale: the 200% frame still renders ${px(rem)}px text where ${px(rem) * 2}px was expected`,
			);
		else
			notes.push(
				`the ${px(rem)}px role (${count} node(s)) has no ${px(rem) * 2}px counterpart at 200% — a node the layout drops, or one that grew by a size the factor does not produce`,
			);
	}
	for (const [rem, count] of at200) {
		if (hasApprox(at100, rem)) continue;
		notes.push(
			`${px200(rem)}px text at 200% is not twice any 100% size (${count} node(s)) — a node that ignored the root font size, or a size the layout introduces at this scale`,
		);
	}
	problems.sort();
	notes.sort();
	return { key, live: problems.length === 0, problems, notes };
}

/** Whether `map` holds `value` within a sub-pixel tolerance of the rounding above. */
function hasApprox(map: Map<number, number>, value: number) {
	for (const candidate of map.keys())
		if (Math.abs(candidate - value) < 1e-3) return true;
	return false;
}

/**
 * Whether the 200 % frame renders the same text SIZES as the 100 % frame — the
 * whole-page inert case. Compares in px (each scale's own root), so a page whose
 * every role stayed put is recognised as one fact rather than as per-role diffs.
 */
function sameSizes(
	at100: Map<number, number>,
	at200: Map<number, number>,
	rootPx100: number,
) {
	const inPx = (histogram: Map<number, number>, root: number) => {
		const out = new Map<number, number>();
		for (const [rem, count] of histogram) {
			const size = Math.round(rem * root * 100) / 100;
			out.set(size, (out.get(size) ?? 0) + count);
		}
		return out;
	};
	const a = inPx(at100, rootPx100);
	const b = inPx(at200, rootPx100 * 2);
	if (a.size !== b.size) return false;
	for (const [size, count] of a) if (b.get(size) !== count) return false;
	return true;
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
				"                      (3000 ms/cell, floor 900 s) so a bound always holds its own plan;",
				"                      a smaller explicit bound is honoured and noted. Cells still",
				"                      unvisited when it fires are reported as having no frame",
				"  --tier <name>       the sample to capture: ci | core (default) | full.",
				"                      The matrix declares 19 device profiles; the run prints the",
				"                      share it covered, and names the profiles it did not.",
				"                        ci    2 of 19 profiles — 272 cells, both themes, scales 100",
				"                              and 200 (~10 min) — the per-push CI job's sample",
				"                        core  5 of 19 profiles — 884 cells, both themes, all",
				"                              three scales — the local default",
				"                        full  19 of 19 profiles — 3196 cells",
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
	// `CI_DEVICES`, ~10 minutes), and `--full` covers every size. `--devices`
	// overrides any of them.
	//
	// An unknown tier is an ERROR rather than a silent fall back to `core`: a typo'd
	// `--tier ci` that quietly ran 884 cells would spend ~33 minutes on a capture the
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
