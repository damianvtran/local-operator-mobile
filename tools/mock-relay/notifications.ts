/**
 * The mock relay's inbox store: the notification routes, with the store's own
 * rules rather than a canned answer.
 *
 * WHY A STORE AND NOT A FIXTURE. Three of this feature's claims can only be
 * proved against a store that MOVES:
 *
 *  - a one-click dismiss really removes the row (a canned answer would make the
 *    "it disappeared" screenshot a claim about a constant),
 *  - a write naming a stale revision is refused instead of applied (the token
 *    rule is the whole point of `revision`), and
 *  - the read surface's read-receipt path changes what the next read returns.
 *
 * The seed is the synthetic fixture `notifications-populated` (there is no live
 * capture yet: the relay routes land with core PR L1b, and `fixtures/relay`
 * records that provenance in the file itself), so the store answers exactly the
 * body the app's contract tests are written against until a mutation happens.
 *
 * Nothing here is clever about persistence: it is an in-memory list reset with
 * the scenario world, which is what a capture needs and nothing more.
 */

import type { Json } from "../lib/json.ts";

export interface NotificationsStoreOptions {
	/** The seeded `GET /api/notifications` body. */
	seed: Json;
	/** The seeded `GET /api/notifications/{id}` bodies, keyed by item id. An id
	 *  with no entry gets the 404 the route would send. */
	details: Readonly<Record<string, Json>>;
}

interface Row {
	item: Record<string, Json>;
	/** The item's durable history, oldest first (what the detail route serves). */
	history: Json[];
}

type Outcome =
	| { ok: true; body: Json }
	| { ok: false; status: number; body: Json };

function asRecord(value: unknown): Record<string, Json> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, Json>)
		: undefined;
}

