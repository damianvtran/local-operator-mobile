import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import {
	AGENT_AVATAR_SHAS,
	AGENT_AVATARS,
	REMOVED_AVATAR_SHA,
} from "./scenarios.ts";

/** Capture instrumentation, NOT a relay capability. Only the two fabricated
 * fixture agents and their existing pixels may enter this store. Keeping it
 * separate from startup avoids turning startup's /api matcher into an arbitrary
 * response interception surface. Every instance belongs to one mock relay. */
type Agent = "researcher" | "reviewer";
type Variant = Agent | "removed" | "none";
type ResponseKind = "selected" | "unauthorized" | "forbidden" | "refused";
type Snapshot = {
	status: number;
	sha256: string | null;
	headers: Record<string, string>;
	body: Buffer;
};
type BarrierView = {
	id: string;
	agentId: Agent;
	sha256: string;
	timeoutMs: number;
	response: ResponseKind;
	state:
		| "armed"
		| "entered"
		| "released"
		| "completed"
		| "cancelled"
		| "expired";
	selected?: { status: number; sha256: string | null };
};
type Event = {
	seq: number;
	kind: string;
	barrierId?: string;
	sessionId?: string;
	agentId?: Agent | null;
	sha256?: string | null;
	status?: number;
};
type Held = {
	view: BarrierView;
	timer: ReturnType<typeof setTimeout>;
	res?: ServerResponse;
	cancel?: () => void;
	complete?: () => void;
	resolve?: (send: boolean) => void;
};
// Read through a fresh parameter after await: release/reset/client-close mutate
// the held view externally, beyond TypeScript’s local control-flow narrowing.
const isReleased = (held: Held): boolean => held.view.state === "released";

const isAgent = (value: unknown): value is Agent =>
	value === "researcher" || value === "reviewer";
const isVariant = (value: unknown): value is Variant =>
	isAgent(value) || value === "removed" || value === "none";
const isResponse = (value: unknown): value is ResponseKind =>
	value === "selected" ||
	value === "unauthorized" ||
	value === "forbidden" ||
	value === "refused";
const knownHash = (value: unknown): value is string =>
	value === AGENT_AVATAR_SHAS.researcher ||
	value === AGENT_AVATAR_SHAS.reviewer ||
	value === REMOVED_AVATAR_SHA;
function exact(input: unknown, fields: string[]): Record<string, unknown> {
	if (
		!input ||
		typeof input !== "object" ||
		Array.isArray(input) ||
		Object.keys(input).length !== fields.length ||
		!fields.every((field) => Object.hasOwn(input, field))
	) {
		throw new Error("invalid avatar capture fields");
	}
	return input as Record<string, unknown>;
}
const jsonSnapshot = (status: number, error: string): Snapshot => ({
	status,
	sha256: null,
	headers: { "content-type": "application/json", "cache-control": "no-store" },
	body: Buffer.from(JSON.stringify({ error })),
});

