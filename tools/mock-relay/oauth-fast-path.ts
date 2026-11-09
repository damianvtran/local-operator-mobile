import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

/** Synthetic OAuth/control-plane boundary beside the relay harness. No login UI:
 * this reproduces an already-authenticated browser's immediate redirect. State,
 * code and verifier live only in memory; receipts expose counts/stages, never them.
 * The token endpoint verifies the REAL app's PKCE and redirect binding. */
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export async function createFastPathOAuth(port = 0, receiptPath?: string) {
	let mode = "failure";
	let hold = false;
	let authorization: { redirect: string; challenge: string } | undefined;
	let release: (() => void) | undefined;
	const counts = { authorize: 0, token: 0, pkce_verified: 0, discovery: 0 };

	// Code uses the owner API envelope; token/refresh and relay HTTP are raw.
	// Load the server-pinned shape and the existing relay corpus, not a second
	// handwritten wire contract that can agree with a broken client.
	const codeContract = JSON.parse(
		readFileSync(
			new URL("../../fixtures/radient/session-code.json", import.meta.url),
			"utf8",
		),
	).body;
	const refusalContract = JSON.parse(
		readFileSync(
			new URL("../../fixtures/radient/session-refusals.json", import.meta.url),
			"utf8",
		),
	);
	const sessions = JSON.parse(
		readFileSync(
			new URL(
				"../../fixtures/relay/http/sessions-with-unread.json",
				import.meta.url,
			),
			"utf8",
		),
	).body;
	const config = JSON.parse(
		readFileSync(
			new URL(
				"../../fixtures/relay/synthetic/sse-config-frame.json",
				import.meta.url,
			),
			"utf8",
		),
	).data;
	const hostname = `${"0".repeat(32)}-lop.radienthq.com`;
	const tunnelId = "fixture-tunnel";
	const connectionCounts = {
		session_code: 0,
		session_token: 0,
		session_pkce_verified: 0,
		relay_requests: 0,
	};
	let sessionMode = "success";
	let tunnelCode: { challenge: string; hostname: string } | undefined;
	const save = () => {
		if (receiptPath)
			writeFileSync(
				receiptPath,
				JSON.stringify({ ...counts, ...connectionCounts }, null, 2),
			);
	};
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const json = (value: unknown, status = 200) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(value));
		};
		if (url.pathname === "/control") {
			if (url.searchParams.get("reset") === "true") {
				// Theme phases are separate fresh-app cases; archive each receipt
				// before this setup reset, never count isolation as authentication.
				Object.assign(counts, {
					authorize: 0,
					token: 0,
					pkce_verified: 0,
					discovery: 0,
				});
				authorization = undefined;
				tunnelCode = undefined;
				sessionMode = "success";
				Object.assign(connectionCounts, {
					session_code: 0,
					session_token: 0,
					session_pkce_verified: 0,
					relay_requests: 0,
				});
				save();
			}
			sessionMode = url.searchParams.get("session") ?? sessionMode;
			mode = url.searchParams.get("mode") ?? mode;
			hold = url.searchParams.get("hold") === "true";
			json({ ok: true });
			return;
		}
		if (url.pathname === "/release-token") {
			release?.();
			release = undefined;
			json({ ok: true });
			return;
		}
		if (url.pathname === "/receipt") {
			json({ ...counts, ...connectionCounts });
			return;
		}
		if (url.pathname === "/authorize") {
			const redirect = url.searchParams.get("redirect_uri");
			const challenge = url.searchParams.get("code_challenge");
			const state = url.searchParams.get("state");
			if (
				!redirect ||
				!challenge ||
				!state ||
				url.searchParams.get("code_challenge_method") !== "S256"
			) {
				json({ error: "invalid_request" }, 400);
				return;
			}
			const target = new URL(redirect);
			if (
				target.protocol !== "http:" ||
				target.hostname !== "127.0.0.1" ||
				target.pathname !== "/callback" ||
				!target.port
			) {
				json({ error: "invalid_request" }, 400);
				return;
			}
			authorization = { redirect, challenge };
			counts.authorize++;
			save();
			target.searchParams.set("code", "synthetic-proof-code");
			target.searchParams.set("state", state);
			response.writeHead(302, {
				location: target.href,
				"cache-control": "no-store",
			});
			response.end();
			return;
		}
		if (url.pathname === "/token" && request.method === "POST") {
			let body = "";
			for await (const chunk of request) body += chunk;
			// Radient's existing native-client endpoint takes JSON, not the
			// conventional form encoding. Match the real service boundary exactly.
			let fields: Record<string, string>;
			try {
				fields = JSON.parse(body) as Record<string, string>;
			} catch {
				json({ error: "invalid_request" }, 400);
				return;
			}
			const data = new URLSearchParams(fields);
			const challenge = createHash("sha256")
				.update(data.get("code_verifier") ?? "")
				.digest("base64url");
			counts.token++;
			if (
				!authorization ||
				data.get("redirect_uri") !== authorization.redirect ||
				challenge !== authorization.challenge ||
				data.get("code") !== "synthetic-proof-code" ||
				data.get("grant_type") !== "authorization_code"
			) {
				save();
				json({ error: "invalid_grant" }, 400);
				return;
			}
			counts.pkce_verified++;
			save();
			if (hold)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			if (mode === "failure") {
				json({ error: "server_error" }, 500);
				return;
			}
			const claims = Buffer.from(
				JSON.stringify({ sub: "synthetic-proof-account" }),
			).toString("base64url");
			json({
				access_token: "synthetic-access-token",
				refresh_token: "synthetic-refresh-token",
				expires_in: 3600,
				token_type: "Bearer",
				id_token: `eyJhbGciOiJub25lIn0.${claims}.synthetic`,
			});
			return;
		}
		if (url.pathname === "/v1/tunnels") {
			if (request.headers.authorization !== "Bearer synthetic-access-token") {
				json({ error: "unauthorized" }, 401);
				return;
			}
			counts.discovery++;
			save();
			json({
				msg: "ok",
				result: [
					{
						id: tunnelId,
						name: "OAuth proof computer",
						hostname,
						status: "active",
						updated_at: "2026-09-05T00:00:00Z",
						harnesses: [{ id: "local-operator", enabled: true }],
					},
				],
			});
			return;
		}
		if (
			url.pathname === "/v1/tunnels/session/code" &&
			request.method === "POST"
		) {
			if (request.headers.authorization !== "Bearer synthetic-access-token") {
				json({ error: "unauthorized" }, 401);
				return;
			}
			let body = "";
			for await (const chunk of request) body += chunk;
			const fields = JSON.parse(body);
			if (
				fields.code_challenge_method !== "S256" ||
				!fields.state ||
				!PKCE_CHALLENGE.test(fields.code_challenge)
			) {
				json({ error: "invalid session request" }, 400);
				return;
			}
			if (fields.tunnel_id !== tunnelId) {
				json({ error: "tunnel not found" }, 404);
				return;
			}
			if (fields.hostname !== hostname) {
				json({ error: "harness hostname not found" }, 404);
				return;
			}
			connectionCounts.session_code++;
			save();
			if (sessionMode === "inactive") {
				tunnelCode = undefined;
				const refusal = refusalContract.cases.find(
					(item: { failure: string }) => item.failure === "disabled",
				);
				json(refusal.body, refusal.status);
				return;
			}
			tunnelCode = { challenge: fields.code_challenge, hostname };
			const result = {
				...codeContract.result,
				state: fields.state,
				callback_uri: `https://${hostname}/_radient/callback`,
			};
			if (sessionMode === "malformed") delete result.code;
			json({ msg: codeContract.msg, result });
			return;
		}
		if (
			url.pathname === "/v1/tunnels/session/token" &&
			request.method === "POST"
		) {
			let body = "";
			for await (const chunk of request) body += chunk;
			const fields = JSON.parse(body);
			const valid =
				tunnelCode &&
				fields.hostname === tunnelCode.hostname &&
				fields.code === codeContract.result.code &&
				createHash("sha256")
					.update(fields.code_verifier ?? "")
					.digest("base64url") === tunnelCode.challenge;
			tunnelCode = undefined; // A real code is one-use even on a wrong verifier.
			connectionCounts.session_token++;
			if (valid) connectionCounts.session_pkce_verified++;
			save();
			if (!valid) {
				json({ error: "invalid_grant" }, 400);
				return;
			}
			json({
				access_token: "fixture-tunnel-grant",
				refresh_token: "fixture-tunnel-handle",
				expires_in: 300,
				refresh_expires_in: 2592000,
			});
			return;
		}
		if (url.pathname === "/healthz" || url.pathname.startsWith("/api/")) {
			if (
				request.headers.cookie !== "__Host-radient-grant=fixture-tunnel-grant"
			) {
				response.writeHead(401, { "content-type": "text/plain" });
				response.end("Sign in with Radient to access this tunnel");
				return;
			}
			connectionCounts.relay_requests++;
			save();
			if (url.pathname.endsWith("/events")) {
				response.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-store",
				});
				const event =
					url.pathname === "/api/config/events" ? "config" : "sessions";
				response.write(
					`event: ${event}\ndata: ${JSON.stringify(event === "config" ? config : sessions)}\n\n`,
				);
				return;
			}
			if (url.pathname === "/healthz") {
				json({ ok: true });
				return;
			}
			if (url.pathname === "/api/sessions") {
				json(sessions);
				return;
			}
		}
		json({ error: "not_found" }, 404);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("No fixture address");
	return {
		origin: `http://127.0.0.1:${address.port}`,
		counts,
		close: () =>
			new Promise<void>((resolve) => {
				release?.();
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

if (process.argv[1]?.endsWith("oauth-fast-path.ts")) {
	await createFastPathOAuth(
		Number(process.env.SIGNIN_PROOF_PORT ?? 54831),
		process.env.SIGNIN_PROOF_RECEIPT,
	);
	console.log("Synthetic fast-path OAuth provider ready");
}
