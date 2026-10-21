import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import type { AuditState } from "./checks.ts";
import { EXTRACT_PROBE, u08GeometryProbe } from "./probe.ts";
import {
	assertRemote,
	fragmentIntersections,
	originalFailure,
	RECORD,
	verifyOriginalInstrument,
} from "./u08-geometry-proof.ts";

const root = resolve(import.meta.dirname, "../..");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const JOBS = /^ {2}([\w-]+):\n/m;
const JOB_GUARD = /^ {4}if: (.+)$/m;
const OBSERVER = /\n\s*state\.onU08Failure\?\.\(a\.index,\s*b\.index\);/;
function state(width = 22): AuditState {
	const rect = {
		x: 10,
		y: 100,
		w: width,
		h: 18,
		right: 10 + width,
		bottom: 118,
	};
	return {
		nodes: [1, 2].map((index) => ({
			index,
			tag: "span",
			path: "same-truncated-path",
			ancestors: [],
			ownText: String(index),
			text: String(index),
			ownInk: true,
			ariaHidden: false,
			interactive: false,
			clippedAway: false,
			rect,
			visibleRect: rect,
			position: "static",
			background: "transparent",
			inModalDialog: false,
		})),
		viewport: { width: 390, height: 844, dpr: 3 },
		platform: "ios",
		scale: "150",
		insets: { top: 59, bottom: 34, left: 0, right: 0 },
	} as unknown as AuditState;
}
describe("remote U08 geometry diagnostic contract — no browser", () => {
	it("retains the original probe byte-for-byte and original policy except a post-FAIL observer", () => {
		expect(verifyOriginalInstrument().probeSHA256).toBe(sha(EXTRACT_PROBE));
		expect(sha(EXTRACT_PROBE)).toBe(
			"2ef600e4b42640db7b921a3fba9f17b1f380701f92e7546beab07cf424e67c13",
		);
		const source = readFileSync(resolve(root, "tools/audit/checks.ts"), "utf8"),
			at = source.indexOf("function u08Overlap("),
			end = source.indexOf("\nfunction ", at + 1);
		expect(sha(source.slice(at, end).replace(OBSERVER, ""))).toBe(
			"785138818c460fcdeeb2e3fcc4f2ff682b85c0572ab02ebf3fcf9e4f2547000d",
		);
		expect(u08GeometryProbe([1, 2])).toContain("clipIntersection");
		expect(() => new Script(u08GeometryProbe([1, 2]))).not.toThrow();
	});
	it("requires the exact original failure, not any red row or an empty diagnosis", () => {
		expect(originalFailure(state()).pair).toEqual([1, 2]);
		expect(() => originalFailure(state(21))).toThrow("NOT REPRODUCED");
		expect(() => originalFailure({ ...state(), nodes: [] })).toThrow(
			"NOT REPRODUCED",
		);
	});
	it("computes diagnostic fragment intersections without changing the original verdict", () => {
		expect(
			fragmentIntersections(
				[{ x: 0, y: 0, w: 22, h: 18 }],
				[{ x: 100, y: 0, w: 22, h: 18 }],
			),
		).toEqual([]);
		expect(
			fragmentIntersections(
				[{ x: 0, y: 0, w: 22, h: 18 }],
				[{ x: 0, y: 0, w: 22, h: 18 }],
			),
		).toEqual([{ x: 0, y: 0, w: 22, h: 18 }]);
		expect(originalFailure(state()).row?.verdict).toBe("FAIL");
	});
	it("pins one canonical scene and refuses a local browser launch", () => {
		expect(RECORD).toMatchObject({
			viewport: { width: 390, height: 844, dpr: 3 },
			insets: { top: 59, bottom: 34, left: 0, right: 0 },
			scale: "150",
			theme: "dark",
			state: "condensed",
			pinnedScenario: "long-transcript",
			openers: [],
		});
		expect(() => assertRemote({})).toThrow("Remote GitHub Linux");
		expect(() =>
			assertRemote({ GITHUB_ACTIONS: "true", RUNNER_OS: "Linux" }),
		).not.toThrow();
	});
	it("refuses every non-dispatch event and non-full stage in the actual Bash validator", () => {
		const source = readFileSync(
			resolve(root, ".github/workflows/e2e.yml"),
			"utf8",
		);
		const script = source
			.split("- name: Validate proof selection")[1]
			?.split("        run: |\n")[1]
			?.split("      - name: Detect the harness")[0];
		if (!script) throw new Error("Missing canonical validator");
		for (const event of [
			"push",
			"pull_request",
			"schedule",
			"workflow_dispatch",
		]) {
			for (const stage of ["full", "setup", "preflight"]) {
				const result = spawnSync("bash", ["-c", script], {
					env: {
						PATH: process.env.PATH,
						GITHUB_EVENT_NAME: event,
						PROOF_MODE: "u08-geometry-proof",
						PROOF_STAGE: stage,
					},
					timeout: 1000,
				});
				expect(result.status === 0, `${event}/${stage}`).toBe(
					event === "workflow_dispatch" && stage === "full",
				);
			}
		}
	});

	it("schedules only bootstrap plus the one bounded proof and preserves explicit validation arms", () => {
		const source = readFileSync(
			resolve(root, ".github/workflows/e2e.yml"),
			"utf8",
		);
		const blocks = source.slice(source.indexOf("\njobs:\n")).split(JOBS);
		const selected = [];
		for (let i = 1; i < blocks.length; i += 2) {
			const name = blocks[i],
				body = blocks[i + 1];
			if (!name || !body) continue;
			const guard = JOB_GUARD.exec(body)?.[1] ?? "true";
			if (
				runInNewContext(
					guard,
					{
						github: { event_name: "workflow_dispatch" },
						inputs: { proof_mode: "u08-geometry-proof" },
					},
					{ timeout: 100 },
				)
			)
				selected.push(name);
		}
		expect(selected).toEqual(["harness", "u08-geometry-proof"]);
		expect(source).toContain("            s15-proof)");
		expect(source).toContain("            core-audit-only)");
		expect(source).toContain("            u08-geometry-proof)");
		const job = source.split("  u08-geometry-proof:\n")[1] ?? "";
		expect(job).toContain("timeout-minutes: 30");
		expect(job).toContain("timeout-minutes: 5");
		expect(job).not.toContain("--tier core");
		expect(job).not.toContain("maestro");
	});
});
