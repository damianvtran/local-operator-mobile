import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

/** Synthetic OAuth/control-plane boundary beside the relay harness. No login UI:
 * this reproduces an already-authenticated browser's immediate redirect. State,
 * code and verifier live only in memory; receipts expose counts/stages, never them.
 * The token endpoint verifies the REAL app's PKCE and redirect binding. */
export async function createFastPathOAuth(port = 0, receiptPath?: string) {
	let mode = "failure";
	let hold = false;
	let authorization: { redirect: string; challenge: string } | undefined;
	let release: (() => void) | undefined;
	const counts = { authorize: 0, token: 0, pkce_verified: 0, discovery: 0 };
	const save = () => {
		if (receiptPath)
			writeFileSync(receiptPath, JSON.stringify(counts, null, 2));
	};
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const json = (value: unknown, status = 200) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(value));
		};
		if (url.pathname === "/control") {
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
			json(counts);
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
						id: "synthetic-proof-tunnel",
						name: "OAuth proof computer",
						hostname: "0123456789abcdef0123456789abcdef-lop.example.com",
						status: "active",
						harnesses: [{ id: "local-operator", enabled: true }],
					},
				],
			});
			return;
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