export function createAvatarCapture() {
	const barriers = new Map<string, Held>();
	const variants = new Map<Agent, Variant>();
	const subscribers = new Map<
		ServerResponse,
		{ publish: () => void; close: () => void }
	>();
	let world = 0;
	let sequence = 0;
	let events: Event[] = [];
	const event = (value: Omit<Event, "seq">) => {
		events.push({ seq: ++sequence, ...value });
		if (events.length > 128) events.shift();
	};
	const detach = (held: Held) => {
		clearTimeout(held.timer);
		if (held.res && held.cancel) held.res.off("close", held.cancel);
		if (held.res && held.complete) held.res.off("finish", held.complete);
		held.cancel = undefined;
		held.complete = undefined;
	};
	const cancel = (held: Held, expired = false) => {
		if (!["armed", "entered", "released"].includes(held.view.state)) return;
		detach(held);
		held.view.state = expired ? "expired" : "cancelled";
		event({ kind: held.view.state, barrierId: held.view.id });
		const res = held.res;
		if (res && !res.destroyed) {
			if (expired && !res.headersSent) {
				res.writeHead(504, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "mock avatar barrier expired" }));
			} else res.destroy();
		}
		held.resolve?.(false);
		held.resolve = undefined;
		held.res = undefined;
	};
	return {
		snapshot() {
			return {
				world,
				barriers: [...barriers.values()].map(({ view }) =>
					structuredClone(view),
				),
				events: structuredClone(events),
			};
		},
		arm(input: unknown) {
			const body = exact(input, [
				"id",
				"agentId",
				"sha256",
				"timeoutMs",
				"response",
			]);
			const { id, agentId, sha256, timeoutMs, response } = body;
			if (
				typeof id !== "string" ||
				!/^[a-zA-Z0-9_-]{1,48}$/.test(id) ||
				!isAgent(agentId) ||
				!knownHash(sha256) ||
				typeof timeoutMs !== "number" ||
				!Number.isInteger(timeoutMs) ||
				timeoutMs < 1 ||
				timeoutMs > 30_000 ||
				!isResponse(response) ||
				barriers.has(id) ||
				barriers.size >= 16
			) {
				throw new Error("invalid avatar barrier");
			}
			const view: BarrierView = {
				id,
				agentId,
				sha256,
				timeoutMs,
				response,
				state: "armed",
			};
			const held: Held = {
				view,
				timer: setTimeout(() => cancel(held, true), timeoutMs),
			};
			barriers.set(id, held);
			return structuredClone(view);
		},
		release(id: string, input: unknown) {
			const body = exact(input, ["outcome"]);
			const held = barriers.get(id);
			if (body.outcome !== "release" || held?.view.state !== "entered") {
				throw new Error("avatar barrier is not releasable");
			}
			clearTimeout(held.timer);
			held.view.state = "released";
			event({ kind: "released", barrierId: id });
			held.resolve?.(true);
			held.resolve = undefined;
			return structuredClone(held.view);
		},
		/** Selection is synchronous and copies the bytes. A later metadata edit
		 * cannot change an already-authenticated request's retained response. */
		select(
			agentId: string,
			requested: string | null,
			etag: string | undefined,
		): Snapshot {
			if (!isAgent(agentId)) return jsonSnapshot(404, "not_found");
			const variant = variants.get(agentId) ?? agentId;
			if (!isAgent(variant) || requested === REMOVED_AVATAR_SHA)
				return jsonSnapshot(404, "not_found");
			const body = Buffer.from(AGENT_AVATARS[variant] as Buffer);
			const sha256 = createHash("sha256").update(body).digest("hex");
			const tag = `"${sha256}"`;
			if (etag === tag)
				return {
					status: 304,
					sha256: null,
					headers: { etag: tag },
					body: Buffer.alloc(0),
				};
			return {
				status: 200,
				sha256,
				body,
				headers: {
					"content-type": "image/png",
					"content-length": String(body.length),
					etag: tag,
					"cache-control": "private, max-age=31536000, immutable",
				},
			};
		},
		async serve(
			agentId: string,
			requested: string | null,
			selected: Snapshot,
			res: ServerResponse,
		) {
			if (res.destroyed) return;
			const held = [...barriers.values()].find(
				({ view }) =>
					view.state === "armed" &&
					view.agentId === agentId &&
					view.sha256 === requested,
			);
			let response = selected;
			if (held) {
				if (held.view.response !== "selected") {
					const status =
						held.view.response === "unauthorized"
							? 401
							: held.view.response === "forbidden"
								? 403
								: 503;
					response = jsonSnapshot(status, "mock_avatar_refusal");
				}
				held.view.selected = {
					status: response.status,
					sha256: response.sha256,
				};
				event({
					kind: "selected",
					barrierId: held.view.id,
					agentId: held.view.agentId,
					...held.view.selected,
				});
				held.view.state = "entered";
				event({ kind: "entered", barrierId: held.view.id });
				held.res = res;
				held.cancel = () => cancel(held);
				res.once("close", held.cancel);
				const send = await new Promise<boolean>((resolve) => {
					held.resolve = resolve;
				});
				if (!send || res.destroyed) return;
				// Reset can cancel a released response before this continuation runs.
				if (!isReleased(held)) return;
				held.complete = () => {
					detach(held);
					held.view.state = "completed";
					event({
						kind: "completed",
						barrierId: held.view.id,
						status: response.status,
						sha256: response.sha256,
					});
					held.res = undefined;
				};
				res.once("finish", held.complete);
			}
			res.writeHead(response.status, response.headers);
			res.end(response.body);
		},
		/** Validate everything before mutating either pixels or metadata. The
		 * callback only receives fixture IDs already resolved from this world. */
		metadata(
			input: unknown,
			rows: Array<{ session_id: string; agent_id?: unknown }>,
			apply: (
				ids: string[],
				agentId: Agent | null,
				sha256: string | null,
			) => void,
		) {
			const body = exact(input, ["sessionId", "agentId", "variant"]);
			const { sessionId, agentId, variant } = body;
			if (
				typeof sessionId !== "string" ||
				!rows.some((row) => row.session_id === sessionId) ||
				(agentId !== null && !isAgent(agentId)) ||
				!isVariant(variant) ||
				(agentId === null && variant !== "none")
			)
				throw new Error("invalid avatar metadata");
			const sha256 = isAgent(variant)
				? AGENT_AVATAR_SHAS[variant]
				: variant === "removed"
					? REMOVED_AVATAR_SHA
					: null;
			// The backing picture belongs to an agent, not to one conversation.
			// Rebind the target and update every shared-agent row in one publication.
			const ids = rows
				.filter(
					(row) =>
						row.session_id === sessionId ||
						(agentId !== null && row.agent_id === agentId),
				)
				.map((row) => row.session_id);
			if (agentId !== null) variants.set(agentId, variant);
			apply(ids, agentId, sha256);
			for (const { publish } of subscribers.values()) publish();
			event({ kind: "metadata-published", sessionId, agentId, sha256 });
			return { ok: true };
		},
		subscribe(res: ServerResponse, publish: () => void) {
			const close = () => subscribers.delete(res);
			subscribers.set(res, { publish, close });
			res.once("close", close);
		},
		reset() {
			for (const held of barriers.values()) cancel(held);
			barriers.clear();
			variants.clear();
			for (const [res, { close }] of subscribers) {
				res.off("close", close);
				res.destroy();
			}
			subscribers.clear();
			events = [];
			sequence = 0;
			world++;
		},
	};
}
