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
});
