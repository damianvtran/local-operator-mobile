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

	/** The next `seq`. Rows and writes share one counter, as on the live store
	 *  (`store.py` `_next_seq`): every write re-stamps the row it moved, which is
	 *  what lets a bounded bulk write tell "counted, then changed elsewhere" from
	 *  "counted and untouched". */
	const nextSeq = (): number => {
		for (const row of rows.values()) {
			highWater = Math.max(highWater, asNumber(row.item.seq));
		}
		highWater += 1;
		return highWater;
	};

	/**
	 * One page, with the live route's paging and scoping (`items.py` `list_page`,
	 * `store.py` `list_items`): newest content first by `(updated_at, id)`, an
	 * opaque `<updated_at>.<id>` keyset cursor, `session_id` narrowing, and a
	 * `through_seq` that caps both the rows and the `high_water` the answer
	 * reports. `waiting` rides the first page only and `observed` names exactly
	 * the tokens this answer served — the set a bulk write must echo.
	 *
	 * WHY THE MOCK PAGES AT ALL: "dismiss all from a conversation" must count and
	 * clear EVERY page, and a mock that answered everything at once could not tell
	 * a client that walks the cursor from one that stops at the first page.
	 */
	const page = (
		state: string,
		limit: number,
		options: { sessionId?: string; throughSeq?: number; cursor?: string } = {},
	): Json => {
		const bounded = Math.max(1, Math.min(Math.trunc(limit), 100));
		const current = Math.max(
			highWater,
			...[...rows.values()].map((row) => asNumber(row.item.seq)),
		);
		const boundary =
			options.throughSeq === undefined
				? current
				: Math.min(current, options.throughSeq);
		const inSession = (row: Row): boolean =>
			options.sessionId === undefined ||
			asString(asRecord(row.item.session)?.id) === options.sessionId;
		const visible = [...rows.values()].filter((row) => {
			const dismissed = asBoolean(row.item.dismissed);
			if (state === "dismissed") return dismissed;
			if (state === "all") return !dismissed;
			return !dismissed && !asBoolean(row.item.read);
		});
		const newestFirst = (a: Row, b: Row): number => {
			const byTime = asNumber(b.item.updated_at) - asNumber(a.item.updated_at);
			if (byTime !== 0) return byTime;
			return asString(b.item.id) < asString(a.item.id) ? -1 : 1;
		};
		const after = (() => {
			const raw = options.cursor ?? "";
			const dot = raw.indexOf(".");
			if (dot <= 0) return null;
			const at = Number(raw.slice(0, dot));
			return Number.isFinite(at) ? { at, id: raw.slice(dot + 1) } : null;
		})();
		const updates = visible
			.filter((row) => asRecord(row.item.ask) === undefined)
			.filter(inSession)
			.filter((row) => asNumber(row.item.seq) <= boundary)
			.filter((row) => {
				if (after === null) return true;
				const at = asNumber(row.item.updated_at);
				return (
					at < after.at || (at === after.at && asString(row.item.id) < after.id)
				);
			})
			.sort(newestFirst);
		const slice = updates.slice(0, bounded);
		const last = slice[slice.length - 1];
		const nextCursor =
			updates.length > bounded && last !== undefined
				? `${asNumber(last.item.updated_at)}.${asString(last.item.id)}`
				: null;
		const items = slice.map((row) => serialize(row));
		const waiting =
			after === null && (state === "unread" || state === "all")
				? visible
						.filter((row) => asRecord(row.item.ask) !== undefined)
						.filter(inSession)
						.map((row) => serialize(row))
				: [];
		const tokens = [...items, ...waiting].map((item) => {
			const record = asRecord(item) ?? {};
			return { id: asString(record.id), revision: asNumber(record.revision) };
		});
		return {
			items,
			waiting,
			next_cursor: nextCursor,
			unread_count: unreadCount(),
			waiting_count: waitingCount(),
			high_water: boundary,
			observed: tokens,
		};
	};

	/** A row that arrives AFTER a client read its page: the next seq, revision 1.
	 *  The test seam for "a late item is never swept up by a bound it postdates"
	 *  (the live store's `notify`, reduced to what the bound reads). */
	const insert = (item: Record<string, Json>): void => {
		const id = asString(item.id);
		if (id === "") return;
		rows.set(id, {
			item: {
				revision: 1,
				read: false,
				dismissed: false,
				...item,
				seq: nextSeq(),
			},
			history: [],
		});
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
		const observed = Array.isArray(record.observed)
			? asArray(record.observed).map((value) => asRecord(value) ?? {})
			: null;
		const bulk = ids.length === 0;
		/* A BULK TARGET WITHOUT TOKENS IS REFUSED, with the live route's own
		 * sentence (measured at local-operator a7d149e705). The mock used to accept
		 * it and fall through to a seq sweep, which is why the under-delivering
		 * mark-all passed the suite: no test sent the body the app sends, and a mock
		 * that accepts anything cannot catch a client that sends too little (code
		 * review m1). */
		if (bulk && (all || sessionId !== "") && observed === null) {
			return {
				ok: false,
				status: 422,
				body: { error: "bulk writes require 0..500 observed tokens" },
			};
		}
		const targets: { id: string; revision: number | null }[] = [];
		if (bulk && observed !== null && (all || sessionId !== "")) {
			/* The live route's bulk shape (`items.py` `apply_patch`): ONLY the
			 * echoed tokens, narrowed to the named conversation, each at its own
			 * revision — a scalar watermark alone cannot name what was seen. */
			for (const token of observed) {
				const id = asString(token.id);
				const owner = asString(asRecord(rows.get(id)?.item.session)?.id);
				if (all || owner === sessionId) {
					targets.push({
						id,
						revision: typeof token.revision === "number" ? token.revision : 0,
					});
				}
			}
		} else if (ids.length > 0) {
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
			/* Counted, then moved elsewhere (read, dismissed, revised): the row's
			 * seq is past the bound the client froze, so the live store refuses it
			 * as stale rather than applying a gesture to a state nobody saw. */
			if (bulk && observed !== null && asNumber(row.item.seq) > throughSeq) {
				skipped.push({ id: target.id, reason: "stale_revision" });
				continue;
			}
			const next: Record<string, Json> = { ...row.item, seq: nextSeq() };
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
			row.item = {
				...row.item,
				read: true,
				read_via: "in_view",
				seq: nextSeq(),
			};
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

	return { page, detail, patch, seen, insert };
}

export type NotificationsStore = ReturnType<typeof createNotificationsStore>;
