import {
	assertStageBEmbeddedConfig,
	STAGE_B_HOST,
	type StageBProofConfig,
	stageBContainsDraftCanary,
	stageBDraftCanary,
	stageBTransport,
	syntheticValue,
	validateStageBProof,
} from "./stage-b-draft-transport";

export { stageBSeedFailure } from "./stage-b-draft-transport";

/** Exercise the same native Keychain bridge before seeding any credentials.
 * Always remove the dedicated throwaway; a cleanup failure must not hide the
 * original entitlement/write/read error that diagnostics need to expose. */
export async function stageBKeychainPreflight(
	port: {
		write(): Promise<void>;
		read(): Promise<string | null>;
		remove(): Promise<void>;
	},
	expected: string,
): Promise<void> {
	let failure: { cause: unknown } | undefined;
	try {
		await port.write();
		if ((await port.read()) !== expected)
			throw new Error("keychain preflight round-trip mismatch");
	} catch (cause) {
		failure = { cause };
	}
	try {
		await port.remove();
	} catch (cause) {
		failure ??= { cause };
	}
	if (failure) throw failure.cause;
	if ((await port.read()) !== null)
		throw new Error("keychain preflight cleanup failed");
}

/** PROOF ENTRY ONLY. No ordinary route imports this module, no production env
 * flag enables it, and it never seeds an authority/scope/queue. The real provider
 * must cold-restore synthetic credentials and obtain its own authenticated /me. */
export function installStageBDraftProof(
	config: StageBProofConfig,
): (report?: (stage: string) => void) => Promise<void> {
	validateStageBProof(config);
	// This MUST run during entry evaluation, before router/provider imports. Seed
	// I/O belongs behind the registered React root, never before main registration.
	const nativeFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = stageBTransport(config, nativeFetch);
	return (report = () => {}) =>
		bootStageBDraftProof(config, nativeFetch, report);
}

