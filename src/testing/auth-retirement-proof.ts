/**
 * Dedicated unsigned simulator entry ONLY. Ordinary package.json stays pointed
 * at expo-router/entry; no production route, launch argument or auth hook imports
 * this module. The CI-generated entry supplies compile-time identity; a matching
 * per-run launch nonce is additional isolation, not a distributable backdoor.
 *
 * Call graph deliberately stops below ConnectionProvider/browser UI:
 *  seed/replacement -> writeStoredOauth / createRadientAccess.persist -> native
 *  credential serializer -> real Expo SecureStore; retire -> startup lifecycle
 *  retire -> nativeCredentialRetirement.retire -> clearStoredCredentials;
 *  restart -> carryOutRestore -> readStoredOauth (+tombstone fence).
 * These are the provider's SAME primitives, not a second key-deletion algorithm.
 * Native provider/UI, push deregistration and browser-auth E2E remain BLOCKED.
 */
import { Linking, Platform } from "react-native";
import {
	type RadientTokens,
	refreshRadientTokens,
} from "@/connection/radient-oauth";
import { StartupAuthorizationLifecycle } from "@/connection/startup-authorization";
import { expoSecureStore, SecureStorage } from "@/connection/storage";
import { nativeCredentialRetirement } from "@/features/auth/authentication-lifecycle";
import { createRadientAccess } from "@/features/auth/radient-access";
import { carryOutRestore } from "@/features/auth/radient-restore";
import {
	clearStoredCredentials,
	clearStoredOauth,
	readStoredOauth,
	writeStoredOauth,
} from "@/features/auth/tunnel-storage";

const FLAVOR = process.env.EXPO_PUBLIC_RETIREMENT_PROOF_FLAVOR;
const NONCE = process.env.EXPO_PUBLIC_RETIREMENT_PROOF_NONCE;
const SOURCE = process.env.EXPO_PUBLIC_RETIREMENT_PROOF_SOURCE;
const PHASES = new Set([
	"seed",
	"persist-control",
	"retire",
	"retired-restore",
	"fresh-replace",
	"fresh-restore",
]);
const ACCOUNT = "native-proof-account";
const ACCESS = `proof.${btoa(JSON.stringify({ sub: ACCOUNT }))}.unsigned-synthetic`;
const synthetic = (expired = false): RadientTokens => ({
	access: ACCESS,
	refresh: "synthetic-proof-refresh",
	expires_at: expired ? 0 : Date.now() + 3600000,
	token_type: "Bearer",
	scope: "openid",
	account_label: "Synthetic native proof",
	account_id: ACCOUNT,
});

function admit(url: string): { phase: string; callback: string } {
	if (
		Platform.OS !== "ios" ||
		FLAVOR !== "auth-retirement-proof" ||
		!NONCE ||
		!/^[a-f0-9]{32}$/.test(NONCE) ||
		!SOURCE ||
		!/^[a-f0-9]{40}$/.test(SOURCE)
	)
		throw new Error("Proof-only build required");
	const request = new URL(url);
	const phase = request.searchParams.get("phase");
	const callback = request.searchParams.get("callback") ?? "";
	const receiver = new URL(callback);
	if (
		request.protocol !== "loretirementproof:" ||
		request.hostname !== "run" ||
		request.searchParams.get("nonce") !== NONCE ||
		!phase ||
		!PHASES.has(phase) ||
		receiver.protocol !== "http:" ||
		receiver.hostname !== "127.0.0.1" ||
		!receiver.port ||
		receiver.pathname !== "/receipt" ||
		receiver.username ||
		receiver.password ||
		receiver.search ||
		receiver.hash
	)
		throw new Error("Proof command refused");
	return { phase, callback };
}

