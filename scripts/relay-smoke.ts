#!/usr/bin/env node
/**
 * Runs the app's REAL relay client against a REAL `lop mobile serve`.
 *
 * `node scripts/relay-smoke.ts --base-url http://127.0.0.1:<port> --password-file <path>`
 *
 * This is a thin driver: every request goes through `createRelayClient`,
 * `RelayEndpoints`, `SseConnection` and `sendPersistedCommand` from `src/`, so
 * there is exactly one implementation of the protocol and this script cannot agree
 * with a private copy of it. What it adds is only the sequence and the PASS/FAIL
 * ledger. (An earlier version re-implemented headers and SSE framing in plain
 * JavaScript "so the client would not vouch for itself"; that let the shipped
 * client and its own proof diverge, and the brand-checked `fetch` defect passed
 * both. The fixture-replay suite in `src/e2e/` now covers agreement with the
 * captured wire; THIS covers agreement with a live daemon.)
 *
 * Node built-ins only, run with native type stripping. Never point it at the
 * operator's live relay (port 4098) or a live tunnel; it refuses both. The
 * password is read from a file or the environment and is never printed.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import type { DecodedFrame } from "../src/relay/index.ts";
import { loadApp } from "./lib/load-src.ts";

interface Config {
	baseUrl: string;
	password: string;
}

const USAGE =
	"usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/relay-smoke.ts \\\n" +
	"         --base-url http://127.0.0.1:<port> [--password-file <path>]\n" +
	"\n" +
	"  --base-url        the relay to smoke (never port 4098, never a *.radienthq.com host)\n" +
	"  --password-file   a 0600 file holding the relay password; or RELAY_PASSWORD /\n" +
	"                    RELAY_BASE_URL / RELAY_PASSWORD_FILE in the environment\n" +
	"\n" +
	"  The flag silences Node's MODULE_TYPELESS_PACKAGE_JSON warning for src/ — the\n" +
	"  repository root cannot be `type: module` (metro.config.js is loaded with\n" +
	"  require), so each src/ module is reparsed as ESM and warns once.\n";

function configFromArgs(argv: string[]): Config | number {
	let baseUrl = process.env.RELAY_BASE_URL ?? "";
	let passwordFile = process.env.RELAY_PASSWORD_FILE ?? "";
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--help" || argv[index] === "-h") {
			process.stdout.write(USAGE);
			return 0;
		}
		if (argv[index] === "--base-url") baseUrl = argv[++index] ?? "";
		else if (argv[index] === "--password-file")
			passwordFile = argv[++index] ?? "";
	}
	baseUrl = baseUrl.trim();
	while (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);
	if (!baseUrl) {
		process.stderr.write(
			"no --base-url: refusing to guess which relay to touch\n",
		);
		return 2;
	}
	const target = new URL(baseUrl);
	if (target.port === "4098" || target.hostname.endsWith("radienthq.com")) {
		process.stderr.write(
			"refusing to run: that looks like a live relay or tunnel. Use an isolated `lop mobile serve`.\n",
		);
		return 2;
	}
	let password = process.env.RELAY_PASSWORD ?? "";
	if (!password && passwordFile)
		password = readFileSync(passwordFile, "utf8").trim();
	return { baseUrl, password };
}

let failures = 0;
/** A step that could not run says so as SKIP with its reason; it is never counted
 *  as a PASS, because a green line for work that did not happen is a false proof. */
const SKIP_PREFIX = "SKIP:";
function report(step: string, ok: boolean, detail: string): void {
	const skipped = ok && detail.startsWith(SKIP_PREFIX);
	if (!ok) failures += 1;
	const label = !ok ? "FAIL" : skipped ? "SKIP" : "PASS";
	const text = skipped ? detail.slice(SKIP_PREFIX.length).trim() : detail;
	process.stdout.write(`${label}  ${step} — ${text}\n`);
}

function bytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value));
}

/** Runs one step; a throw is a FAIL carrying the typed error's kind and status. */
async function step(name: string, body: () => Promise<string>): Promise<void> {
	try {
		report(name, true, await body());
	} catch (cause) {
		const error = cause as { kind?: string; status?: number; message?: string };
		const where = error.kind
			? `${error.kind}${error.status ? ` ${error.status}` : ""}: `
			: "";
		report(name, false, `${where}${error.message ?? String(cause)}`);
	}
}

