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

/** Closed check-site codes only: native errors/values never enter callbacks. */
export const PROOF_APP_STAGES = [
	"seed-store-not-empty",
	"seed-write-not-persistent",
	"replace-not-persisted",
	"retire-held-mismatch",
	"retire-no-bearer",
	"retire-still-present",
	"restore-write-not-persistent",
	"restore-account-mismatch",
	"restore-persist-control",
	"restore-fresh",
	"restore-retired",
	"exception",
	"other",
] as const;
type AppStage = (typeof PROOF_APP_STAGES)[number];
class ProofCheckFailure extends Error {
	readonly stage: AppStage;
	constructor(stage: AppStage) {
		super("Native proof check failed");
		this.stage = stage;
	}
}

export const READY_KINDS = ["listener-ready"] as const;
export const PROGRESS_KINDS = ["url-admitted", "url-refused"] as const;
export const URL_REFUSAL_REASONS = [
	"identity",
	"scheme",
	"nonce",
	"phase",
	"callback",
	"parse",
] as const;
type UrlRefusal = (typeof URL_REFUSAL_REASONS)[number];
class UrlRefused extends Error {
	readonly reason: UrlRefusal;
	constructor(reason: UrlRefusal) {
		super("Proof URL refused");
		this.reason = reason;
	}
}
const RECEIVER_PORT = Number(
	process.env.EXPO_PUBLIC_RETIREMENT_PROOF_RECEIVER_PORT,
);
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

function staticIdentityValid(): boolean {
	return (
		Platform.OS === "ios" &&
		FLAVOR === "auth-retirement-proof" &&
		/^[a-f0-9]{32}$/.test(NONCE ?? "") &&
		/^[a-f0-9]{40}$/.test(SOURCE ?? "") &&
		Number.isInteger(RECEIVER_PORT) &&
		RECEIVER_PORT >= 20000 &&
		RECEIVER_PORT <= 39999
	);
}
function knownPhase(url: string): string | undefined {
	try {
		const phase = new URL(url).searchParams.get("phase");
		return phase && PHASES.has(phase) ? phase : undefined;
	} catch {
		return undefined;
	}
}
function admit(url: string): { phase: string; callback: string } {
	if (!staticIdentityValid()) throw new UrlRefused("identity");
	let request: URL;
	try {
		request = new URL(url);
	} catch {
		throw new UrlRefused("parse");
	}
	if (request.protocol !== "loretirementproof:" || request.hostname !== "run")
		throw new UrlRefused("scheme");
	if (request.searchParams.get("nonce") !== NONCE)
		throw new UrlRefused("nonce");
	const phase = request.searchParams.get("phase");
	if (!phase || !PHASES.has(phase)) throw new UrlRefused("phase");
	const callback = request.searchParams.get("callback") ?? "";
	let receiver: URL;
	try {
		receiver = new URL(callback);
	} catch {
		throw new UrlRefused("callback");
	}
	if (
		receiver.protocol !== "http:" ||
		receiver.hostname !== "127.0.0.1" ||
		receiver.port !== String(RECEIVER_PORT) ||
		receiver.pathname !== "/receipt" ||
		receiver.username ||
		receiver.password ||
		receiver.search ||
		receiver.hash
	)
		throw new UrlRefused("callback");
	return { phase, callback };
}
/** Best-effort coarse progress is bounded and cannot expose a callback URL or
 * exception. The receiver address is compiled, not obtained from an input URL. */
async function postMarker(
	path: "/ready" | "/progress",
	body: Record<string, unknown>,
): Promise<void> {
	if (!staticIdentityValid()) return;
	const abort = new AbortController(),
		timer = setTimeout(() => abort.abort(), 10000);
	try {
		await fetch(`http://127.0.0.1:${RECEIVER_PORT}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-proof-nonce": NONCE! },
			body: JSON.stringify({ ...body, flavor: FLAVOR, sourceSha: SOURCE }),
			signal: abort.signal,
		});
	} catch {
		/* A missing observation is not phase success; the host's budgets decide. */
	} finally {
		clearTimeout(timer);
	}
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
	const check = (yes: unknown, stage: AppStage) => {
		if (!yes) throw new ProofCheckFailure(stage);
	};
	if (phase === "seed") {
		// Explicit first setup only. The host MUST NOT invoke this after retirement.
		check((await store.readOauth()) === null, "seed-store-not-empty");
		check(
			(await writeStoredOauth(synthetic(true))).persistent,
			"seed-write-not-persistent",
		);
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
			"replace-not-persisted",
		);
		return {
			phase,
			ok: true,
			rawOauthPresent: (await store.readOauth()) !== null,
		};
	}
	if (phase === "retire") {
		const held = await readStoredOauth();
		check(held?.account_id === ACCOUNT, "retire-held-mismatch");
		accessor.replace(held);
		// Production refresh parser/transport + single-flight accessor, not a fake
		// rotated record write. No provider refresh-concurrency claim is made.
		const bearer = await accessor.access({ force: true });
		check(bearer !== null, "retire-no-bearer");
		await lifecycle.retire(false, () =>
			nativeCredentialRetirement.retire(null, async () => {
				accessor.replace(null);
				await clearStoredCredentials();
			}),
		);
		check((await store.readOauth()) === null, "retire-still-present");
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
			check(
				(await writeStoredOauth(t)).persistent,
				"restore-write-not-persistent",
			);
		},
		clearOauth: async () => {
			deletes += 1;
			await clearStoredOauth();
		},
		refresh,
		discover: async (t) => {
			check(t.account_id === ACCOUNT, "restore-account-mismatch");
			publishes += 1;
		},
	});
	const rawOauthPresent = (await store.readOauth()) !== null;
	if (phase === "persist-control")
		check(
			outcome.restored && rawOauthPresent && refreshes === 1 && publishes === 1,
			"restore-persist-control",
		);
	if (phase === "fresh-restore")
		check(
			outcome.restored && rawOauthPresent && refreshes === 0 && publishes === 1,
			"restore-fresh",
		);
	if (phase === "retired-restore")
		check(
			!outcome.restored &&
				!rawOauthPresent &&
				refreshes === 0 &&
				publishes === 0 &&
				deletes === 0,
			"restore-retired",
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
let listenerInstalled = false;
export function installAuthRetirementProof(): void {
	if (listenerInstalled) return;
	listenerInstalled = true;
	let consumed = false;
	const receive = async (url: string) => {
		if (consumed) return;
		let request: ReturnType<typeof admit>;
		try {
			request = admit(url);
		} catch (error) {
			const phase = knownPhase(url);
			await postMarker("/progress", {
				kind: "url-refused",
				reason: error instanceof UrlRefused ? error.reason : "parse",
				...(phase ? { phase } : {}),
			});
			return;
		}
		consumed = true;
		await postMarker("/progress", {
			kind: "url-admitted",
			phase: request.phase,
		});
		let receipt: Record<string, unknown>;
		try {
			receipt = await run(request.phase, request.callback);
		} catch (error) {
			receipt = {
				phase: request.phase,
				ok: false,
				stage: error instanceof ProofCheckFailure ? error.stage : "exception",
			};
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
	void postMarker("/ready", { kind: "listener-ready" });
}
