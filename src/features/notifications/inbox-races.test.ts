// biome-ignore-all lint/suspicious/noExplicitAny: this explicit hook scheduler implements React's heterogeneous dispatcher slots, not app data.
/** Adapted from the independent round-1 review probe. It executes production
 * hooks with deferred IO, but is NOT a React renderer or native navigation proof.
 * No IO is patched out of the hook: only React's scheduling is deterministic. */
import React from "react";
import { describe, expect, it } from "vitest";
import { createListStore } from "@/state/list-store";
import { useNotifications } from "./use-notifications";

// A deterministic hook scheduler, NOT a renderer or native-flow proof. Executes
// the unchanged production hook with deferred IO and explicit effect commits.
const internal = (React as any)
	.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
function runner() {
	const slots: any[] = [];
	let cursor = 0;
	let effects: any[] = [];
	const changed = (a: any[], b: any[]) =>
		!a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
	const dispatcher = {
		useState(initial: any) {
			const n = cursor++;
			if (!slots[n])
				slots[n] = {
					value: typeof initial === "function" ? initial() : initial,
				};
			return [
				slots[n].value,
				(v: any) => {
					slots[n].value = typeof v === "function" ? v(slots[n].value) : v;
				},
			];
		},
		useRef(initial: any) {
			const n = cursor++;
			slots[n] ??= { current: initial };
			return slots[n];
		},
		useCallback(fn: any, deps: any[]) {
			const n = cursor++;
			if (!slots[n] || changed(slots[n].deps, deps)) slots[n] = { fn, deps };
			return slots[n].fn;
		},
		useEffect(fn: any, deps: any[]) {
			const n = cursor++;
			if (!slots[n] || changed(slots[n].deps, deps)) {
				const prev = slots[n];
				slots[n] = { deps, cleanup: prev?.cleanup };
				effects.push(() => {
					slots[n].cleanup?.();
					slots[n].cleanup = fn();
				});
			}
		},
	};
	return {
		render(client: any, enabled: boolean, connectionGeneration = 0) {
			cursor = 0;
			effects = [];
			const before = internal.H;
			internal.H = dispatcher;
			let state: ReturnType<typeof useNotifications>;
			try {
				// biome-ignore lint/correctness/useHookAtTopLevel: the dispatcher invokes one hook per explicit render; finally restores React even when the hook throws.
				state = useNotifications(client, enabled, connectionGeneration);
			} finally {
				internal.H = before;
			}
			for (const effect of effects) effect();
			return state;
		},
		dispose() {
			for (const slot of slots) slot?.cleanup?.();
		},
	};
}
const flush = () => new Promise((r) => setImmediate(r));
function deferredClient() {
	const calls: any[] = [];
	return {
		calls,
		notifications() {
			return new Promise((resolve, reject) => calls.push({ resolve, reject }));
		},
	};
}

const block = (n: number, hw: number) => ({
	unread_count: n,
	waiting_count: 0,
	waiting_unread_count: 0,
	high_water: hw,
});
const response = (n: number, hw: number, cursor: string | null = null) => ({
	...block(n, hw),
	items: [],
	waiting: [],
	next_cursor: cursor,
});
const frame = (n: number, hw: number) => ({
	sessions: [],
	degraded: [],
	notifications: block(n, hw),
});

