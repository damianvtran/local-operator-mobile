/** Mock-only, in-memory evidence — never a new relay capability or durable receipt.
 * Keep admission separate from acknowledgment: dropping an HTTP reply must not
 * erase a side effect, and resetting a world must not release an old write into
 * its successor. Limits fail closed rather than evicting dedup identities.
 */
import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";

export type BarrierPoint = "config" | "start" | "start-ack" | "command-ack";
type Outcome = "release" | "drop" | "expired" | "cancelled";
interface Match {
	path: string;
	sessionId?: string;
	commandId?: string;
}
interface Barrier extends Partial<Match> {
	id: string;
	point: BarrierPoint;
	timeoutMs: number;
	state: "armed" | "entered" | "released" | "dropped" | "expired" | "cancelled";
	entered: Match | null;
}
interface HeldBarrier {
	view: Barrier;
	timer: ReturnType<typeof setTimeout>;
	finish: (outcome: Outcome) => void;
	resolve?: (outcome: Outcome) => void;
}
interface RequestEvidence {
	method: "POST";
	path: string;
	rawBody: string;
	body: Record<string, unknown>;
	bodySha256: string;
}
export interface Admission extends RequestEvidence {
	commandId: string;
	sessionId: string;
	op: string;
	images: {
		index: number;
		mimeType: string;
		byteLength: number;
		sha256: string;
	}[];
}
interface Creation extends RequestEvidence {
	sessionId: string;
}

export const STARTUP_LIMITS = {
	barriers: 16,
	admissions: 128,
	sessions: 64,
	imagesPerCommand: 64,
	bytes: 8 * 1024 * 1024,
} as const;
const digest = (bytes: string | Buffer) =>
	createHash("sha256").update(bytes).digest("hex");
