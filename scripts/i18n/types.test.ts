import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { generate, loadSources } from "./generate.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
function fixtureTypes() {
	const input = loadSources(root);
	const key = "mobile.home.jobs";
	input.english[key] = "{count, plural, one {# job} other {# jobs}}";
	input.context[key] = {
		role: "Isolated plural type fixture",
		tone: "Neutral count",
		length: "Not rendered in production",
		note: "Synthetic only; never enabled catalogue source",
		params: { count: "number" },
		placeholders: { count: "Number of jobs" },
	};
	const en = input.catalogues.en?.["mobile.home"];
	if (!en) throw new Error("fixture missing English catalogue");
	en[key] = input.english[key];
	return generate(input);
}
function diagnostics(call: string) {
	// TypeScript 7 exposes version metadata, not the TypeScript 5 compiler API,
	// at its root. Exercise the pinned CLI instead; never silently substitute a
	// donor compiler or a native-API daemon for the project's actual type gate.
	const dir = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			"mobile-i18n-types-",
		),
	);
	try {
		writeFileSync(
			join(dir, "fixture.ts"),
			`${fixtureTypes()}\ndeclare const t: Translator;\n${call};\n`,
		);
		writeFileSync(
			join(dir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					strict: true,
					noEmit: true,
					types: [],
					target: "esnext",
					skipLibCheck: true,
				},
				files: ["fixture.ts"],
			}),
		);
		const result = spawnSync(
			join(root, "node_modules/.bin/tsc"),
			["--project", join(dir, "tsconfig.json"), "--pretty", "false"],
			{ encoding: "utf8", timeout: 20_000 },
		);
		if (result.error) throw result.error;
		if (result.signal) throw new Error(`type fixture killed: ${result.signal}`);
		return { status: result.status, output: result.stdout + result.stderr };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("generated two-overload Translator", () => {
	it("accepts real no-param and synthetic plural calls", () => {
		expect(
			diagnostics(
				't("mobile.home.greeting"); t("mobile.home.jobs", { count: 21 })',
			),
		).toEqual({ status: 0, output: "" });
	});
	for (const [reason, call, expected] of [
		[
			"unknown key",
			't("mobile.home.not_a_key")',
			/error TS2345:[\s\S]*mobile\.home\.not_a_key/,
		],
		[
			"missing params",
			't("mobile.home.jobs")',
			/error TS2345:[\s\S]*mobile\.home\.jobs/,
		],
		[
			"wrong param type",
			't("mobile.home.jobs", { count: "21" })',
			/error TS2322:[\s\S]*Type 'string' is not assignable to type 'number'/,
		],
		[
			"missing required param",
			't("mobile.home.jobs", {})',
			/error TS2345:[\s\S]*Property 'count' is missing/,
		],
		[
			"extra param",
			't("mobile.home.jobs", { count: 21, surplus: true })',
			/error TS2353:[\s\S]*surplus/,
		],
		[
			"params on no-param key",
			't("mobile.home.greeting", { surplus: true })',
			/error TS2345:[\s\S]*mobile\.home\.greeting/,
		],
	] as const) {
		it(`rejects ${reason}`, () => {
			const result = diagnostics(call);
			// The pinned native TS7 CLI returns 1 for diagnostics, unlike legacy
			// tsc's 2. A failed import/setup is NOT a successful negative control:
			// require the exact fixture's diagnostic as well as the known status.
			expect(result.status).toBe(1);
			expect(result.output).toMatch(expected);
		});
	}
});
