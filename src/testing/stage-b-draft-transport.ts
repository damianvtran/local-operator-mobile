/** Imported only by the generated dedicated proof entry, never by app routes.
 * Unknown requests MUST reject: falling through would send a real credential or
 * leave a fixture failure looking like a production connectivity problem. */
export const STAGE_B_BUNDLE = "com.localoperator.mobile.stagebproof";
export const STAGE_B_HOST =
	"0123456789abcdef0123456789abcdef-lop.radienthq.com";
export const STAGE_B_OTHER_HOST =
	"1123456789abcdef0123456789abcdef-lop.radienthq.com";
export interface StageBProofConfig {
	flavor: "stage-b-draft-proof";
	bundleId: typeof STAGE_B_BUNDLE;
	sourceSha: string;
	nonce: string;
	fixtureOrigin: string;
}
const DRAFT_CANARY = /^stage-b-private-draft-[a-f0-9]{32}$/;
/** A public marker, never the HTTP control credential. Both the coordinator and
 * native scanner consume the same seed value across every process restart. */
export function stageBDraftCanary(value: unknown, authNonce: string): string {
	if (
		typeof value !== "string" ||
		!DRAFT_CANARY.test(value) ||
		value.includes(authNonce)
	)
		throw new Error("independent synthetic draft canary required");
	return value;
}
export function stageBContainsDraftCanary(
	text: string,
	canary: string,
): boolean {
	return text.includes(canary);
}

