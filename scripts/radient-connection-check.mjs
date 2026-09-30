#!/usr/bin/env node
// biome-ignore-all lint/performance/useTopLevelRegex: a regex literal here runs
// once per hand-run check, not in a loop — hoisting it out would only move it.
/**
 * `NO CREDENTIALS — not run here.`
 *
 * The one path a maintainer runs by hand, because it needs the operator's own
 * Radient account and a live tunnel: discover the account's computers, mint a
 * tunnel session, make an authenticated request through the edge, and stream a
 * session's projections.
 *
 * It is committed rather than left as a recipe because every step of it is a
 * contract detail that is easy to get subtly wrong and impossible to discover
 * without a real tunnel — the `__Host-radient-grant` cookie name and the fact that
 * a BEARER token is deleted by the edge, the hostname form the edge accepts, the
 * 60-second stream cap, and the `{msg, result}` envelope the owner API answers
 * with.
 *
 * Usage (never in CI; never with a token in shell history):
 *
 *   RADIENT_ACCESS_TOKEN=$(...) node scripts/radient-connection-check.mjs \
 *     --hostname <32hex>-lop.radienthq.com [--tunnel-id <id>] [--session <id>] \
 *     [--prompt "say hi"]
 *
 * The access token must be a `lop`-audienced Radient OAuth token (the desktop
 * client's, `lop login radient`). Nothing here prints it, and every id is echoed
 * only in truncated form: this output is meant to be pasteable into a pull request
 * as redacted evidence.
 */

import { randomUUID } from "node:crypto";

const MAX_STREAM_MS = 65_000;

function parseArgs(argv) {
	const args = { prompt: null };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--hostname") args.hostname = argv[++index];
		else if (arg === "--tunnel-id") args.tunnelId = argv[++index];
		else if (arg === "--session") args.session = argv[++index];
		else if (arg === "--prompt") args.prompt = argv[++index];
		else if (arg === "--help" || arg === "-h") args.help = true;
	}
	return args;
}

function short(value) {
	return typeof value === "string" && value.length > 8
		? `${value.slice(0, 8)}…`
		: String(value);
}

