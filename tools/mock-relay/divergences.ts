#!/usr/bin/env node

/**
 * The ten ways the mock relay used to differ from the real one, asserted.
 *
 * A QA pass drove ~44 request cases through the mock and a real `lop mobile
 * serve` and found ten divergences. They matter for one reason: a mock that is
 * more lenient than the relay, or that refuses where the relay stays open, cannot
 * catch a client bug in the place the bug lives. The worst of them was a `404` on
 * an unknown session's event stream that the real relay never sends — it opens a
 * 200 stream and simply says nothing — so a client written against the mock would
 * look correct and hang in production.
 *
 * `verify.ts` cannot cover these: they are *fall-through* behaviours, and the
 * captured corpus only holds responses the relay meant to send. So they are
 * asserted here, one per case, over real sockets, against the behaviour the real
 * relay was measured to have — never against the old mock.
 *
 *   node tools/mock-relay/divergences.ts [--relay <worktree>]
 *
 * Exit 0 only when every case matches. A case that cannot be matched is listed in
 * `KNOWN_DIVERGENCES` and reported as such, with the reason, rather than being
 * quietly dropped: an unlisted divergence is the defect this file exists for.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKTREE = resolve(
	process.env.LOCAL_OPERATOR_WORKTREE ?? resolve(HERE, "..", ".."),
);
const RELAY = join(WORKTREE, "tools", "mock-relay", "relay.ts");
const PASSWORD = "mock-relay-password";
const SID = "6714def86197";
const UNKNOWN = "ffffffffffffffffffff";

/**
 * Divergences that cannot be matched in-process, with the reason.
 *
 * Every entry is printed on every run, so a reader sees the coverage this file
 * does NOT have rather than inferring it is complete.
 */
const KNOWN_DIVERGENCES: Array<{ id: string; what: string; reason: string }> = [
	{
		id: "D10",
		what: "/mark.png serves a stand-in image rather than the shipped mark",
		reason:
			"the shipped mark is a shipped binary asset in the relay's own web bundle; vendoring it would add a fixture that says nothing about the client. The BYTES are asserted to be a real PNG instead, which is what a client can observe.",
	},
	{
		id: "D11",
		what: "`PATCH /api/projects/{key}` answers the mock's 405 where the real relay answers 200 (create, delete and both milestone routes are REAL here now)",
		reason:
			"NARROWED, not new. The read path's slice carried no project write call at all, so the whole family answered 405; the lifecycle slice implemented create, delete and the milestone pair against an isolated daemon and this entry shrank to the one verb that slice does not offer. `PATCH` belongs to the edit form's slice, and a mock that answered 200 to a body no client sends would be inventing the edit semantics — the accepted keys, the tri-state `''`-clears rule, the estimate's apply arm — with nothing in this repository to validate them. Measured at the ref the write fixtures name: `PATCH` there answers 200 with the row's SUMMARY. The mock's `ALLOWED_METHODS` entry therefore keeps `GET, HEAD, DELETE` on that path, so PATCH is a 405 rather than an invented body.",
	},
	{
		id: "D12",
		what: "a method the project COLLECTION does not carry answers `405` with a wider `Allow` here (`GET, HEAD, POST`) than the relay sends (`GET, HEAD`)",
		reason:
			"A shape difference in one response header, and it is the mock's simplification rather than the relay's behaviour. aiohttp registers `GET /api/projects` and `POST /api/projects` as two ROUTES, so a `DELETE` on the collection is answered by the GET route and its `Allow` lists only that route's methods (`GET, HEAD` — measured). The mock's table is keyed per PATH with a method list, so its single entry carries all three and the refusal names all three. No client reads `Allow` — the app branches on the status and the body — and matching it would mean modelling aiohttp's route table rather than the wire, which is the wrong thing to mirror. Stated rather than hidden, because an unlisted divergence is the defect this file exists for.",
	},
];

interface Check {
	name: string;
	actual: unknown;
	expected: unknown;
	ok: boolean;
}

const results: Check[] = [];
let group = "";

const check = (
	name: string,
	actual: unknown,
	expected: unknown,
	note = "",
): void => {
	const ok =
		typeof expected === "function"
			? (expected as (value: unknown) => boolean)(actual)
			: JSON.stringify(actual) === JSON.stringify(expected);
	results.push({ name: `${group}: ${name}`, actual, expected, ok });
	if (!ok)
		console.error(
			`  FAIL ${group}: ${name}\n       actual: ${JSON.stringify(actual)}${note ? `\n       note:   ${note}` : ""}`,
		);
};