// Proof diagnostics are uploaded and drawn on-screen. Keep nonce-derived auth,
// canaries, bearer/JWT material and long opaque key values out of both surfaces.
export function stageBDiagnosticText(value: string): string {
	return value
		.replace(
			/stage-b-(?:synthetic|private-draft)-[^\s"'\\]+/gi,
			"[redacted-proof-value]",
		)
		.replace(/Bearer\s+[^\s"'\\]+/gi, "Bearer [redacted]")
		.replace(
			/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+/g,
			"[redacted-jwt]",
		)
		.replace(
			/\b(?:access|refresh|grant|token|password|authorization|nonce)\b["']?\s*[:=]\s*["']?[^\s,"'}\\]+/gi,
			"[redacted-credential]",
		)
		.replace(/[a-f0-9]{24,}/gi, "[redacted-opaque]")
		.replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, "[redacted-key]");
}
export function stageBSeedFailure(error: unknown): {
	name: string;
	message: string;
} {
	const record =
		error && typeof error === "object"
			? (error as { name?: unknown; message?: unknown })
			: null;
	return {
		name: stageBDiagnosticText(
			typeof record?.name === "string" ? record.name : "Error",
		).slice(0, 80),
		message: stageBDiagnosticText(
			typeof record?.message === "string"
				? record.message
				: String(error ?? "bootstrap failed"),
		)
			.replace(/[\r\n]/g, " ")
			.slice(0, 240),
	};
}
/** Native Constants may reserialize dictionaries in a different property order.
 * Compare the exact identity fields, never JSON encoding order or guessed labels. */
export function assertStageBEmbeddedConfig(
	embedded: unknown,
	bundleId: unknown,
	config: StageBProofConfig,
): void {
	const keys = Object.keys(config) as (keyof StageBProofConfig)[];
	const fail = (fields: string) => {
		throw new Error(
			`proof bundle identity does not match compiled config: ${fields}`,
		);
	};
	if (bundleId !== STAGE_B_BUNDLE) fail("bundle-identifier");
	if (!embedded || typeof embedded !== "object")
		fail("embedded-config-unavailable");
	const value = embedded as Record<string, unknown>;
	if (Object.keys(value).length !== keys.length) fail("unexpected-field-count");
	const mismatch = keys.filter((key) => value[key] !== config[key]);
	if (mismatch.length) fail(`fields=${mismatch.join(",")}`);
}
const SHA = /^[a-f0-9]{40}$/;
const NONCE = /^[a-f0-9]{32}$/;
export function validateStageBProof(config: StageBProofConfig): void {
	const origin = new URL(config.fixtureOrigin);
	if (
		config.flavor !== "stage-b-draft-proof" ||
		config.bundleId !== STAGE_B_BUNDLE ||
		!SHA.test(config.sourceSha) ||
		!NONCE.test(config.nonce) ||
		origin.origin !== config.fixtureOrigin ||
		origin.protocol !== "http:" ||
		origin.hostname !== "127.0.0.1" ||
		!origin.port
	)
		throw new Error("invalid dedicated native proof identity");
}
export const syntheticValue = (
	config: StageBProofConfig,
	name: string,
): string => `stage-b-synthetic-${config.nonce}-${name}`;

/** Preserve the production request semantics, including no-store/error, while
 * swapping ONLY allowlisted synthetic destinations for an owned real socket.
 * The fixed production /me API itself receives no fixture configurability. */
export function stageBTransport(
	config: StageBProofConfig,
	nativeFetch: typeof fetch,
): typeof fetch {
	validateStageBProof(config);
	const prefix = syntheticValue(config, "");
	const controlPaths = new Set([
		"/v1/me",
		"/v1/tunnels",
		"/v1/tunnels/session/code",
		"/v1/tunnels/session/token",
		"/v1/tunnels/session/refresh",
		"/v1/tunnels/session/logout",
		"/v1/auth/oauth/token",
	]);
	return async (input, init) => {
		const request =
			typeof input === "string" || input instanceof URL ? null : input;
		const url = new URL(request?.url ?? String(input));
		const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
		const headers = new Headers(init?.headers ?? request?.headers);
		const options = { ...init, method, headers };
		if (
			url.origin === "https://api.radienthq.com" &&
			controlPaths.has(url.pathname) &&
			!url.search
		) {
			const bearer = headers.get("authorization") ?? "";
			const authenticated = [
				"/v1/me",
				"/v1/tunnels",
				"/v1/tunnels/session/code",
			].includes(url.pathname);
			if (headers.has("cookie"))
				throw new Error("control-plane proof cookies refused");
			if (
				(authenticated || bearer.length > 0) &&
				!["access-a", "access-a-renewed", "access-b", "access-tenant-b"].some(
					(name) => bearer === `Bearer ${syntheticValue(config, name)}`,
				)
			)
				throw new Error("non-synthetic proof credential refused");
			if (url.pathname === "/v1/me") {
				if (
					method !== "GET" ||
					init?.cache !== "no-store" ||
					init?.redirect !== "error" ||
					headers.get("cache-control") !== "no-store, no-cache" ||
					headers.get("pragma") !== "no-cache"
				)
					throw new Error("unsafe native identity request");
				headers.set("x-stage-b-no-store", "true");
				headers.set("x-stage-b-redirect-error", "true");
			} else if (url.pathname === "/v1/tunnels") {
				if (method !== "GET") throw new Error("unsupported discovery method");
			} else if (url.pathname === "/v1/auth/oauth/token") {
				if (method !== "POST" || typeof init?.body !== "string")
					throw new Error("unsupported synthetic refresh request");
				const body = JSON.parse(init.body) as Record<string, unknown>;
				if (
					body.grant_type !== "refresh_token" ||
					body.refresh_token !== syntheticValue(config, "oauth-refresh") ||
					Object.keys(body).some(
						(key) =>
							!["grant_type", "refresh_token", "client_id"].includes(key),
					)
				)
					throw new Error("non-synthetic OAuth refresh refused");
			} else {
				if (method !== "POST" || typeof init?.body !== "string")
					throw new Error("unsupported native proof auth request");
				const body = JSON.parse(init.body) as Record<string, unknown>;
				if (
					![STAGE_B_HOST, STAGE_B_OTHER_HOST].includes(String(body.hostname)) ||
					(authenticated &&
						body.tunnel_id !==
							(body.hostname === STAGE_B_HOST
								? "stage-b-personal-tunnel"
								: "stage-b-other-personal-tunnel"))
				)
					throw new Error("non-synthetic proof destination refused");
				if (
					!authenticated &&
					![body.code, body.refresh_token].some(
						(value) => typeof value === "string" && value.startsWith(prefix),
					)
				)
					throw new Error("non-synthetic refresh/code refused");
			}
		} else if (
			[STAGE_B_HOST, STAGE_B_OTHER_HOST].some(
				(host) => url.origin === `https://${host}`,
			) &&
			(url.pathname === "/healthz" || url.pathname.startsWith("/api/"))
		) {
			// Computers probes /healthz publicly BEFORE choosing a route, exactly
			// like the real relay. Requiring a grant here fabricated "no answer".
			// This exception is GET-only and NEVER admits any /api request.
			const publicProbe =
				url.pathname === "/healthz" &&
				method === "GET" &&
				!headers.has("cookie") &&
				!headers.has("authorization");
			if (
				!publicProbe &&
				(headers.get("cookie") !==
					`__Host-radient-grant=${syntheticValue(config, "grant")}` ||
					headers.get("origin") !== url.origin ||
					headers.get("authorization"))
			)
				throw new Error("non-synthetic relay authority refused");
		} else {
			throw new Error("destination outside dedicated proof allowlist");
		}
		headers.set("x-stage-b-proof", config.nonce);
		return nativeFetch(
			`${config.fixtureOrigin}${url.pathname}${url.search}`,
			options,
		);
	};
}
