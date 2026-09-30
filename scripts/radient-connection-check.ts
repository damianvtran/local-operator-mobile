#!/usr/bin/env node
/**
 * `NO CREDENTIALS — not run here.`
 *
 * The one path a maintainer runs by hand, because it needs the operator's own
 * Radient account and a live tunnel: discover the account's computers, mint a
 * tunnel session, make an authenticated request through the edge, and stream a
 * session's projections.
 *
 *   RADIENT_ACCESS_TOKEN=$(...) node scripts/radient-connection-check.ts \
 *     --hostname <32hex>-lop.radienthq.com [--tunnel-id <id>] [--session <id>]
 *
 * Like `relay-smoke.ts` this is a thin driver over the app's own modules
 * (`discoverComputers`, `TunnelSessionManager`, `createRelayClient`,
 * `SseConnection`): it holds no private copy of the protocol, so a step that passes
 * here passed through the code the app ships. It exists because the things it
 * exercises — the `__Host-radient-grant` cookie, the exact hostname form, the
 * control-plane mint and its PKCE, the 60-second stream lease — cannot be
 * reproduced without a real tunnel.
 *
 * The access token must be a `lop`-audienced Radient OAuth token (the desktop
 * client's). It is read from the environment only, never printed, and every id is
 * echoed truncated, so the output is pasteable into a pull request as redacted
 * evidence. Node built-ins only; run with native type stripping.
 */

import type { DecodedFrame } from "../src/relay/index.ts";
import { loadApp } from "./lib/load-src.ts";

const HOSTNAME_FORM = /^[a-f0-9]{32}-(lop|oc)\.radienthq\.com$/;
const STREAM_WAIT_MS = 20_000;

interface Args {
	hostname?: string;
	tunnelId?: string;
	session?: string;
	help: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = { help: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--hostname") args.hostname = argv[++index];
		else if (arg === "--tunnel-id") args.tunnelId = argv[++index];
		else if (arg === "--session") args.session = argv[++index];
		else if (arg === "--help" || arg === "-h") args.help = true;
	}
	return args;
}

function short(value: string): string {
	return value.length > 8 ? `${value.slice(0, 8)}…` : value;
}

let failures = 0;
function report(name: string, ok: boolean, detail: string): void {
	if (!ok) failures += 1;
	process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}\n`);
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		process.stdout.write(
			"usage: RADIENT_ACCESS_TOKEN=… node scripts/radient-connection-check.ts --hostname <host> [--tunnel-id <id>] [--session <id>]\n",
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
	if (!HOSTNAME_FORM.test(args.hostname)) {
		process.stderr.write(
			"the hostname must be the exact Radient-issued form (32 hex, -lop or -oc, .radienthq.com, https only)\n",
		);
		return 2;
	}
	const hostname = args.hostname;
	const { connection } = await loadApp();

	/* 1. Discovery, on the owner API. A BEARER token here, and only here. */
	const found = await connection.discoverComputers({
		accessToken: async () => token,
	});
	if (found.kind !== "computers") {
		report(
			"discover",
			false,
			found.kind === "none" ? "the account has no tunnels" : found.kind,
		);
		return 1;
	}
	report("discover", true, `${found.computers.length} computer(s)`);
	const computer =
		found.computers.find((candidate) => candidate.tunnelId === args.tunnelId) ??
		found.computers.find((candidate) => candidate.hostname === hostname);
	if (!computer) {
		report("select", false, `no computer with hostname ${short(hostname)}`);
		return 1;
	}
	report(
		"select",
		true,
		`tunnel ${short(computer.tunnelId)}, status=${computer.status}, local-operator=${computer.supportsLocalOperator}`,
	);

	/* 2. Mint: the app's own PKCE + state, code then token. */
	const manager = new connection.TunnelSessionManager({
		oauthAccessToken: async () => token,
	});
	let session: Awaited<ReturnType<typeof manager.mint>>;
	try {
		session = await manager.mint({ tunnelId: computer.tunnelId, hostname });
	} catch (cause) {
		const error = cause as {
			failure?: string;
			status?: number;
			message?: string;
		};
		report(
			"mint",
			false,
			`${error.failure ?? "error"}${error.status ? ` ${error.status}` : ""}: ${error.message}`,
		);
		return 1;
	}
	const grantMinutes = Math.round(
		(session.grantExpiresAt - Date.now()) / 60_000,
	);
	report(
		"mint",
		true,
		`grant valid ~${grantMinutes} min; 30-day handle held (never printed)`,
	);

	/* 3. An authenticated GET through the edge with the grant cookie alone. */
	const client = connection.createRelayClient({
		route: { mode: "radient", hostname, tunnelId: computer.tunnelId },
		tunnelSession: () => manager.current,
	});
	try {
		const list = await client.sessions();
		report(
			"sessions",
			true,
			`${list.sessions.length} session(s), degraded=[${list.degraded.join(",")}]`,
		);
	} catch (cause) {
		const error = cause as { kind?: string; status?: number; message?: string };
		report(
			"sessions",
			false,
			`${error.kind ?? "error"}${error.status ? ` ${error.status}` : ""}: ${error.message}`,
		);
	}

	/* 4. The list stream, then (optionally) one session's. */
	const seen: string[] = [];
	let streamError = "";
	const stream = client.sessionsStream({
		onFrame: (frame: DecodedFrame) => void seen.push(frame.kind),
		onError: (error) => {
			streamError = `${error.kind}${error.status ? ` ${error.status}` : ""}`;
		},
	});
	stream.connection.start();
	const deadline = Date.now() + STREAM_WAIT_MS;
	while (!seen.includes("sessions") && !streamError && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	stream.stop();
	report(
		"list-sse",
		seen.includes("sessions"),
		seen.includes("sessions")
			? `${seen.length} frame(s)`
			: streamError || "no frame within the wait",
	);

	if (args.session) {
		let version = -1;
		const projection = client.sessionStream(args.session, {
			onFrame: (frame: DecodedFrame) => {
				if (frame.kind === "projection") version = frame.data.version;
			},
		});
		projection.connection.start();
		const until = Date.now() + STREAM_WAIT_MS;
		while (version < 0 && Date.now() < until) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		projection.stop();
		report(
			"session-sse",
			version >= 0,
			version >= 0
				? `projection version=${version}`
				: "no projection within the wait",
		);
	}

	/* 5. Revoke, so the check leaves no live 30-day handle behind. */
	const revoked = await connection.revokeTunnelSession(session);
	report("revoke", revoked.revoked, `via ${revoked.via}`);

	process.stdout.write(
		`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`,
	);
	return failures === 0 ? 0 : 1;
}

process.exit(await main());
