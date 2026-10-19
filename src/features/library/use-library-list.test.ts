/**
 * The listing hook's stale-page settlement (review round 2).
 *
 * The pure generation gate cannot catch this one: the bug is a React flag left
 * true when a superseded request's `finally` is rejected. This harness runs the
 * real hook with the small hook surface it uses, so the repro is the actual
 * sequence — start a cursor page, change the query, let the new first page land,
 * then let the old cursor answer — rather than a model of it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryAsset, LibraryListResponse } from "@/contracts";
import type { RelayEndpoints } from "@/relay";

const rt = vi.hoisted(() => {
	type Effect = {
		id: number;
		deps: unknown[] | undefined;
		run: () => void | (() => void);
	};
	const states: unknown[] = [];
	const refs: { current: unknown }[] = [];
	const effects: Effect[] = [];
	const cleanups = new Map<
		number,
		{ deps: unknown[] | undefined; fn?: () => void }
	>();
	let cursor = 0;
	let dirty = false;

	const api = {
		useState(initial: unknown) {
			const index = cursor++;
			if (!(index in states)) {
				states[index] =
					typeof initial === "function"
						? (initial as () => unknown)()
						: initial;
			}
			return [
				states[index],
				(next: unknown) => {
					const value =
						typeof next === "function"
							? (next as (current: unknown) => unknown)(states[index])
							: next;
					if (Object.is(value, states[index])) return;
					states[index] = value;
					dirty = true;
				},
			];
		},
		useRef(initial: unknown) {
			const index = cursor++;
			if (!(index in refs)) refs[index] = { current: initial };
			return refs[index];
		},
		useCallback(fn: unknown) {
			cursor += 1;
			return fn;
		},
		useMemo(fn: () => unknown) {
			cursor += 1;
			return fn();
		},
		useEffect(run: () => void | (() => void), deps?: unknown[]) {
			effects.push({ id: cursor++, deps, run });
		},
	};

	return {
		api,
		begin() {
			cursor = 0;
			effects.length = 0;
		},
		takeEffects() {
			return [...effects];
		},
		isDirty() {
			return dirty;
		},
		clean() {
			dirty = false;
		},
		runEffects() {
			for (const effect of effects) {
				const previous = cleanups.get(effect.id);
				const same =
					previous !== undefined && sameDeps(previous.deps, effect.deps);
				if (same) continue;
				previous?.fn?.();
				const cleanup = effect.run();
				cleanups.set(effect.id, {
					deps: effect.deps,
					fn: typeof cleanup === "function" ? cleanup : undefined,
				});
			}
		},
		reset() {
			states.length = 0;
			refs.length = 0;
			effects.length = 0;
			cleanups.clear();
			cursor = 0;
			dirty = false;
		},
	};
});

vi.mock("react", () => rt.api);

const { useLibraryList } = await import("@/features/library/use-library-list");
const { DEFAULT_BROWSE } = await import("@/features/library/library-model");
const { nextEpoch, resetLibraryUpdates } = await import(
	"@/features/library/library-updates"
);

const sameDeps = (a: unknown[] | undefined, b: unknown[] | undefined) => {
	if (a === undefined || b === undefined) return a === b;
	return (
		a.length === b.length &&
		a.every((value, index) => Object.is(value, b[index]))
	);
};

const row = (id: string, name: string): LibraryAsset => ({
	id,
	ref: {
		type: "path",
		display_path: `~/${name}`,
		digest: null,
		content_type: "text/plain",
	},
	name,
	derived_name: name,
	description: "",
	kind: "markdown",
	category: "document",
	origin: "created",
	origin_group: "created",
	origins: ["created"],
	tags: [],
	primary_tag: null,
	size_bytes: 10,
	width: null,
	height: null,
	duration_s: null,
	created_at: 1,
	modified_at: 1,
	last_seen_at: 1,
	exists: true,
	highlighted: false,
	highlight_why: null,
	occurrences: [],
	session_count: 0,
	chat: null,
	preview: { state: "ready", mime_type: "text/markdown", pages: null },
	organized: null,
	locked: false,
	favorite: false,
	archived: false,
});

const listing = (
	rows: LibraryAsset[],
	next: string | null,
): LibraryListResponse => ({
	state: "ready",
	revision: 1,
	total: rows.length,
	counts: { category: {}, origin_group: {}, kind: {} },
	tags: [],
	rows,
	next_cursor: next,
	cursor_reset: false,
	scan: { sessions_total: 1, sessions_scanned: 1 },
	librarian: null,
});

type Pending = {
	request: { cursor?: string; q?: string };
	resolve: (answer: LibraryListResponse) => void;
	reject: (reason: unknown) => void;
};

describe("useLibraryList stale pages", () => {
	const calls: Pending[] = [];
	let browse = DEFAULT_BROWSE;
	let result: ReturnType<typeof useLibraryList> | null = null;

	const client = {
		libraryList: (request: { cursor?: string; q?: string }) =>
			new Promise<LibraryListResponse>((resolve, reject) => {
				calls.push({ request, resolve, reject });
			}),
	} as unknown as RelayEndpoints;

	const render = () => {
		rt.begin();
		// biome-ignore lint/correctness/useHookAtTopLevel: this harness IS the renderer; it calls the real hook with the only React surface the hook uses.
		result = useLibraryList(client, browse, true);
		rt.runEffects();
	};

	const settle = async () => {
		for (let pass = 0; pass < 20; pass += 1) {
			await Promise.resolve();
			if (!rt.isDirty()) break;
			rt.clean();
			render();
		}
	};

	beforeEach(() => {
		vi.useFakeTimers();
		rt.reset();
		resetLibraryUpdates();
		calls.length = 0;
		browse = DEFAULT_BROWSE;
		result = null;
		render();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("clears a superseded cursor page's loading flag and keeps paging alive", async () => {
		await vi.advanceTimersByTimeAsync(300);
		expect(calls).toHaveLength(1);
		calls[0]?.resolve(listing([row("la_old_1", "old one")], "cursor-old"));
		await settle();
		expect(result?.rows.map((asset) => asset.id)).toEqual(["la_old_1"]);

		result?.loadMore();
		await settle();
		expect(calls).toHaveLength(2);
		expect(result?.loadingMore).toBe(true);

		// The reader types a new query while the old cursor page is in flight.
		browse = { ...browse, query: "new" };
		rt.clean();
		render();
		await settle();
		await vi.advanceTimersByTimeAsync(300);
		expect(calls).toHaveLength(3);
		calls[2]?.resolve(listing([row("la_new_1", "new one")], "cursor-new"));
		await settle();

		expect(result?.loadedWith?.query).toBe("new");
		expect(result?.rows.map((asset) => asset.id)).toEqual(["la_new_1"]);
		expect(result?.loadingMore).toBe(false);

		// The old cursor answer arrives after the new page. It must be discarded.
		calls[1]?.resolve(listing([row("la_old_2", "old two")], "cursor-old-2"));
		await settle();
		expect(result?.rows.map((asset) => asset.id)).toEqual(["la_new_1"]);
		expect(result?.loadingMore).toBe(false);

		// And a later page for the current query must still be requestable.
		result?.loadMore();
		await settle();
		expect(calls).toHaveLength(4);
		expect(calls[3]?.request.cursor).toBe("cursor-new");
	});

	it("keeps two saved rows when a cursor page appends", async () => {
		await vi.advanceTimersByTimeAsync(300);
		calls[0]?.resolve(
			listing(
				[row("la_saved_a", "Old A"), row("la_saved_b", "Old B")],
				"cursor-two",
			),
		);
		await settle();

		/* The refresh starts BEFORE the saves: its answer is not authoritative
		 *  for rows the user edited while it was in flight. */
		result?.refresh();
		await settle();
		expect(calls).toHaveLength(2);

		result?.applySaved([
			{ asset: row("la_saved_a", "Saved A"), epoch: nextEpoch() },
			{ asset: row("la_saved_b", "Saved B"), epoch: nextEpoch() },
		]);
		await settle();
		expect(result?.rows.map((asset) => asset.name)).toEqual([
			"Saved A",
			"Saved B",
		]);

		calls[1]?.resolve(
			listing(
				[row("la_saved_a", "Old A"), row("la_saved_b", "Old B")],
				"cursor-two",
			),
		);
		await settle();
		expect(result?.rows.map((asset) => asset.name)).toEqual([
			"Saved A",
			"Saved B",
		]);

		result?.loadMore();
		await settle();
		expect(calls).toHaveLength(3);
		calls[2]?.resolve(listing([row("la_page_two", "Page two")], null));
		await settle();

		expect(result?.rows.map((asset) => asset.name)).toEqual([
			"Saved A",
			"Saved B",
			"Page two",
		]);
	});

	it("retires saved rows when a later refresh or new query returns newer values", async () => {
		await vi.advanceTimersByTimeAsync(300);
		calls[0]?.resolve(
			listing(
				[row("la_external_a", "Old A"), row("la_external_b", "Old B")],
				"cursor-refresh",
			),
		);
		await settle();

		// Both saves happen before the refresh starts, so the refresh owns both.
		result?.applySaved([
			{ asset: row("la_external_a", "Saved A"), epoch: nextEpoch() },
			{ asset: row("la_external_b", "Saved B"), epoch: nextEpoch() },
		]);
		await settle();
		result?.refresh();
		await settle();
		expect(calls).toHaveLength(2);
		calls[1]?.resolve(
			listing(
				[
					row("la_external_a", "External newer A"),
					row("la_external_b", "External newer B"),
				],
				"cursor-refresh",
			),
		);
		await settle();
		expect(result?.rows.map((asset) => asset.name)).toEqual([
			"External newer A",
			"External newer B",
		]);

		// Same rule on a new-query first page: a fetch started after the saves
		// returns the server's answers, not the saved overlays.
		result?.applySaved([
			{ asset: row("la_external_a", "Saved again A"), epoch: nextEpoch() },
			{ asset: row("la_external_b", "Saved again B"), epoch: nextEpoch() },
		]);
		await settle();
		expect(result?.rows.map((asset) => asset.name)).toEqual([
			"Saved again A",
			"Saved again B",
		]);

		browse = { ...browse, query: "new" };
		rt.clean();
		render();
		await settle();
		await vi.advanceTimersByTimeAsync(300);
		expect(calls).toHaveLength(3);
		calls[2]?.resolve(
			listing(
				[
					row("la_external_a", "External newer A2"),
					row("la_external_b", "External newer B2"),
				],
				"cursor-new",
			),
		);
		await settle();
		expect(result?.rows.map((asset) => asset.name)).toEqual([
			"External newer A2",
			"External newer B2",
		]);
	});

	it("clears a superseded refresh spinner across a query change", async () => {
		await vi.advanceTimersByTimeAsync(300);
		calls[0]?.resolve(listing([row("la_old_1", "old one")], "cursor-old"));
		await settle();

		result?.refresh();
		await settle();
		expect(calls).toHaveLength(2);
		expect(result?.refreshing).toBe(true);

		browse = { ...browse, query: "new" };
		rt.clean();
		render();
		await settle();
		expect(result?.refreshing).toBe(false);

		await vi.advanceTimersByTimeAsync(300);
		calls[2]?.resolve(listing([row("la_new_1", "new one")], "cursor-new"));
		await settle();
		expect(result?.refreshing).toBe(false);
		expect(result?.loading).toBe(false);

		// The old refresh answer lands late; it must not repaint or leave a spinner.
		calls[1]?.resolve(listing([row("la_old_1", "old one")], "cursor-old"));
		await settle();
		expect(result?.rows.map((asset) => asset.id)).toEqual(["la_new_1"]);
		expect(result?.refreshing).toBe(false);

		result?.refresh();
		await settle();
		expect(calls).toHaveLength(4);
		expect(calls[3]?.request.q).toBe("new");
	});
});