interface RelayHandle {
	base: string;
	stop: () => Promise<void>;
}

const sleep = (ms: number): Promise<void> =>
	new Promise((done) => setTimeout(done, ms));

/** Start the mock relay on an ephemeral port and wait for the port it prints. */
async function startRelay(): Promise<RelayHandle> {
	const proc = spawn(
		process.execPath,
		[RELAY, "--scenario", "idle", "--print-port", "--quiet"],
		{
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let stderr = "";
	proc.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString("utf8");
	});
	const port = await new Promise<number>((done, fail) => {
		let out = "";
		const timer = setTimeout(
			() => fail(new Error(`no port in 20s: ${stderr.slice(-300)}`)),
			20_000,
		);
		proc.stdout.on("data", (chunk: Buffer) => {
			out += chunk.toString("utf8");
			const line = out.split("\n")[0]?.trim() ?? "";
			if (/^\d+$/.test(line)) {
				clearTimeout(timer);
				done(Number(line));
			}
		});
		proc.on("close", () =>
			fail(
				new Error(`relay exited before printing a port: ${stderr.slice(-300)}`),
			),
		);
	});
	return {
		base: `http://127.0.0.1:${port}`,
		stop: () =>
			new Promise<void>((done) => {
				proc.on("exit", () => done());
				proc.kill("SIGTERM");
				setTimeout(done, 2000);
			}),
	};
}

/** A client that keeps its cookie, exactly as the native one must. */
function makeClient(base: string) {
	let cookie: string | null = null;
	const call = async (
		method: string,
		path: string,
		body?: unknown,
		timeoutMs = 5000,
	): Promise<{
		status: number | null;
		headers: Headers;
		text: string;
		json: unknown;
	}> => {
		const headers: Record<string, string> = {};
		if (cookie) headers.cookie = cookie;
		const init: RequestInit = {
			method,
			redirect: "manual",
			headers,
			signal: AbortSignal.timeout(timeoutMs),
		};
		if (body !== undefined) {
			headers["content-type"] = "application/json";
			init.body = JSON.stringify(body);
		}
		try {
			const res = await fetch(new URL(path, base), init);
			const setCookie = res.headers.getSetCookie()[0];
			if (setCookie) cookie = setCookie.split(";")[0] ?? null;
			const text = await res.text();
			let json: unknown;
			try {
				json = JSON.parse(text);
			} catch {
				json = undefined;
			}
			return { status: res.status, headers: res.headers, text, json };
		} catch {
			return {
				status: null,
				headers: new Headers(),
				text: "",
				json: undefined,
			};
		}
	};
	return {
		get: (path: string, timeoutMs?: number) =>
			call("GET", path, undefined, timeoutMs),
		post: (path: string, body?: unknown, timeoutMs?: number) =>
			call("POST", path, body, timeoutMs),
		/** A DELETE, with or without a body — the project delete's confirmation IS
		 *  its body, so the no-body shape had to become optional rather than the
		 *  only one. */
		delete: (path: string, body?: unknown) => call("DELETE", path, body),
		/** Any other verb, for the method tables (`PUT` on a collection). */
		call: (method: string, path: string, body?: unknown, timeoutMs?: number) =>
			call(method, path, body, timeoutMs),
		/** An authenticated POST with no body at all (not even `{}`). */
		postNoBody: async (
			path: string,
		): Promise<{ status: number | null; text: string; json: unknown }> => {
			const headers: Record<string, string> = {
				"content-type": "application/json",
			};
			if (cookie) headers.cookie = cookie;
			const res = await fetch(new URL(path, base), {
				method: "POST",
				redirect: "manual",
				headers,
				signal: AbortSignal.timeout(5000),
			});
			const text = await res.text();
			let json: unknown;
			try {
				json = JSON.parse(text);
			} catch {
				json = undefined;
			}
			return { status: res.status, text, json };
		},
		login: async (): Promise<void> => {
			const headers = { "content-type": "application/x-www-form-urlencoded" };
			const res = await fetch(new URL("/login", base), {
				method: "POST",
				redirect: "manual",
				headers,
				body: `password=${encodeURIComponent(PASSWORD)}`,
			});
			const setCookie = res.headers.getSetCookie()[0];
			if (setCookie) cookie = setCookie.split(";")[0] ?? null;
		},
	};
}

