/**
 * The registry <-> store moves the Computers screen and the root hook make: Remove,
 * hydration's merge, and sign-out clearing both the registry and the hidden set.
 *
 * Runs the REAL `tunnel-storage` module. Under vitest `react-native` resolves to
 * react-native-web, so `Platform.OS` is `web` and the module opens its
 * `memorySecureStore` fallback — the app's own web path, not a mock. Its singleton
 * persists across tests in this file, so each test starts by signing out.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DiscoveredComputer } from "@/connection";
import {
	removeComputer,
	startSavedComputersHydration,
} from "@/features/auth/saved-computers-sync";
import {
	clearStoredCredentials,
	readHiddenTunnelIds,
} from "@/features/auth/tunnel-storage";
import { createConnectionStore } from "@/state";

const HOST_A = "0123456789abcdef0123456789abcdef-lop.example.com";
const HOST_B = "fedcba9876543210fedcba9876543210-lop.example.com";

function discovered(tunnelId: string, hostname: string): DiscoveredComputer {
	return {
		tunnelId,
		name: `computer ${tunnelId}`,
		deviceId: `device-${tunnelId}`,
		hostname,
		status: "ready",
		rawStatus: "active",
		supportsLocalOperator: true,
		billing: { eligible: null, message: null },
		updatedAt: 0,
	};
}

function routedStore() {
	const store = createConnectionStore();
	store
		.getState()
		.startRoute({ mode: "radient", hostname: HOST_A, tunnelId: "t1" });
	return store;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const flush = () => new Promise((done) => setTimeout(done, 0));

const first = discovered("t1", HOST_A);
const feed = [first, discovered("t2", HOST_B)];

beforeEach(async () => {
	await clearStoredCredentials();
});

describe("Remove on the Computers screen", () => {
	it("hides the row at once, persists the removal, and outlasts a discovery refresh", async () => {
		const store = routedStore();
		store.getState().setComputers(feed);

		const written = removeComputer(store, first);
		/* Synchronously, before the keystore write settles. */
		expect(store.getState().computers.map((c) => c.tunnelId)).toEqual(["t2"]);
		/* The web fallback says so: the removal is for this session only. */
		expect(await written).toEqual({ persistent: false });

		expect(await readHiddenTunnelIds()).toEqual(["t1"]);
		store.getState().setComputers(feed);
		expect(store.getState().computers.map((c) => c.tunnelId)).toEqual(["t2"]);
	});
});

describe("startup hydration", () => {
	it("unions the loaded set with a Remove tapped while the read was in flight", async () => {
		const store = routedStore();
		store.getState().setComputers(feed);
		const read = deferred<string[]>();
		const stop = startSavedComputersHydration(
			store,
			() => read.promise,
			() => () => {},
		);

		store.getState().hideComputer("t2");
		read.resolve(["t1"]);
		await flush();

		expect(store.getState().hiddenTunnelIds).toEqual(["t2", "t1"]);
		expect(store.getState().computers).toEqual([]);
		stop();
	});

	it("drops a read that a sign-out overtook, so forgotten removals stay forgotten", async () => {
		const store = routedStore();
		const read = deferred<string[]>();
		let signedOut: () => void = () => {};
		startSavedComputersHydration(
			store,
			() => read.promise,
			(listener) => {
				signedOut = listener;
				return () => {};
			},
		);

		store.getState().hideComputer("t2");
		signedOut();
		read.resolve(["t1"]);
		await flush();

		expect(store.getState().hiddenTunnelIds).toEqual([]);
	});
});

describe("sign-out", () => {
	it("clears the registry and the store's hidden set, so a computer comes back", async () => {
		const store = routedStore();
		const stop = startSavedComputersHydration(store);
		await flush();
		store.getState().setComputers(feed);
		await removeComputer(store, first);
		expect(await readHiddenTunnelIds()).toEqual(["t1"]);

		await clearStoredCredentials();

		expect(await readHiddenTunnelIds()).toEqual([]);
		expect(store.getState().hiddenTunnelIds).toEqual([]);
		store.getState().setComputers(feed);
		expect(store.getState().computers.map((c) => c.tunnelId)).toEqual([
			"t1",
			"t2",
		]);

		/* A cold start after sign-out hydrates nothing. */
		const cold = routedStore();
		startSavedComputersHydration(cold);
		await flush();
		expect(cold.getState().hiddenTunnelIds).toEqual([]);
		stop();
	});
});