function step(name, status, detail) {
	process.stdout.write(
		`${status.padEnd(5)} ${name}${detail ? ` — ${detail}` : ""}\n`,
	);
	return status === "PASS";
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		process.stdout.write(
			"usage: node scripts/radient-connection-check.mjs --hostname <host> [--tunnel-id <id>] [--session <id>]\n",
		);
		return 0;
	}
	const token = process.env.RADIENT_ACCESS_TOKEN ?? "";
	if (!args.hostname || !token) {
		process.stderr.write(
			"NO CREDENTIALS — not run here: this script needs RADIENT_ACCESS_TOKEN (a `lop`-audienced Radient OAuth token) and --hostname.\n",
		);
		return 2;
	}
	if (!/^[a-f0-9]{32}-(lop|oc)\.radienthq\.com$/.test(args.hostname)) {
		process.stderr.write(
			"the hostname must be the exact Radient-issued form (32 hex, -lop or -oc, .radienthq.com, https only)\n",
		);
		return 2;
	}

	let failures = 0;
	const check = (ok) => {
		if (!ok) failures += 1;
	};

	/* 1. Discovery, on the owner API. A BEARER token here, and only here. */
	let computers = [];
	try {
		const response = await fetch("https://api.radienthq.com/v1/tunnels", {
			headers: { accept: "application/json", authorization: `Bearer ${token}` },
			credentials: "omit",
		});
		const envelope = await response.json();
		computers = Array.isArray(envelope?.result) ? envelope.result : [];
		check(
			step(
				"discover",
				response.ok ? "PASS" : "FAIL",
				`${response.status}, ${computers.length} tunnel(s)`,
			),
		);
	} catch (cause) {
		check(step("discover", "FAIL", cause.message));
		return 1;
	}

	const tunnel =
		computers.find((candidate) => candidate.id === args.tunnelId) ??
		computers.find((candidate) => candidate.hostname === args.hostname) ??
		null;
	check(
		step(
			"select tunnel",
			tunnel ? "PASS" : "FAIL",
			tunnel
				? `id=${short(tunnel.id)}, status=${tunnel.status}`
				: "no tunnel matches",
		),
	);
	if (!tunnel) return 1;

	/* 2. Mint a tunnel session: the code, then the token. Two public endpoints. */
	const verifier = Buffer.from(
		crypto.getRandomValues(new Uint8Array(96)),
	).toString("base64url");
	const challenge = Buffer.from(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
	).toString("base64url");
	const state = randomUUID();
	let grant = "";
	let refreshHandle = "";
	try {
		const codeResponse = await fetch(
			"https://api.radienthq.com/v1/tunnels/session/code",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					tunnel_id: tunnel.id,
					hostname: args.hostname,
					state,
					code_challenge: challenge,
					code_challenge_method: "S256",
				}),
			},
		);
		const code = await codeResponse.json();
		check(
			step(
				"session/code",
				codeResponse.ok ? "PASS" : "FAIL",
				`${codeResponse.status}, code=${code?.code ? "issued" : "none"}`,
			),
		);
		if (!codeResponse.ok) {
			/* A 402 here is the billing state the picker is supposed to surface
			 * BEFORE a tap, so it is worth naming rather than showing as "failed". */
			if (codeResponse.status === 402)
				process.stdout.write(
					"      (402: this tunnel's billing is inactive — the reason a picker shows a banner)\n",
				);
			return 1;
		}

		const tokenResponse = await fetch(
			"https://api.radienthq.com/v1/tunnels/session/token",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					code: code.code,
					code_verifier: verifier,
					hostname: args.hostname,
				}),
			},
		);
		const session = await tokenResponse.json();
		grant = session?.access_token ?? "";
		refreshHandle = session?.refresh_token ?? "";
		check(
			step(
				"session/token",
				tokenResponse.ok && grant ? "PASS" : "FAIL",
				`${tokenResponse.status}, expires_in=${session?.expires_in}, refresh_expires_in=${session?.refresh_expires_in}`,
			),
		);
		if (!grant) return 1;
	} catch (cause) {
		check(step("session mint", "FAIL", cause.message));
		return 1;
	}

	const origin = `https://${args.hostname}`;
	const headers = {
		accept: "application/json",
		/* A BEARER token is deleted by the edge (`index.ts:251`); the two
		 * `__Host-radient-*` cookies ARE the credential, and the edge re-sets both
		 * whenever it transparently refreshes. */
		cookie: `__Host-radient-grant=${grant}; __Host-radient-refresh=${refreshHandle}`,
		origin,
	};

	/* 3. An authenticated GET through the edge and the gateway. */
	let listFrame = null;
	try {
		const response = await fetch(`${origin}/api/sessions`, {
			headers,
			redirect: "manual",
		});
		listFrame = await response.json();
		check(
			step(
				"authenticated GET",
				response.ok ? "PASS" : "FAIL",
				`${response.status}, ${Array.isArray(listFrame?.sessions) ? listFrame.sessions.length : 0} session(s)` +
					(response.headers.get("x-radient-login")
						? ", X-Radient-Login present (re-auth)"
						: ""),
			),
		);
		if (!response.ok) return 1;
	} catch (cause) {
		check(step("authenticated GET", "FAIL", cause.message));
		return 1;
	}

	/* 4. The list stream, and the 60-second cut that shapes the client. */
	try {
		const startedAt = Date.now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), MAX_STREAM_MS);
		const response = await fetch(`${origin}/api/sessions/events`, {
			headers: { ...headers, accept: "text/event-stream" },
			signal: controller.signal,
			redirect: "manual",
		});
		const reader = response.body?.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let frames = 0;
		let ended = "still open";
		while (reader) {
			const { done, value } = await reader.read();
			if (done) {
				ended = "EOF (the lease)";
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const parts = buffer.split("\n\n");
			buffer = parts.pop() ?? "";
			for (const part of parts) if (part.includes("data:")) frames += 1;
		}
		clearTimeout(timer);
		check(
			step(
				"list SSE",
				frames > 0 ? "PASS" : "FAIL",
				`${response.status}, ${frames} frame(s) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s, ended: ${ended}`,
			),
		);
	} catch (cause) {
		check(
			step(
				"list SSE",
				cause.name === "AbortError" ? "PASS" : "FAIL",
				cause.name === "AbortError"
					? "held open to the deadline"
					: cause.message,
			),
		);
	}

	/* 5. Optionally start a session and stream its projection, which is the whole
	 *    point of the tunnel: a command delivered to the user's computer. */
	const sessionId = args.session ?? null;
	if (sessionId) {
		try {
			const response = await fetch(
				`${origin}/api/sessions/${sessionId}/events`,
				{
					headers: { ...headers, accept: "text/event-stream" },
					redirect: "manual",
				},
			);
			const reader = response.body?.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let projection = null;
			const deadline = Date.now() + 20_000;
			while (reader && Date.now() < deadline && !projection) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split("\n\n");
				buffer = parts.pop() ?? "";
				for (const part of parts) {
					const line = part
						.split("\n")
						.find((candidate) => candidate.startsWith("data:"));
					if (line) projection = JSON.parse(line.slice(5).trim());
				}
			}
			await reader?.cancel().catch(() => undefined);
			check(
				step(
					"session SSE seed",
					response.ok && projection ? "PASS" : "FAIL",
					`version=${projection?.version}, pid=${projection?.pid}`,
				),
			);
		} catch (cause) {
			check(step("session SSE seed", "FAIL", cause.message));
		}

		if (args.prompt) {
			try {
				const response = await fetch(
					`${origin}/api/sessions/${sessionId}/command`,
					{
						method: "POST",
						headers: { ...headers, "content-type": "application/json" },
						body: JSON.stringify({
							op: "prompt",
							command_id: randomUUID(),
							text: args.prompt,
						}),
					},
				);
				const body = await response.json();
				check(
					step(
						"command",
						response.ok ? "PASS" : "FAIL",
						`${response.status}, detail="${body?.detail ?? ""}"`,
					),
				);
			} catch (cause) {
				check(step("command", "FAIL", cause.message));
			}
		}
	} else {
		step("session SSE seed", "SKIP", "no --session given");
	}

	/* 6. Revoke. The Worker's own logout is the revoke that matters, and it is
	 *    forwarded to the control plane as `/v1/tunnels/session/logout`. */
	try {
		const response = await fetch(`${origin}/_radient/logout`, {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			redirect: "manual",
		});
		check(
			step(
				"revoke",
				response.status < 400 ? "PASS" : "FAIL",
				`${response.status}`,
			),
		);
	} catch (cause) {
		check(step("revoke", "FAIL", cause.message));
	}

	process.stdout.write(`\n${failures} failure(s)\n`);
	return failures === 0 ? 0 : 1;
}

main()
	.then((code) => process.exit(code))
	.catch((cause) => {
		process.stderr.write(
			`the check itself failed: ${cause.stack ?? cause.message}\n`,
		);
		process.exit(2);
	});