const points: BarrierPoint[] = ["config", "start", "start-ack", "command-ack"];
const BARRIER_ID = /^[a-zA-Z0-9_-]{1,48}$/;
const API_PATH = /^\/api\/[a-zA-Z0-9/_-]{1,160}$/;
const SESSION_ID = /^[0-9a-f]{12}$/;
const COMMAND_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createStartupEvidence() {
	const barriers = new Map<string, HeldBarrier>();
	const admissions = new Map<string, Admission>();
	const createdSessions: Creation[] = [];
	const replies = new Map<ServerResponse, () => void>();
	let bytes = 0;
	const evidence = (
		path: string,
		body: Record<string, unknown>,
		rawBody: string,
	): RequestEvidence => ({
		method: "POST",
		path,
		body: structuredClone(body),
		rawBody,
		bodySha256: digest(rawBody),
	});
	// Count both retained body representations. Only synthetic prompt/steer/start
	// inputs enter this ledger; login, cookies and credential commands never do.
	const reserve = (body: Record<string, unknown>, rawBody: string) => {
		const size =
			Buffer.byteLength(rawBody) + Buffer.byteLength(JSON.stringify(body));
		if (bytes + size > STARTUP_LIMITS.bytes) return false;
		bytes += size;
		return true;
	};
	return {
		arm(input: Record<string, unknown>) {
			const { id, point, path, sessionId, commandId } = input;
			const timeoutMs = input.timeoutMs ?? 30_000;
			if (
				typeof id !== "string" ||
				!BARRIER_ID.test(id) ||
				!points.includes(point as BarrierPoint) ||
				typeof timeoutMs !== "number" ||
				!Number.isInteger(timeoutMs) ||
				timeoutMs < 1 ||
				timeoutMs > 60_000 ||
				(path !== undefined &&
					(typeof path !== "string" || !API_PATH.test(path))) ||
				(sessionId !== undefined &&
					(typeof sessionId !== "string" || !SESSION_ID.test(sessionId))) ||
				(commandId !== undefined &&
					(typeof commandId !== "string" || !COMMAND_ID.test(commandId)))
			) {
				throw new Error(
					"invalid barrier: id, point, optional path/sessionId/commandId and timeoutMs (1..60000) required",
				);
			}
			if (barriers.has(id) || barriers.size >= STARTUP_LIMITS.barriers)
				throw new Error(
					"barrier id reused or capacity reached; reset the scenario",
				);
			const view: Barrier = {
				id,
				point: point as BarrierPoint,
				timeoutMs,
				state: "armed",
				entered: null,
				...(typeof path === "string" ? { path } : {}),
				...(typeof sessionId === "string" ? { sessionId } : {}),
				...(typeof commandId === "string" ? { commandId } : {}),
			};
			const held: HeldBarrier = {
				view,
				timer: setTimeout(() => held.finish("expired"), timeoutMs),
				finish(outcome) {
					if (view.state !== "armed" && view.state !== "entered") return;
					clearTimeout(held.timer);
					view.state =
						outcome === "release"
							? "released"
							: outcome === "drop"
								? "dropped"
								: outcome;
					held.resolve?.(outcome);
				},
			};
			barriers.set(id, held);
			return structuredClone(view);
		},
		release(id: string, outcome: unknown = "release") {
			const held = barriers.get(id);
			if (held?.view.state !== "entered")
				throw new Error("barrier is not entered");
			if (outcome !== "release" && outcome !== "drop")
				throw new Error("outcome must be release or drop");
			if (
				outcome === "drop" &&
				held.view.point !== "start-ack" &&
				held.view.point !== "command-ack"
			)
				throw new Error("drop requires an after-admission ack barrier");
			held.finish(outcome);
			return structuredClone(held.view);
		},
		async wait(
			point: BarrierPoint,
			match: Match,
			res: ServerResponse,
		): Promise<boolean> {
			if (res.destroyed) return false;
			const held = [...barriers.values()].find(
				({ view }) =>
					view.state === "armed" &&
					view.point === point &&
					(view.path === undefined || view.path === match.path) &&
					(view.sessionId === undefined ||
						view.sessionId === match.sessionId) &&
					(view.commandId === undefined || view.commandId === match.commandId),
			);
			if (!held) return !res.destroyed;
			held.view.state = "entered";
			held.view.entered = { ...match };
			const closed = () => held.finish("cancelled");
			res.once("close", closed);
			const outcome = await new Promise<Outcome>((resolve) => {
				held.resolve = resolve;
			});
			res.off("close", closed);
			if (outcome === "release") return !res.destroyed;
			if (outcome === "expired" && !res.destroyed) {
				res.writeHead(504, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "mock barrier expired" }));
			} else res.destroy();
			return false;
		},
		trackReply(res: ServerResponse, delayMs?: number, reply?: () => void) {
			// The existing no-ack faults also own sockets/timers. Reaping only the
			// new barriers would leave their previous world's request alive on reset.
			replies.get(res)?.();
			const timer =
				delayMs === undefined
					? undefined
					: setTimeout(() => {
							cleanup();
							if (!res.destroyed) reply?.();
						}, delayMs);
			const cleanup = () => {
				clearTimeout(timer);
				res.off("close", cleanup);
				res.off("finish", cleanup);
				replies.delete(res);
			};
			replies.set(res, cleanup);
			res.once("close", cleanup);
			res.once("finish", cleanup);
		},
		admit(
			sessionId: string,
			commandId: string,
			body: Record<string, unknown>,
			rawBody: string,
		) {
			if (admissions.has(commandId)) return true;
			if (
				admissions.size >= STARTUP_LIMITS.admissions ||
				(Array.isArray(body.images) &&
					body.images.length > STARTUP_LIMITS.imagesPerCommand) ||
				!reserve(body, rawBody)
			)
				return false;
			const images = (Array.isArray(body.images) ? body.images : []).map(
				(image, index) => {
					const data = Buffer.from(
						typeof image.data_b64 === "string" ? image.data_b64 : "",
						"base64",
					);
					return {
						index,
						mimeType:
							typeof image.mime_type === "string"
								? image.mime_type
								: "image/png",
						byteLength: data.length,
						sha256: digest(data),
					};
				},
			);
			admissions.set(commandId, {
				...evidence(`/api/sessions/${sessionId}/command`, body, rawBody),
				sessionId,
				commandId,
				op: String(body.op),
				images,
			});
			return true;
		},
		create(sessionId: string, body: Record<string, unknown>, rawBody: string) {
			if (
				createdSessions.length >= STARTUP_LIMITS.sessions ||
				!reserve(body, rawBody)
			)
				return false;
			createdSessions.push({
				...evidence("/api/sessions/start", body, rawBody),
				sessionId,
			});
			return true;
		},
		imageRefs(commandId: string) {
			return (admissions.get(commandId)?.images ?? []).map((image) => ({
				index: image.index,
				mime_type: image.mimeType,
			}));
		},
		image(sessionId: string, entry: string, index: number) {
			const admission = admissions.get(entry.slice("user-".length));
			if (admission?.sessionId !== sessionId || !entry.startsWith("user-"))
				return undefined;
			const image = Array.isArray(admission.body.images)
				? admission.body.images[index]
				: undefined;
			return image
				? {
						data: Buffer.from(
							typeof image.data_b64 === "string" ? image.data_b64 : "",
							"base64",
						),
						mimeType: image.mime_type ?? "image/png",
					}
				: null;
		},
		snapshot() {
			return structuredClone({
				limits: STARTUP_LIMITS,
				retainedBytes: bytes,
				barriers: [...barriers.values()].map(({ view }) => view),
				createdSessions,
				admissions: [...admissions.values()],
			});
		},
		reset() {
			for (const held of barriers.values()) held.finish("cancelled");
			for (const [res, cleanup] of replies) {
				cleanup();
				res.destroy();
			}
			barriers.clear();
			admissions.clear();
			createdSessions.length = 0;
			bytes = 0;
		},
	};
}