async function main(): Promise<number> {
	const config = configFromArgs(process.argv.slice(2));
	if (typeof config === "number") return config;
	const { connection, relay, testing } = await loadApp();

	const jar = testing.createCookieJarFetch();
	const route = {
		mode: "custom" as const,
		baseUrl: config.baseUrl,
		allowInsecure: true,
	};
	const client = connection.createRelayClient({ route, fetchImpl: jar.fetch });
	process.stdout.write(
		`relay smoke run against ${new URL(config.baseUrl).origin}\n`,
	);

	let sessionId = "";
	let completionToken = "";

	await step("healthz", async () => {
		const health = await client.healthz();
		if (!health.ok) throw new Error("healthz answered ok=false");
		return `version=${health.version}, sessions=${health.sessions}, ${bytes(health)}B`;
	});

	await step("unauth-401", async () => {
		try {
			await client.sessions();
		} catch (cause) {
			const error = cause as { kind?: string; status?: number };
			if (error.kind === "relay-unauthorized" && error.status === 401) {
				return "401 relay-unauthorized before login";
			}
			throw cause;
		}
		throw new Error("an unauthenticated /api/sessions succeeded");
	});

	await step("login", async () => {
		const result = await client.login(config.password);
		if (!result.signedIn) throw new Error(`expected 303, got ${result.status}`);
		if (!jar.names().includes("lop_mobile"))
			throw new Error("no lop_mobile cookie in the jar");
		return `${result.status}, cookie=${jar.names().join(",")}`;
	});

	await step("login-rejected", async () => {
		const other = testing.createCookieJarFetch();
		const stranger = connection.createRelayClient({
			route,
			fetchImpl: other.fetch,
		});
		const result = await stranger.login(`${randomUUID()}-wrong`);
		if (result.signedIn) throw new Error("a wrong password was accepted");
		return `${result.status}, no session established (${other.names().length} cookies)`;
	});

	await step("cross-origin-403", async () => {
		/* Deliberately NOT the app's client: this is a violation of the header
		 * contract the client always honours, sent by hand to prove the relay
		 * enforces it. */
		const response = await fetch(
			`${config.baseUrl}/api/sessions/none/command`,
			{
				method: "POST",
				headers: {
					origin: "https://evil.example",
					"content-type": "application/json",
				},
				body: "{}",
			},
		);
		if (response.status !== 403)
			throw new Error(`expected 403, got ${response.status}`);
		return "403 same-origin refusal";
	});

	await step("sessions", async () => {
		const list = await client.sessions();
		return `${list.sessions.length} session(s), degraded=[${list.degraded.join(",")}], ${bytes(list)}B`;
	});

	await step("list-sse", async () => {
		const frames: string[] = [];
		const stream = client.sessionsStream({
			onFrame: (frame: DecodedFrame) => void frames.push(frame.kind),
		});
		stream.connection.start();
		await waitFor(() => frames.includes("sessions"), 10_000);
		stream.stop();
		return `event=sessions, ${frames.length} frame(s)`;
	});

	await step("start-session", async () => {
		const started = await client.startSession({});
		sessionId = started.session_id;
		return `session_id=${sessionId}, pid=${started.pid}`;
	});

	await step("session-sse", async () => {
		let version = -1;
		/* Everything that arrives is recorded, so a timeout says WHAT came instead of
		 * only that nothing matched — a frame the client rejects as malformed looks
		 * identical to silence otherwise. */
		const seenKinds: string[] = [];
		let rejection = "";
		const stream = client.sessionStream(sessionId, {
			onFrame: (frame: DecodedFrame) => {
				seenKinds.push(frame.kind);
				if (frame.kind === "malformed") {
					const parsed = frame.error;
					rejection = parsed.ok ? "schema mismatch" : parsed.error.summary;
				}
				if (frame.kind === "projection") {
					version = frame.data.version;
					completionToken =
						frame.data.attention.completion_token ?? completionToken;
				}
			},
			onError: (error) => {
				rejection = `${error.kind}: ${error.message}`;
			},
		});
		stream.connection.start();
		try {
			await waitFor(() => version >= 0, 15_000);
		} catch {
			stream.stop();
			throw new Error(
				`no projection; frames seen=[${seenKinds.join(",")}]${rejection ? `; ${rejection}` : ""}`,
			);
		}
		stream.stop();
		return `event=projection, version=${version}`;
	});

	const envelopes = new relay.RetryEnvelopeStore({
		store: relay.memoryEnvelopeStore(),
	});
	await step("command-prompt", async () => {
		const sent = await relay.sendPersistedCommand({
			client,
			envelopes,
			sessionId,
			op: "prompt",
			text: "say hello",
		});
		return `detail="${sent.detail}", command_id=${sent.commandId.slice(0, 8)}…`;
	});

	await step("concurrent-send", async () => {
		/* Two sends in the same tick, which is what a double-tap that lands before the
		 * composer can disable its button looks like. Measured against a real daemon
		 * they used to mint two `command_id`s and the prompt RAN TWICE (QA round 3,
		 * Q2). The proof is the daemon's own transcript, not the client's bookkeeping. */
		const text = `concurrent probe ${randomUUID().slice(0, 8)}`;
		const shared = new relay.RetryEnvelopeStore({
			store: relay.memoryEnvelopeStore(),
		});
		const [first, second] = await Promise.all([
			relay.sendPersistedCommand({
				client,
				envelopes: shared,
				sessionId,
				op: "prompt",
				text,
			}),
			relay.sendPersistedCommand({
				client,
				envelopes: shared,
				sessionId,
				op: "prompt",
				text,
			}),
		]);
		if (first.commandId !== second.commandId) {
			throw new Error(
				`two command ids for one instruction: ${first.commandId} and ${second.commandId}`,
			);
		}
		const page = await client.history(sessionId, { limit: 50 });
		const copies = page.entries.filter((entry) => entry.text === text).length;
		if (copies !== 1) {
			throw new Error(
				`the daemon recorded ${copies} copies of the prompt, expected 1`,
			);
		}
		return `one command_id ${first.commandId.slice(0, 8)}…, transcript holds 1 copy`;
	});

	await step("command-duplicate", async () => {
		const commandId = randomUUID();
		const body = {
			op: "prompt" as const,
			command_id: commandId,
			text: "duplicate probe",
		};
		const first = await client.command(sessionId, body);
		const second = await client.command(sessionId, body);
		if (second.detail !== "already admitted") {
			throw new Error(
				`replay answered "${second.detail}", not "already admitted"`,
			);
		}
		return `first="${first.detail}", replay="${second.detail}"`;
	});

	await step("command-refused", async () => {
		try {
			await client.command(sessionId, {
				op: "prompt",
				command_id: "not-a-uuid",
				text: "x",
			});
		} catch (cause) {
			/* Refused on the device by the request schema before it left, OR by the
			 * relay with a pre-admission 422 — either way it must not be sent as-is. */
			const error = cause as {
				kind?: string;
				status?: number;
				message?: string;
			};
			return `${error.kind ?? "rejected"}${error.status ? ` ${error.status}` : ""}: ${String(error.message).slice(0, 60)}`;
		}
		throw new Error("a prompt with an invalid command_id was accepted");
	});

	await step("history", async () => {
		const page = await client.history(sessionId, { limit: 5 });
		return `${page.entries.length} entr(y/ies), has_more=${page.has_more}, ${bytes(page)}B`;
	});
	await step(
		"models",
		async () => `${(await client.models()).models.length} item(s)`,
	);
	await step("commands", async () => {
		const list = await client.commands();
		return `${list.commands.length} item(s), ${bytes(list)}B`;
	});
	await step("directories", async () => {
		const dirs = await client.directories();
		return `home=${dirs.home}, ${bytes(dirs)}B`;
	});
	await step(
		"past-sessions",
		async () => `${(await client.pastSessions()).sessions.length} item(s)`,
	);

	await step("seen", async () => {
		if (!completionToken)
			return `${SKIP_PREFIX} the mock provider had not completed a turn, so there is no completion_token to acknowledge`;
		const seen = await client.seen(sessionId, completionToken);
		return `ok=${seen.ok} for completion_token=${completionToken.slice(0, 8)}…`;
	});

	await step("logout", async () => {
		const result = await client.logout();
		if (result.status !== 303)
			throw new Error(`expected 303, got ${result.status}`);
		return `${result.status}, cookie jar now ${jar.names().length} item(s)`;
	});

	process.stdout.write(
		`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`,
	);
	return failures === 0 ? 0 : 1;
}

async function waitFor(check: () => boolean, ms: number): Promise<void> {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

process.exit(await main());
