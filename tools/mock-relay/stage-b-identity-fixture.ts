import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { STAGE_B_HELD_RELEASE_MS } from "../../scripts/ci/stage-b-draft-timing.ts";
import {
	fixtureBody,
	startFixtureRelay,
} from "../../src/testing/fixture-relay.ts";
import { loadFixture } from "../../src/testing/fixtures.ts";
import {
	STAGE_B_BUNDLE,
	STAGE_B_HOST,
	STAGE_B_OTHER_HOST,
	type StageBProofConfig,
	syntheticValue,
} from "../../src/testing/stage-b-draft-transport.ts";

const OPAQUE_FINGERPRINT = /^[a-f0-9]{64}$/;
const PROCESS_LEASE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export type IdentityScenario =
	| "same"
	| "account-b"
	| "tenant-b"
	| "unauthorized"
	| "malformed"
	| "redirect"
	| "offline"
	| "held"
	| "refresh";
export interface StageBHeldProof {
	firstSeenAt: number;
	deadlineAt: number;
	readonly releasedAt?: number;
	recordFrame(name: string, completedAtMs?: number): void;
	release(): void;
}
const send = (response: ServerResponse, status: number, body: unknown) => {
	response.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify(body));
};
/** Deliberately cacheable identity responses discriminate native cache bypass:
 * cache:'no-store' alone is not forwarded by Expo57. The client must put its
 * explicit no-store/no-cache directives on the wire and issue a fresh request. */
const sendIdentity = (response: ServerResponse, body: unknown) => {
	response.writeHead(200, {
		"content-type": "application/json",
		"cache-control": "private, max-age=3600",
	});
	response.end(JSON.stringify(body));
};
/** A real socket fixture. Only synthetic credentials are accepted. Receipts are
 * counters/flags, never Authorization, body, draft text or attachment bytes. */
