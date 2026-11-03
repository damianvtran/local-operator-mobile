/** Proof-only handshake. Listener readiness is not phase success: it gates
 * the single existing openurl, with no sleeps, retries or URL re-delivery. */
import type { Server } from "node:http";
import type { RefusedReason } from "./auth-retirement-phase-diagnostics.ts";
// Run41547698402: live process, no receipts/refusals after60s, openurl7.81s
// after launch. Bound JS listener startup separately before sending any URL.
export const READY_BUDGET_MS = 45000;
export const READY_KINDS = ["listener-ready"] as const;
export const PROGRESS_KINDS = ["url-admitted", "url-refused"] as const;
export const URL_REFUSAL_REASONS = [
	"identity",
	"scheme",
	"nonce",
	"phase",
	"callback",
	"parse",
] as const;
const PHASES = [
	"seed",
	"persist-control",
	"retire",
	"retired-restore",
	"fresh-replace",
	"fresh-restore",
];
export class ReadyTimeout extends Error {
	constructor() {
		super("Native listener readiness timed out");
	}
}
export function createReadyGate(budgetMs = READY_BUDGET_MS) {
	let receive: ((at: number) => void) | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		arm(): Promise<number> {
			if (receive) throw new Error("Ready waiter already armed");
			const pending = new Promise<number>((yes, no) => {
				receive = yes;
				timer = setTimeout(() => {
					receive = null;
					no(new ReadyTimeout());
				}, budgetMs);
			});
			void pending.catch(() => undefined);
			return pending;
		},
		accept(): boolean {
			if (!receive) return false;
			const yes = receive;
			receive = null;
			clearTimeout(timer);
			yes(performance.now());
			return true;
		},
		cancel(): void {
			clearTimeout(timer);
			receive = null;
		},
	};
}
export async function launchWithReady<T>(
	gate: ReturnType<typeof createReadyGate>,
	launch: () => Promise<T>,
): Promise<{ launch: T; readyAt: number }> {
	const ready = gate.arm(); // Must precede launch: native readiness may arrive during it.
	try {
		const result = await launch();
		return { launch: result, readyAt: await ready };
	} finally {
		gate.cancel();
	}
}
export function signalRefusal(
	value: unknown,
	path: "/ready" | "/progress",
	phase: string,
	flavor: string,
	source: string,
): RefusedReason | null {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return "coarse-type";
	const r = value as Record<string, unknown>;
	const allowed =
		path === "/ready"
			? ["kind", "flavor", "sourceSha"]
			: ["kind", "phase", "reason", "flavor", "sourceSha"];
	if (Object.keys(r).some((key) => !allowed.includes(key)))
		return "unknown-key";
	if (r.flavor !== flavor) return "flavor-mismatch";
	if (r.sourceSha !== source) return "source-mismatch";
	if (path === "/ready")
		return r.kind === "listener-ready" ? null : "progress-unknown";
	if (r.kind !== "url-admitted" && r.kind !== "url-refused")
		return "progress-unknown";
	if ("phase" in r && r.phase !== phase) return "phase-mismatch";
	if (
		r.kind === "url-admitted" &&
		(!PHASES.includes(String(r.phase)) || "reason" in r)
	)
		return "progress-unknown";
	if (
		r.kind === "url-refused" &&
		!URL_REFUSAL_REASONS.some((reason) => reason === r.reason)
	)
		return "progress-unknown";
	return null;
}
export function urlProgress(value: unknown): string {
	if (!value || typeof value !== "object") return "none";
	const r = value as Record<string, unknown>;
	if (r.kind === "url-admitted") return "admitted";
	return r.kind === "url-refused" &&
		URL_REFUSAL_REASONS.some((reason) => reason === r.reason)
		? `refused:${r.reason}`
		: "none";
}
export function listenForProofSignals(
	server: Server,
	port: number,
): Promise<void> {
	if (!Number.isInteger(port) || port < 20000 || port > 39999)
		throw new Error("Proof receiver port refused");
	return new Promise((yes, no) => {
		const failed = (error: Error) => {
			server.off("listening", listening);
			no(error);
		};
		const listening = () => {
			server.off("error", failed);
			yes();
		};
		server.once("error", failed);
		server.once("listening", listening);
		server.listen(port, "127.0.0.1");
	});
}

export function safeUrlProgress(value: unknown): string {
	if (value === "admitted" || value === "none") return value;
	return URL_REFUSAL_REASONS.some((reason) => value === `refused:${reason}`)
		? String(value)
		: "none";
}
