import { execFile } from "node:child_process";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RadientTokens } from "@/connection/radient-oauth";
import { StartupAuthorizationLifecycle } from "@/connection/startup-authorization";
import { SECURE_KEYS, SecureStorage } from "@/connection/storage";
import { createRadientAccess } from "./radient-access";
import { carryOutRestore } from "./radient-restore";

/* Disk-backed synthetic keystore, NOT the machine keychain. A fresh module and
 * lifecycle read the same bytes after a simulated kill; no old promise/queue is
 * inherited. Only the native adapter is replaced, not SecureStorage or restore. */
const disk = vi.hoisted(() => ({
	root: process.env.RETIREMENT_PROBE_ROOT ?? "",
	failWrite: false,
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/connection", async (original) => ({
	...(await original<object>()),
	expoSecureStore: async () => ({
		getItemAsync: async (key: string) => {
			try {
				return await readFile(join(disk.root, key), "utf8");
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw e;
			}
		},
		setItemAsync: async (key: string, value: string) => {
			if (disk.failWrite) throw new Error("synthetic write failure");
			await writeFile(join(disk.root, key), value);
		},
		deleteItemAsync: async (key: string) => {
			try {
				await unlink(join(disk.root, key));
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
			}
		},
	}),
}));
const tokens = (access = "old"): RadientTokens => ({
	access,
	refresh: "rolling",
	expires_at: Date.now() + 3600000,
	scope: "openid",
	token_type: "Bearer",
	account_label: null,
	account_id: `${access}-account`,
});
async function boot() {
	vi.resetModules();
	const storage = await import("./tunnel-storage");
	const { expoSecureStore } = await import("@/connection");
	const store = new SecureStorage(await expoSecureStore());
	const lifecycle = new StartupAuthorizationLifecycle({
		read: () => store.readStartupAuthorization(),
		write: (r) => store.writeStartupAuthorization(r),
	});
	return { storage, store, lifecycle };
}
async function fixture(
	state:
		| "tombstone"
		| "revoked"
		| "active"
		| "absent"
		| "unreadable" = "tombstone",
) {
	if (process.env.RETIREMENT_PROBE_ROOT) return boot();
	disk.root = await mkdtemp(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"restore-",
		),
	);
	disk.failWrite = false;
	const f = await boot();
	await f.storage.writeStoredOauth(tokens());
	await f.storage.writeSavedTunnel({
		baseUrl: "https://relay.example",
		password: "old-password",
		allowInsecure: false,
	});
	await f.store.writeTunnelSession({
		grant: "handle-grant",
		grant_expires_at: Date.now() + 3600000,
		refresh_handle: "retained-handle",
		refresh_expires_at: Date.now() + 7200000,
		hostname: "relay.example",
		tunnel_id: "t1",
		minted_at: Date.now(),
	});
	if (state === "unreadable")
		await writeFile(
			join(disk.root, SECURE_KEYS.startupAuthorization),
			"bad-json",
		);
	else if (state !== "absent")
		await f.store.writeStartupAuthorization(
			state === "active"
				? { version: 1, state, generation: "g", route: "r" }
				: { version: 1, state },
		);
	return boot();
}
async function restore(f: Awaited<ReturnType<typeof boot>>) {
	const refresh = vi.fn(async () => tokens("refreshed"));
	const publish = vi.fn(async () => {});
	const clear = vi.fn(f.storage.clearStoredOauth);
	const outcome = await carryOutRestore({
		readOauth: f.storage.readStoredOauth,
		refresh,
		discover: publish,
		clearOauth: clear,
		writeOauth: async (t) => {
			await f.storage.writeStoredOauth(t);
		},
	});
	return { outcome, refresh, publish, clear };
}
function access(f: Awaited<ReturnType<typeof boot>>) {
	let current = tokens("replacement");
	return createRadientAccess({
		current: () => current,
		publish: (t) => {
			current = t!;
		},
		refresh: async (t) => t,
		write: f.storage.writeStoredOauth,
		clear: f.storage.clearStoredOauth,
		invalidGrant: () => false,
		serialize: async (op) => {
			await op();
		},
	});
}
/* Process boot has a separate, bounded budget: the normal 5 s unit timeout
 * races a cold Vite transform on the shared host. One worker THREAD keeps all
 * child execution inside this process; execFile reaps it on its 60 s ceiling. */
