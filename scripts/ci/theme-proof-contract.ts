import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { capFor } from "./account-routing-proof-contract.ts";

/**
 * The theme proof's frame inventory (decision record § 7, PR 2): the picker in
 * each mode, a search, the selected card, and home + session in each theme. A
 * green driver exit alone must not admit an incomplete set, so the runner
 * refuses one; the test beside this file keeps the flow and this list in step.
 */
export const PROOF_THEMES = [
	"localOperatorDark",
	"localOperatorLight",
	"dracula",
	"obsidian",
	"rosePine",
	"rosePineDawn",
	"highContrastLight",
	// Restored maps and the third light-palette safety-margin neighbor. The
	// other two (localOperatorLight/rosePineDawn) are already above.
	"catppuccinMocha",
	"tokyoNightStorm",
	"duskfox",
	"outrun",
	"everforestLight",
] as const;

export const THEME_FRAMES: readonly string[] = [
	"picker-mode-system",
	"picker-mode-light",
	"picker-mode-dark",
	"picker-search-rose",
	"picker-selected-dracula",
	...PROOF_THEMES.flatMap((theme) => [`home-${theme}`, `session-${theme}`]),
	"home-persisted-everforestLight",
	"picker-persisted-everforestLight",
];

const PATH_SEPARATOR = /[\\/]/;

/** Copy useful evidence independently of the completeness verdict. A later
 * failed session prerequisite must not discard already-taken picker frames. */
export function copyThemeFrames(output: string, destination: string) {
	const found: string[] = [];
	const visit = (dir: string) => {
		for (const row of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, row.name);
			// No link traversal: only Maestro-owned regular screenshots are collected.
			if (row.isDirectory()) visit(path);
			else if (
				row.isFile() &&
				row.name.endsWith(".png") &&
				relative(output, path).split(PATH_SEPARATOR).includes("takeScreenshot")
			) {
				assert(!found.includes(row.name), `duplicate screenshot ${row.name}`);
				mkdirSync(destination, { recursive: true });
				copyFileSync(path, join(destination, row.name));
				found.push(row.name);
			}
		}
	};
	visit(output);
	return found;
}

/** Acceptance stays fail-closed even when partial evidence was salvaged. */
export function collectThemeFrames(
	output: string,
	destination: string,
	required: readonly string[] = THEME_FRAMES,
) {
	const found = copyThemeFrames(output, destination);
	for (const name of required)
		assert(found.includes(`${name}.png`), `missing ${name}.png`);
	return found;
}

/** A diagnostic success is a saved-route prerequisite only, never theme proof. */
export function themeProofPlan(stage = "full") {
	//42037732071 already observed both real-app authorities. Retest only the
	// incomplete closed-listener row, with its OWN current same-listener401.
	if (stage === "transport-xctest-negative")
		return {
			stage,
			flow: null,
			budgetSeconds: 900,
			frames: ["welcome-ready", "loopback-ipv4", "negative-loopback-ipv4"],
		};
	if (stage === "transport-xctest")
		return {
			stage,
			flow: null,
			budgetSeconds: 900,
			frames: ["welcome-ready", "loopback-ipv4", "published-local"],
		};
	if (stage === "transport")
		return {
			stage,
			flow: "transport-pair.yaml",
			budgetSeconds: 900,
			frames: ["transport-loopback-ipv4", "transport-published-local"],
		};
	// Setup remains900s. Manager explicitly reallocates diagnostic600 ->900s
	// so it can warm its OWN simulator before the short app flow. Setup41990457134
	// measured boot120s + install118s + warm130s, before launch/other operations.
	// This is one shared budget, not900s per phase; full mode is unchanged.
	if (stage === "setup")
		return { stage, flow: null, budgetSeconds: 900, frames: ["setup-ready"] };
	if (stage === "diagnostic")
		return {
			stage,
			flow: "saved-route-diagnostic.yaml",
			budgetSeconds: 900,
			frames: ["diagnostic-home", "diagnostic-sidebar"],
		};
	if (stage !== "full") throw new Error("unsupported theme proof stage");
	return {
		stage,
		flow: "theme-matrix.yaml",
		budgetSeconds: 2700,
		frames: THEME_FRAMES,
	};
}
export function assertDiagnosticSimulator(runtime: string, deviceType: string) {
	assert(runtime.endsWith("iOS-26-5"), "diagnostic requires iOS26.5");
	assert(
		deviceType === "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
		"diagnostic requires iPhone17",
	);
}
export function assertDiagnosticTrace(
	events: readonly {
		event: string;
		stage?: string;
		requestClass?: string;
		status?: number;
	}[],
) {
	assert(
		events.some((e) => e.stage === "save.begin"),
		"missing safe saved-provider trace",
	);
	assert(
		events.some(
			(e) =>
				e.event === "response" &&
				e.requestClass === "peer-list" &&
				e.status === 200,
		),
		"missing post-save peer-list200 trace",
	);
	assert(
		events.some((e) => e.stage === "cold-list.applied"),
		"missing saved-provider list application trace",
	);
}

export function assertDriverReady(hierarchy: string) {
	assert(
		["welcome-screen", "home-screen"].some((id) => hierarchy.includes(id)),
		"warm driver did not show a drawn app screen",
	);
}
/** Exact existing account-routing warm-up: launch the installed app, then touch
 * the actual XCTest driver through hierarchy. No sleep, reinstall or guessed
 * port probe. A single unsuccessful bootstrap stops the setup lane. */
export async function warmThemeDriver(
	run: (
		name: string,
		command: string,
		args: string[],
		cap: number,
	) => Promise<string>,
	udid: string,
	bundle: string,
) {
	await run(
		"warm-launch-app",
		"xcrun",
		["simctl", "launch", udid, bundle],
		capFor("selector"),
	);
	const hierarchy = await run(
		"warm-maestro-driver",
		"maestro",
		["--verbose", "--device", udid, "hierarchy"],
		capFor("maestroCold"),
	);
	assertDriverReady(hierarchy);
	return hierarchy;
}
const DRIVER_BOOTSTRAP_FAILURE =
	/IOSDriverTimeoutException|iOS driver not ready in time|\[driver-bootstrap\]/i;
export const isDriverBootstrapFailure = (text: string) =>
	DRIVER_BOOTSTRAP_FAILURE.test(text);
const BOOTSTRAP_URL = /https?:\/\/[^\s"'<>]+/gi;
const BOOTSTRAP_SECRET =
	/\b(authorization|set-cookie|cookie|password|token)\s*[:=]\s*[^\r\n]+/gi;
export const sanitizeBootstrapLog = (text: string) =>
	text
		.replace(BOOTSTRAP_URL, "<redacted-origin>")
		.replace(BOOTSTRAP_SECRET, "$1: <redacted>");

/** A setup in another job/VM cannot warm this simulator. Cache the one actual
 * attempt by owned device AND bundle; failed attempts are retained too, so a
 * caller cannot turn a bootstrap failure into an implicit retry. */
export function createThemeDriverWarmer(
	run: Parameters<typeof warmThemeDriver>[0],
) {
	const attempts = new Map<string, Promise<string>>();
	return (udid: string, bundle: string): Promise<string> => {
		const key = JSON.stringify([udid, bundle]);
		let attempt = attempts.get(key);
		if (!attempt) {
			attempt = warmThemeDriver(run, udid, bundle);
			attempts.set(key, attempt);
		}
		return attempt;
	};
}
