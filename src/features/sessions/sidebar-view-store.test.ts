import { describe, expect, it } from "vitest";

import {
	DEFAULT_SIDEBAR_VIEW,
	SIDEBAR_VIEW_KEY,
	type SidebarView,
} from "@/features/sessions/sidebar-view";
import {
	createSidebarViewStore,
	type SidebarViewStorage,
} from "@/features/sessions/sidebar-view-store";

/** An in-memory device store: what the app's `deviceStore` is to this module. */
function memoryStorage(seed: Record<string, string> = {}) {
	const data = new Map(Object.entries(seed));
	const writes: string[] = [];
	const storage: SidebarViewStorage = {
		get: async (key) => data.get(key) ?? null,
		set: async (key, value) => {
			writes.push(key);
			data.set(key, value);
		},
	};
	return { data, writes, storage };
}

const FLAT: SidebarView = { ...DEFAULT_SIDEBAR_VIEW, groupBy: "flat" };

describe("sidebar view persistence", () => {
	it("writes a choice through, and a fresh store (a relaunch) reads it back", async () => {
		const disk = memoryStorage();
		const first = createSidebarViewStore(() => disk.storage);
		await first.getState().hydrate();
		first.getState().setView(FLAT);
		await Promise.resolve();
		expect(disk.writes).toEqual([SIDEBAR_VIEW_KEY]);

		const relaunched = createSidebarViewStore(() => disk.storage);
		expect(relaunched.getState().view).toBe(DEFAULT_SIDEBAR_VIEW);
		await relaunched.getState().hydrate();
		expect(relaunched.getState().view).toEqual(FLAT);
		expect(relaunched.getState().hydrated).toBe(true);
	});

	it("a tap made before the stored value arrives is not undone by it", async () => {
		const disk = memoryStorage({
			[SIDEBAR_VIEW_KEY]: JSON.stringify({ orderBy: "recent" }),
		});
		const store = createSidebarViewStore(() => disk.storage);
		const reading = store.getState().hydrate();
		store.getState().setView(FLAT);
		await reading;
		// The tap changed the grouping only; the stored order survives (M2).
		expect(store.getState().view).toEqual({ ...FLAT, orderBy: "recent" });
	});

	it("M2: an early tap persists the stored view plus the tapped field, not defaults over it", async () => {
		const disk = memoryStorage({
			[SIDEBAR_VIEW_KEY]: JSON.stringify({
				orderBy: "recent",
				basis: "created",
			}),
		});
		const store = createSidebarViewStore(() => disk.storage);
		const reading = store.getState().hydrate();
		// Built from the default the reader sees before the stored view lands.
		store.getState().setView({ ...DEFAULT_SIDEBAR_VIEW, showEnded: false });
		await reading;
		await Promise.resolve();
		const expected: SidebarView = {
			...DEFAULT_SIDEBAR_VIEW,
			orderBy: "recent",
			basis: "created",
			showEnded: false,
		};
		expect(store.getState().view).toEqual(expected);
		const relaunched = createSidebarViewStore(() => disk.storage);
		await relaunched.getState().hydrate();
		expect(relaunched.getState().view).toEqual(expected);
	});

	it("an unreadable store keeps the default rather than failing the drawer", async () => {
		const store = createSidebarViewStore(() => ({
			get: () => Promise.reject(new Error("synthetic read failure")),
			set: () => Promise.reject(new Error("synthetic write failure")),
		}));
		await store.getState().hydrate();
		expect(store.getState().view).toBe(DEFAULT_SIDEBAR_VIEW);
		// A failed write keeps the choice on screen (and does not throw).
		store.getState().setView(FLAT);
		await Promise.resolve();
		expect(store.getState().view).toEqual(FLAT);
	});

	it("reads the store once however many mounts ask", async () => {
		let reads = 0;
		const store = createSidebarViewStore(() => ({
			get: async () => {
				reads += 1;
				return null;
			},
			set: async () => undefined,
		}));
		await Promise.all([store.getState().hydrate(), store.getState().hydrate()]);
		expect(reads).toBe(1);
	});
});