function asArray(value: unknown): Json[] {
	return Array.isArray(value) ? (value as Json[]) : [];
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/**
 * The seed, split into the rows the routes mutate.
 *
 * `waiting` and `items` are ONE store on the real relay (an open ask is a row
 * that happens to come from the ask queue), and they are one store here for the
 * same reason: a read or a dismiss over a selection has to see both, and two
 * lists would let an id be applied twice or not at all.
 */
export function createNotificationsStore(options: NotificationsStoreOptions) {
	const seed = asRecord(options.seed) ?? {};
	const rows = new Map<string, Row>();
	for (const item of [...asArray(seed.waiting), ...asArray(seed.items)]) {
		const record = asRecord(item);
		if (record === undefined) continue;
		const id = asString(record.id);
		if (id === "") continue;
		rows.set(id, { item: record, history: [] });
	}
	const detailSeeds = new Map(Object.entries(options.details ?? {}));
	let highWater = asNumber(seed.high_water);

	const unreadCount = (): number => {
		let count = 0;
		for (const row of rows.values()) {
			if (!asBoolean(row.item.read) && !asBoolean(row.item.dismissed))
				count += 1;
		}
		return count;
	};

	const waitingCount = (): number => {
		let count = 0;
		for (const row of rows.values()) {
			if (
				asRecord(row.item.ask) !== undefined &&
				!asBoolean(row.item.dismissed)
			) {
				count += 1;
			}
		}
		return count;
	};

	/** The item as the wire serves it, recomputed rather than echoed: the counts
	 *  inside it are the store's, so a stale seeded value cannot leak out. */
	const serialize = (row: Row): Json => row.item;

	const page = (state: string, limit: number): Json => {
		const visible = [...rows.values()].filter((row) => {
			const dismissed = asBoolean(row.item.dismissed);
			if (state === "dismissed") return dismissed;
			if (state === "all") return !dismissed;
			return !dismissed && !asBoolean(row.item.read);
		});
		const items = visible
			.filter((row) => asRecord(row.item.ask) === undefined)
			.map((row) => serialize(row))
			.slice(0, limit);
		const waiting =
			state === "unread" || state === "all"
				? visible
						.filter((row) => asRecord(row.item.ask) !== undefined)
						.map((row) => serialize(row))
				: [];
		return {
			items,
			/* `waiting` is first-page-only on the real route; this mock answers one
			 * page and says so with a null cursor, which is the same contract. */
			waiting,
			next_cursor: null,
			unread_count: unreadCount(),
			waiting_count: waitingCount(),
			high_water: highWater,
		};
	};

	const detail = (rawId: string): Outcome => {
		const id = rawId;
		const seeded = detailSeeds.get(id);
		const row = rows.get(id);
		if (seeded !== undefined && row !== undefined) {
			/* The seeded detail is authoritative for the SHAPE (history, asks,
			 * anchor), while `item` is the live row — so a read performed before the
			 * detail is fetched shows in the detail rather than being overwritten by
			 * a stale copy. */
			const record = asRecord(seeded) ?? {};
			return {
				ok: true,
				body: { ...record, item: serialize(row) },
			};
		}
		if (seeded !== undefined) return { ok: true, body: seeded };
		if (row !== undefined) {
			return {
				ok: true,
				body: {
					item: serialize(row),
					history: row.history,
					session: {
						id: asString(asRecord(row.item.session)?.id),
						title: asString(asRecord(row.item.session)?.title),
						agent_id: asString(asRecord(row.item.session)?.agent_id),
						live_state: "idle",
						cwd: "",
					},
					anchor: null,
					projects: asArray(row.item.projects),
					asks: [],
				},
			};
		}
		return {
			ok: false,
			status: 404,
			body: {
				error: "unknown notification",
				code: "notification_not_found",
			},
		};
	};

	/**
	 * One write, with the store's two refusals: `stale_revision` (the row moved
	 * since the caller rendered it) and `live_ask` (an open ask cannot be
	 * dismissed from the reel — contract §2.3).
	 */
	const patch = (body: unknown): Outcome => {
		const record = asRecord(body) ?? {};
		const op = asString(record.op);
		const ids = asArray(record.ids).map((value) => asRecord(value) ?? {});
		const all = record.all === true;
		const throughSeq = asNumber(record.through_seq, Number.POSITIVE_INFINITY);
		const sessionId = asString(record.session_id);
		const targets: { id: string; revision: number | null }[] = [];
		if (ids.length > 0) {
			for (const target of ids) {
				targets.push({
					id: asString(target.id),
					revision:
						typeof target.revision === "number" ? target.revision : null,
				});
			}
		} else if (all) {
			for (const row of rows.values()) {
				if (asNumber(row.item.seq) <= throughSeq) {
					targets.push({ id: asString(row.item.id), revision: null });
				}
			}
		} else if (sessionId !== "") {
			for (const row of rows.values()) {
				const owner = asString(asRecord(row.item.session)?.id);
				if (owner === sessionId && asNumber(row.item.seq) <= throughSeq) {
					targets.push({ id: asString(row.item.id), revision: null });
				}
			}
		}

		const changed: string[] = [];
		const skipped: Json[] = [];
		for (const target of targets) {
			const row = rows.get(target.id);
			if (row === undefined) {
				skipped.push({ id: target.id, reason: "unknown" });
				continue;
			}
			if (
				target.revision !== null &&
				target.revision !== asNumber(row.item.revision)
			) {
				skipped.push({ id: target.id, reason: "stale_revision" });
				continue;
			}
			if (op === "dismiss" && asRecord(row.item.ask) !== undefined) {
				skipped.push({ id: target.id, reason: "live_ask" });
				continue;
			}
			const next = { ...row.item };
			if (op === "read" || op === "unread") {
				next.read = op === "read";
				next.read_via = op === "read" ? "explicit" : null;
			} else if (op === "dismiss" || op === "undismiss") {
				next.dismissed = op === "dismiss";
			}
			row.item = next;
			changed.push(target.id);
		}
		return {
			ok: true,
			body: {
				changed,
				skipped,
				unread_count: unreadCount(),
				high_water: unreadHighWater(),
			},
		};
	};

	/** The in-view receipt (contract §6.4). The server re-checks each id's
	 *  revision and the evidence's freshness, exactly as the desktop plane does —
	 *  a receipt naming a row that moved is skipped, not applied. */
	const seen = (body: unknown): Outcome => {
		const record = asRecord(body) ?? {};
		const evidence = asRecord(record.evidence);
		const inputAtMs = asNumber(evidence?.input_at_ms, 0);
		const items = asArray(record.items).map((value) => asRecord(value) ?? {});
		const changed: string[] = [];
		const skipped: Json[] = [];
		for (const target of items) {
			const id = asString(target.id);
			const row = rows.get(id);
			if (row === undefined) {
				skipped.push({ id, reason: "unknown" });
				continue;
			}
			if (asNumber(target.revision) !== asNumber(row.item.revision)) {
				skipped.push({ id, reason: "stale_revision" });
				continue;
			}
			/* The evidence must be LATER than the row's own last update: a touch
			 * that predates the item cannot have seen it. */
			if (inputAtMs < asNumber(row.item.updated_at) * 1000) {
				skipped.push({ id, reason: "stale_evidence" });
				continue;
			}
			if (asRecord(row.item.ask) !== undefined) {
				skipped.push({ id, reason: "live_ask" });
				continue;
			}
			row.item = { ...row.item, read: true, read_via: "in_view" };
			changed.push(id);
		}
		return {
			ok: true,
			body: {
				changed,
				skipped,
				unread_count: unreadCount(),
				high_water: unreadHighWater(),
			},
		};
	};

	/** The high-water a write reports: the max `seq` the store holds. Reads that
	 *  come later still see it, so a mark-all can say what it covered. */
	const unreadHighWater = (): number => {
		let max = highWater;
		for (const row of rows.values()) {
			max = Math.max(max, asNumber(row.item.seq));
		}
		highWater = max;
		return max;
	};

	return { page, detail, patch, seen };
}

export type NotificationsStore = ReturnType<typeof createNotificationsStore>;
