import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { AuditNode, AuditState } from "./checks.ts";
import {
	ARTIFACT_LIMIT_BYTES,
	assertCoverage,
	assertTurnControl,
	evaluateRepairedCell,
	FAILURE_RESERVE_BYTES,
	type FailureContext,
	nextArtifactBytes,
	POSITIVE_IDS,
	TURN_CONTROL_ID,
	TURN_CONTROL_SOURCE,
	verificationRecords,
	writeFailureEvidence,
} from "./u08-fragment-verification.ts";
import {
	ORIGINAL_NODE_PATH,
	RECORD,
	verifyOriginalInstrument,
} from "./u08-geometry-proof.ts";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const cell = {
	theme: "dark",
	state: "condensed",
	path: "/session/6714def86197?lo-scroll=top",
};
interface PaintNode {
	tagName: string;
	parentElement: PaintNode | null;
	childElementCount: number;
	textContent: string;
	style: {
		display: string;
		visibility: string;
		opacity: string;
		contentVisibility: string;
	};
	getClientRects: () => {
		x: number;
		y: number;
		width: number;
		height: number;
	}[];
	getAttribute: (name: string) => string | null;
	querySelectorAll: () => PaintNode[];
}
function controlFixture(glyph = "▸", aria: string | null = null) {
	const make = (
		tagName: string,
		parentElement: PaintNode | null,
		textContent = "",
	): PaintNode => ({
		tagName,
		parentElement,
		textContent,
		childElementCount: 0,
		style: {
			display: "block",
			visibility: "visible",
			opacity: "1",
			contentVisibility: "visible",
		},
		getClientRects: () => [{ x: 0, y: 100, width: 12, height: 18 }],
		getAttribute: () => null,
		querySelectorAll: () => [],
	});
	const ancestor = make("BODY", null),
		control = make("BUTTON", ancestor),
		leaf = make("SPAN", control, glyph);
	control.childElementCount = 1;
	control.style.display = "flex";
	leaf.style.display = "inline";
	control.getAttribute = (name) => (name === "aria-expanded" ? aria : null);
	control.querySelectorAll = () => [leaf];
	let styleReads = 0;
	const collect = (
		controls: PaintNode[] = [control],
		readStyle = (node: PaintNode) => node.style,
	) => {
		styleReads = 0;
		const reading = runInNewContext(
			TURN_CONTROL_SOURCE,
			{
				document: { querySelectorAll: () => controls },
				getComputedStyle: (node: PaintNode) => {
					styleReads++;
					return readStyle(node);
				},
			},
			{ timeout: 100 },
		);
		return { reading, styleReads };
	};
	return { ancestor, control, leaf, collect };
}
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXcAAAAASUVORK5CYII=",
	"base64",
);
function failureContext(): FailureContext {
	return {
		head: "synthetic-head",
		phase: "control-state",
		cell,
		completedKeys: ["light-condensed"],
		readiness: { path: "/session/6714def86197", testIds: [TURN_CONTROL_ID] },
		environment: {
			theme: "dark",
			viewport: { width: 390, height: 844, dpr: 3 },
		},
		control: {
			controlId: TURN_CONTROL_ID,
			count: 1,
			ariaExpanded: null,
			caretCount: 0,
			carets: [],
		},
		error: "control-state expected caret ▸; observed none",
	};
}
function outputDir() {
	return mkdtempSync(
		resolve(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			"u08-failure-test-",
		),
	);
}