async function restartProbe(pattern: string, expectedAccess?: string) {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("CMUX_")),
	);
	return promisify(execFile)(
		process.execPath,
		[
			"node_modules/vitest/vitest.mjs",
			"run",
			"src/features/auth/retirement-restore.test.ts",
			"-t",
			pattern,
			"--maxWorkers=1",
			"--pool=threads",
		],
		{
			env: {
				...env,
				NODE_ENV: process.env.NODE_ENV ?? "test",
				RETIREMENT_PROBE_ROOT: disk.root,
				RETIREMENT_EXPECTED_ACCESS: expectedAccess ?? "",
			},
			timeout: 60000,
			killSignal: "SIGKILL",
		},
	);
}
afterEach(() => {
	disk.failWrite = false;
});
describe("retained credentials are not post-sign-out authority", () => {
	it("a separate process cannot restore retained tombstone credentials", async () => {
		await fixture();
		const result = await restartProbe("fresh process refuses");
		expect(result.stdout).toMatch(/2 passed/);
	}, 70000);

	it.each(["tombstone", "unreadable"] as const)(
		"fresh process refuses %s without refreshing, publishing or deleting retained OAuth/handle",
		async (state) => {
			const f = await fixture(state);
			const before = await readFile(join(disk.root, SECURE_KEYS.oauth), "utf8");
			const r = await restore(f);
			expect(r.outcome.restored).toBe(false);
			expect(r.refresh).not.toHaveBeenCalled();
			expect(r.publish).not.toHaveBeenCalled();
			expect(r.clear).not.toHaveBeenCalled();
			expect(await readFile(join(disk.root, SECURE_KEYS.oauth), "utf8")).toBe(
				before,
			);
			expect((await f.store.readTunnelSession())?.refresh_handle).toBe(
				"retained-handle",
			);
			expect(await f.storage.readStoredRadientAccount()).toBeNull();
			// A saved custom route must not authenticate and consume the tombstone
			// before the OAuth fence is checked; nor may a saved handle be authority.
			expect(await f.storage.readSavedTunnel()).toBeNull();
			expect(await f.storage.readStoredTunnelSession()).toBeNull();
		},
	);
	it.each(["active", "absent", "revoked"] as const)(
		"preserves %s restore semantics",
		async (state) => {
			const r = await restore(await fixture(state));
			expect(r.outcome.restored).toBe(true);
			expect(r.publish).toHaveBeenCalledOnce();
			if (process.env.RETIREMENT_EXPECTED_ACCESS)
				expect(r.outcome.tokens?.access).toBe(
					process.env.RETIREMENT_EXPECTED_ACCESS,
				);
		},
	);
	it("explicit verified replacement survives a fresh-process restart", async () => {
		const f = await fixture();
		await f.lifecycle.retire();
		const a = access(f);
		expect(
			await f.lifecycle.replaceCredentialsIfCurrent(
				f.lifecycle.getRevision(),
				() => a.persist(tokens("replacement")),
			),
		).toBe(true);
		const fresh = await boot();
		const r = await restore(fresh);
		expect(r.outcome.tokens?.access).toBe("replacement");
		const child = await restartProbe(
			"preserves .* restore semantics",
			"replacement",
		);
		expect(child.stdout).toMatch(/3 passed/);
		expect(await fresh.store.readStartupAuthorization()).toEqual({
			version: 1,
			state: "revoked",
		});
	}, 70000);
	it("an expired retained grant is not even offered for refresh", async () => {
		const f = await fixture();
		await f.storage.writeStoredOauth({ ...tokens(), expires_at: 0 });
		const r = await restore(await boot());
		expect(r.outcome.restored).toBe(false);
		expect(r.refresh).not.toHaveBeenCalled();
		expect(r.publish).not.toHaveBeenCalled();
		expect(r.clear).not.toHaveBeenCalled();
	});
	it("failed/non-durable persistence never acknowledges the tombstone", async () => {
		const f = await fixture();
		const a = access(f);
		disk.failWrite = true;
		expect(
			await f.lifecycle.replaceCredentialsIfCurrent(
				f.lifecycle.getRevision(),
				() => a.persist(tokens("replacement")),
			),
		).toBe(false);
		disk.failWrite = false;
		expect((await (await boot()).store.readStartupAuthorization())?.state).toBe(
			"tombstone",
		);
		expect((await restore(await boot())).outcome.restored).toBe(false);
	});
	it("checks revision both before dispatch and after held persistence; newer sign-out stays tombstoned", async () => {
		const f = await fixture();
		const revision = f.lifecycle.getRevision();
		const records = vi.spyOn(f.store, "writeStartupAuthorization");
		let release!: () => void;
		const held = new Promise<void>((r) => {
			release = r;
		});
		let entered!: () => void;
		const started = new Promise<void>((r) => {
			entered = r;
		});
		const replace = f.lifecycle.replaceCredentialsIfCurrent(
			revision,
			async () => {
				entered();
				await held;
				return access(f).persist(tokens("replacement"));
			},
		);
		await started;
		const signout = f.lifecycle.retire();
		release();
		expect(await replace).toBe(false);
		await signout;
		// Even a transient acknowledgement is forbidden: a kill between that
		// write and the newer tombstone could otherwise restore the old grant.
		expect(records.mock.calls.map(([record]) => record.state)).not.toContain(
			"revoked",
		);
		const stale = vi.fn(async () => true);
		expect(await f.lifecycle.replaceCredentialsIfCurrent(revision, stale)).toBe(
			false,
		);
		expect(stale).not.toHaveBeenCalled();
		expect((await (await boot()).store.readStartupAuthorization())?.state).toBe(
			"tombstone",
		);
		expect((await restore(await boot())).outcome.restored).toBe(false);
	});
});
