/**
 * Keep a row's IDENTITY across frames when its CONTENT did not change.
 *
 * WHY THIS IS THE PERFORMANCE FIX AND NOT A MICRO-OPTIMISATION. The relay
 * re-sends the whole transcript window on every frame (ten a second while a turn
 * streams), and every layer between the wire and the list rebuilds its arrays and
 * objects as it goes: the projection store, the page merge, the condense plan.
 * React Native's cell renderer is a `PureComponent`, so a row's bail-out is its
 * props' identity — and a fresh object for every row, every frame, means every
 * MOUNTED row re-renders on every frame. Measured on this app before the fix: a
 * window of ~60 mounted rows produced ~60 row renders per streamed frame.
 *
 * A row is reused when its `id` matches, in ORDER (the wire's ids are not
 * guaranteed unique — the harness's own `rich-rows` fixture stamps every row
 * `m-1` — so the n-th page row with an id pairs with the n-th previous row with
 * it, exactly the rule `mergeTranscript` uses), and its content is structurally
 * equal. That equality check is the cost of the fix: a few small plain objects
 * per row, against re-rendering a row's whole subtree. When every row is reused
 * and nothing was added or removed, the ARRAY is reused too, so the condense
 * plan, the group plan and the window policy all keep their memoised results and
 * the frame costs one comparison pass and no render at all.
 *
 * WHY STRUCTURAL EQUALITY AND NOT `JSON.stringify`. Entries are small,
 * flat-ish plain objects; a stringify allocates a string per row per frame and
 * pays for key ordering twice. `sameValue` below is a short-circuiting compare
 * over the shapes this contract actually has (strings, numbers, booleans, null,
 * plain objects, arrays of the same).
 */
import { LIVE_INLINE_UI } from "./live-inline-ui";

export const sameValue = (a: unknown, b: unknown): boolean => {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null || typeof a !== "object") return false;
	const aIsArray = Array.isArray(a);
	if (aIsArray !== Array.isArray(b)) return false;
	if (aIsArray) {
		const left = a as unknown[];
		const right = b as unknown[];
		if (left.length !== right.length) return false;
		for (let at = 0; at < left.length; at += 1) {
			if (!sameValue(left[at], right[at])) return false;
		}
		return true;
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const leftKeys = Object.keys(left);
	if (leftKeys.length !== Object.keys(right).length) return false;
	for (const key of leftKeys) {
		if (!(key in right)) return false;
		if (!sameValue(left[key], right[key])) return false;
	}
	return true;
};

// Symbol metadata is deliberately absent from the wire keys sameValue compares.
const sameRow = (a: object, b: object): boolean =>
	sameValue(a, b) &&
	sameValue(
		LIVE_INLINE_UI in a ? a[LIVE_INLINE_UI] : undefined,
		LIVE_INLINE_UI in b ? b[LIVE_INLINE_UI] : undefined,
	);

/**
 * Canonical identity of a transcript-like row across live (`tc-<call>`) and
 * durable (`<msg>:<call>`) streams: when `tool_call_id` is non-empty on a tool
 * row, `call:<tool_call_id>` stays invariant across stream-to-history handoff.
 */
export function canonicalKeyOf(row: {
	id: string;
	kind?: string;
	tool_call_id?: string;
}): string {
	return row.kind === "tool" &&
		typeof row.tool_call_id === "string" &&
		row.tool_call_id.length > 0
		? `call:${row.tool_call_id}`
		: row.id;
}

/**
 * `next`, with every row that equals its predecessor in `previous` replaced by
 * the predecessor's own object — and `previous` itself when the whole list is
 * unchanged.
 */
export function reuseRows<
	T extends { id: string; kind?: string; tool_call_id?: string },