async function run(
	phase: string,
	callback: string,
): Promise<Record<string, unknown>> {
	/* Read through real production SecureStorage, with the native adapter — NEVER
	 * filesystem fixtures, memory adapters, direct Keychain APIs or raw key dumps.
	 * Raw reads below are presence checks needed to distinguish physical deletion
	 * from the app reader merely hiding a tombstoned grant. No token is reported. */
	const store = new SecureStorage(await expoSecureStore());
	const lifecycle = new StartupAuthorizationLifecycle({
		read: () => store.readStartupAuthorization(),
		write: (r) => store.writeStartupAuthorization(r),
	});
	let current: RadientTokens | null = null;
	let refreshes = 0,
		publishes = 0,
		deletes = 0;
	const tokenUrl = new URL("/token", callback).toString();
	const refresh = async (tokens: RadientTokens) => {
		refreshes += 1;
		return refreshRadientTokens(tokens, { tokenUrl });
	};
	const accessor = createRadientAccess({
		current: () => current,
		publish: (t) => {
			current = t;
		},
		refresh,
		write: writeStoredOauth,
		clear: clearStoredOauth,
		invalidGrant: () => false,
		serialize: (op) => nativeCredentialRetirement.retire(null, op),
	});
	const check = (yes: unknown) => {
		if (!yes) throw new Error("Native primitive proof phase failed");
	};
	if (phase === "seed") {
		// Explicit first setup only. The host MUST NOT invoke this after retirement.
		check((await store.readOauth()) === null);
		check((await writeStoredOauth(synthetic(true))).persistent);
		return {
			phase,
			ok: true,
			rawOauthPresent: (await store.readOauth()) !== null,
		};
	}
	if (phase === "fresh-replace") {
		// Synthetic explicit authentication replaces browser proof ONLY for this
		// primitive experiment. It is not a claim about the provider/browser flow.
		await lifecycle.retire(false, () =>
			nativeCredentialRetirement.retire(null, clearStoredCredentials),
		);
		accessor.replace(synthetic());
		check(
			await lifecycle.replaceCredentialsIfCurrent(lifecycle.getRevision(), () =>
				accessor.persist(synthetic()),
			),
		);
		return {
			phase,
			ok: true,
			rawOauthPresent: (await store.readOauth()) !== null,
		};
	}
	if (phase === "retire") {
		const held = await readStoredOauth();
		check(held?.account_id === ACCOUNT);
		accessor.replace(held);
		// Production refresh parser/transport + single-flight accessor, not a fake
		// rotated record write. No provider refresh-concurrency claim is made.
		const bearer = await accessor.access({ force: true });
		check(bearer !== null);
		await lifecycle.retire(false, () =>
			nativeCredentialRetirement.retire(null, async () => {
				accessor.replace(null);
				await clearStoredCredentials();
			}),
		);
		check((await store.readOauth()) === null);
		return {
			phase,
			ok: true,
			durableRetired: true,
			rawOauthPresent: false,
			refreshes,
		};
	}
	const outcome = await carryOutRestore({
		readOauth: readStoredOauth,
		writeOauth: async (t) => {
			check((await writeStoredOauth(t)).persistent);
		},
		clearOauth: async () => {
			deletes += 1;
			await clearStoredOauth();
		},
		refresh,
		discover: async (t) => {
			check(t.account_id === ACCOUNT);
			publishes += 1;
		},
	});
	const rawOauthPresent = (await store.readOauth()) !== null;
	if (phase === "persist-control")
		check(
			outcome.restored && rawOauthPresent && refreshes === 1 && publishes === 1,
		);
	if (phase === "fresh-restore")
		check(
			outcome.restored && rawOauthPresent && refreshes === 0 && publishes === 1,
		);
	if (phase === "retired-restore")
		check(
			!outcome.restored &&
				!rawOauthPresent &&
				refreshes === 0 &&
				publishes === 0 &&
				deletes === 0,
		);
	return {
		phase,
		ok: true,
		restored: outcome.restored,
		rawOauthPresent,
		refreshes,
		publishes,
		deletes,
	};
}

/** Install once in the generated proof entry. One command per process prevents
 * duplicate deep-link delivery from accidentally seeding or retiring twice. */
export function installAuthRetirementProof(): void {
	let consumed = false;
	const receive = async (url: string) => {
		if (consumed) return;
		let request: ReturnType<typeof admit>;
		try {
			request = admit(url);
		} catch {
			return;
		}
		consumed = true;
		let receipt: Record<string, unknown>;
		try {
			receipt = await run(request.phase, request.callback);
		} catch {
			receipt = { phase: request.phase, ok: false };
		}
		// Bounded receiver transport; never surface exception text or credentials.
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), 10000);
		try {
			await fetch(request.callback, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-proof-nonce": NONCE!,
				},
				body: JSON.stringify({ ...receipt, flavor: FLAVOR, sourceSha: SOURCE }),
				signal: abort.signal,
			});
		} finally {
			clearTimeout(timer);
		}
	};
	Linking.addEventListener("url", ({ url }) => {
		void receive(url);
	});
	void Linking.getInitialURL().then((url) => {
		if (url) void receive(url);
	});
}