async function bootStageBDraftProof(
	config: StageBProofConfig,
	nativeFetch: typeof fetch,
	report: (stage: string) => void,
): Promise<void> {
	const stage = (name: string) => {
		report(name);
		console.info(`Stage B bootstrap stage=${name}`);
	};
	const bounded = async <T>(
		name: string,
		operation: () => Promise<T>,
	): Promise<T> => {
		stage(name);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				operation(),
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() => reject(new Error(`bootstrap deadline exceeded at ${name}`)),
						30000,
					);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	};
	// Embedded non-lazy bundles already contain these modules. Synchronous require
	// avoids depending on Metro's async-loading policy during the seed gate.
	stage("constants-module");
	const { default: Constants } =
		require("expo-constants") as typeof import("expo-constants");
	const embedded = Constants.expoConfig?.extra?.stageBProof as
		| StageBProofConfig
		| undefined;
	stage("embedded-identity");
	assertStageBEmbeddedConfig(
		embedded,
		Constants.expoConfig?.ios?.bundleIdentifier,
		config,
	);
	const headers = {
		"x-stage-b-proof": config.nonce,
		"content-type": "application/json",
	};
	const control = async (path: string, init?: RequestInit) => {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				nativeFetch(`${config.fixtureOrigin}/proof/${path}`, {
					...init,
					headers,
					signal: controller.signal,
				}),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => {
						controller.abort();
						reject(new Error(`fixture ${path} deadline exceeded`));
					}, 20000);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	};
	const receipt = async (
		kind: string,
		values: Record<string, string | number | boolean>,
	) => {
		const response = await control("receipt", {
			method: "POST",
			body: JSON.stringify({ kind, sourceSha: config.sourceSha, ...values }),
		});
		if (!response.ok) throw new Error("proof receipt refused");
	};
	stage("storage-module");
	const storage =
		require("@/features/auth/tunnel-storage") as typeof import("@/features/auth/tunnel-storage");
	stage("key-module");
	const { privateDataKeys } =
		require("@/connection/private-data-key") as typeof import("@/connection/private-data-key");
	stage("filesystem-module");
	const { File, Directory, Paths } =
		require("expo-file-system") as typeof import("expo-file-system");
	stage("crypto-module");
	const crypto = require("expo-crypto") as typeof import("expo-crypto");
	const sentinel = () =>
		new File(Paths.cache, "lo-mobile-private-installation-v1");
	const hash = (value: string) =>
		crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, value);
	stage("keychain-preflight");
	const secureStore =
		require("expo-secure-store") as typeof import("expo-secure-store");
	const probeKey = "lo-mobile-stage-b-keychain-preflight";
	const probeValue = "stage-b-keychain-round-trip";
	const probeOptions = {
		keychainAccessible: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
	};
	await bounded("keychain-preflight", () =>
		stageBKeychainPreflight(
			{
				write: () =>
					secureStore.setItemAsync(probeKey, probeValue, probeOptions),
				read: () => secureStore.getItemAsync(probeKey, probeOptions),
				remove: () => secureStore.deleteItemAsync(probeKey, probeOptions),
			},
			probeValue,
		),
	);
	const priorKey = await bounded("private-key-read", () =>
		privateDataKeys().read(),
	);
	stage("startup-receipt");
	await receipt("startup", {
		keychainPreflight: true,
		survivingKey: priorKey !== null,
		sentinelPresent: sentinel().exists,
		installFingerprint: priorKey ? await hash(priorKey.installId) : "none",
	});
	stage("fixture-seed");
	const response = await control("seed");
	if (!response.ok) throw new Error("synthetic credential seed unavailable");
	const seed = (await response.json()) as {
		canary?: unknown;
		access?: unknown;
		grant?: unknown;
		refreshHandle?: unknown;
		hostname?: unknown;
		tunnelId?: unknown;
		expiredAccess?: unknown;
	};
	if (
		!["access-a", "access-a-renewed", "access-b", "access-tenant-b"].some(
			(name) => seed.access === syntheticValue(config, name),
		) ||
		seed.grant !== syntheticValue(config, "grant") ||
		seed.refreshHandle !== syntheticValue(config, "refresh") ||
		seed.hostname !== STAGE_B_HOST ||
		seed.tunnelId !== "stage-b-personal-tunnel"
	)
		throw new Error("non-synthetic credential seed refused");
	const canary = stageBDraftCanary(seed.canary, config.nonce);
	const now = Date.now();
	await bounded("oauth-write", () =>
		storage.writeStoredOauth({
			access: String(seed.access),
			refresh: syntheticValue(config, "oauth-refresh"),
			expires_at: seed.expiredAccess === true ? now - 1 : now + 3600000,
			scope: "openid",
			token_type: "Bearer",
			account_label: "Stage B synthetic account",
			account_id: null,
		}),
	);
	await bounded("tunnel-write", () =>
		storage.writeStoredTunnelSession({
			grant: String(seed.grant),
			grantExpiresAt: now + 300000,
			refreshHandle: String(seed.refreshHandle),
			refreshExpiresAt: now + 2592000000,
			hostname: STAGE_B_HOST,
			tunnelId: "stage-b-personal-tunnel",
			mintedAt: now,
		}),
	);
	stage("seeded-receipt");
	await receipt("seeded", { nativeSecureStorage: true });

	const scan = async () => {
		let files = 0;
		let committed = 0;
		let plaintext = false;
		const visit = async (directory: InstanceType<typeof Directory>) => {
			if (!directory.exists) return;
			for (const entry of directory.list()) {
				if (entry instanceof Directory) await visit(entry);
				else {
					files++;
					if (entry.name.endsWith(".json")) committed++;
					if (stageBContainsDraftCanary(await entry.text(), canary))
						plaintext = true;
				}
			}
		};
		for (const name of [
			"lo-mobile-sealed-v1",
			"lo-mobile-store",
			"lo-mobile-startup",
		])
			await visit(new Directory(Paths.document, name));
		return { files, committed, plaintext };
	};
	// The observer must detect a planted leak before its absence is trusted. The
	// control is synthetic, ephemeral and removed before the real app imports.
	const positive = new File(
		Paths.document,
		"lo-mobile-store",
		"stage-b-observer-control.json",
	);
	positive.create({ intermediates: true });
	positive.write(canary);
	const detected = (await scan()).plaintext;
	positive.delete();
	if (!detected)
		throw new Error("plaintext observer failed its positive control");
	stage("observer-control");
	await receipt("observer-control", { detected, removed: !positive.exists });
	// Seed is fully durable before importing the real provider singleton. React
	// mounts it only after this gate resolves. No ordinary entry imports this
	// observer; the callback hook is inserted only in the generated CI checkout.
	stage("selection-trace");
	const { connectionStore } =
		require("@/features/auth/connection-provider") as typeof import("@/features/auth/connection-provider");
	const { stageBRouteTrace } =
		require("./stage-b-route-trace") as typeof import("./stage-b-route-trace");
	const trace = stageBRouteTrace(
		() => connectionStore.getState(),
		(event) => receipt("route-trace", { ...event }),
	);
	(globalThis as { __stageBRowPress?: () => void }).__stageBRowPress =
		trace.rowPress;
	(
		globalThis as { __stageBSelectionSuperseded?: () => void }
	).__stageBSelectionSuperseded = trace.superseded;
	connectionStore.subscribe(trace.observe);
	trace.observe();
	let running = false;
	setInterval(() => {
		if (running) return;
		running = true;
		void (async () => {
			const result = await control("next");
			const { action } = (await result.json()) as { action: string | null };
			if (action !== null)
				await (
					await import("@/features/session/draft-recovery")
				).awaitDraftRecoveryWrites();
			if (action === "snapshot") {
				const picker = new Directory(Paths.cache, "ImagePicker");
				const pickerCopies = picker.exists ? picker.list().length : 0;
				const state = await scan();
				const key = await privateDataKeys().read();
				const { getStartupAuthorization } = await import(
					"@/connection/startup-authorization"
				);
				const scope = getStartupAuthorization()?.scope;
				await receipt("snapshot", {
					...state,
					pickerCopies,
					recoveryAdmitted: (
						await import("@/features/session/draft-recovery")
					).isDraftRecoveryAdmitted(),
					keyPresent: key !== null,
					sentinelPresent: sentinel().exists,
					installFingerprint: key ? await hash(key.installId) : "none",
					generationFingerprint: scope ? await hash(scope) : "none",
				});
			} else if (action === "drop-sentinel") {
				if (sentinel().exists) sentinel().delete();
				await receipt("drop-sentinel", {
					removed: !sentinel().exists,
					keyStillPresent: (await privateDataKeys().read()) !== null,
				});
			} else if (
				action === "partial-pending" ||
				action === "corrupt-recovery"
			) {
				const store = (
					await import("@/features/session/native-private-store")
				).nativePrivateStore("recovery");
				const key = (await store.keys()).find(
					(key) =>
						key.startsWith("[") &&
						(JSON.parse(key) as unknown[])[1] === "startup:active",
				);
				if (!key) throw new Error("no committed active recovery fixture");
				const directory = new Directory(
					Paths.document,
					"lo-mobile-sealed-v1",
					"recovery",
					await hash(key),
				);
				const latest = directory
					.list()
					.filter(
						(entry) => entry instanceof File && entry.name.endsWith(".json"),
					)
					.sort((a, b) => a.name.localeCompare(b.name))
					.at(-1);
				if (!(latest instanceof File))
					throw new Error("missing recovery commit");
				if (action === "partial-pending") {
					const name = String(Number(latest.name.slice(0, 12)) + 1).padStart(
						12,
						"0",
					);
					const pending = new File(directory, `${name}.pending`);
					pending.create();
					pending.write('{"version":');
				} else {
					const revision = JSON.parse(await latest.text()) as { value: string };
					const sealed = JSON.parse(revision.value) as { ciphertext: string };
					sealed.ciphertext =
						(sealed.ciphertext[0] === "A" ? "B" : "A") +
						sealed.ciphertext.slice(1);
					revision.value = JSON.stringify(sealed);
					latest.write(JSON.stringify(revision));
				}
				await receipt(action, { injected: true });
			} else if (action === "wrong-key") {
				const key = await privateDataKeys().read();
				if (!key) throw new Error("no native key fixture");
				await privateDataKeys().write({
					...key,
					keyHex: await (await crypto.AESEncryptionKey.generate()).encoded(
						"hex",
					),
				});
				await receipt("wrong-key", { injected: true });
			} else if (action !== null) throw new Error("unsupported proof control");
		})()
			.catch(() => {
				void receipt("control-error", { failed: true });
			})
			.finally(() => {
				running = false;
			});
	}, 400);
	stage("complete");
}