describe("M1: retiring a route before its inbox read completes", () => {
	it.each(["null", "disabled", "other-client", "same-client-reset"])(
		"fences %s transitions and their already-landed answer",
		async (mode) => {
			const r = runner(),
				a = deferredClient(),
				b = deferredClient();
			try {
				let s = r.render(a, true, 0);
				a.calls[0].resolve(response(9, 900));
				await flush();
				s = r.render(a, true, 0);
				expect(s.response?.unread_count).toBe(9);
				s.reload({ silent: true });
				const next = mode === "null" ? null : mode === "other-client" ? b : a;
				const enabled = mode !== "null" && mode !== "disabled";
				const epoch = mode === "same-client-reset" ? 1 : 0;
				s = r.render(next, enabled, epoch);
				expect(s.response).toBeNull();
				a.calls[1].resolve(response(8, 901));
				await flush();
				s = r.render(next, enabled, epoch);
				expect(s.response).toBeNull();
				if (enabled) {
					const current = next === b ? b.calls[0] : a.calls[2];
					current.resolve(response(1, 10));
					await flush();
					expect(r.render(next, enabled, epoch).response?.unread_count).toBe(1);
				}
			} finally {
				r.dispose();
			}
		},
	);
	it("refuses old generation publication before React renders the reset", () => {
		const store = createListStore();
		const old = store.getState().connectionGeneration;
		store.getState().applyInboxCounts(block(9, 900), old);
		store.getState().reset();
		store.getState().applyInboxCounts(block(8, 901), old);
		store.getState().applyFrame(frame(8, 901), undefined, old);
		expect(store.getState().notifications).toBeNull();
		store
			.getState()
			.applyInboxCounts(block(1, 10), store.getState().connectionGeneration);
		expect(store.getState().notifications?.unread_count).toBe(1);
	});
});

describe("M2: page-one supersession owns pagination cleanup", () => {
	it.each([true, false])("fresh response first=%s", async (freshFirst) => {
		const r = runner(),
			a = deferredClient();
		try {
			let s = r.render(a, true);
			a.calls[0].resolve(response(7, 40, "page-two"));
			await flush();
			s = r.render(a, true);
			s.loadMore();
			expect(r.render(a, true).loadingMore).toBe(true);
			s.reload({ silent: true });
			expect(r.render(a, true).loadingMore).toBe(false);
			if (!freshFirst) {
				a.calls[1].resolve(response(7, 40));
				await flush();
			}
			a.calls[2].resolve(response(6, 41, "fresh-page-two"));
			await flush();
			s = r.render(a, true);
			expect(s.loadingMore).toBe(false);
			expect(s.response?.next_cursor).toBe("fresh-page-two");
			s.loadMore();
			expect(r.render(a, true).loadingMore).toBe(true);
			if (freshFirst) {
				a.calls[1].resolve(response(7, 40));
				await flush();
			}
			// The OLD cursor's finally must not clear this NEW cursor's spinner.
			expect(r.render(a, true).loadingMore).toBe(true);
			a.calls[3].resolve(response(6, 41));
			await flush();
			expect(r.render(a, true).loadingMore).toBe(false);
		} finally {
			r.dispose();
		}
	});
});

describe("M3: HTTP and SSE share a per-connection count watermark", () => {
	it("refuses old frames as well as old HTTP answers; accepts equal/newer and zero", () => {
		const store = createListStore();
		const epoch = store.getState().connectionGeneration;
		store.getState().applyFrame(frame(7, 40));
		store.getState().applyInboxCounts(block(0, 41), epoch);
		store.getState().applyFrame(frame(7, 40));
		expect(store.getState().notifications?.unread_count).toBe(0);
		store.getState().applyFrame(frame(1, 41));
		expect(store.getState().notifications?.unread_count).toBe(1);
		store.getState().applyFrame(frame(2, 42));
		store.getState().applyInboxCounts(block(9, 41), epoch);
		expect(store.getState().notifications?.unread_count).toBe(2);
	});
	it("retains absence, hides unknown, preserves watermark through unknown and resets it on reconnect", () => {
		const store = createListStore();
		const epoch = store.getState().connectionGeneration;
		store.getState().applyInboxCounts(block(5, 50), epoch);
		store.getState().applyFrame({ sessions: [], degraded: [] });
		expect(store.getState().notifications?.unread_count).toBe(5);
		store.getState().applyFrame({ ...frame(0, 0), notifications: {} });
		expect(store.getState().notifications).toBeNull();
		store.getState().applyFrame(frame(9, 49));
		store.getState().applyInboxCounts(block(9, 49), epoch);
		expect(store.getState().notifications).toBeNull();
		store.getState().applyFrame(frame(1, 51));
		expect(store.getState().notifications?.unread_count).toBe(1);
		store.getState().reset();
		store.getState().applyFrame(frame(2, 1));
		expect(store.getState().notifications?.unread_count).toBe(2);
	});
});
