#!/usr/bin/env node
/**
 * The mesh half's WIRE PROOF: the app's OWN client, against the mock relay,
 * driving the paths the sessions-and-delegation feature depends on — on BOTH
 * list transports, and through the transfer route's at-most-once journal.
 *
 *     node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *       scripts/mesh-wire-proof.ts --base-url http://127.0.0.1:PORT --password <pw>
 *
 * Why this exists rather than a unit test: the rules that must not regress are
 * WIRE facts the unit tests cannot see —
 *
 *  1. `include_peers` must be asked on the GET **and** on the SSE stream, or a
 *     repaint drops the remote rows the first GET painted (the relay reads the
 *     flag once, at connection open);
 *  2. a retried move under the SAME request id must replay (`replayed: true`)
 *     and dial NOTHING — the property the whole journal exists for;
 *  3. the raised-wait re-issue is legal only where the id was RELEASED: on a
 *     recorded id the journal refuses it as a conflict (its fingerprint is the
 *     whole body, `wait_s` included), which is why the phone's claim keeps the
 *     same body. This script proves the refusal on the wire so the client
 *     comment citing it stays true.
 *
 * The client is `createRelayClient` + `RelayEndpoints` + `SseConnection` from
 * `src/` — there is exactly one protocol implementation, and this script cannot
 * agree with a private copy of it. Node built-ins only, run with native type
 * stripping; the password comes from `--password` or `LOP_MOBILE_PASSWORD` and
 * is never printed. Point it at a mock relay you started yourself
 * (`node tools/mock-relay/relay.ts --port 0 --scenario mesh-rows`), never at a
 * live relay.
 */

import { randomUUID } from "node:crypto";

import { loadApp, registerSourceResolver } from "./lib/load-src.ts";

const USAGE =
	"usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/mesh-wire-proof.ts \\\n" +
	"  --base-url http://127.0.0.1:<port> --password <pw>";

interface JsonRecord {
	[key: string]: unknown;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const baseUrl = readArg(args, "--base-url");
	const password =
		readArg(args, "--password") ?? process.env.LOP_MOBILE_PASSWORD;
	if (baseUrl === null || password === undefined || password === "") {
		console.error(USAGE);
		process.exit(2);
	}

	registerSourceResolver();

	const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
	const check = (name: string, pass: boolean, detail: string): void => {
		checks.push({ name, pass, detail });
		console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
	};

	await pin(baseUrl, "mesh-move-receipt");
	const client = await freshClient(baseUrl, password);

	/* ---------------------------------------------------------- the GET -- */
	const frame = await client.sessions({ includePeers: true });
	const remote = frame.sessions.filter((row) => row.locality === "remote");
	check(
		"GET /api/sessions?include_peers=true carries the peers' rows",
		remote.length === 3,
		`${String(remote.length)} remote rows: ${remote.map((row) => row.session_id).join(", ")}`,
	);
	const oldBuild = remote.find((row) => row.session_id === "0a1b2c3d4e5f");
	check(
		"an old-build peer's no-claim stamp arrives as created_at 0",
		oldBuild?.created_at === 0,
		`created_at=${String(oldBuild?.created_at)}`,
	);
	const plain = await client.sessions();
	check(
		"without the flag the answer carries no peers (what every older build asks)",
		plain.sessions.every((row) => row.locality !== "remote"),
		`${String(plain.sessions.length)} local rows, 0 remote`,
	);

	/* ------------------------------------------------------- the stream -- */
	const withPeers = await readFirstFrame(baseUrl, password, true);
	check(
		"SSE /api/sessions/events?include_peers=true seeds the SAME remote rows",
		withPeers !== null && withPeers.remote === 3,
		`first frame remote rows=${String(withPeers?.remote)}`,
	);
	const bare = await readFirstFrame(baseUrl, password, false);
	check(
		"a stream that did NOT ask seeds none — the flap the both-transports rule prevents",
		bare !== null && bare.remote === 0,
		`first frame remote rows=${String(bare?.remote)}`,
	);

	/* --------------------------------------------------------- the move -- */
	const id1 = randomUUID().toLowerCase();
	const attempt = await client.transfer("9f2c1a7b0d3e", {
		to: "local",
		keep: false,
		wait_s: 0,
		request_id: id1,
	});
	check(
		"the attempt's receipt is the phase transcript",
		attempt.mode === "move" &&
			attempt.phases.length === 4 &&
			attempt.phases[0]?.phase === "prepared" &&
			attempt.replayed === false,
		`mode=${attempt.mode} phases=${attempt.phases.map((p) => p.phase).join("/")} replayed=${String(attempt.replayed)}`,
	);

