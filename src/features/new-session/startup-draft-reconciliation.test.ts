import { beforeEach, describe, expect, it, vi } from "vitest";
import { memorySecureStore, SecureStorage } from "@/connection/storage";
import type { RelayEndpoints } from "@/relay/endpoints";

// Only native bridge ports are replaced. Runtime/coordinator, vault leases,
// auth retirement, ordinary adapters and serialized handoff are production code.
const disk = vi.hoisted(() => ({
	families: new Map<string, Map<string, string>>(),
	failWrite: false,
	failRemove: false,
	removals: 0,
	failedWrites: 0,
	erased: 0,
	uuid: 0,
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-crypto", () => ({
	randomUUID: () =>
		`00000000-0000-4000-8000-${String(++disk.uuid).padStart(12, "0")}`,
}));
vi.mock("expo-file-system", () => ({
	Paths: { document: "memory://documents" },
	File: class {},
	Directory: class {
		exists = false;
		delete() {}
	},
}));
vi.mock("@/features/session/picker-cache", () => ({
	clearNativePickerCache: async () => {},
}));
vi.mock("@/features/session/native-private-store", () => ({
	nativePrivateStore: (family: string) => {
		let bytes = disk.families.get(family);
		if (!bytes) {
			bytes = new Map();
			disk.families.set(family, bytes);
		}
		const store = bytes;
		return {
			get: async (key: string) => store.get(key) ?? null,
			set: async (key: string, value: string) => {
				if (family === "recovery" && key !== "authority" && disk.failWrite) {
					disk.failedWrites++;
					throw new Error("synthetic vault write failed");
				}
				store.set(key, value);
			},
			remove: async (key: string) => {
				if (family === "recovery") {
					if (disk.failRemove)
						throw new Error("synthetic vault deletion failed");
					disk.removals++;
				}
				store.delete(key);
			},
			keys: async () => [...store.keys()],
			clear: async () => {
				store.clear();
			},
		};
	},
	eraseNativePrivateInstallation: async () => {
		disk.erased++;
		for (const family of disk.families.values()) family.clear();
	},
}));
const client = {
	startSession: async () => {
		throw new Error("a draft must not create a session");
	},
} as unknown as RelayEndpoints;
let storage: SecureStorage;
type ProcessModules = {
	auth: typeof import("@/connection/startup-authorization");
	runtime: typeof import("./startup-runtime");
	recovery: typeof import("@/features/session/draft-recovery");
	ordinary: typeof import("@/features/session/device-storage");
	admitted: { scope: string; revision: number };
};
let processModules: ProcessModules | null = null;
function current(): ProcessModules {
	if (!processModules) throw new Error("fixture has not booted");
	return processModules;
}
async function boot(proof: string | null): Promise<ProcessModules> {
	processModules?.auth.startupAuthorizationLifecycle.suspend();
	vi.resetModules();
	const auth = await import("@/connection/startup-authorization");
	auth.configureStartupAuthorizationStorage({
		read: () => storage.readStartupAuthorization(),
		write: (record) => storage.writeStartupAuthorization(record),
	});
	const runtime = await import("./startup-runtime");
	const recovery = await import("@/features/session/draft-recovery");
	const ordinary = await import("@/features/session/device-storage");
	auth.startupAuthorizationLifecycle.registerCleanup(
		ordinary.clearAuthorizationData,
	);
	const revision = auth.startupAuthorizationLifecycle.getRevision();
	const admitted = await auth.startupAuthorizationLifecycle.admit(
		"native-personal-route",
		revision,
		() =>
			recovery.prepareDraftRecovery(proof, () =>
				auth.startupAuthorizationLifecycle.isCurrent(revision),
			),
		proof,
	);
	if (!admitted) throw new Error("synthetic admission failed");
	return { auth, runtime, recovery, ordinary, admitted };
}
async function restart(proof: string | null) {
	processModules = await boot(proof);
	return processModules;
}
const sid = "synthetic-session";
async function edit(kind: "startup" | "legacy", text: string) {
	const p = current();
	if (kind === "legacy") await p.ordinary.writeDraft(sid, text);
	else {
		const owner = await p.runtime.openStartup(p.admitted, client);
		owner.edit(text, []);
		await owner.flush();
		await p.recovery.awaitDraftRecoveryWrites().catch(() => {});
		await owner.quiesce();
	}
}
async function shown(kind: "startup" | "legacy") {
	const p = current();
	if (kind === "startup")
		return (await p.runtime.openStartup(p.admitted, client)).snapshot().draft
			.text;
	const owner = await p.runtime.startupForSession(p.admitted, client, sid);
	return owner?.snapshot().draft.text ?? (await p.ordinary.readDraft(sid));
}
async function vaultText(kind: "startup" | "legacy") {
	const p = current();
	const raw = await p.recovery.readRecoveryDraft(
		kind === "startup" ? "startup:active" : p.ordinary.draftKey(sid),
		p.admitted.scope,
	);
	return raw === null
		? ""
		: kind === "startup"
			? (JSON.parse(raw) as { text: string }).text
			: raw;
}
beforeEach(() => {
	processModules?.auth.startupAuthorizationLifecycle.suspend();
	processModules = null;
	disk.families.clear();
	disk.failWrite = false;
	disk.failRemove = false;
	disk.removals = 0;
	disk.failedWrites = 0;
	disk.erased = 0;
	storage = new SecureStorage(memorySecureStore());
});
for (const kind of ["startup", "legacy"] as const)
	describe(`${kind}: real vault across JS restart and actual auth retirement`, () => {
		it.each(["", "newer offline text"])(
			"reconciles durable offline edit/discard (%j) before any old vault import",
			async (text) => {
				await restart("owner-a");
				await edit(kind, "old proven text");
				expect(await vaultText(kind)).toBe("old proven text");
				const generation = current().admitted.scope;
				await restart(null);
				expect(current().admitted.scope).toBe(generation);
				expect(await shown(kind)).toBe("old proven text");
				await edit(kind, text);
				// The actual vault has no read/write lease offline; its old committed bytes
				// are genuinely still there, rather than a permissive mock deleting them.
				expect(
					[...(disk.families.get("recovery")?.values() ?? [])].some((value) =>
						value.includes("old proven text"),
					),
				).toBe(true);
				await restart("owner-a");
				expect(current().admitted.scope).toBe(generation);
				expect(await shown(kind)).toBe(text);
				expect(await vaultText(kind)).toBe(text);
				await current().auth.startupAuthorizationLifecycle.revoke();
				await restart("owner-a");
				expect(await shown(kind)).toBe(text);
			},
		);
		it.each(["", "current text before expiry"])(
			"hands pending offline intent (%j) through real revoke/purge into fresh same-owner recovery",
			async (text) => {
				await restart("owner-a");
				await edit(kind, "old proven text");
				await restart(null);
				await edit(kind, text);
				const oldGeneration = current().admitted.scope;
				await current().auth.startupAuthorizationLifecycle.revoke();
				expect(current().auth.getStartupAuthorization()).toBeNull();
				expect(current().recovery.isDraftRecoveryAdmitted()).toBe(false);
				// Checkpointing with cached comparison metadata did not grant read proof.
				expect(
					await current().recovery.readRecoveryDraft(
						"startup:active",
						oldGeneration,
					),
				).toBeNull();
				await restart("owner-a");
				expect(current().admitted.scope).not.toBe(oldGeneration);
				expect(await shown(kind)).toBe(text);
			},
		);
		it.each(["", "current text before explicit reauth"])(
			"hands pending intent (%j) through explicit reauthentication retirement before purge",
			async (text) => {
				await restart("owner-a");
				await edit(kind, "old proven text");
				await restart(null);
				await edit(kind, text);
				await current().auth.startupAuthorizationLifecycle.retire(
					false,
					undefined,
					"reauthenticate",
				);
				expect(current().auth.getStartupAuthorization()).toBeNull();
				expect(current().recovery.isDraftRecoveryAdmitted()).toBe(false);
				await restart("owner-a");
				expect(await shown(kind)).toBe(text);
			},
		);
		it("deletes stale recovery when replacement fails, rather than restoring the predecessor", async () => {
			await restart("owner-a");
			await edit(kind, "old proven text");
			await restart(null);
			await edit(kind, "current offline text");

			disk.failWrite = true;
			await current().auth.startupAuthorizationLifecycle.revoke();
			expect(disk.failedWrites).toBeGreaterThan(0);
			expect(disk.removals).toBeGreaterThan(0);
			disk.failWrite = false;
			await restart("owner-a");
			expect(await shown(kind)).toBe("");
		});
		it("does not purge the durable last copy if replacement AND stale deletion both fail", async () => {
			await restart("owner-a");
			await edit(kind, "old proven text");
			await restart(null);
			await edit(kind, "current offline text");
			disk.failWrite = true;
			disk.failRemove = true;
			await expect(
				current().auth.startupAuthorizationLifecycle.revoke(),
			).rejects.toThrow("deletion failed");
			expect((await storage.readStartupAuthorization())?.state).toBe("active");
			disk.failWrite = false;
			disk.failRemove = false;
			await restart("owner-a");
			expect(await shown(kind)).toBe("current offline text");
		});
		it("a generation without a proven comparison tuple deletes stale recovery instead of claiming its owner", async () => {
			await restart("owner-a");
			await edit(kind, "old proven text");
			await current().auth.startupAuthorizationLifecycle.revoke();
			await restart(null);
			await edit(kind, "unowned offline text");
			await current().auth.startupAuthorizationLifecycle.revoke();
			await restart("owner-a");
			expect(await shown(kind)).toBe("");
		});
		it("a different proven owner purges the prior handoff", async () => {
			await restart("owner-a");
			await edit(kind, "old proven text");
			await restart(null);
			await edit(kind, "current offline text");
			await current().auth.startupAuthorizationLifecycle.revoke();
			await restart("owner-b");
			expect(await shown(kind)).toBe("");
			expect(disk.erased).toBeGreaterThan(0);
		});
	});
