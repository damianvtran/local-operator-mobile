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
	return text.split(/^---\s*$/m).map((document) => {
		const lines = document.split("\n").flatMap((line) => {
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
				assert(raw.endsWith("'"));
				return raw.slice(1, -1).replaceAll("''", "'");
			}
			assert(
				!/[#\[\]{}&*!|>]/.test(raw.replaceAll(/\$\{[^}]+\}/g, "")),
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

export const maestroChecks: [string, () => void][] = [
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
];

if (import.meta.main) {
	for (const [name, run] of maestroChecks) test(name, run);
}