describe("hosted control contract and live-lifetime failure evidence", () => {
	it("accepts the actual installed RNW caret when accessibilityState does not become ARIA, and checks explicit ARIA consistently", () => {
		// Real compiled package, bypassing native test mocks. SSR is not browser or
		// native layout/IME proof: it discriminates this adapter/attribute contract.
		const React = require("react"),
			{ renderToStaticMarkup } = require("react-dom/server"),
			{ Pressable, Text } = require("react-native-web");
		for (const expanded of [false, true])
			for (const explicit of [false, true]) {
				const props = explicit
					? { "aria-expanded": expanded }
					: { accessibilityState: { expanded } };
				const html = renderToStaticMarkup(
					React.createElement(
						Pressable,
						{ testID: TURN_CONTROL_ID, accessibilityRole: "button", ...props },
						React.createElement(Text, null, expanded ? "▾" : "▸"),
					),
				);
				const carets = [...html.matchAll(/>(▸|▾)</gu)].map((m) => m[1]);
				expect([
					...html.matchAll(/data-testid="turn-bar-tc-conv-00-user"/g),
				]).toHaveLength(1);
				expect(carets).toEqual([expanded ? "▾" : "▸"]);
				// Markup is actually rendered by RNW; style/layout facts below are explicit
				// supplied logical controls, not claimed SSR/browser measurements.
				const fixture = controlFixture(
					carets[0],
					html.match(/aria-expanded="([^"]*)"/)?.[1] ?? null,
				);
				const { reading, styleReads } = fixture.collect();
				expect(styleReads).toBeGreaterThan(0);
				expect(reading.ariaExpanded).toBe(explicit ? String(expanded) : null);
				expect(reading.ariaExpanded === String(expanded)).toBe(explicit); // Old guard fails on the same real RNW output.
				expect(reading.count).toBe(1);
				expect(reading.carets).toEqual([expanded ? "▾" : "▸"]);
				expect(() =>
					assertTurnControl(
						{ ...cell, state: expanded ? "expanded" : "condensed" },
						reading,
					),
				).not.toThrow();
			}
	});
	it("executes the real collector and refuses missing, duplicate, wrong-caret, hidden or contradictory state", () => {
		const fixture = controlFixture();
		const { control } = fixture;
		const collect = (controls: PaintNode[]) =>
			fixture.collect(controls).reading;
		const good = collect([control]);
		expect(() => assertTurnControl(cell, good)).not.toThrow();
		expect(good.ariaExpanded).toBeNull();
		for (const reading of [
			collect([]),
			collect([control, controlFixture().control]),
			controlFixture("▾").collect().reading,
			(() => {
				const hidden = controlFixture();
				hidden.leaf.getClientRects = () => [];
				return hidden.collect().reading;
			})(),
			{ ...good, ariaExpanded: "true" },
			{ ...good, ariaExpanded: undefined },
			{ ...good, carets: ["▸", "▸"], caretCount: 2 },
			undefined,
		]) {
			expect(() => assertTurnControl(cell, reading)).toThrow(
				/control-state theme=dark state=condensed path=.*control=turn-bar.*expected aria=false caret=▸; unreadable=.*; observed=/,
			);
		}
		expect(() =>
			assertTurnControl(
				{ ...cell, state: "expanded" },
				{ ...good, carets: ["▾"], ariaExpanded: "false" },
			),
		).toThrow("expected aria=true");
	});
	it("refuses non-painted and collapsed caret/control witnesses through the actual probe and guard", () => {
		type Fixture = ReturnType<typeof controlFixture>;
		const cases: [string, (f: Fixture) => void, string][] = [
			[
				"own visibility",
				(f) => {
					f.leaf.style.visibility = "hidden";
				},
				"visibility",
			],
			[
				"own opacity",
				(f) => {
					f.leaf.style.opacity = "0";
				},
				"opacity",
			],
			[
				"control visibility",
				(f) => {
					f.control.style.visibility = "hidden";
				},
				"visibility",
			],
			[
				"control opacity",
				(f) => {
					f.control.style.opacity = "0";
				},
				"opacity",
			],
			[
				"ancestor visibility",
				(f) => {
					f.ancestor.style.visibility = "hidden";
				},
				"visibility",
			],
			[
				"ancestor opacity",
				(f) => {
					f.ancestor.style.opacity = "0";
				},
				"opacity",
			],
			[
				"caret zero area",
				(f) => {
					f.leaf.getClientRects = () => [{ x: 0, y: 100, width: 0, height: 0 }];
				},
				"rect-area",
			],
			[
				"control zero area",
				(f) => {
					f.control.getClientRects = () => [
						{ x: 0, y: 100, width: 0, height: 18 },
					];
				},
				"rect-area",
			],
			[
				"display none",
				(f) => {
					f.leaf.style.display = "none";
					f.leaf.getClientRects = () => [];
				},
				"rect-area",
			],
			[
				"ancestor display none",
				(f) => {
					f.ancestor.style.display = "none";
				},
				"display",
			],
			[
				"effective opacity zero",
				(f) => {
					f.control.style.opacity = "1e-200";
					f.ancestor.style.opacity = "1e-200";
				},
				"effective-opacity",
			],
			[
				"unknown opacity",
				(f) => {
					f.leaf.style.opacity = "not-a-number";
				},
				"opacity",
			],
			[
				"unreadable style",
				(f) => {
					Object.defineProperty(f.leaf.style, "visibility", {
						get() {
							throw new Error("unreadable computed visibility");
						},
					});
				},
				"computed-style",
			],
		];
		for (const [name, mutate, property] of cases) {
			const f = controlFixture();
			mutate(f);
			const { reading, styleReads } = f.collect();
			expect(styleReads, name).toBeGreaterThan(0);
			expect(() => assertTurnControl(cell, reading), name).toThrow(property);
			expect(reading.caretCount, name).toBe(0);
		}
		const visible = controlFixture();
		visible.leaf.style.opacity = "0.5";
		visible.control.style.opacity = "0.5";
		visible.ancestor.style.opacity = "0.5";
		const { reading } = visible.collect();
		expect(() => assertTurnControl(cell, reading)).not.toThrow();
		expect(reading.caretVisibility[0].visibility.effectiveOpacity).toBe(0.125);
	});
	it("retains the failing computed property and measured style trace in failure diagnostics", async () => {
		const f = controlFixture();
		f.ancestor.style.opacity = "0";
		const { reading } = f.collect();
		const out = outputDir();
		try {
			await writeFailureEvidence(
				out,
				0,
				{ ...failureContext(), control: reading },
				null,
			);
			const saved = JSON.parse(
				readFileSync(resolve(out, "failure.json"), "utf8"),
			);
			expect(saved.readabilityFailure).toMatchObject({
				property: "opacity",
				value: "0",
				style: { tag: "BODY", opacity: "0", effectiveOpacity: 0 },
			});
			expect(
				saved.control.controlVisibility.trace.some(
					(t: { opacity: string }) => t.opacity === "0",
				),
			).toBe(true);
			expect(saved.diagnosed).toBe(false);
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	});

	it("writes actual partial-context and PNG bytes before caller teardown, preserving prior cell records", async () => {
		const out = outputDir();
		let alive = true;
		try {
			writeFileSync(
				resolve(out, "light-condensed.json"),
				JSON.stringify({
					kind: "PARTIAL CORRECTED CELL",
					key: "light-condensed",
				}),
			);
			await writeFailureEvidence(out, 0, failureContext(), async () => {
				expect(alive).toBe(true);
				return { data: png.toString("base64") };
			});
			alive = false;
			const saved = JSON.parse(
				readFileSync(resolve(out, "failure.json"), "utf8"),
			);
			expect(saved).toMatchObject({
				...failureContext(),
				diagnosed: false,
				screenshot: { status: "saved" },
			});
			expect(readFileSync(resolve(out, "failure.png"))).toEqual(png);
			expect(
				JSON.parse(readFileSync(resolve(out, "light-condensed.json"), "utf8"))
					.key,
			).toBe("light-condensed");
			expect(
				readdirSync(out).reduce(
					(n, name) => n + statSync(resolve(out, name)).size,
					0,
				),
			).toBeLessThanOrEqual(ARTIFACT_LIMIT_BYTES);
			expect(readdirSync(out)).not.toContain("verification.json");
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	});
	it("keeps failure context when screenshots fail or the aggregate image budget is exhausted", async () => {
		for (const mode of ["no-page", "reject", "invalid", "budget", "stall"]) {
			const out = outputDir();
			try {
				if (mode === "budget") {
					writeFileSync(resolve(out, "prior.png"), "");
					truncateSync(
						resolve(out, "prior.png"),
						ARTIFACT_LIMIT_BYTES - FAILURE_RESERVE_BYTES,
					);
				}
				const capture =
					mode === "no-page"
						? null
						: async () => {
								if (mode === "stall") return new Promise<never>(() => {});
								if (mode === "reject") throw new Error("page closed");
								return {
									data: mode === "invalid" ? "bad" : png.toString("base64"),
								};
							};
				await writeFailureEvidence(out, 0, failureContext(), capture);
				const saved = JSON.parse(
					readFileSync(resolve(out, "failure.json"), "utf8"),
				);
				expect(saved.screenshot.status).toBe("unavailable");
				expect(saved.cell).toEqual(cell);
				expect(saved.diagnosed).toBe(false);
				expect(readdirSync(out)).not.toContain("failure.png");
				expect(
					readdirSync(out).reduce(
						(n, name) => n + statSync(resolve(out, name)).size,
						0,
					),
				).toBeLessThanOrEqual(ARTIFACT_LIMIT_BYTES - 2048);
			} finally {
				rmSync(out, { recursive: true, force: true });
			}
		}
	});
	it("retains bounded cell identity when oversized errors have no control reply", async () => {
		const out = outputDir();
		try {
			await writeFailureEvidence(
				out,
				0,
				{
					...failureContext(),
					control: undefined,
					error: "x".repeat(32768),
					environment: { oversized: "x".repeat(32768) },
				},
				null,
			);
			const file = readFileSync(resolve(out, "failure.json"));
			const saved = JSON.parse(file.toString());
			expect(file.length).toBeLessThanOrEqual(FAILURE_RESERVE_BYTES / 2);
			expect(saved.cell).toEqual(cell);
			expect(saved.diagnosed).toBe(false);
			expect(saved.expectedControl).toMatchObject({
				controlId: TURN_CONTROL_ID,
				caret: "▸",
				ariaExpanded: "false",
				ariaMayBeAbsent: true,
			});
			expect(saved.control.summary).toBe("undefined");
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	});
});

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
