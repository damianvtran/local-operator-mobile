import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { AuditNode, AuditState } from "./checks.ts";
import {
	ARTIFACT_LIMIT_BYTES,
	assertCoverage,
	evaluateRepairedCell,
	FAILURE_RESERVE_BYTES,
	nextArtifactBytes,
	POSITIVE_IDS,
	verificationRecords,
} from "./u08-fragment-verification.ts";
import {
	ORIGINAL_NODE_PATH,
	RECORD,
	verifyOriginalInstrument,
} from "./u08-geometry-proof.ts";

const root = resolve(import.meta.dirname, "../..");
const JOB = /^ {2}([\w-]+):\n/m,
	GUARD = /^ {4}if: (.+)$/m;
function incident(): AuditState {
	const rect = { x: 25, y: 467, w: 22, h: 18, right: 47, bottom: 485 };
	const nodes = [
		{
			index: 0,
			tag: "button",
			testId: "turn-bar-tc-conv-03-user",
			interactive: true,
			ownText: "",
			ancestors: [],
			rect,
			visibleRect: rect,
		},
		...[1, 2].map((index) => ({
			index,
			tag: "span",
			path: ORIGINAL_NODE_PATH,
			ownText: String(index),
			ancestors: [0],
			rect: index === 1 ? rect : { ...rect, w: 274, right: 299 },
			visibleRect: index === 1 ? rect : { ...rect, w: 274, right: 299 },
			u08PaintFragments:
				index === 1
					? [{ x: 25, y: 467.484375, w: 21.609375, h: 18.171875 }]
					: [{ x: 148.1875, y: 467.484375, w: 151.21875, h: 18.171875 }],
			position: "static",
			background: "transparent",
			ownBackground: "transparent",
		})),
	] as unknown as AuditNode[];
	return {
		nodes,
		u08GeometryVersion: 1,
		viewport: RECORD.viewport,
		insets: RECORD.insets,
		scale: "150",
		platform: "ios",
	} as AuditState;
}
describe("bounded corrected verification is not historical reproduction", () => {
	it("derives exactly four canonical original matrix cells and no arbitrary new scene", () => {
		const records = verificationRecords(RECORD);
		expect(records).toHaveLength(4);
		expect(new Set(records.map((r) => r.theme + "-" + r.state))).toEqual(
			new Set([
				"dark-condensed",
				"dark-expanded",
				"light-condensed",
				"light-expanded",
			]),
		);
		for (const r of records) {
			expect(r.viewport).toEqual({ width: 390, height: 844, dpr: 3 });
			expect(r.insets).toEqual({ top: 59, bottom: 34, left: 0, right: 0 });
			expect(r.scale).toBe("150");
			expect(r.pinnedScenario).toBe("long-transcript");
			expect(r.openers).toEqual([]);
		}
		expect(() => verifyOriginalInstrument()).toThrow(
			"Original probe/policy changed",
		);
	});
	it("requires actual original-family candidate, fragment data and DISJOINT policy decision", () => {
		expect(evaluateRepairedCell(incident(), ORIGINAL_NODE_PATH)).toMatchObject({
			pair: [1, 2],
			verdict: "EXCEPTION",
			geometry: { area: 0 },
		});
		expect(() =>
			evaluateRepairedCell({ ...incident(), nodes: [] }, ORIGINAL_NODE_PATH),
		).toThrow("Missing/ambiguous");
		expect(() =>
			evaluateRepairedCell(
				{ ...incident(), u08GeometryVersion: undefined },
				ORIGINAL_NODE_PATH,
			),
		).toThrow("schema");
		const wrong = incident();
		const target = wrong.nodes[0];
		if (target) target.testId = "toolbar";
		expect(() => evaluateRepairedCell(wrong, ORIGINAL_NODE_PATH)).toThrow(
			"scope",
		);
		const noFragments = incident();
		for (const n of noFragments.nodes) delete n.u08PaintFragments;
		expect(() => evaluateRepairedCell(noFragments, ORIGINAL_NODE_PATH)).toThrow(
			"fragment measurement",
		);
		const empty = incident();
		for (const n of empty.nodes.filter((n) => n.tag === "span"))
			n.u08PaintFragments = [];
		expect(() => evaluateRepairedCell(empty, ORIGINAL_NODE_PATH)).toThrow(
			"fragment measurement",
		);
		const collision = incident(),
			a = collision.nodes[1],
			b = collision.nodes[2];
		if (!a || !b) throw Error("Missing fixture");
		b.u08PaintFragments = a.u08PaintFragments;
		expect(() => evaluateRepairedCell(collision, ORIGINAL_NODE_PATH)).toThrow(
			"residual",
		);
	});
	it("refuses empty, duplicate, partial and missing-positive coverage", () => {
		const all = [
			"dark-condensed",
			"dark-expanded",
			"light-condensed",
			"light-expanded",
		].map((key) => ({ key }));
		expect(() => assertCoverage(all, true)).not.toThrow();
		expect(() => assertCoverage([], true)).toThrow("Incomplete");
		expect(() => assertCoverage(all, false)).toThrow("Incomplete");
		expect(() =>
			assertCoverage([all[0] ?? { key: "" }, ...all.slice(0, 3)], true),
		).toThrow("Incomplete");
	});
	it("admits corrected mode only for manual full-stage execution in actual bootstrap", () => {
		const source = readFileSync(
			resolve(root, ".github/workflows/e2e.yml"),
			"utf8",
		);
		const script = source
			.split("- name: Validate proof selection")[1]
			?.split("        run: |\n")[1]
			?.split("      - name: Detect the harness")[0];
		if (!script) throw Error("Missing validator");
		for (const event of [
			"workflow_dispatch",
			"push",
			"pull_request",
			"schedule",
		])
			for (const stage of ["full", "setup", "preflight"]) {
				const ran = spawnSync("bash", ["-c", script], {
					env: {
						PATH: process.env.PATH,
						GITHUB_EVENT_NAME: event,
						PROOF_MODE: "u08-fragment-verification",
						PROOF_STAGE: stage,
					},
					timeout: 1000,
				});
				expect(ran.status === 0, `${event}/${stage}`).toBe(
					event === "workflow_dispatch" && stage === "full",
				);
			}
	});

	it("selects only bootstrap + existing bounded job for the new explicit mode", () => {
		const source = readFileSync(
				resolve(root, ".github/workflows/e2e.yml"),
				"utf8",
			),
			parts = source.slice(source.indexOf("\njobs:\n")).split(JOB),
			selected = [];
		for (let i = 1; i < parts.length; i += 2) {
			const body = parts[i + 1],
				name = parts[i];
			if (
				body &&
				name &&
				runInNewContext(
					GUARD.exec(body)?.[1] ?? "true",
					{
						github: { event_name: "workflow_dispatch" },
						inputs: { proof_mode: "u08-fragment-verification" },
					},
					{ timeout: 100 },
				)
			)
				selected.push(name);
		}
		expect(selected).toEqual(["harness", "u08-geometry-proof"]);
		const job = source.split("  u08-geometry-proof:\n")[1] ?? "";
		expect(job).toContain("timeout-minutes: 30");
		expect(job).toContain("timeout-minutes: 5");
		expect(job).toContain("--preflight-only");
		expect(job).toContain("--verify-fragments");
		const runner = readFileSync(
			resolve(root, "tools/audit/u08-fragment-verification.ts"),
			"utf8",
		);
		expect(POSITIVE_IDS).toEqual(["modal-collide-a", "modal-collide-b"]);
		expect(ARTIFACT_LIMIT_BYTES).toBe(5 * 1024 * 1024);
		expect(runner).toContain("nextArtifactBytes(bytes, data.length)");
		expect(
			nextArtifactBytes(0, ARTIFACT_LIMIT_BYTES - FAILURE_RESERVE_BYTES),
		).toBe(ARTIFACT_LIMIT_BYTES - FAILURE_RESERVE_BYTES);
		expect(() =>
			nextArtifactBytes(ARTIFACT_LIMIT_BYTES - FAILURE_RESERVE_BYTES, 1),
		).toThrow("artifact budget");
	});
});
