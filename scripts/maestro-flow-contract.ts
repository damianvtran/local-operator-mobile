/**
 * Native execution remains Maestro's job. This dependency-free guard catches a
 * narrower failure before a build: clearing credentials and then asserting a
 * connected screen without walking the public own-tunnel setup.
 *
 * Parse the block mapping/sequence/scalar subset these flows use, not commented
 * selector mentions. Unsupported YAML fails closed; Maestro and the YAML
 * validation gate remain authoritative for the full language and runtime.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isKnownIdentifier } from "../src/ui/a11y.ts";

type Value = string | number | boolean | null | Value[] | Mapping;
type Mapping = { [key: string]: Value };
const root = fileURLToPath(new URL("../", import.meta.url));
const workspace = join(root, "e2e/maestro");
const helperPath = "helpers/connect-relay.yaml";

const mapping = (value: Value | undefined): Mapping => {
	assert(value !== null && typeof value === "object" && !Array.isArray(value));
	return value;
};

export function parseFlow(text: string): Value[] {
	return text.split(/^---\s*$/m).map((yamlDocument) => {
		const lines = yamlDocument.split("\n").flatMap((line) => {
			if (/^\s*(?:#.*)?$/.test(line)) return [];
			assert(!line.includes("\t"), "YAML indentation must use spaces");
			return [
				{ indent: line.length - line.trimStart().length, text: line.trim() },
			];
		});
		let cursor = 0;
		const scalar = (raw: string): Value => {
			if (raw.startsWith('"')) return JSON.parse(raw) as Value;
			if (raw.startsWith("'")) {
				// YAML escapes a single quote by doubling it. A closing quote must
				// end the scalar; trailing text is not another valid quoted segment.
				assert(
					/^'(?:[^']|'')*'$/.test(raw),
					"invalid single-quoted YAML scalar",
				);
				return raw.slice(1, -1).replaceAll("''", "'");
			}
			assert(
				!/[#[\]{}&*!|>]|:(?:\s|$)/.test(raw.replaceAll(/\$\{[^}]+\}/g, "")),
				`unsupported YAML scalar: ${raw}`,
			);
			if (raw === "true") return true;
			if (raw === "false") return false;
			if (/^\d+$/.test(raw)) return Number(raw);
			return raw;
		};
		const block = (indent: number): Value => {
			const sequence = lines[cursor]?.text.startsWith("- ") ?? false;
			const result: Mapping | Value[] = sequence ? [] : {};
			while (cursor < lines.length && lines[cursor]?.indent === indent) {
				const line = lines[cursor];
				assert(line);
				assert.equal(
					line.text.startsWith("- "),
					sequence,
					"mixed YAML collection",
				);
				cursor += 1;
				const raw = sequence ? line.text.slice(2) : line.text;
				const field = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(raw);
				let value: Value;
				if (field) {
					const key = field[1];
					assert(key);
					const next = lines[cursor];
					value =
						field[2] !== undefined
							? scalar(field[2])
							: next && next.indent > indent
								? block(next.indent)
								: null;
					if (Array.isArray(result)) result.push({ [key]: value });
					else {
						assert(!(key in result), `duplicate YAML key: ${key}`);
						result[key] = value;
					}
				} else {
					assert(Array.isArray(result), `unsupported YAML mapping: ${raw}`);
					result.push(scalar(raw));
				}
			}
			return result;
		};
		assert(lines.length > 0, "empty YAML document");
		const result = block(0);
		assert.equal(cursor, lines.length, "unsupported YAML indentation");
		return result;
	});
}

const read = (path: string) => parseFlow(readFileSync(path, "utf8"));
const commands = (documents: Value[]): Mapping[] => {
	assert.equal(
		documents.length,
		2,
		"flow needs a header and commands document",
	);
	assert.equal(mapping(documents[0]).appId, "${APP_ID}");
	assert(Array.isArray(documents[1]));
	return documents[1].map((command) =>
		typeof command === "string" ? { [command]: null } : mapping(command),
	);
};
const visible = (command: Mapping, id: string) =>
	command.extendedWaitUntil !== undefined &&
	mapping(mapping(command.extendedWaitUntil).visible).id === id;

const identifiers = (value: Value): string[] => {
	if (Array.isArray(value)) return value.flatMap(identifiers);
	if (value === null || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, child]) =>
		key === "id" ? [String(child)] : identifiers(child),
	);
};

function checkSelectedFlows(config: Value[]) {
	assert.deepEqual(
		mapping(config[0]).flows,
		["flows/*.yaml"],
		"helpers must not be selected as standalone flows",
	);
	assert(!helperPath.startsWith("flows/"));
}

function checkHelper(steps: Mapping[]) {
	const action = (name: string, id: string) =>
		steps.findIndex(
			(step) => step[name] !== undefined && mapping(step[name]).id === id,
		);
	const welcome = steps.findIndex((step) => visible(step, "welcome-screen"));
	const enter = action("tapOn", "welcome-custom-url");
	const screen = steps.findIndex((step) => visible(step, "own-tunnel-screen"));
	const url = action("tapOn", "custom-url-field");
	const password = action("tapOn", "custom-password-field");
	const insecure = action("tapOn", "custom-insecure-opt-in");
	const probe = action("tapOn", "own-tunnel-test");
	const verdict = steps.findIndex(
		(step) =>
			step.extendedWaitUntil !== undefined &&
			mapping(mapping(step.extendedWaitUntil).visible).text === "Connected",
	);
	const connect = action("tapOn", "custom-connect");
	const home = steps.findIndex((step) => visible(step, "home-screen"));
	const order = [
		welcome,
		enter,
		screen,
		url,
		password,
		insecure,
		probe,
		verdict,
		connect,
		home,
	];
	assert(
		order.every(
			(index, i) => index >= 0 && (i === 0 || index > (order[i - 1] ?? -1)),
		),
		"helper must walk welcome, fields, HTTP opt-in, real probe verdict, connect, then home",
	);
	assert.equal(steps[url + 1]?.inputText, "${RELAY_URL}");
	assert.equal(steps[password + 1]?.inputText, "${RELAY_PASSWORD}");
	assert.equal(mapping(steps[connect]?.tapOn).enabled, true);
	for (const id of [
		"custom-url-field",
		"custom-password-field",
		"custom-insecure-opt-in",
		"own-tunnel-test",
		"custom-connect",
	]) {
		const tap = action("tapOn", id);
		assert(
			tap > 0 &&
				steps
					.slice(0, tap)
					.some(
						(step) =>
							step.scrollUntilVisible !== undefined &&
							mapping(mapping(step.scrollUntilVisible).element).id === id,
					),
			`guided screen must scroll to ${id}`,
		);
	}
	assert(
		steps.filter((step) => "hideKeyboard" in step).length >= 2,
		"keyboard must not obscure the next field or button",
	);
}

function checkPrerequisites(steps: Mapping[]) {
	let connected = false;
	let helperCalls = 0;
	for (const step of steps) {
		if (
			step.launchApp !== undefined &&
			mapping(step.launchApp).clearState === true
		)
			connected = false;
		if (step.runFlow !== undefined) {
			assert.equal(step.runFlow, `../${helperPath}`);
			connected = true;
			helperCalls += 1;
		}
		if (
			identifiers(step).some((id) =>
				[
					"home-screen",
					"computers-screen",
					"settings-button",
					"settings-screen",
					"conversations-sidebar",
				].includes(id),
			)
		) {
			assert(
				connected,
				"connected assertions require the public connection prelude after clearState",
			);
		}
	}
	assert.equal(
		helperCalls,
		1,
		"each connected flow must invoke the shared prelude once",
	);
}

function checkIdentifiers(value: Value) {
	if (Array.isArray(value)) value.forEach(checkIdentifiers);
	else if (value !== null && typeof value === "object") {
		for (const [key, child] of Object.entries(value)) {
			if (key === "id") {
				assert.equal(typeof child, "string");
				assert(isKnownIdentifier(String(child)), `unknown selector: ${child}`);
			}
			checkIdentifiers(child);
		}
	}
}

// Settings has a long saved-tunnel section above Appearance. Roots being ready
// says nothing about its controls being in the viewport. These ordered targets
// follow Settings/Segmented source order, not a requirement to scroll every id.
const settingsTargets = [
	["assertVisible", "settings-theme-group", "DOWN"],
	["assertVisible", "settings-theme-system", "DOWN"],
	["tapOn", "settings-theme-dark", "DOWN"],
	["tapOn", "settings-theme-light", "DOWN"],
	["tapOn", "settings-theme-system", "UP"],
	["assertVisible", "settings-section-connection", "UP"],
	["tapOn", "settings-text-scale-200", "DOWN"],
	["tapOn", "settings-text-scale-100", "UP"],
	["assertVisible", "settings-sign-out", "DOWN"],
	["assertVisible", "settings-section-diagnostics", "UP"],
] as const;

function checkSettingsTraversal(steps: Mapping[]) {
	const watched = new Set<string>(settingsTargets.map(([, id]) => id));
	let targetIndex = 0;
	let lastScroll: {
		id: Value | undefined;
		direction: Value | undefined;
		index: number;
	} | null = null;
	let mutation: { id: string; index: number; ready: boolean } | null = null;
	const captures: Value[] = [];
	for (const [index, step] of steps.entries()) {
		if (step.scrollUntilVisible !== undefined) {
			const scroll = mapping(step.scrollUntilVisible);
			lastScroll = {
				id: mapping(scroll.element).id,
				direction: scroll.direction,
				index,
			};
			assert.equal(
				scroll.timeout,
				15000,
				"Settings scroll budget must stay bounded",
			);
		}
		for (const kind of ["assertVisible", "tapOn"] as const) {
			if (step[kind] === undefined) continue;
			const id = String(mapping(step[kind]).id);
			if (!watched.has(id)) continue;
			const expected = settingsTargets[targetIndex];
			assert(expected, "unexpected Settings interaction");
			assert.deepEqual(
				[kind, id],
				expected.slice(0, 2),
				"preserve Settings traversal and assertions",
			);
			assert(
				lastScroll?.id === id,
				`Settings ${id} requires its own target scroll before ${kind}`,
			);
			assert.equal(
				lastScroll.direction,
				expected[2],
				`Settings ${id} scroll direction`,
			);
			lastScroll = null;
			targetIndex += 1;
			if (kind === "tapOn") mutation = { id, index, ready: false };
		}
		if (step.extendedWaitUntil !== undefined && mutation !== null) {
			const anchor = mapping(mapping(step.extendedWaitUntil).visible);
			if (anchor.id === mutation.id && anchor.selected === true) {
				if (mutation.id.startsWith("settings-text-scale-")) {
					// Expansion moves the selected 200 control DOWN; first find it
					// again, then 100 is earlier in the track and can be reached UP.
					// Contraction after 100 likewise invalidates the old scroll offset.
					assert(
						lastScroll?.id === mutation.id && lastScroll.index > mutation.index,
						`Settings ${mutation.id} needs post-scale remeasurement`,
					);
					assert.equal(
						lastScroll.direction,
						mutation.id.endsWith("200") ? "DOWN" : "UP",
						"post-scale scroll direction",
					);
				}
				mutation.ready = true;
			}
		}
		if (step.takeScreenshot !== undefined) {
			captures.push(step.takeScreenshot);
			if (mutation !== null) {
				assert(
					mutation.ready,
					`Settings screenshot must wait for selected ${mutation.id}`,
				);
				mutation = null;
			}
		}
	}
	assert.equal(
		targetIndex,
		settingsTargets.length,
		"all Settings interactions remain covered",
	);
	assert.deepEqual(captures, [
		"11-00-settings",
		"11-01-theme-control",
		"11-02-theme-dark",
		"11-03-theme-light",
		"11-04-theme-system",
		"11-05-connection-section",
		"11-06-text-200",
		"11-07-text-100",
		"11-08-sign-out",
		"11-09-diagnostics",
	]);
}

/**
 * The emulator-runner `script:` of the `maestro-android` job, as the action sees it.
 *
 * The action runs ONE COMMAND PER LINE and drops `#` lines, so the guard reads the
 * block the same way instead of matching the raw YAML: a comment that merely mentions
 * `adb uninstall` must not satisfy it. Scoped to the "Run the flows" step because the
 * workflow has other `script:` keys that mean something else.
 */