export async function startStageBIdentityFixture(sourceSha: string) {
	const nonce = randomBytes(16).toString("hex");
	// Draft text/YAML/screenshots are public proof artifacts, unlike the HTTP
	// control credential. Give the scanner its own independent, non-auth marker.
	let draftMarker = randomBytes(16).toString("hex");
	while (draftMarker === nonce) draftMarker = randomBytes(16).toString("hex");
	const canary = `stage-b-private-draft-${draftMarker}`;
	const config: StageBProofConfig = {
		flavor: "stage-b-draft-proof",
		bundleId: STAGE_B_BUNDLE,
		sourceSha,
		nonce,
		fixtureOrigin: "",
	};
	const value = (name: string) => syntheticValue(config, name);
	const relay = await startFixtureRelay({
		auth: {
			mode: "radient",
			grant: value("grant"),
			origin: `https://${STAGE_B_HOST}`,
		},
		cutStreamAfterMs: 1500,
	});
	let otherRelay: Awaited<ReturnType<typeof startFixtureRelay>>;
	try {
		otherRelay = await startFixtureRelay({
			auth: {
				mode: "radient",
				grant: value("grant"),
				origin: `https://${STAGE_B_OTHER_HOST}`,
			},
			cutStreamAfterMs: 1500,
		});
	} catch (error) {
		await relay.close();
		throw error;
	}
	let scenario: IdentityScenario = "same";
	let renewed = false;
	let expired = false;
	const held = new Set<() => void>();
	let heldObserver: ((proof: StageBHeldProof) => Promise<void>) | undefined;
	let heldReleaseMs = STAGE_B_HELD_RELEASE_MS;
	let heldCapture: Promise<void> | undefined;
	let identityObserver: (() => Promise<void>) | undefined;
	let identityCapture: Promise<void> | undefined;
	const heldTimings: {
		firstSeenAt: number;
		releasedAfterMs?: number;
		closedAfterMs?: number;
		deadlineMs: number;
		frames?: {
			name: string;
			completedAtMs?: number;
			completedAfterArrivalMs?: number;
			completedRelativeToReleaseMs?: number;
		}[];
	}[] = [];
	const identity = (response: ServerResponse, body: unknown) => {
		sendIdentity(response, body);
		if (identityObserver) {
			const observer = identityObserver;
			identityObserver = undefined;
			identityCapture = Promise.resolve().then(observer);
			void identityCapture.catch(() => {}); // Awaited by the coordinator; never an unhandled rejection.
		}
	};
	const heldWaiters = new Set<() => void>();
	const codes = new Map<string, { challenge: string; hostname: string }>();
	const receipts: Record<string, unknown>[] = [];
	// No URL/query/header values: these timestamps diagnose whether selection
	// reached each fixture boundary without leaking credentials into receipts.
	const requestTimeline: {
		kind: string;
		receivedAtMs: number;
		completedAtMs?: number;
		closedAtMs?: number;
		status?: number;
		scenario: IdentityScenario;
		counters?: Record<string, number>;
	}[] = [];
	const counters = {
		me: 0,
		healthProbes: 0,
		discovery: 0,
		redirectTarget: 0,
		mutations: 0,
		unauthorized: 0,
		oauthRefresh: 0,
		expired: 0,
	};
	const controlQueue: string[] = [];
	const seed = () => ({
		canary,
		access: value(
			scenario === "account-b"
				? "access-b"
				: scenario === "tenant-b"
					? "access-tenant-b"
					: renewed && scenario !== "refresh"
						? "access-a-renewed"
						: "access-a",
		),
		grant: value("grant"),
		refreshHandle: value("refresh"),
		expiredAccess: scenario === "refresh",
		hostname: STAGE_B_HOST,
		tunnelId: "stage-b-personal-tunnel",
	});
	const server = createServer(async (request, response) => {
		const path = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
		const kind =
			path === "/healthz"
				? "health"
				: path === "/v1/me"
					? "me"
					: path === "/v1/tunnels"
						? "discovery"
						: null;
		if (kind) {
			const event = {
				kind,
				receivedAtMs: Date.now(),
				scenario,
			} as (typeof requestTimeline)[number];
			requestTimeline.push(event);
			response.once("finish", () => {
				event.completedAtMs = Date.now();
				event.status = response.statusCode;
				event.counters = { ...counters };
			});
			response.once("close", () => {
				event.closedAtMs = Date.now();
			});
		}
		try {
			// Count redirect targets before authentication so a platform that follows
			// but drops headers cannot fake the no-follow negative control.
			if (
				new URL(request.url ?? "/", "http://fixture.invalid").pathname ===
				"/redirect-target"
			) {
				counters.redirectTarget++;
				send(response, 403, {});
				return;
			}
			if (request.headers["x-stage-b-proof"] !== nonce) {
				send(response, 403, { error: "proof nonce required" });
				return;
			}
			const url = new URL(request.url ?? "/", "http://fixture.invalid");
			if (url.pathname === "/proof/seed" && request.method === "GET") {
				send(response, 200, seed());
				return;
			}
			if (url.pathname === "/proof/next" && request.method === "GET") {
				send(response, 200, { action: controlQueue.shift() ?? null });
				return;
			}
			if (url.pathname === "/proof/receipt" && request.method === "POST") {
				let raw = "";
				for await (const chunk of request) {
					raw += chunk;
					if (raw.length > 4096) throw new Error("receipt too large");
				}
				const receipt: unknown = JSON.parse(raw);
				if (
					typeof receipt !== "object" ||
					receipt === null ||
					!("kind" in receipt) ||
					!("sourceSha" in receipt) ||
					(receipt.kind === "route-trace" &&
						[
							"traceEvent",
							"traceSequence",
							"traceAtMs",
							"traceRevision",
							"tracePhase",
							"traceRoute",
							"traceSelected",
							"traceFailure",
						].some((key) => !(key in receipt))) ||
					(receipt.kind === "stage-b-callback-probe" &&
						[
							"processId",
							"presses",
							"superseded",
							"traceRevision",
							"tracePhase",
							"traceRoute",
							"traceSelected",
							"traceFailure",
						].some((key) => !(key in receipt))) ||
					Object.entries(receipt).some(([key, val]) => {
						if (key === "kind")
							return ![
								"startup",
								"seeded",
								"observer-control",
								"snapshot",
								"drop-sentinel",
								"partial-pending",
								"corrupt-recovery",
								"wrong-key",
								"control-error",
								"route-trace",
								"stage-b-callback-probe",
							].includes(String(val));
						if (key === "sourceSha") return val !== sourceSha;
						if (key === "traceEvent")
							return !["row-press", "state", "superseded"].includes(
								String(val),
							);
						if (key === "tracePhase")
							return ![
								"signed-out",
								"discovering",
								"minting",
								"live",
								"re-minting",
								"degraded",
								"refused",
								"other",
							].includes(String(val));
						if (key === "traceRoute")
							return !["none", "radient", "custom", "other"].includes(
								String(val),
							);
						if (["traceSequence", "traceAtMs", "traceRevision"].includes(key))
							return (
								typeof val !== "number" ||
								!Number.isSafeInteger(val) ||
								val < 0 ||
								(key === "traceSequence" && (val < 1 || val > 32))
							);
						if (["installFingerprint", "generationFingerprint"].includes(key))
							return (
								typeof val !== "string" ||
								(val !== "none" && !OPAQUE_FINGERPRINT.test(val))
							);
						if (key === "processId")
							return (
								typeof val !== "string" || !PROCESS_LEASE.test(String(val))
							);
						if (["presses", "superseded"].includes(key))
							return (
								typeof val !== "number" ||
								!Number.isSafeInteger(val) ||
								val < 0 ||
								val > 100000
							);
						if (["files", "committed", "pickerCopies"].includes(key))
							return (
								typeof val !== "number" || !Number.isSafeInteger(val) || val < 0
							);
						return (
							![
								"traceSelected",
								"traceFailure",
								"survivingKey",
								"sentinelPresent",
								"nativeSecureStorage",
								"keychainPreflight",
								"detected",
								"removed",
								"plaintext",
								"keyPresent",
								"recoveryAdmitted",
								"keyStillPresent",
								"injected",
								"failed",
							].includes(key) || typeof val !== "boolean"
						);
					})
				) {
					send(response, 400, {});
					return;
				}
				receipts.push(receipt as Record<string, unknown>);
				send(response, 200, { ok: true });
				return;
			}
			const bearer = request.headers.authorization;
			const accepted = [
				"access-a",
				"access-a-renewed",
				"access-b",
				"access-tenant-b",
			].some((name) => bearer === `Bearer ${value(name)}`);
			if (
				["/v1/me", "/v1/tunnels", "/v1/tunnels/session/code"].includes(
					url.pathname,
				) &&
				!accepted
			) {
				counters.unauthorized++;
				send(response, 401, { error: "synthetic credential required" });
				return;
			}
			if (url.pathname === "/v1/me" && request.method === "GET") {
				counters.me++;
				if (
					request.headers["x-stage-b-no-store"] !== "true" ||
					request.headers["x-stage-b-redirect-error"] !== "true" ||
					request.headers["cache-control"] !== "no-store, no-cache" ||
					request.headers.pragma !== "no-cache"
				) {
					send(response, 400, { error: "unsafe identity request" });
					return;
				}
				if (scenario === "unauthorized") {
					send(response, 401, {});
					return;
				}
				if (scenario === "offline") {
					response.destroy();
					return;
				}
				if (scenario === "redirect") {
					response.writeHead(302, {
						location: `${config.fixtureOrigin}/redirect-target`,
					});
					response.end();
					return;
				}
				const account =
					bearer === `Bearer ${value("access-b")}`
						? "stage-b-account-b"
						: "stage-b-account-a";
				const body = {
					result: {
						identity: { account_id: account },
						account: {
							id: account,
							tenant_id:
								bearer === `Bearer ${value("access-tenant-b")}`
									? "stage-b-tenant-b"
									: "stage-b-tenant-a",
						},
					},
				};
				if (scenario === "malformed") {
					send(response, 200, {
						result: { identity: { account_id: account } },
					});
					return;
				}
				if (scenario === "held") {
					const observer = heldObserver;
					heldObserver = undefined;
					const firstSeenAt = Date.now();
					const timing = {
						firstSeenAt,
						deadlineMs: heldReleaseMs,
					} as (typeof heldTimings)[number];
					heldTimings.push(timing);
					let timer: ReturnType<typeof setTimeout> | undefined;
					const release = () => {
						if (timer) clearTimeout(timer);
						if (!held.delete(release)) return;
						timing.releasedAfterMs = Date.now() - firstSeenAt;
						for (const frame of timing.frames ?? []) {
							if (frame.completedAtMs !== undefined)
								frame.completedRelativeToReleaseMs =
									frame.completedAtMs - firstSeenAt - timing.releasedAfterMs;
						}
						if (!response.destroyed) identity(response, body);
					};
					held.add(release);
					for (const ready of heldWaiters) ready();
					heldWaiters.clear();
					response.once("close", () => {
						timing.closedAfterMs = Date.now() - firstSeenAt;
						if (timer) clearTimeout(timer);
						held.delete(release);
					});
					if (observer) {
						// Never let capture/driver latency extend the proof's production deadline.
						timer = setTimeout(release, heldReleaseMs);
						heldCapture = Promise.resolve().then(() =>
							observer({
								firstSeenAt,
								deadlineAt: firstSeenAt + heldReleaseMs,
								get releasedAt() {
									return timing.releasedAfterMs === undefined
										? undefined
										: firstSeenAt + timing.releasedAfterMs;
								},
								recordFrame: (name, completedAtMs) => {
									timing.frames ??= [];
									let frame = timing.frames.find((item) => item.name === name);
									if (!frame) {
										frame = { name };
										timing.frames.push(frame);
									}
									if (completedAtMs !== undefined) {
										frame.completedAtMs = completedAtMs;
										frame.completedAfterArrivalMs = completedAtMs - firstSeenAt;
										if (timing.releasedAfterMs !== undefined)
											frame.completedRelativeToReleaseMs =
												completedAtMs - firstSeenAt - timing.releasedAfterMs;
									}
								},
								release,
							}),
						);
						void heldCapture.catch(() => {}); // Re-thrown by awaitHeldCapture below.
					}
					return;
				}
				identity(response, body);
				return;
			}
			if (url.pathname === "/v1/tunnels" && request.method === "GET") {
				counters.discovery++;
				send(response, 200, {
					result: [STAGE_B_HOST, STAGE_B_OTHER_HOST].map((hostname, index) => ({
						id:
							index === 0
								? "stage-b-personal-tunnel"
								: "stage-b-other-personal-tunnel",
						name: index === 0 ? "Stage B computer" : "Stage B other computer",
						hostname,
						status: "active",
						harnesses: [{ id: "local-operator", enabled: true, hostname }],
					})),
				});
				return;
			}
			if (
				url.pathname === "/v1/auth/oauth/token" &&
				request.method === "POST"
			) {
				let raw = "";
				for await (const chunk of request) raw += chunk;
				const form = JSON.parse(raw) as Record<string, unknown>;
				if (
					form.grant_type !== "refresh_token" ||
					form.refresh_token !== value("oauth-refresh")
				) {
					send(response, 401, {});
					return;
				}
				counters.oauthRefresh++;
				send(response, 200, {
					access_token: value("access-a-renewed"),
					refresh_token: value("oauth-refresh"),
					expires_in: 3600,
					token_type: "Bearer",
					scope: "openid",
				});
				return;
			}
			if (
				request.method === "POST" &&
				url.pathname.startsWith("/v1/tunnels/session/")
			) {
				let raw = "";
				for await (const chunk of request) raw += chunk;
				const body = JSON.parse(raw) as Record<string, unknown>;
				if (
					url.pathname.endsWith("/code") &&
					typeof body.code_challenge === "string" &&
					[STAGE_B_HOST, STAGE_B_OTHER_HOST].includes(String(body.hostname))
				) {
					const code = value(`code-${codes.size}`);
					codes.set(code, {
						challenge: body.code_challenge,
						hostname: String(body.hostname),
					});
					send(response, 200, { code, state: body.state });
					return;
				}
				const validCode =
					typeof body.code === "string" &&
					typeof body.code_verifier === "string" &&
					codes.get(body.code)?.hostname === body.hostname &&
					codes.get(body.code)?.challenge ===
						createHash("sha256").update(body.code_verifier).digest("base64url");
				if (
					(url.pathname.endsWith("/token") && validCode) ||
					(url.pathname.endsWith("/refresh") &&
						body.refresh_token === value("refresh"))
				) {
					send(response, 200, {
						access_token: value("grant"),
						refresh_token: value("refresh"),
						expires_in: 300,
						refresh_expires_in: 2592000,
					});
					return;
				}
				if (
					url.pathname.endsWith("/logout") &&
					body.refresh_token === value("refresh")
				) {
					send(response, 200, { ok: true });
					return;
				}
				send(response, 401, {});
				return;
			}
			if (url.pathname === "/healthz" || url.pathname.startsWith("/api/")) {
				if (url.pathname === "/healthz") counters.healthProbes++;
				// Public liveness stays available across auth expiry, as on the relay.
				if (expired && url.pathname !== "/healthz") {
					counters.expired++;
					send(response, 401, { error: "Authentication required" });
					return;
				}
				if (
					request.method === "POST" &&
					(url.pathname === "/api/sessions" ||
						url.pathname.endsWith("/command"))
				)
					counters.mutations++;
				const headers = new Headers();
				for (const [name, val] of Object.entries(request.headers))
					if (
						typeof val === "string" &&
						!["host", "connection", "content-length"].includes(name)
					)
						headers.set(name, val);
				let body: string | undefined;
				if (request.method !== "GET") {
					body = "";
					for await (const chunk of request) body += chunk;
				}
				const upstream = await fetch(
					`${request.headers.origin === `https://${STAGE_B_OTHER_HOST}` ? otherRelay.baseUrl : relay.baseUrl}${url.pathname}${url.search}`,
					{
						method: request.method ?? "GET",
						headers,
						...(body !== undefined ? { body } : {}),
						redirect: "manual",
					},
				);
				// The minimal relay authenticates first, but has no directory route and
				// its captured model catalogue is empty. Supply the home screen's data
				// only after that gate, so proof screenshots aren't fixture-error states.
				if (
					request.method === "GET" &&
					[200, 404].includes(upstream.status) &&
					(url.pathname === "/api/directories" ||
						url.pathname === "/api/models")
				) {
					await upstream.body?.cancel();
					send(
						response,
						200,
						url.pathname === "/api/directories"
							? fixtureBody("http/directories.json")
							: loadFixture("synthetic/models.ranked.json"),
					);
					return;
				}
				response.writeHead(
					upstream.status,
					Object.fromEntries(upstream.headers),
				);
				if (upstream.body)
					Readable.fromWeb(
						upstream.body as import("node:stream/web").ReadableStream,
					).pipe(response);
				else response.end();
				return;
			}
			send(response, 404, { error: "unsupported proof endpoint" });
		} catch {
			if (!response.headersSent)
				send(response, 500, { error: "fixture request failed" });
			else response.destroy();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("fixture socket missing");
	config.fixtureOrigin = `http://127.0.0.1:${address.port}`;
	return {
		config,
		canary,
		counters,
		requestTimeline,
		receipts,
		held: () => held.size,
		heldTimings,
		observeHeld: (
			observer: (proof: StageBHeldProof) => Promise<void>,
			releaseMs = STAGE_B_HELD_RELEASE_MS,
		) => {
			heldObserver = observer;
			heldReleaseMs = releaseMs;
			heldCapture = undefined;
		},
		awaitHeldCapture: async () => {
			if (!heldCapture) throw new Error("held proof capture never started");
			await heldCapture;
		},
		observeIdentity: (observer: () => Promise<void>) => {
			identityObserver = observer;
			identityCapture = undefined;
		},
		awaitIdentityCapture: async () => {
			if (!identityCapture)
				throw new Error("fresh identity capture never started");
			await identityCapture;
		},
		whenHeld: () =>
			held.size > 0
				? Promise.resolve()
				: new Promise<void>((resolve) => heldWaiters.add(resolve)),
		scenario: (next: IdentityScenario) => {
			scenario = next;
			renewed = true;
			expired = false;
		},
		expire: () => {
			expired = true;
		},
		command: (action: string) => controlQueue.push(action),
		release: () => {
			for (const release of held) release();
		},
		close: async () => {
			for (const release of held) release();
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
			await Promise.all([relay.close(), otherRelay.close()]);
		},
	};
}
