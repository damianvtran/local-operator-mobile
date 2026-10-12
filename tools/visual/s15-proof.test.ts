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
		const flag = (name: string) =>
			job.match(new RegExp(`--${name} ([^\\s]+)`))?.[1] ?? "";
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
		for (const name of [
			"mock-relay-contract",
			"web-audit",
			"docs-commands",
			"web-audit-core",
			"maestro-android",
		]) {
			const header =
				workflow.split(`  ${name}:\n`)[1]?.split("    runs-on:")[0] ?? "";
			expect(header, name).toContain("inputs.proof_mode != 's15-proof'");
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
