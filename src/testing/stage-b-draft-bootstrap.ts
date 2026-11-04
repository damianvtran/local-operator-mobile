import {
	STAGE_B_BUNDLE,
	STAGE_B_HOST,
	type StageBProofConfig,
	stageBTransport,
	syntheticValue,
	validateStageBProof,
} from "./stage-b-draft-transport";

/** PROOF ENTRY ONLY. No ordinary route imports this module, no production env
 * flag enables it, and it never seeds an authority/scope/queue. The real provider
 * must cold-restore synthetic credentials and obtain its own authenticated /me. */
export function installStageBDraftProof(
	config: StageBProofConfig,
): () => Promise<void> {
	validateStageBProof(config);
	// This MUST run during entry evaluation, before router/provider imports. Seed
	// I/O belongs behind the registered React root, never before main registration.
	const nativeFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = stageBTransport(config, nativeFetch);
	return () => bootStageBDraftProof(config, nativeFetch);
}

async function bootStageBDraftProof(
	config: StageBProofConfig,
	nativeFetch: typeof fetch,
): Promise<void> {
	const { default: Constants } = await import("expo-constants");
	const embedded = Constants.expoConfig?.extra?.stageBProof as
		| StageBProofConfig
		| undefined;
	if (
		Constants.expoConfig?.ios?.bundleIdentifier !== STAGE_B_BUNDLE ||
		JSON.stringify(embedded) !== JSON.stringify(config)
	)
		throw new Error("proof bundle identity does not match compiled config");
	const headers = {
		"x-stage-b-proof": config.nonce,
		"content-type": "application/json",
	};
	const control = (path: string, init?: RequestInit) =>
		nativeFetch(`${config.fixtureOrigin}/proof/${path}`, { ...init, headers });
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
	const storage = await import("@/features/auth/tunnel-storage");
	const { privateDataKeys } = await import("@/connection/private-data-key");
	const { File, Directory, Paths } = await import("expo-file-system");
	const crypto = await import("expo-crypto");
	const sentinel = () =>
		new File(Paths.cache, "lo-mobile-private-installation-v1");
	const hash = (value: string) =>
		crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, value);
	const priorKey = await privateDataKeys().read();
	await receipt("startup", {
		survivingKey: priorKey !== null,
		sentinelPresent: sentinel().exists,
		installFingerprint: priorKey ? await hash(priorKey.installId) : "none",
	});
	const response = await control("seed");
	if (!response.ok) throw new Error("synthetic credential seed unavailable");
	const seed = (await response.json()) as {
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
	const now = Date.now();
	await storage.writeStoredOauth({
		access: String(seed.access),
		refresh: syntheticValue(config, "oauth-refresh"),
		expires_at: seed.expiredAccess === true ? now - 1 : now + 3600000,
		scope: "openid",
		token_type: "Bearer",
		account_label: "Stage B synthetic account",
		account_id: null,
	});
	await storage.writeStoredTunnelSession({
		grant: String(seed.grant),
		grantExpiresAt: now + 300000,
		refreshHandle: String(seed.refreshHandle),
		refreshExpiresAt: now + 2592000000,
		hostname: STAGE_B_HOST,
		tunnelId: "stage-b-personal-tunnel",
		mintedAt: now,
	});
	await receipt("seeded", { nativeSecureStorage: true });

	const canary = `stage-b-private-draft-${config.nonce}`;
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
					if ((await entry.text()).includes(canary)) plaintext = true;
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
	await receipt("observer-control", { detected, removed: !positive.exists });
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
}