	const dialsBefore = await readNumber(baseUrl, "transferDials");
	const replay = await client.transfer("9f2c1a7b0d3e", {
		to: "local",
		keep: false,
		wait_s: 0,
		request_id: id1,
	});
	const dialsAfter = await readNumber(baseUrl, "transferDials");
	check(
		"the SAME id, SAME body replays (replayed:true) and dials nothing",
		replay.replayed === true &&
			dialsBefore !== null &&
			dialsBefore === dialsAfter,
		`replayed=${String(replay.replayed)}, dials ${String(dialsBefore)} -> ${String(dialsAfter)}`,
	);

	const conflict = await client
		.transfer("9f2c1a7b0d3e", {
			to: "d_other000001",
			keep: false,
			wait_s: 0,
			request_id: id1,
		})
		.then(() => null)
		.catch((error: unknown) => error);
	check(
		"the same id with a DIFFERENT body is 409 receipt_conflict",
		status(conflict) === 409 && code(conflict) === "receipt_conflict",
		`status=${String(status(conflict))} code=${String(code(conflict))}`,
	);

	/* The raised-wait re-issue on a RECORDED id: refused as a conflict — the
	 * fact the client's `moveClaim`/`moveWait` split is built on. */
	const id2 = randomUUID().toLowerCase();
	await client.transfer("9f2c1a7b0d3e", {
		to: "local",
		keep: false,
		wait_s: 0,
		request_id: id2,
	});
	const raised = await client
		.transfer("9f2c1a7b0d3e", {
			to: "local",
			keep: false,
			wait_s: 300,
			request_id: id2,
		})
		.then(() => null)
		.catch((error: unknown) => error);
	check(
		"a RAISED wait on a recorded id is 409 (the fingerprint covers wait_s)",
		status(raised) === 409 && code(raised) === "receipt_conflict",
		`status=${String(status(raised))} code=${String(code(raised))}`,
	);

	/* --------------------------------------------------- the unconfirmed -- */
	await pin(baseUrl, "mesh-move-unconfirmed");
	const id3 = randomUUID().toLowerCase();
	const unconfirmed = await client
		.transfer("9f2c1a7b0d3e", {
			to: "d_missing0001",
			keep: false,
			wait_s: 0,
			request_id: id3,
		})
		.then(() => null)
		.catch((error: unknown) => error);
	check(
		"an unanswered move is 503 relay_unavailable — UNCONFIRMED, not refused",
		status(unconfirmed) === 503 && code(unconfirmed) === "relay_unavailable",
		`status=${String(status(unconfirmed))} code=${String(code(unconfirmed))}`,
	);
	const dialsBeforeReplay = await readNumber(baseUrl, "transferDials");
	const replayedRefusal = await client
		.transfer("9f2c1a7b0d3e", {
			to: "d_missing0001",
			keep: false,
			wait_s: 0,
			request_id: id3,
		})
		.then(() => null)
		.catch((error: unknown) => error);
	const dialsAfterReplay = await readNumber(baseUrl, "transferDials");
	check(
		"the unconfirmed outcome REPLAYS under the same id (same sentence, no dial)",
		status(replayedRefusal) === 503 &&
			code(replayedRefusal) === "relay_unavailable" &&
			dialsBeforeReplay === dialsAfterReplay,
		`status=${String(status(replayedRefusal))}, dials ${String(dialsBeforeReplay)} -> ${String(dialsAfterReplay)}`,
	);