>(previous: readonly T[] | null | undefined, next: readonly T[]): readonly T[] {
	if (previous === null || previous === undefined) return next;
	if (previous === next) return next;
	/* THE COMMON CASE, without allocating a lookup: a streamed frame re-sends the
	 *  same rows in the same order, so every id already sits at its own index and
	 *  the comparison is one pass over two arrays. The bucket map below is only for
	 *  a frame that INSERTED or DROPPED rows (the tail window sliding), where an
	 *  index means a different row. Kept separate because this path runs ten times
	 *  a second, and a Map plus a bucket list per frame is garbage the reader's
	 *  frame budget pays for. */
	if (previous.length === next.length) {
		let aligned = true;
		for (let at = 0; at < next.length; at += 1) {
			const prevRow = previous[at];
			const nextRow = next[at];
			if (
				!prevRow ||
				!nextRow ||
				canonicalKeyOf(prevRow) !== canonicalKeyOf(nextRow)
			) {
				aligned = false;
				break;
			}
		}
		if (aligned) {
			let reusedAligned = 0;
			const out: T[] = new Array(next.length);
			for (let at = 0; at < next.length; at += 1) {
				const row = next[at] as T;
				const old = previous[at] as T;
				if (sameRow(old, row)) {
					out[at] = old;
					reusedAligned += 1;
				} else {
					out[at] = row;
				}
			}
			return reusedAligned === next.length ? previous : out;
		}
	}
	const buckets = new Map<string, T[]>();
	for (const row of previous) {
		const key = canonicalKeyOf(row);
		const bucket = buckets.get(key);
		if (bucket === undefined) buckets.set(key, [row]);
		else bucket.push(row);
	}
	const out: T[] = new Array(next.length);
	for (let at = 0; at < next.length; at += 1) {
		const row = next[at] as T;
		const old = buckets.get(canonicalKeyOf(row))?.shift();
		if (old !== undefined && sameRow(old, row)) {
			out[at] = old;
		} else {
			out[at] = row;
		}
	}
	/* `previous` only when it is the SAME LIST, index for index — not merely the
	 *  same rows. A frame that permutes rows (same ids, same content, new order)
	 *  reuses every row here, and returning `previous` would keep painting the
	 *  old order until some row's content changed (review round 1, R1-1). */
	if (previous.length !== next.length) return out;
	for (let at = 0; at < out.length; at += 1) {
		if (out[at] !== previous[at]) return out;
	}
	return previous;
}

/* ------------------------------------------------- list items and derived maps */

const sameFields = (a: object, b: object): boolean => {
	const left = Object.keys(a);
	if (left.length !== Object.keys(b).length) return false;
	for (const key of left) {
		if (!Object.is((a as never)[key], (b as never)[key])) return false;
	}
	return true;
};

/**
 * `next`, with each item that is field-for-field identical to the item at the
 * same id in `previous` replaced by that very object (and `previous` itself when
 * nothing changed).
 *
 * WHY (streaming-perf audit): the condense/group/fold plans build a FRESH item
 * object for every row on every plan, and the plan re-runs on every streamed
 * frame because the streaming row changed. React Native's `CellRenderer` is a
 * `PureComponent` over `item`, so a fresh object for an UNCHANGED row made every
 * mounted cell (up to ~60) re-run `renderItem` ten times a second. The INVARIANT
 * is "an item is reused only when every field is `Object.is`-equal": an entry
 * item compares its `entry` by identity (which `reuseRows` already keeps for an
 * unchanged row), so a changed row, or any nested object the plan rebuilt, is
 * never reused. Positions are matched by id, so a row inserted or dropped
 * elsewhere cannot hand a cell the wrong item.
 */
export function reuseItems<T extends { id: string }>(
	previous: readonly T[] | null | undefined,
	next: readonly T[],
): readonly T[] {
	if (!previous || previous === next) return next;
	const before = new Map<string, T>();
	for (const item of previous) before.set(item.id, item);
	let changed = previous.length !== next.length;
	const out = next.map((item, at) => {
		const old = before.get(item.id);
		const reuse = old !== undefined && sameFields(old, item) ? old : item;
		if (reuse !== previous[at]) changed = true;
		return reuse;
	});
	return changed ? out : previous;
}

/** `next`, or `previous` itself when both maps hold the same entries. Derived
 *  per-row lookups (`spacingTiers`, `containment`) are rebuilt per plan but are
 *  usually unchanged; a fresh identity would invalidate `renderItem` (it lists
 *  them as dependencies) and, with it, every mounted cell. */
export function reuseMap<K, V>(
	previous: ReadonlyMap<K, V> | null | undefined,
	next: ReadonlyMap<K, V>,
): ReadonlyMap<K, V> {
	if (!previous || previous === next) return next;
	if (previous.size !== next.size) return next;
	for (const [key, value] of next) {
		if (!previous.has(key) || !Object.is(previous.get(key), value)) return next;
	}
	return previous;
}
