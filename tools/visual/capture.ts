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
 *   node tools/visual/capture.mjs --dir <web-build> --out <frames-dir> \
 *     [--relay http://127.0.0.1:PORT] [--scenario <name>] [--cells S4/populated,...]
 *     [--devices iphone-15,...] [--themes dark,light] [--scales 100,150,200]
 *     [--consecutive] [--plan] [--yes] [--strict] [--full]
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bool, csv, num, parseArgs, str } from "../lib/args.ts";
import type { CdpPage } from "../lib/cdp.ts";
import { sleep } from "../lib/cdp.ts";
import { launchChrome } from "../lib/chrome.ts";
import { serveDir } from "../lib/static-server.ts";
import { renderGallery } from "./gallery.ts";
import {
	ALL_DEVICES,
	CORE_DEVICES,
	DEVICES,
	type DeviceProfile,
	MEASURE_PROBE,
	PRE_PAINT_PROBE,
	READINESS_PROBE,
	SCALES,
	SCREEN_ROOTS,
	SCREENS,
	THEMES,
} from "./matrix.ts";

/** Frames above this count are refused without `--yes`: a full matrix is minutes. */
const CONFIRM_THRESHOLD = 120;

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
		if (!screen)
			throw new Error(
				`unknown screen id '${screenId}' in cell '${cell}' (see matrix.mjs § SCREENS)`,
			);
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
	}: {
		baseUrl: string;
		state: RelayStateReply;
		outDir: string;
		settleMs: number;
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
		const shot = await page.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
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
	// The readiness reading: which route the app settled on and which screen
	// roots it actually rendered. This is the guard against a green matrix over
	// the wrong screen, which is exactly what the first run of this harness
	// produced before the relay was proxied.
	const readiness = asReadiness(await page.evaluate(READINESS_PROBE));
	const readinessProblems = readinessProblemsFor(cell, path, readiness);

	offConsole();
	offException();

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

	constructor(
		message: string,
		failures: {
			themeProblems: string[];
			readinessProblems: string[];
			identicalStates: string[];
		},
	) {
		super(message);
		this.name = "CaptureFailure";
		this.themeProblems = failures.themeProblems;
		this.readinessProblems = failures.readinessProblems;
		this.identicalStates = failures.identicalStates;
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
	testIds: string[];
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
		text: typeof bag.text === "string" ? bag.text : "",
		elementCount: typeof bag.elementCount === "number" ? bag.elementCount : 0,
	};
}

/**
 * Does the app's route match the path the cell asked for?
 *
 * Segment-wise, because a cell names a route pattern: `/session/{sessionId}`
 * against the app's `/session/6714def86197` is a match, and a *different* route
 * (`/sign-in`) is not — which is the failure this check exists to catch.
 */
function routeMatches(asked: string, actual: string): boolean {
	const segments = (path: string): string[] =>
		path
			.replace(/\/$/, "")
			.split("/")
			.filter((part) => part !== "");
	const wanted = segments(asked);
	const got = segments(actual);
	if (wanted.length !== got.length) return false;
	return wanted.every(
		(segment, index) => segment.startsWith("{") || segment === got[index],
	);
}

/**
 * Why a cell is not ready, in the order a reader needs to hear it.
 *
 * A missing reading is itself a failure: the probe runs in the page, so nothing
 * coming back means the frame was taken from a page the harness could not read.
 */