/**
 * Read a stream with a raw socket and report what arrived.
 *
 * `D1` is about a stream that stays OPEN and says NOTHING, which only a raw read
 * can observe: a client library that waits for a body would report a timeout and
 * hide the difference between "open and silent" and "refused".
 */
async function probeStream(
	base: string,
	path: string,
	cookie: string | null,
	ms: number,
): Promise<{ status: number; bytes: number; terminated: boolean }> {
	const { hostname, port } = new URL(base);
	return new Promise((done) => {
		let head = "";
		let bytes = 0;
		let status = 0;
		let terminated = false;
		const socket = netConnect(Number(port), hostname, () => {
			socket.write(
				`GET ${path} HTTP/1.1\r\nHost: ${hostname}\r\nAccept: text/event-stream` +
					`${cookie === null ? "" : `\r\nCookie: ${cookie}`}\r\nConnection: close\r\n\r\n`,
			);
		});
		socket.on("data", (chunk: Buffer) => {
			if (status === 0) {
				head += chunk.toString("utf8");
				const split = head.indexOf("\r\n\r\n");
				if (split === -1) return;
				status = Number(/HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0);
				bytes += Buffer.byteLength(head.slice(split + 4));
				if (head.slice(split + 4).includes("0\r\n\r\n")) terminated = true;
				head = "";
				return;
			}
			bytes += chunk.length;
			if (chunk.toString("utf8").includes("0\r\n\r\n")) terminated = true;
		});
		const finish = (): void => {
			socket.destroy();
			done({ status, bytes, terminated });
		};
		socket.on("close", finish);
		socket.on("error", finish);
		setTimeout(finish, ms);
	});
}

/** The cookie value, for the raw-socket probe which cannot use `fetch`. */
async function cookieFor(base: string): Promise<string | null> {
	const res = await fetch(new URL("/login", base), {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `password=${encodeURIComponent(PASSWORD)}`,
	});
	return res.headers.getSetCookie()[0]?.split(";")[0] ?? null;
}