	/* --------------------------------------------- the release rule ---- */
	await pin(baseUrl, "mesh-move-busy");
	const busyId = randomUUID().toLowerCase();
	const busy = await client
		.transfer("9f2c1a7b0d3e", {
			to: "local",
			keep: false,
			wait_s: 0,
			request_id: busyId,
		})
		.then(() => null)
		.catch((error: unknown) => error);
	check(
		"a `busy` refusal is a REFUSAL (409, nothing changed), not an unconfirmed 503",
		status(busy) === 409 && code(busy) === "busy",
		`status=${String(status(busy))} code=${String(code(busy))}`,
	);
	/*
	 * THE RELEASE, which is the busy remedy's whole mechanism: a plain refusal
	 * left nothing behind, so the SAME id re-issued with a raised wait DIALS
	 * again — a kept id would answer 409 `receipt_conflict` and the wait could
	 * never run the move. The assertion is the dial count and the absence of
	 * `receipt_conflict`, not the second answer's shape (the mock's busy source
	 * is still busy, so the second dial refuses the same way).
	 */
	const busyDialsBefore = await readNumber(baseUrl, "transferDials");
	const afterRelease = await client
		.transfer("9f2c1a7b0d3e", {
			to: "local",
			keep: false,
			wait_s: 300,
			request_id: busyId,
		})
		.then(() => null)
		.catch((error: unknown) => error);
	const busyDialsAfter = await readNumber(baseUrl, "transferDials");
	check(
		"a raised wait under the same id after a plain refusal runs again (a dial, never `receipt_conflict`)",
		status(afterRelease) === 409 &&
			code(afterRelease) === "busy" &&
			busyDialsBefore !== null &&
			busyDialsAfter === busyDialsBefore + 1,
		`status=${String(status(afterRelease))} code=${String(code(afterRelease))}, dials ${String(busyDialsBefore)} -> ${String(busyDialsAfter)}`,
	);

	/* The 422 family: the route's own body validation, shape for shape. */
	const badBody = await client
		.transfer("9f2c1a7b0d3e", {
			to: "not a path safe id",
			keep: false,
			wait_s: 0,
			request_id: randomUUID().toLowerCase(),
		})
		.then(() => null)
		.catch((error: unknown) => error);
	check(
		"a malformed `to` is refused 422 before any work (nothing changed)",
		status(badBody) === 422,
		`status=${String(status(badBody))}`,
	);

	const failed = checks.filter((entry) => !entry.pass).length;
	console.log(
		`\n${failed === 0 ? "ALL PASS" : `${String(failed)} FAIL`} — ${String(checks.length)} checks`,
	);
	process.exit(failed === 0 ? 0 : 1);
}

function readArg(args: string[], name: string): string | null {
	const at = args.indexOf(name);
	if (at === -1) return null;
	return args[at + 1] ?? null;
}

function status(error: unknown): number | undefined {
	return (error as { status?: number } | null)?.status;
}

function code(error: unknown): string | undefined {
	return (error as { code?: string } | null)?.code;
}

async function pin(baseUrl: string, scenario: string): Promise<void> {
	const res = await fetch(`${baseUrl}/__mock/scenario`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			// The harness-process identity the mock uses for pin ownership: a pin
			// from a DIFFERENT process while another owns the world is refused, and
			// this proof wants its own ownership to be visible.
			"x-lo-harness": "mesh-wire-proof",
		},
		body: JSON.stringify({ scenario }),
	});
	if (!res.ok) {
		throw new Error(
			`could not pin scenario '${scenario}': ${String(res.status)} ${await res.text()}`,
		);
	}
}

/** The first `sessions` frame of a fresh stream, as `{remote}` — or null. */
async function readFirstFrame(
	baseUrl: string,
	password: string,
	includePeers: boolean,
): Promise<{ remote: number } | null> {
	const client = await freshClient(baseUrl, password);
	let first: { remote: number } | null = null;
	const stream = client.sessionsStream({
		includePeers,
		onFrame: (frame) => {
			if (frame.kind === "sessions" && first === null) {
				first = {
					remote: frame.data.sessions.filter((row) => row.locality === "remote")
						.length,
				};
			}
		},
	});
	stream.connection.start();
	const started = Date.now();
	while (first === null && Date.now() - started < 5_000) {
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	stream.stop();
	return first;
}

/** A client on the custom route, signed in — the shape `relay-smoke.ts` uses:
 *  its own cookie jar, its own login, so two probes cannot share a session. */
async function freshClient(baseUrl: string, password: string) {
	const { connection, testing } = await loadApp();
	const jar = testing.createCookieJarFetch();
	const client = connection.createRelayClient({
		route: { mode: "custom" as const, baseUrl, allowInsecure: true },
		fetchImpl: jar.fetch,
	});
	const result = await client.login(password);
	if (!result.signedIn) {
		throw new Error(
			`relay refused the password (status ${String(result.status)})`,
		);
	}
	return client;
}

async function readNumber(
	baseUrl: string,
	field: string,
): Promise<number | null> {
	const res = await fetch(`${baseUrl}/__mock/state`);
	if (!res.ok) return null;
	const body = (await res.json()) as JsonRecord;
	const value = body[field];
	return typeof value === "number" ? value : null;
}

await main();
