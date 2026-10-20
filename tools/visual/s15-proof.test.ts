import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { MEASURE_PROBE } from "./matrix";

const root = resolve(import.meta.dirname, "../..");

describe("optional S15 proof", () => {
	it("plans exactly the affected states and controls without launching a browser", () => {
		const workflow = readFileSync(
			resolve(root, ".github/workflows/e2e.yml"),
			"utf8",
		);
		const job =
			workflow.split("  s15-proof:\n")[1]?.split("  web-audit-core:\n")[0] ??
			"";
		const finalCapture =
			job
				.split("- name: Capture affected cells and positive controls")[1]
				?.split("- name: Audit")[0] ?? "";
		const flag = (name: string) =>
			finalCapture.match(new RegExp(`--${name} ([^\\s]+)`))?.[1] ?? "";
		const result = spawnSync(
			process.execPath,
			[
				"tools/visual/capture.ts",
				"--dir",
				"dist",
				"--out",
				"unused-plan",
				"--tier",
				"core",
				"--cells",
				flag("cells"),
				"--devices",
				flag("devices"),
				"--themes",
				flag("themes"),
				"--scales",
				flag("scales"),
				"--consecutive",
				"--plan",
			],
			{ cwd: root, encoding: "utf8", timeout: 20_000 },
		);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain(
			"capture plan: 72 cells × 3 frame(s) = 216 frames",
		);
		expect(flag("cells").split(",")).toEqual([
			"S15/populated",
			"S15/ended",
			"S15/degraded-row",
			"S15/mesh-remote",
			"S15/populated-long",
			"S15/menu-open",
		]);
		expect(flag("devices")).toBe("iphone-15-landscape,iphone-15");
		expect(flag("scales")).toBe("100,150,200");
		expect(flag("themes")).toBe("dark,light");
		expect(job).not.toContain("continue-on-error");
		expect(job).toContain("--s15-flow-proof");
		expect(job).not.toContain("git restore");
		expect(job).not.toContain("s15-old-app");
		// INTENT, not the literal: these jobs must run on a FULL run and be excluded
		// by an S15 run. R7 rewrote the condition from `!= 's15-proof'` to the
		// equivalent `(inputs.proof_mode || 'full') == 'full'` (the same clause the
		// stage gate uses, with the dispatch default made explicit). Asserting the
		// new literal alone would stop testing the intent, so evaluate the job's own
		// guard with the real input values instead: 'full' includes the job, and
		// 's15-proof' excludes it. A dropped guard evaluates truthy for BOTH and
		// fails here.
		const runsFor = (header: string, mode: string): boolean => {
			const guard = /^\s*if:\s*(.+)$/m.exec(header)?.[1]?.trim();
			// No `if:` at all means GitHub runs the job for EVERY mode, so it must
			// report as running — otherwise a DROPPED guard would be caught by a
			// wrong assertion (it would read as absent on full too) instead of the
			// real one (present on an S15 run, which is the defect).
			if (guard === undefined) return true;
			// The workflow narrows some jobs by event too; those keep the event gate,
			// so supply the S15 dispatch event and the mode under test.
			const sandbox = {
				inputs: { proof_mode: mode },
				github: { event_name: "workflow_dispatch" },
			};
			return Boolean(
				runInNewContext(
					`(() => { const inputs = this.inputs, github = this.github; return (${guard}); })()`,
					sandbox,
				),
			);
		};
		for (const name of [
			"mock-relay-contract",
			"web-audit",
			"docs-commands",
			"web-audit-core",
			"maestro-android",
		]) {
			const header =
				workflow.split(`  ${name}:\n`)[1]?.split("    runs-on:")[0] ?? "";
			expect(header, name).toBeTruthy();
			expect(runsFor(header, "full"), `${name} on a full run`).toBe(true);
			expect(runsFor(header, "s15-proof"), `${name} on an S15 run`).toBe(false);
		}
	});

	it("records a collapsed list and its scroll extent without changing scroll", () => {
		const rect = (top: number, height: number, width = 280) => ({
			top,
			bottom: top + height,
			height,
			width,
		});
		const footer = {
			contains: () => true,
			getBoundingClientRect: () => rect(126, 244),
		};
		const row = { getBoundingClientRect: () => rect(138, 80) };
		const list = {
			getBoundingClientRect: () => rect(102, 24),
			clientHeight: 24,
			scrollHeight: 500,
			scrollTop: 0,
			querySelectorAll: () => [row],
		};
		const pane = {
			getBoundingClientRect: () => rect(0, 390, 339),
			querySelector: (selector: string) =>
				selector.includes("conversations-list") ? list : footer,
		};
		const html = { scrollWidth: 844, clientWidth: 844, scrollTop: 0 };
		const reading = runInNewContext(MEASURE_PROBE, {
			window: { innerWidth: 844, innerHeight: 390 },
			location: { pathname: "/", search: "" },
			document: {
				documentElement: html,
				body: null,
				querySelectorAll: () => [],
				querySelector: (selector: string) =>
					selector.includes("conversations-sidebar") ? pane : null,
			},
			getComputedStyle: () => ({
				fontSize: "32px",
				backgroundColor: "rgb(0, 0, 0)",
			}),
		});
		expect(reading.paneGeometry).toMatchObject({
			paneHeight: 390,
			listHeight: 24,
			listClientHeight: 24,
			listScrollHeight: 500,
			footerHeight: 244,
			rowCount: 1,
			visibleRows: 0,
		});
		expect(list.scrollTop).toBe(0);
	});
});