async function main(): Promise<void> {
	const relay = await startRelay();
	try {
		const client = makeClient(relay.base);
		await client.login();

		/* ---- D1: an unknown session's stream is open and silent, never a 404 ---- */
		group = "D1 /events on an unknown session";
		{
			const cookie = await cookieFor(relay.base);
			const stream = await probeStream(
				relay.base,
				`/api/sessions/${UNKNOWN}/events`,
				cookie,
				2500,
			);
			check("answers 200, not the 404 the mock invented", stream.status, 200);
			check("sends no frame at all", stream.bytes, 0);
			check("and does not terminate its body", stream.terminated, false);
		}

		/* ---- D2: liveness precedes the op refusal (contract §4.3) ---- */
		group = "D2 command order";
		{
			const forNew = await client.post(`/api/sessions/${UNKNOWN}/command`, {
				op: "new_conversation",
				command_id: "11111111-2222-4333-8444-000000000001",
			});
			check(
				"new_conversation on an unknown session is 409 session not connected",
				forNew.status,
				409,
			);
			check(
				"with the relay's own sentence",
				(forNew.json as { error?: unknown } | undefined)?.error,
				"session not connected",
			);
			const forResume = await client.post(`/api/sessions/${UNKNOWN}/command`, {
				op: "resume_session",
				command_id: "11111111-2222-4333-8444-000000000002",
			});
			check(
				"resume_session is answered the same way, not with an op refusal",
				forResume.status,
				409,
			);
			// The op this PR added sits in the same place in the order. It was BELOW the
			// liveness check in the first version, which made the mock answer
			// `200 no approval was pending` for a session the relay refuses — lenient in
			// exactly the case the round-1 fix had just made faithful.
			const forApproval = await client.post(
				`/api/sessions/${UNKNOWN}/command`,
				{
					op: "approval_answer",
					request_id: "dc5bc227dd764cde",
					approved: true,
				},
			);
			check(
				"approval_answer on an unknown session is 409 session not connected",
				forApproval.status,
				409,
			);
			check(
				"and it is refused for liveness, not for a missing approval",
				(forApproval.json as { error?: unknown } | undefined)?.error,
				"session not connected",
			);
			// The MALFORMED direction, which is where an earlier revision of the mock was
			// one block too high: the relay validates the frame BETWEEN the lookup and the
			// 409 for every op except `prompt`, so a malformed op on an unknown session is
			// 422 — QA proved it against a live isolated daemon, and the reviewer's
			// "409 whatever the op" was reasoned from source and is wrong for these.
			const malformed: Array<{ name: string; body: Record<string, unknown> }> =
				[
					{
						name: "approval_answer with no request_id",
						body: { op: "approval_answer", approved: true },
					},
					{
						name: "approval_answer with a non-boolean approved",
						body: { op: "approval_answer", request_id: "x", approved: "yes" },
					},
					{ name: "steer with no text", body: { op: "steer" } },
				];
			for (const entry of malformed) {
				const res = await client.post(
					`/api/sessions/${UNKNOWN}/command`,
					entry.body,
				);
				check(
					`on an UNKNOWN session, ${entry.name} is 422, not 409`,
					res.status,
					422,
				);
			}
			// ... and `prompt` keeps the other order: liveness first, so a prompt with no
			// text on an unknown session is still 409.
			const emptyPrompt = await client.post(
				`/api/sessions/${UNKNOWN}/command`,
				{ op: "prompt" },
			);
			check(
				"while an empty prompt on an unknown session is still 409",
				emptyPrompt.status,
				409,
			);

			// An UNKNOWN OP is not a shape refusal either: `validate_control_frame` is an
			// if/elif chain with no `else` (`types.py:208-424`), so an op it does not know
			// passes validation and reaches the liveness answer; the `422 unknown op` comes
			// from the registrant, and only on a LIVE session (`daemon.py:3890-4015`).
			const unknownOpUnknown = await client.post(
				`/api/sessions/${UNKNOWN}/command`,
				{ op: "frobnicate" },
			);
			check(
				"an unknown OP on an unknown session is 409, not the registrant's 422",
				unknownOpUnknown.status,
				409,
			);
			const unknownOpLive = await client.post(`/api/sessions/${SID}/command`, {
				op: "frobnicate",
			});
			check(
				"while the same op on a LIVE session is the registrant's 422",
				unknownOpLive.status,
				422,
			);
			// `steer` shares `prompt`'s text rule, and the relay checks `isinstance(text, str)`
			// FIRST: images rescue a BLANK text, not a missing `text` key.
			const imageNoText = await client.post(`/api/sessions/${SID}/command`, {
				op: "steer",
				command_id: "11111111-2222-4333-8444-00000000000a",
				images: [{ data_b64: "AAAA" }],
			});
			check(
				"steer with an image but no text key is 422 (text must be a string first)",
				imageNoText.status,
				422,
			);
		}

		/* ---- D3: an empty start body is invalid JSON, not a fabricated start ---- */
		group = "D3 empty start body";
		{
			// No body at all, and AUTHENTICATED: `{}` is valid JSON and the relay
			// accepts it, and an unauthenticated request is a 401 before the route is
			// ever reached, so both would hide the divergence.
			const empty = await client.postNoBody("/api/sessions/start");
			check("is refused 400", empty.status, 400);
			check(
				"with invalid JSON",
				(empty.json as { error?: unknown } | undefined)?.error,
				"invalid JSON",
			);
		}

		/* ---- D4: the session is resolved before the parameter ---- */
		group = "D4 image route order";
		{
			const image = await client.get(`/api/sessions/${UNKNOWN}/image`);
			check(
				"an unknown session is 404 even with no entry parameter",
				image.status,
				404,
			);
			check(
				"and the sentence is about the session",
				(image.json as { error?: unknown } | undefined)?.error,
				"unknown session",
			);
		}

		/* ---- D5: an unrouted path is plain text ---- */
		group = "D5 unrouted path";
		for (const path of ["/api/nope", "/nope", "/robots.txt"]) {
			const res = await client.get(path);
			check(`${path} is 404`, res.status, 404);
			check(
				`${path} is text/plain`,
				res.headers.get("content-type"),
				"text/plain; charset=utf-8",
			);
			check(`${path} says Not Found`, res.text, "Not Found");
		}

		/* ---- D6: a wrong method is 405 with Allow ---- */
		group = "D6 wrong method";
		{
			const getCommand = await client.get(`/api/sessions/${SID}/command`);
			check("GET /command is 405, not 404", getCommand.status, 405);
			check(
				"the Allow header names what is allowed",
				(getCommand.headers.get("allow") ?? "").includes("POST"),
				true,
			);
			check(
				"the body is the relay's own text",
				getCommand.text,
				"Method Not Allowed",
			);
			const deleteSessions = await client.delete("/api/sessions");
			check("DELETE /api/sessions is 405", deleteSessions.status, 405);
		}

		/* ---- D7: only GET /logout exists ---- */
		group = "D7 logout is GET-only";
		{
			const post = await client.post("/logout", undefined);
			check("POST /logout is 405, not a 303", post.status, 405);
			check(
				"and Allow names GET and HEAD",
				post.headers.get("allow"),
				"GET, HEAD",
			);
		}

		/* ---- D8: the cleared cookie carries expires as well as Max-Age=0 ---- */
		group = "D8 cleared cookie";
		{
			// A SEPARATE client: GET /logout clears the cookie, so using the shared
			// one would poison every case after this and hide a real failure behind
			// a 401.
			const logoutClient = makeClient(relay.base);
			await logoutClient.login();
			const res = await logoutClient.get("/logout");
			const header = res.headers.getSetCookie()[0] ?? "";
			check("logout redirects", res.status, 303);
			check(
				"the cookie is cleared with Max-Age=0",
				/Max-Age=0/.test(header),
				true,
			);
			check(
				"and with expires, as the relay sends it",
				/expires=/i.test(header),
				true,
				header,
			);
		}

		/* ---- D9: the bare relay has no body ceiling; the gateway's does ---- */
		group = "D9 no relay-level body ceiling";
		{
			const big = await client.post(
				`/api/sessions/${SID}/command`,
				{
					op: "prompt",
					command_id: "11111111-2222-4333-8444-000000000003",
					text: "x".repeat(11 * 1024 * 1024),
				},
				60_000,
			);
			// The assertion is on a REAL answer, not on the absence of a 413: a
			// transport failure would satisfy `status !== 413` while proving nothing,
			// which is the vacuous pass this file exists to avoid.
			check(
				"an 11 MiB body is admitted rather than refused",
				big.status,
				200,
				`status ${String(big.status)} — a null status here means the request never completed`,
			);
			check(
				"the handler answers about the command, not about its size",
				typeof (big.json as { detail?: unknown } | undefined)?.detail,
				"string",
			);
		}

		/* ---- D10: the image is a real PNG even though it is a stand-in ---- */
		group = "D10 mark.png";
		{
			// Read as BYTES: `res.text()` decodes the PNG as UTF-8 and mangles the
			// signature, so a check on the decoded string could never pass.
			const res = await fetch(new URL("/mark.png", relay.base));
			const bytes = new Uint8Array(await res.arrayBuffer());
			check("is 200 image/png", res.headers.get("content-type"), "image/png");
			check(
				"and its bytes are a PNG signature",
				[bytes[0], bytes[1], bytes[2], bytes[3]].join(","),
				"137,80,78,71",
			);
			check(
				"with a non-trivial length",
				bytes.length > 64,
				true,
				`${bytes.length} bytes`,
			);
		}

		/* ---- the project WRITE routes, against the behaviour a real relay was
		 * measured to have (the ref the write fixtures name) ---- */
		group = "project writes";
		{
			const created = await client.post("/api/projects", {
				name: "divergence-probe",
				status: "active",
				tags: ["a", "b"],
			});
			/* 200, NOT 201 — the earlier D11 said 201 and was wrong: the daemon's
			 *  `_project_call` wraps every payload in a plain `JSONResponse`, measured
			 *  at both write routes. A mock that answered 201 would diverge from the
			 *  relay it is supposed to be. */
			check("create answers 200", created.status, 200);
			check(
				"create echoes the row's SUMMARY",
				typeof (created.json as { project?: { id?: unknown } } | undefined)
					?.project?.id,
				"string",
			);
			const listed = await client.get("/api/projects");
			check(
				"and the row is IN the listing afterwards",
				(
					(listed.json as { projects?: Array<{ name?: unknown }> })?.projects ??
					[]
				).some((row) => row.name === "divergence-probe"),
				true,
			);
			const taken = await client.post("/api/projects", {
				name: "DIVERGENCE-PROBE",
			});
			check("a taken name is 409", taken.status, 409);
			check(
				"…case-insensitively, with the relay's own sentence",
				(taken.json as { error?: unknown } | undefined)?.error,
				"project 'DIVERGENCE-PROBE' already exists",
			);
			check(
				"…and its machine code",
				(taken.json as { code?: unknown } | undefined)?.code,
				"project_name_exists",
			);
			const blank = await client.post("/api/projects", { name: "   " });
			check("a blank name is 422", blank.status, 422);
			check(
				"…with `name is required`",
				(blank.json as { error?: unknown } | undefined)?.error,
				"name is required",
			);
			const listed0 = await client.post("/api/projects", [1, 2, 3]);
			check("a body that is not an object is 400", listed0.status, 400);
			check(
				"…with the relay's own sentence and no code",
				listed0.json as { error?: unknown; code?: unknown } | undefined,
				(error: unknown) =>
					JSON.stringify(error) ===
					'{"error":"request body must be an object"}',
			);

			const slashed = await client.post(
				"/api/projects/divergence-probe/milestones",
				{ name: "ship/v2" },
			);
			/* The measurement the phone's slash guard exists for: the add route carries
			 *  the name in its BODY, so a slash name is CREATED — and the remove route
			 *  carries it in the PATH, where `[^/]+` cannot match `ship%2Fv2` either. */
			check("a slash-named milestone is creatable", slashed.status, 200);
			const unreachable = await client.delete(
				`/api/projects/divergence-probe/milestones/${encodeURIComponent("ship/v2")}`,
			);
			check("…and its removal never reaches a route", unreachable.status, 404);
			check(
				"…as the server's own page, not the relay's error JSON",
				unreachable.json,
				undefined,
			);

			const milestone = await client.post(
				"/api/projects/divergence-probe/milestones",
				{ name: "beta cut", completed: true },
			);
			check("a milestone write answers the whole VIEW", milestone.status, 200);
			check(
				"…with the milestone the store now holds",
				(
					(
						milestone.json as {
							project?: { milestones?: Array<{ name?: unknown }> };
						}
					)?.project?.milestones ?? []
				).some((row) => row.name === "beta cut"),
				true,
			);
			const removedMilestone = await client.delete(
				"/api/projects/divergence-probe/milestones/never%20added",
			);
			check(
				"removing a milestone the project does not hold is 422",
				removedMilestone.status,
				422,
			);
			check(
				"…with the store's sentence",
				(removedMilestone.json as { error?: unknown } | undefined)?.error,
				"no milestone named 'never added'",
			);

			const mismatch = await client.delete("/api/projects/divergence-probe", {
				confirm: "something else",
			});
			check("a confirm that is not the name is 422", mismatch.status, 422);
			check(
				"…with the relay's own sentence",
				(mismatch.json as { error?: unknown } | undefined)?.error,
				"confirm must repeat the project name 'divergence-probe' exactly (the name, not the id)",
			);
			const noConfirm = await client.delete("/api/projects/divergence-probe");
			check("a DELETE with no body at all is 400", noConfirm.status, 400);
			const deleted = await client.delete("/api/projects/divergence-probe", {
				confirm: "divergence-probe",
			});
			check("delete answers the relay's own read-back", deleted.json, {
				ok: true,
				deleted: true,
			});
			const gone = await client.delete("/api/projects/divergence-probe", {
				confirm: "divergence-probe",
			});
			check("deleting it again is the relay's 404", gone.status, 404);
			check(
				"…with its machine code",
				(gone.json as { code?: unknown } | undefined)?.code,
				"project_not_found",
			);

			const put = await client.call("PUT", "/api/projects", { name: "x" });
			check("PUT on the collection is 405", put.status, 405);
			const patch = await client.call(
				"PATCH",
				"/api/projects/payments-migration",
				{
					status: "paused",
				},
			);
			check(
				"PATCH is still the mock's 405 (the narrowed D11)",
				patch.status,
				405,
			);
		}
	} finally {
		await relay.stop();
	}

	const failed = results.filter((r) => !r.ok);
	console.log(`\n=== divergences (${results.length} checks)`);
	for (const result of results) {
		if (result.ok) console.log(`  PASS  ${result.name}`);
	}
	if (KNOWN_DIVERGENCES.length > 0) {
		console.log(
			"\n=== known divergences (asserted as far as a client can observe)",
		);
		for (const entry of KNOWN_DIVERGENCES) {
			console.log(`  ${entry.id}  ${entry.what}\n      ${entry.reason}`);
		}
	}
	console.log(
		`\n${results.length - failed.length}/${results.length} checks passed; ${failed.length} failed`,
	);
	process.exit(failed.length === 0 ? 0 : 1);
}

// The scratch dir is created and removed so a run never writes beside the tools
// (the repository's own rule for a harness's temporary state).
const scratch = mkdtempSync(
	join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "divergences-"),
);
process.on("exit", () => {
	try {
		rmSync(scratch, { recursive: true, force: true });
	} catch {
		// Best effort: nothing here is load-bearing.
	}
});

await main();
