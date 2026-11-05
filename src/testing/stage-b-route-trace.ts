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
	traceRoute: StageBRouteMode;
	traceSelected: boolean;
	traceFailure: boolean;
}
/** Same-process lease plus synchronous counters for the lost-tap gate. A
 * capped trace record cannot answer "did the callback run at all", so the
 * counts are kept OUTSIDE the 32-record cap and incremented at entry. */
export type StageBRouteMode = "none" | "radient" | "custom" | "other";
export interface StageBCallbackSnapshot {
	processId: string;
	presses: number;
	superseded: number;
	revision: number;
	phase: (typeof STAGE_B_TRACE_PHASES)[number];
	route: StageBRouteMode;
	selected: boolean;
	failure: boolean;
}
export function stageBRouteTrace(
	read: () => StageBTraceState,
	send: (event: StageBRouteTrace) => Promise<void>,
	now: () => number = Date.now,
	processId = "unleased",
) {
	let count = 0,
		presses = 0,
		supersessions = 0,
		last = "",
		tail = Promise.resolve();
	const project = () => {
		const state = read();
		const tracePhase =
			STAGE_B_TRACE_PHASES.find((value) => value === state.phase) ?? "other";
		const traceRoute: StageBRouteMode =
			state.route === null
				? "none"
				: state.route.mode === "radient"
					? "radient"
					: state.route.mode === "custom"
						? "custom"
						: "other";
		return {
			traceRevision:
				Number.isSafeInteger(state.revision) && state.revision >= 0
					? state.revision
					: 0,
			tracePhase,
			traceRoute,
			traceSelected: state.tunnelId !== null,
			traceFailure: state.surface !== null,
		};
	};
	const emit = (traceEvent: StageBRouteTrace["traceEvent"]) => {
		if (count >= 32) return;
		const projection = project();
		const fingerprint = JSON.stringify(projection);
		if (traceEvent === "state" && fingerprint === last) return;
		last = fingerprint;
		const event: StageBRouteTrace = {
			...projection,
			traceEvent,
			traceSequence: ++count,
			traceAtMs: now(),
		};
		// Serialized, capped diagnostics are deliberately best-effort: an unreachable
		// fixture must never prevent the real callback/admission or extend /me's fence.
		tail = tail.then(() => send(event)).catch(() => {});
	};
	return {
		rowPress: () => {
			presses++;
			emit("row-press");
		},
		superseded: () => {
			supersessions++;
			emit("superseded");
		},
		observe: () => emit("state"),
		settled: () => tail,
		/** Bounded, identity-free answer to "did THIS process run the callback". */
		probe: (): StageBCallbackSnapshot => {
			const projection = project();
			return {
				processId,
				presses,
				superseded: supersessions,
				revision: projection.traceRevision,
				phase: projection.tracePhase,
				route: projection.traceRoute,
				selected: projection.traceSelected,
				failure: projection.traceFailure,
			};
		},
	};
}