function readinessProblemsFor(
	cell: FramePlan,
	path: string,
	readiness: Readiness | null,
): string[] {
	if (readiness === null) return ["the page returned no readiness reading"];
	const problems: string[] = [];
	if (!routeMatches(path, readiness.path)) {
		problems.push(
			`the app is on '${readiness.path}' but the cell asked for '${path}'`,
		);
	}
	const root = SCREEN_ROOTS[cell.screen];
	if (root !== undefined && !readiness.testIds.includes(root)) {
		problems.push(
			`no '${root}' root in the DOM: the app did not render screen ${cell.screen}`,
		);
	}
	return problems;
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
	const toHex = (n) => Number(n).toString(16).padStart(2, "0");
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
 * can say which sample produced it: a core run is not a full-matrix result, and
 * a cell that was not captured is BLOCKED rather than passed.
 */
export interface CaptureOptions {
	dir: string;
	out: string;
	relay?: string | undefined;
	cells: string[];
	tier: "core" | "full";
	devices: string[];
	themes: string[];
	scales: Array<{ id: string; factor: number }>;
	consecutive: boolean;
	settleMs: number;
	tokens: string;
	plan: boolean;
	yes: boolean;
	strict: boolean;
	profile?: string | undefined;
	port: number;
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
	consoleErrors: string[];
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

	const plan = buildPlan({
		state,
		cells: options.cells,
		devices: options.devices,
		themes: options.themes,
		scales: options.scales,
		consecutive: options.consecutive,
	});
	const framesPerCell = options.consecutive ? 3 : 1;
	const plannedFrames = plan.length * framesPerCell;

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
	const chrome = await launchChrome({ profile: options.profile });
	const tokens = canvasTokens(options.tokens);
	const records: CaptureRecord[] = [];
	const startedAt = Date.now();
	let index = 0;

	try {
		const page = await chrome.page();
		await page.send("Page.enable");
		await page.send("Runtime.enable");
		await page.send("Page.addScriptToEvaluateOnNewDocument", {
			source: PRE_PAINT_PROBE,
		});

		for (const cell of plan) {
			index += 1;
			const record = await captureCell(page, cell, {
				baseUrl: server.url,
				state,
				outDir,
				settleMs: options.settleMs,
			});
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
		await chrome.close();
		await server.close();
	}

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

	// A cell that did not reach its own screen is not evidence, and a set of cells
	// that produced one identical image is the specific failure this guard exists
	// for: before the relay was proxied, five `S4` states rendered the
	// unauthenticated screen and the matrix looked complete.
	const unready = records.filter((record) => !record.ready);
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
			devicesCaptured: options.devices,
			themeTokens: tokens ?? null,
			textScaleVerdict: scaleCheck.verdict,
			textScaleLive: scaleCheck.live === true,
			deviceProfile: DEVICES,
			scaleProfile: SCALES,
			screens: SCREENS,
		},
		themeProblems,
		readinessProblems,
		identicalStates: identicalCells,
		unreadyCells: unready.map((record) => record.name),
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
		console.log("readiness: every cell reached the screen it names");
	}
	if (identicalCells.length) {
		console.log(
			`IDENTICAL STATES (${identicalCells.length}): cells that declare different states produced the same bytes`,
		);
		for (const entry of identicalCells) console.log(`  - ${entry}`);
	}

	const strict = options.strict !== false;
	const blocking =
		themeProblems.length + readinessProblems.length + identicalCells.length;
	if (strict && blocking > 0) {
		throw new CaptureFailure(
			`${themeProblems.length} theme problem(s), ${readinessProblems.length} unready cell(s), ` +
				`${identicalCells.length} identical-state pair(s); see ${join(outDir, "manifest.json")}`,
			{ themeProblems, readinessProblems, identicalStates: identicalCells },
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
function verifyTextScale(records) {
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
	const median = ratios.map((r) => r.ratio).sort((a, b) => a - b)[
		Math.floor(ratios.length / 2)
	];
	const works = median > 1.2;
	return {
		medianObservedRatio: Number(median.toFixed(3)),
		expected: 2,
		live: works,
		verdict: works
			? `scale dimension is live (median ${median.toFixed(2)}x at 200%)`
			: `scale dimension is INERT (median ${median.toFixed(2)}x at 200%) — three frames per cell ` +
				"are effectively one, so any U-04 'no clipping at 200%' result from this run is meaningless",
		ratios,
	};
}

/* -------------------------------------------------------------------- CLI -- */

const isMain =
	process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
	const { flags } = parseArgs(process.argv.slice(2));
	const repoRoot = new URL("../../", import.meta.url).pathname;
	const dir = str(flags, "dir", undefined);
	const out = str(flags, "out", undefined);
	if (bool(flags, "help") || !dir || !out) {
		console.log(
			[
				"usage: node tools/visual/capture.mjs --dir <web-build> --out <frames-dir> [options]",
				"",
				"  Both --dir and --out are required: a default output path inside the",
				"  repository would write a frame tree into it, and frames never belong in",
				"  the repository (ADR 0003).",
				"",
				"  --dir <path>        the built web target to serve (expo export --platform web)",
				"  --out <path>        where frames/, manifest.json and index.html go",
				"  --relay <url>       mock relay base URL; supplies the scenario list and session ids",
				"  --cells <a/b,...>   explicit screen/state cells (default: whatever the relay declares)",
				"  --devices <names>   comma list; default all. See matrix.mjs DEVICES",
				"  --themes <names>    default dark,light",
				"  --scales <ids>      default 100,150,200",
				"  --consecutive       also capture a +250 ms and a settled frame per cell",
				"  --settle <ms>       boot budget before the first frame (default 1200)",
				"  --tokens <path>     tokens.json, to check each frame's canvas against its theme",
				"  --plan              print the frame list and exit without capturing",
				"  --yes               allow a run above the confirmation threshold",
				"  --no-strict         report theme problems without failing the run",
				"  --full              every device × theme × scale cell (same as the defaults)",
			].join("\n"),
		);
		process.exit(dir && out ? 0 : 2);
	}
	// An empty `--scales` means "all of them": the matrix's scale dimension is the
	// one that catches a transcript row clipping its tool result, so it is on by
	// default rather than opt-in.
	const scaleIds = csv(flags, "scales");
	// Which devices a default run covers. `core` is the sample the operator's
	// rule asks to be run first — smallest phone, a typical phone, phone
	// landscape, a tablet in each orientation — and `--full` (or `--tier full`)
	// covers every size. `--devices` overrides either.
	const tier =
		bool(flags, "full") || str(flags, "tier", "core") === "full"
			? "full"
			: "core";
	const requestedDevices = csv(flags, "devices");
	const defaultDevices = tier === "full" ? ALL_DEVICES : CORE_DEVICES;
	const summary = await runCapture({
		dir,
		out,
		relay: str(flags, "relay", undefined),
		cells: csv(flags, "cells"),
		tier,
		devices: requestedDevices.length ? requestedDevices : defaultDevices,
		themes: csv(flags, "themes").length ? csv(flags, "themes") : THEMES,
		scales: scaleIds.length
			? SCALES.filter((s) => scaleIds.includes(s.id))
			: SCALES,
		consecutive: bool(flags, "consecutive"),
		settleMs: num(flags, "settle", 1200),
		tokens: str(
			flags,
			"tokens",
			join(repoRoot, "design", "tokens", "tokens.json"),
		),
		plan: bool(flags, "plan"),
		yes: bool(flags, "yes"),
		strict: !bool(flags, "no-strict"),
		profile: str(flags, "profile", undefined),
		port: num(flags, "port", 0),
	});
	if (summary?.dryRun) process.exit(0);
}
