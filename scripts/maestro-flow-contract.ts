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
				!/[#\[\]{}&*!|>]|:(?:\s|$)/.test(raw.replaceAll(/\$\{[^}]+\}/g, "")),
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
	const installs = lines.flatMap((line, index) =>
		/^adb install\b/.test(line) ? [index] : [],
	);
	assert.equal(installs.length, 1, "exactly one `adb install` line");
	const at = installs[0] as number;
	const install = lines[at] as string;
	// Only `adb install -r <apk>` is allowed, which excludes -d/-g, `|| true`, `;`
	// and `&` in one assertion.
	assert(
		/^adb install -r \S+\.apk$/.test(install),
		"unexpected install shape: the install must stay a hard failure",
	);
	const before = lines[at - 1] ?? "";
	assert(
		/^adb uninstall "\$APP_ID" \|\| echo "[^"]+"$/.test(before),
		'`adb uninstall "$APP_ID" || echo "<visible message>"` must be the line before `adb install`',
	);
	assert(!before.includes("/dev/null"), "the uninstall must stay visible");
}

export const maestroChecks: [string, () => void][] = [
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
];

if (import.meta.main) {
	for (const [name, run] of maestroChecks) test(name, run);
}