function emulatorScriptLines(workflow: string): string[] {
	const step = workflow.split("      - name: Run the flows\n")[1];
	assert(step !== undefined, "the 'Run the flows' step must exist");
	const lines = step.split("\n");
	const start = lines.findIndex((line) => /^ {10}script: \|\s*$/.test(line));
	assert(start >= 0, "the emulator-runner step must carry a `script: |` block");
	const block: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line.trim() !== "" && !line.startsWith(" ".repeat(12))) break;
		block.push(line.trim());
	}
	return block.filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * The AVD cache (`Linux-avd-<api>-<hash of e2e/maestro/**>`) outlives the job and is
 * SAVED with the app already installed, signed by that run's throwaway keystore. A later
 * run that hits the cache builds a NEW keystore, and `adb install -r` cannot replace a
 * package signed by a different key (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`; nightly
 * 38506995844). So the install must be preceded, on the line immediately before, by an
 * uninstall of the SAME `$APP_ID` the flows launch. The uninstall may fail (a fresh AVD
 * has no app) but must say so rather than go to /dev/null, and the install itself must
 * stay a hard failure: a tolerated install would turn a signing mismatch into a flow
 * failure that reads like an app bug.
 */
export function checkEmulatorInstall(workflow: string) {
	const lines = emulatorScriptLines(workflow);
	// Any `adb … install` counts, whatever target flag it carries (`-s <serial>`,
	// `-e`, `-d`): an edit that adds one must not turn the count into zero and the
	// uninstall check into a check of nothing.
	const installs = lines.flatMap((line, index) =>
		/^adb\b.*\binstall\b/.test(line) ? [index] : [],
	);
	assert.equal(installs.length, 1, "exactly one `adb install` line");
	const at = installs[0] as number;
	const install = lines[at] as string;
	// Only `adb [-s <serial>] install -r <apk>` is allowed, which excludes -d/-g,
	// `|| true`, `;` and `&` in one assertion.
	const installShape = /^adb(?: -s (\S+))? install -r \S+\.apk$/.exec(install);
	assert(
		installShape !== null,
		"unexpected install shape: the install must stay a hard failure",
	);
	const before = lines[at - 1] ?? "";
	const uninstallShape =
		/^adb(?: -s (\S+))? uninstall "\$APP_ID" \|\| echo "[^"]+"$/.exec(before);
	assert(
		uninstallShape !== null,
		'`adb uninstall "$APP_ID" || echo "<visible message>"` must be the line before `adb install`',
	);
	// A serial is allowed because it pins a command to one device, but the pair must
	// agree: removing the app from one device and installing on another leaves the
	// cached signer in place and the failure intact.
	assert.equal(
		uninstallShape[1],
		installShape[1],
		"the uninstall and the install must target the same device",
	);
	assert(!before.includes("/dev/null"), "the uninstall must stay visible");
}

/**
 * The readiness gate must stay in front of the flows. Both nightly "flaked once"
 * runs since #86 failed the first flow on `device offline`
 * (`scripts/ci/await-emulator-ready.sh` carries the measurements), and the gate is
 * three separate lines that an innocent edit to the `script:` block can drop
 * without anything going red — the flake would simply come back and read as a pass:
 * before the uninstall/install (a transport that has not held still), after the
 * install (the warm-up, which needs the package to exist), and again before the
 * one re-run (a retry into the same dropped transport is not a retry).
 */
export function checkEmulatorGate(workflow: string) {
	const lines = emulatorScriptLines(workflow);
	const install = lines.findIndex((line) => /^adb\b.*\binstall\b/.test(line));
	assert(
		lines[0] === "sh scripts/ci/await-emulator-ready.sh",
		"the first script line must be the full readiness gate",
	);
	assert(install > 0, "the install line must exist");
	assert(
		lines[install + 1] ===
			'EMULATOR_STABLE_PROBES=1 sh scripts/ci/await-emulator-ready.sh "$APP_ID"',
		"the line after the install must warm the app through the gate",
	);
	const flows = lines.find((line) => line.startsWith("run_flows()"));
	assert(flows !== undefined, "the flows invocation must exist");
	assert(
		/run_flows \|\| \{[^}]*sh scripts\/ci\/await-emulator-ready\.sh && run_flows; \}$/.test(
			flows,
		),
		"the one re-run must be gated, and must not run when the gate fails",
	);
}

/**
 * The account-routing Android proof must carry EXACTLY ONE re-gated retry of its
 * flow — the sibling `maestro-android` job's documented practice (ADR 0004), copied
 * deliberately rather than dropped in the copy.
 *
 * WHY: Maestro 2.11.0's CLI has no retry option (`--retry` fails at argument
 * parsing), and the documented device-offline flake
 * (`DeviceServerDiedException: Device server died during 'deviceInfo'`) killed this
 * lane's FIRST flow step before any assertion (run 38922359159) — so it produced no
 * flow evidence. The sibling lane tolerates that flake with a retry; a copy without
 * one fails outright on the same flake. The retry must RE-GATE the emulator before
 * re-running (the sibling's own comment says why: the gate is what turns "device
 * offline" into a bounded, loud wait), and it must not invent a `--retry` flag.
 */
/**
 * The proof flow must not `assertVisible`/`tapOn` a TEXT target without scrolling it
 * into view first — unless it is an element the previous step already brought into
 * view on the same screen.
 *
 * WHY: at the lane's device size the settings form is taller than the viewport, and
 * `text:` targets sit below the fold. The neighbouring steps already scroll to their
 * target; one diverged, and a bare assertion then failed against CORRECT app
 * behaviour (run 38925920010, seq 37: `Assertion is false: "Not saved yet." is
 * visible`). Same shape as the continuation bug: the surrounding pattern was right
 * and a single step did not follow it, so the check is a test rather than a note.
 *
 * The allow-list holds the two cases that are genuinely in view by construction:
 * `settings-button` is on the home screen the flow just asserted, and the three
 * segmented choice targets share the ONE row that the flow scrolls to before
 * selecting. Anything else must carry its own preceding scroll.
 */
const IN_VIEW_AFTER_REACHING: ReadonlySet<string> = new Set([
	// The home screen was asserted immediately before this is tapped.
	"settings-button",
	// The segmented row itself, reached once by the flow before the first choice.
	"settings-account-routing-group:headroom",
]);

export function checkProofFlowScrollsTextTargets(text: string) {
	const documents = parseFlow(text);
	assert.equal(
		documents.length,
		2,
		"a flow needs a header and a commands document",
	);
	const steps = documents[1];
	assert(Array.isArray(steps), "the commands document must be a sequence");
	let lastScroll: string | null = null;
	let screenShots = 0;
	for (const [index, raw] of steps.entries()) {
		const step = mapping(raw);
		if (step.scrollUntilVisible !== undefined) {
			const element = mapping(mapping(step.scrollUntilVisible).element);
			lastScroll = String(element.text ?? element.id ?? "");
			continue;
		}
		if (step.takeScreenshot !== undefined) {
			screenShots += 1;
			lastScroll = null;
			continue;
		}
		if (step.runFlow !== undefined) {
			lastScroll = null;
			continue;
		}
		for (const kind of ["assertVisible", "tapOn"] as const) {
			if (step[kind] === undefined) continue;
			const target = mapping(step[kind]);
			const text = target.text;
			if (typeof text !== "string") continue;
			const inView = IN_VIEW_AFTER_REACHING.has(text);
			assert.ok(
				inView || lastScroll === text,
				`step ${index}: ${kind} text ${JSON.stringify(text)} must be scrolled into view first (or be an element already in view)`,
			);
			if (lastScroll === text) lastScroll = null;
		}
	}
	assert.ok(
		screenShots >= 3,
		"the flow must still capture its rendered states",
	);
}

export function checkProofFlowRetry(workflow: string) {
	const lines = emulatorScriptLinesFor(
		"account-routing-android-proof",
		workflow,
	);
	const retries = lines.filter((line) => /run_flows \|\|/.test(line));
	assert.equal(retries.length, 1, "exactly one re-gated flow retry");
	const retry = retries[0] as string;
	assert.match(
		retry,
		/run_flows \|\| \{[^}]*await-emulator-ready\.sh && run_flows; \}$/,
		"the retry must re-gate the emulator before re-running the flow",
	);
	assert.match(
		retry,
		/::warning/,
		"a flaked run must be reported as a warning",
	);
	assert.doesNotMatch(
		workflow,
		/maestro[^\n]*--retry/,
		"Maestro 2.11.0 has no --retry flag; the retry is the script's own",
	);
}

/** The `script:` lines of the emulator step inside ONE named job. */
function emulatorScriptLinesFor(job: string, workflow: string): string[] {
	const jobsSection = workflow.split("\njobs:\n")[1];
	assert.ok(jobsSection, "workflow must declare jobs");
	// A job header is EXACTLY two spaces + name + colon at the line start; `\n  `
	// alone also matches the four-space body indent and would cut the body off at
	// its first nested line.
	const header = new RegExp(`\n  ${job}:\\n`);
	const at = jobsSection.search(header);
	assert.ok(at >= 0, `${job} must exist`);
	const rest = jobsSection.slice(at + 1);
	const others = [...rest.matchAll(/\n {2}[A-Za-z0-9_-]+:\s*\n/g)]
		.map((m) => m.index)
		.filter((index) => index > 0);
	const end = others.length > 0 ? Math.min(...others) : rest.length;
	const jobBody = rest.slice(0, end);
	const lines = jobBody.split("\n");
	const start = lines.findIndex((line) => /^ {10}script: \|\s*$/.test(line));
	assert.ok(start >= 0, `${job} must carry an emulator script: block`);
	const block: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line.trim() !== "" && !line.startsWith(" ".repeat(12))) break;
		block.push(line.trim());
	}
	return block.filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * EVERY `android-emulator-runner` `script:` block in the workflow must keep each
 * command on ONE line.
 *
 * The action parses `script:` into one command per line and runs each through
 * `/usr/bin/sh -c`, so a `\` continuation splits a command and the FIRST line runs
 * alone — with a literal backslash where the continuation was. Measured: the
 * account-routing Android proof job (run 38916253711) put its `maestro test`
 * invocation across six lines and died in ~2s with
 * `Flow path does not exist: .../local-operator-mobile/\`.
 *
 * WHY THIS IS A TEST AND NOT ONLY A COMMENT: the rule is documented in the very
 * job the new one was copied from, and the copy still broke it. `emulatorScriptLines`
 * above is scoped to the "Run the flows" step, so it could not see the new block;
 * this check walks EVERY emulator step instead, which is what makes the class
 * closed rather than the one instance.
 */
export function checkEmulatorScriptContinuations(workflow: string) {
	const blocks: { name: string; lines: string[] }[] = [];
	const marks = [...workflow.matchAll(/^ {6}- (?:uses|name):[^\n]*\n/gm)];
	for (const mark of marks) {
		const start = mark.index as number;
		const next = marks.find((candidate) => (candidate.index as number) > start);
		const step = workflow.slice(
			start,
			next ? (next.index as number) : undefined,
		);
		if (!/android-emulator-runner/.test(step)) continue;
		const lines = step.split("\n");
		const at = lines.findIndex((line) => /^ {10}script: \|\s*$/.test(line));
		if (at < 0) continue;
		const label =
			step
				.split("\n")
				.find((line) => /^ {6}- name:/.test(line))
				?.trim() ??
			step.split("\n")[0]?.trim() ??
			"emulator step";
		const block: string[] = [];
		for (const line of lines.slice(at + 1)) {
			if (line.trim() !== "" && !line.startsWith(" ".repeat(12))) break;
			block.push(line);
		}
		blocks.push({ name: label, lines: block });
	}
	assert.ok(
		blocks.length > 0,
		"at least one emulator `script:` block must exist",
	);
	for (const { name, lines } of blocks)
		for (const [index, line] of lines.entries())
			assert.ok(
				!line.trimEnd().endsWith("\\"),
				`${name}: line ${index + 1} ends in a backslash — the action runs one command per line, so a continuation splits it`,
			);
}

export const maestroChecks: [string, () => void][] = [
	[
		"the Android proof scrolls every below-the-fold text target into view",
		() => {
			const flowPath = join(
				workspace,
				"account-routing-proof/connect-android.yaml",
			);
			const text = readFileSync(flowPath, "utf8");
			checkProofFlowScrollsTextTargets(text);
			// Discriminating: dropping the scroll the saved round-trip needs must fail,
			// so the check cannot pass by finding no text targets at all.
			const withoutScroll = text.replace(
				`- scrollUntilVisible:\n    element:\n      text: "Not saved yet."\n    direction: DOWN\n    timeout: 15000\n`,
				"",
			);
			assert.notEqual(
				withoutScroll,
				text,
				"the probe must actually change the flow",
			);
			assert.throws(
				() => checkProofFlowScrollsTextTargets(withoutScroll),
				/must be scrolled into view first/,
			);
		},
	],
	[
		"the Android proof carries exactly one re-gated flow retry (ADR 0004)",
		() => {
			const workflow = readFileSync(
				join(root, ".github/workflows/e2e.yml"),
				"utf8",
			);
			checkProofFlowRetry(workflow);
			// Discriminating: dropping the retry must fail, so the check cannot pass
			// by finding nothing to inspect.
			const withoutRetry = workflow
				.split("\n")
				.filter((line) => !/run_flows \|\|/.test(line))
				.join("\n");
			assert.throws(
				() => checkProofFlowRetry(withoutRetry),
				/exactly one re-gated flow retry/,
			);
		},
	],
	[
		"every emulator script block keeps each command on one line",
		() => {
			// `readFileSync`, not `read`: `read` is the Maestro FLOW parser, and the
			// workflow is not a flow (it would reject `${{ … }}` scalars).
			const workflow = readFileSync(
				join(root, ".github/workflows/e2e.yml"),
				"utf8",
			);
			checkEmulatorScriptContinuations(workflow);
			// Discriminating: a block with a continuation must be rejected, so the
			// check cannot pass by reading nothing.
			assert.throws(
				() =>
					checkEmulatorScriptContinuations(
						workflow.replace(
							"            adb install -r android/app/build/outputs/apk/release/app-release.apk",
							"            adb install -r android/app/build/outputs/apk/release/app-release.apk \\",
						),
					),
				/ends in a backslash/,
			);
		},
	],
	[
		"Settings scrolls to each target and remeasures appearance changes before captures",
		() => {
			const steps = commands(
				read(join(workspace, "flows/07-settings-theme-scale.yaml")),
			);
			checkSettingsTraversal(steps);
			read(join(workspace, "flows/07-settings-theme-scale.yaml")).forEach(
				checkIdentifiers,
			);
		},
	],
	[
		"Settings traversal rejects omitted scrolls, backwards returns and stale scale geometry",
		() => {
			const steps = commands(
				read(join(workspace, "flows/07-settings-theme-scale.yaml")),
			);
			checkSettingsTraversal(steps);
			const mutateScroll = (id: string, remove: boolean, postScale = false) => {
				const changed = structuredClone(steps);
				const at = changed.findIndex(
					(step) =>
						step.scrollUntilVisible !== undefined &&
						mapping(mapping(step.scrollUntilVisible).element).id === id &&
						(!postScale ||
							mapping(mapping(step.scrollUntilVisible).element).selected ===
								true),
				);
				assert(at >= 0, `missing negative-control scroll for ${id}`);
				if (remove) changed.splice(at, 1);
				else {
					const scroll = mapping(changed[at]?.scrollUntilVisible);
					scroll.direction = scroll.direction === "UP" ? "DOWN" : "UP";
				}
				return changed;
			};
			assert.throws(
				() =>
					checkSettingsTraversal(mutateScroll("settings-theme-group", true)),
				/requires its own target scroll/,
			);
			for (const id of [
				"settings-section-connection",
				"settings-text-scale-100",
				"settings-section-diagnostics",
			]) {
				assert.throws(
					() => checkSettingsTraversal(mutateScroll(id, true)),
					/requires its own target scroll/,
				);
				assert.throws(
					() => checkSettingsTraversal(mutateScroll(id, false)),
					/scroll direction/,
				);
			}
			for (const id of ["settings-text-scale-200", "settings-text-scale-100"]) {
				assert.throws(
					() => checkSettingsTraversal(mutateScroll(id, true, true)),
					/post-scale remeasurement/,
				);
				assert.throws(
					() => checkSettingsTraversal(mutateScroll(id, false, true)),
					/post-scale scroll direction/,
				);
			}
			const noSelectedWait = steps.filter(
				(step) =>
					step.extendedWaitUntil === undefined ||
					mapping(mapping(step.extendedWaitUntil).visible).id !==
						"settings-text-scale-200",
			);
			assert.throws(
				() => checkSettingsTraversal(noSelectedWait),
				/screenshot must wait for selected/,
			);
		},
	],
	[
		"scalar subset rejects malformed YAML and preserves escaped quoted values",
		() => {
			for (const invalid of [
				"label: 'ok' trailing 'text'",
				"label: value: nested",
				"label: value:",
				"label: 'missing closing quote",
				'label: "ok" trailing "text"',
			])
				assert.throws(() => parseFlow(invalid));
			assert.deepEqual(parseFlow("label: 'it''s ok'"), [{ label: "it's ok" }]);
			assert.deepEqual(parseFlow('label: "a \\"quote\\""'), [
				{ label: 'a "quote"' },
			]);
			assert.deepEqual(parseFlow("label: 'https://example.invalid:443'"), [
				{ label: "https://example.invalid:443" },
			]);
		},
	],
	[
		"F3 waits for the idle relay's populated sidebar rather than an empty state",
		() => {
			const steps = commands(
				read(join(workspace, "flows/03-session-list.yaml")),
			);
			assert(steps.some((step) => visible(step, "session-row-${SESSION_ID}")));
			assert(
				steps.some(
					(step) =>
						step.assertNotVisible !== undefined &&
						mapping(step.assertNotVisible).id === "sessions-empty",
				),
			);
			assert(
				!steps.some(
					(step) =>
						step.assertVisible !== undefined &&
						mapping(step.assertVisible).id === "sessions-empty",
				),
			);
		},
	],
	[
		"connected flows 02–09 establish a route after clearing credentials",
		() => {
			const names = readdirSync(join(workspace, "flows")).filter((name) =>
				/^0[2-9].*\.yaml$/.test(name),
			);
			assert.equal(
				names.length,
				8,
				"all eight connected flows must remain covered",
			);
			for (const name of names) {
				const path = join(workspace, "flows", name);
				const steps = commands(read(path));
				assert.equal(mapping(steps[0]?.launchApp).clearState, true);
				checkPrerequisites(steps);
				assert.equal(
					resolve(dirname(path), String(steps[1]?.runFlow)),
					join(workspace, helperPath),
				);
			}
		},
	],
	[
		"shared helper is not a standalone workspace flow",
		() => checkSelectedFlows(read(join(workspace, "config.yaml"))),
	],
	[
		"shared helper probes the real relay before saving and connecting",
		() => checkHelper(commands(read(join(workspace, helperPath)))),
	],
	[
		"helper selectors obey the same a11y contract as standalone flows",
		() => read(join(workspace, helperPath)).forEach(checkIdentifiers),
	],
	[
		"F2 covers saved custom-route restart rather than Radient discovery",
		() => {
			const steps = commands(
				read(join(workspace, "flows/02-tunnel-pick.yaml")),
			);
			assert(steps.some((step) => "stopApp" in step));
			const restart = steps.findIndex(
				(step) =>
					step.launchApp !== undefined &&
					mapping(step.launchApp).clearState === false,
			);
			assert(restart > 1);
			assert(
				steps.slice(restart + 1).some((step) => visible(step, "home-screen")),
			);
			assert(!steps.flatMap(identifiers).includes("computers-screen"));
		},
	],
	[
		"negative controls reject missing prerequisites, standalone helpers, and unknown ids",
		() => {
			assert.throws(
				() =>
					checkPrerequisites([
						{ launchApp: { clearState: true } },
						{ assertVisible: { id: "home-screen" } },
					]),
				/require the public connection prelude/,
			);
			assert.throws(
				() => checkSelectedFlows([{ flows: ["**/*.yaml"] }]),
				/standalone/,
			);
			assert.throws(
				() => checkIdentifiers({ id: "not-a-real-control" }),
				/unknown selector/,
			);
			assert.throws(
				() => parseFlow("flows: [inline, yaml]"),
				/unsupported YAML scalar/,
			);
		},
	],
	[
		"the emulator uninstalls the app before the hard-failing install, so a cached AVD cannot block it",
		() => {
			const workflow = readFileSync(
				join(root, ".github/workflows/e2e.yml"),
				"utf8",
			);
			checkEmulatorInstall(workflow);
		},
	],
	[
		"the emulator readiness gate precedes the install, follows it as a warm-up, and gates the one re-run",
		() => {
			const workflow = readFileSync(
				join(root, ".github/workflows/e2e.yml"),
				"utf8",
			);
			checkEmulatorGate(workflow);
			// Negative controls: each removal must be named, not tolerated.
			const gateLine = "            sh scripts/ci/await-emulator-ready.sh\n";
			const warmLine =
				'            EMULATOR_STABLE_PROBES=1 sh scripts/ci/await-emulator-ready.sh "$APP_ID"\n';
			assert(workflow.includes(gateLine) && workflow.includes(warmLine));
			assert.throws(
				() => checkEmulatorGate(workflow.replace(gateLine, "")),
				/first script line/,
			);
			assert.throws(
				() => checkEmulatorGate(workflow.replace(warmLine, "")),
				/warm the app/,
			);
			assert.throws(
				() =>
					checkEmulatorGate(
						workflow.replace(
							"sh scripts/ci/await-emulator-ready.sh && run_flows; }",
							"run_flows; }",
						),
					),
				/re-run must be gated/,
			);
		},
	],
	[
		"emulator install guard rejects uninstall after install, another id, silenced or tolerated forms",
		() => {
			const workflow = readFileSync(
				join(root, ".github/workflows/e2e.yml"),
				"utf8",
			);
			const install =
				"            adb install -r android/app/build/outputs/apk/release/app-release.apk\n";
			const uninstall =
				'            adb uninstall "$APP_ID" || echo "no earlier $APP_ID on this AVD to remove"\n';
			assert(
				workflow.includes(uninstall + install),
				"the repaired pair exists",
			);
			const swap = (replacement: string) =>
				workflow.replace(uninstall + install, replacement);
			const variants: [string, string, RegExp][] = [
				["no uninstall", install, /must be the line before/],
				[
					"uninstall after install",
					install + uninstall,
					/must be the line before/,
				],
				[
					"another id",
					uninstall.replace("$APP_ID", "com.radient.localoperator.mobile") +
						install,
					/must be the line before/,
				],
				[
					"silenced",
					uninstall.replace("|| echo", ">/dev/null 2>&1 || echo") + install,
					/must be the line before/,
				],
				[
					"comment only",
					"            # " + uninstall.trim() + "\n" + install,
					/must be the line before/,
				],
				[
					"tolerated install",
					uninstall + install.replace(/\n$/, " || true\n"),
					/hard failure|unexpected install shape/,
				],
				[
					"downgrade flag",
					uninstall + install.replace("-r ", "-r -d "),
					/hard failure|unexpected install shape/,
				],
			];
			for (const [name, replacement, expected] of variants)
				assert.throws(
					() => checkEmulatorInstall(swap(replacement)),
					expected,
					name,
				);
		},
	],
	[
		"emulator install guard accepts one consistent -s <serial> and rejects every unguarded install",
		() => {
			const workflow = readFileSync(
				join(root, ".github/workflows/e2e.yml"),
				"utf8",
			);
			const pad = "            ";
			const apk = "android/app/build/outputs/apk/release/app-release.apk";
			const msg = '"no earlier $APP_ID on this AVD to remove"';
			const install = (target = "") => `${pad}adb ${target}install -r ${apk}\n`;
			const uninstall = (target = "", id = '"$APP_ID"') =>
				`${pad}adb ${target}uninstall ${id} || echo ${msg}\n`;
			const current = uninstall() + install();
			assert(workflow.includes(current), "the repaired pair exists");
			const swap = (replacement: string) =>
				workflow.replace(current, replacement);
			// A serial pins both commands to one device, so it is allowed — but only the
			// SAME serial on both lines: uninstalling on one device and installing on
			// another would leave the cached signer in place and the failure intact.
			checkEmulatorInstall(
				swap(uninstall("-s emulator-5554 ") + install("-s emulator-5554 ")),
			);
			const variants: [string, string, RegExp][] = [
				[
					"serial on install only",
					uninstall() + install("-s emulator-5554 "),
					/same device/,
				],
				[
					"serial on uninstall only",
					uninstall("-s emulator-5554 ") + install(),
					/same device/,
				],
				[
					"different serials",
					uninstall("-s emulator-5554 ") + install("-s emulator-5556 "),
					/same device/,
				],
				[
					"serial uninstall of another id",
					uninstall("-s emulator-5554 ", "com.radient.localoperator.mobile") +
						install("-s emulator-5554 "),
					/must be the line before/,
				],
				[
					"serial install with no uninstall",
					install("-s emulator-5554 "),
					/must be the line before/,
				],
				[
					"serial install tolerated",
					uninstall("-s emulator-5554 ") +
						install("-s emulator-5554 ").replace(/\n$/, " || true\n"),
					/hard failure/,
				],
				[
					"a second, unguarded -s install beside the guarded pair",
					current + install("-s emulator-5554 "),
					/exactly one `adb install`/,
				],
				[
					"a second, unguarded -e install beside the guarded pair",
					current + install("-e "),
					/exactly one `adb install`/,
				],
			];
			for (const [name, replacement, expected] of variants)
				assert.throws(
					() => checkEmulatorInstall(swap(replacement)),
					expected,
					name,
				);
		},
	],
];

if (import.meta.main) {
	for (const [name, run] of maestroChecks) test(name, run);
}
