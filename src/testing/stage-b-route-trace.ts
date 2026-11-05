/** Imported only by the dedicated proof bootstrap, never the ordinary app entry.
 * Observe the callback/publication/revision boundary without logging identities,
 * routes, refusal sentences, credentials or drafts, or awaiting telemetry in UI.
 * Initial /me timing remains the fixture's authoritative request timeline. */
export const STAGE_B_TRACE_PHASES = [
	"signed-out",
	"discovering",
	"minting",
	"live",
	"re-minting",
	"degraded",
	"refused",
	"other",
] as const;
export interface StageBTraceState {
	revision: number;
	phase: string;
	route: { mode: string } | null;
	tunnelId: string | null;
	surface: unknown;
}
export interface StageBRouteTrace {
	traceEvent: "row-press" | "state" | "superseded";
	traceSequence: number;
	traceAtMs: number;
	traceRevision: number;
	tracePhase: (typeof STAGE_B_TRACE_PHASES)[number];
	traceRoute: "none" | "radient" | "custom" | "other";
	traceSelected: boolean;
	traceFailure: boolean;
}
export function stageBRouteTrace(
	read: () => StageBTraceState,
	send: (event: StageBRouteTrace) => Promise<void>,
	now: () => number = Date.now,
) {
	let count = 0,
		last = "",
		tail = Promise.resolve();
	const emit = (traceEvent: StageBRouteTrace["traceEvent"]) => {
		if (count >= 32) return;
		const state = read();
		const tracePhase =
			STAGE_B_TRACE_PHASES.find((value) => value === state.phase) ?? "other";
		const traceRoute =
			state.route === null
				? "none"
				: state.route.mode === "radient"
					? "radient"
					: state.route.mode === "custom"
						? "custom"
						: "other";
		const projection = {
			traceRevision:
				Number.isSafeInteger(state.revision) && state.revision >= 0
					? state.revision
					: 0,
			tracePhase,
			traceRoute,
			traceSelected: state.tunnelId !== null,
			traceFailure: state.surface !== null,
		};
		const fingerprint = JSON.stringify(projection);
		if (traceEvent === "state" && fingerprint === last) return;
		last = fingerprint;
		const event: StageBRouteTrace = {
			...projection,
			traceRoute,
			traceEvent,
			traceSequence: ++count,
			traceAtMs: now(),
		};
		// Serialized, capped diagnostics are deliberately best-effort: an unreachable
		// fixture must never prevent the real callback/admission or extend /me's fence.
		tail = tail.then(() => send(event)).catch(() => {});
	};
	return {
		rowPress: () => emit("row-press"),
		superseded: () => emit("superseded"),
		observe: () => emit("state"),
		settled: () => tail,
	};
}
