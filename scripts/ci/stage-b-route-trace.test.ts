import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	type StageBRouteTrace,
	type StageBTraceState,
	stageBRouteTrace,
} from "../../src/testing/stage-b-route-trace";
import {
	instrumentStageBComputerPick,
	instrumentStageBSelectionFences,
} from "./stage-b-draft-build";

describe("proof-only callback/publication trace", () => {
	it("records callback, selection and revision changes without private payloads", async () => {
		const state: StageBTraceState = {
			revision: 0,
			phase: "discovering",
			route: null,
			tunnelId: null,
			surface: null,
		};
		const events: StageBRouteTrace[] = [];
		const trace = stageBRouteTrace(
			() => state,
			async (event) => {
				events.push(event);
			},
			() => 100,
		);
		trace.observe();
		trace.observe();
		trace.rowPress();
		Object.assign(state, {
			revision: 1,
			phase: "minting",
			route: { mode: "radient", hostname: "private-host" },
			tunnelId: "private-tunnel",
		});
		trace.observe();
		Object.assign(state, {
			revision: 2,
			phase: "refused",
			surface: { detail: "private-failure" },
		});
		trace.observe();
		trace.superseded();
		await trace.settled();
		expect(events.map((e) => e.traceEvent)).toEqual([
			"state",
			"row-press",
			"state",
			"state",
			"superseded",
		]);
		expect(events.map((e) => e.traceRevision)).toEqual([0, 0, 1, 2, 2]);
		expect(events[2]).toMatchObject({
			traceSelected: true,
			tracePhase: "minting",
			traceRoute: "radient",
		});
		expect(events[3]).toMatchObject({ traceFailure: true, traceRevision: 2 });
		const encoded = JSON.stringify(events);
		for (const value of ["private-host", "private-tunnel", "private-failure"])
			expect(encoded).not.toContain(value);
	});
	it("caps telemetry, collapses unknown values, and never awaits a failing fixture in the callback", async () => {
		const state: StageBTraceState = {
			revision: 0,
			phase: "private-phase",
			route: { mode: "private-mode" },
			tunnelId: null,
			surface: null,
		};
		const events: StageBRouteTrace[] = [];
		const trace = stageBRouteTrace(
			() => state,
			async (e) => {
				events.push(e);
				throw new Error("unavailable");
			},
			() => 100,
		);
		for (let i = 0; i < 80; i++) {
			state.revision = i;
			trace.observe();
			trace.rowPress();
		}
		await expect(trace.settled()).resolves.toBeUndefined();
		await trace.settled();
		expect(events).toHaveLength(32);
		expect(
			events.every((e) => e.tracePhase === "other" && e.traceRoute === "other"),
		).toBe(true);
		expect(events.map((e) => e.traceSequence)).toEqual(
			Array.from({ length: 32 }, (_, i) => i + 1),
		);
	});
	it("observes all five selection fences without changing their early-return behavior", async () => {
		const source =
			"\tconst selectComputer = useCallback(async()=>{\n" +
			"if (!admission.isCurrent()) return;\n".repeat(4) +
			"try { throw new Error('synthetic'); } catch { if (admission && !admission.isCurrent()) return; }\n});\n\tconst refreshList = 0;";
		const compiled = stripTypeScriptTypes(
			instrumentStageBSelectionFences(source),
		);
		for (let target = 1; target <= 5; target++) {
			let calls = 0,
				events = 0;
			await runInNewContext(`${compiled}\nselectComputer();`, {
				useCallback: (f: unknown) => f,
				admission: { isCurrent: () => ++calls !== target },
				__stageBSelectionSuperseded: () => events++,
			});
			expect(events).toBe(1);
			expect(calls).toBe(target);
		}
		expect(() => instrumentStageBSelectionFences("no member")).toThrow(
			"source mismatch",
		);
		const actual = readFileSync(
			new URL(
				"../../src/features/auth/connection-provider.tsx",
				import.meta.url,
			),
			"utf8",
		);
		expect(actual).not.toContain("__stageBSelectionSuperseded");
		expect(instrumentStageBSelectionFences(actual)).toContain(
			"__stageBSelectionSuperseded",
		);
	});
	it("instruments only the owned generated callback and does not veto selection on trace failure", () => {
		const source =
			"function pick(computer: {tunnelId:string}) { setPicked(computer.tunnelId); } pick({tunnelId:'synthetic'});";
		const compiled = stripTypeScriptTypes(instrumentStageBComputerPick(source));
		const calls: string[] = [];
		runInNewContext(compiled, {
			__stageBRowPress: () => calls.push("row-press"),
			setPicked: () => calls.push("selection"),
		});
		expect(calls).toEqual(["row-press", "selection"]);
		calls.length = 0;
		runInNewContext(compiled, {
			__stageBRowPress: () => {
				throw new Error("trace failure");
			},
			setPicked: () => calls.push("selection"),
		});
		expect(calls).toEqual(["selection"]);
		expect(() => instrumentStageBComputerPick("no callback")).toThrow(
			"source mismatch",
		);
		expect(() => instrumentStageBComputerPick(source + source)).toThrow(
			"source mismatch",
		);
		const product = readFileSync(
			new URL("../../src/features/auth/computers.tsx", import.meta.url),
			"utf8",
		);
		expect(product).not.toContain("__stageBRowPress");
		expect(instrumentStageBComputerPick(product)).toContain("__stageBRowPress");
	});
	it("counts every row entry synchronously, past the trace record cap, and probes without private data", async () => {
		const state: StageBTraceState = {
			revision: 0,
			phase: "signed-out",
			route: null,
			tunnelId: null,
			surface: null,
		};
		const events: StageBRouteTrace[] = [];
		const trace = stageBRouteTrace(
			() => state,
			async (event) => {
				events.push(event);
			},
			() => 7,
			"lease-1",
		);
		for (let i = 0; i < 40; i++) trace.rowPress();
		expect(trace.probe()).toEqual({
			processId: "lease-1",
			presses: 40,
			superseded: 0,
			revision: 0,
			phase: "signed-out",
			route: "none",
			selected: false,
			failure: false,
		});
		await trace.settled();
		expect(events).toHaveLength(32);
		Object.assign(state, {
			revision: 2,
			phase: "live",
			route: { mode: "radient", hostname: "private-host" },
			tunnelId: "private-tunnel",
		});
		trace.superseded();
		const probe = trace.probe();
		expect(probe).toMatchObject({
			presses: 40,
			superseded: 1,
			revision: 2,
			phase: "live",
			route: "radient",
			selected: true,
			processId: "lease-1",
		});
		expect(JSON.stringify(probe)).not.toContain("private-host");
		expect(JSON.stringify(probe)).not.toContain("private-tunnel");
	});
});
