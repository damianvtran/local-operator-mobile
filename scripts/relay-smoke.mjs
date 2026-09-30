#!/usr/bin/env node
/**
 * End-to-end smoke run against a REAL `lop mobile` relay.
 *
 * This script exists to answer one question the unit tests cannot: does the
 * protocol in `src/relay/` match a running relay's actual behaviour — its headers,
 * its statuses, its SSE framing, its command receipts? It talks to the relay the
 * way the app does (a signed cookie and an explicit `Origin`), prints a PASS/FAIL
 * line per step with the real status and byte count, and exits non-zero if any step
 * failed, so it is usable as a gate.
 *
 * It is deliberately PLAIN NODE with no dependencies, and therefore deliberately
 * duplicates a little of `src/relay/`: a smoke run that shared the client under
 * test would prove that the client agrees with itself. The duplication is the
 * point, and it is kept to paths, headers and SSE framing.
 *
 * Usage:
 *   node scripts/relay-smoke.mjs --base-url http://127.0.0.1:4099 --password-file <path>
 *   RELAY_BASE_URL=http://127.0.0.1:4099 RELAY_PASSWORD_FILE=<path> node scripts/relay-smoke.mjs
 *
 * Never point this at the operator's live relay and never commit a password: the
 * password is read from a file (mode 0600) or an environment variable and is never
 * printed, logged or included in a failure message.
 *
 * A step that cannot run in the current environment is reported as SKIP with the
 * reason, never as a PASS.
 */

// biome-ignore-all lint/performance/useTopLevelRegex: one-shot dev tooling, run by
// hand against a relay; none of these sites is on a hot path.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 15_000;
/** Keep the stream steps short: this is a smoke run, not a soak. */
const STREAM_READ_MS = 8_000;
/** How long a step may wait for the relay to publish something (a completion). */
const COMPLETION_WAIT_MS = 30_000;

/* --------------------------------------------------------------- tiny harness */

const results = [];
let failures = 0;

function record(step, status, detail) {
	const line = `${status.padEnd(5)} ${step}${detail ? ` — ${detail}` : ""}`;
	results.push(line);
	if (status === "FAIL") failures += 1;
	process.stdout.write(`${line}\n`);
}

function parseArgs(argv) {
	const args = { steps: new Set() };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--base-url") args.baseUrl = argv[++index];
		else if (arg === "--password-file") args.passwordFile = argv[++index];
		else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
		else if (arg === "--step") args.steps.add(argv[++index]);
		else if (arg === "--help" || arg === "-h") args.help = true;
		else if (!arg.startsWith("--")) args.baseUrl = arg;
	}
	return args;
}

function resolveConfig(args) {
	const baseUrl = (args.baseUrl ?? process.env.RELAY_BASE_URL ?? "")
		.trim()
		.replace(/\/+$/, "");
	const passwordFile =
		args.passwordFile ?? process.env.RELAY_PASSWORD_FILE ?? "";
	let password = process.env.RELAY_PASSWORD ?? "";
	if (!password && passwordFile) {
		try {
			password = readFileSync(passwordFile, "utf8").trim();
		} catch (cause) {
			process.stderr.write(`cannot read the password file: ${cause.message}\n`);
			process.exit(2);
		}
	}
	return {
		baseUrl,
		password,
		timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		only: args.steps,
	};
}

/** The cookie jar, by hand: the relay's single credential is one signed cookie and
 *  a real Client is not available here. */
const jar = new Map();

function cookieHeader() {
	return [...jar.entries()]
		.map(([name, value]) => `${name}=${value}`)
		.join("; ");
}

function absorbSetCookies(response) {
	const values =
		typeof response.headers.getSetCookie === "function"
			? response.headers.getSetCookie()
			: [];
	for (const pair of values) {
		const [head] = pair.split(";");
		if (!head) continue;
		const separator = head.indexOf("=");
		if (separator === -1) continue;
		const name = head.slice(0, separator).trim();
		const value = head.slice(separator + 1).trim();
		/* A `Max-Age=0` is the relay clearing the cookie on logout. */
		if (/max-age=0/i.test(pair) || value === "") jar.delete(name);
		else jar.set(name, value);
	}
}

/**
 * One request. `origin` mirrors what the app sends on every request: both gates
 * compare it exactly on a mutation, and the edge requires it.
 */
async function request(
	config,
	path,
	{ method = "GET", body, form, origin, headers = {}, timeoutMs } = {},
) {
	const url = `${config.baseUrl}${path}`;
	const init = {
		method,
		redirect: "manual",
		cache: "no-store",
		headers: { accept: "application/json", ...headers },
		signal: AbortSignal.timeout(timeoutMs ?? config.timeoutMs),
	};
	const cookie = cookieHeader();
	if (cookie) init.headers.cookie = cookie;
	if (origin ?? config.baseUrl) init.headers.origin = origin ?? config.baseUrl;
	if (form) {
		init.headers["content-type"] = "application/x-www-form-urlencoded";
		init.body = new URLSearchParams(form).toString();
	} else if (body !== undefined) {
		init.headers["content-type"] = "application/json";
		init.body = JSON.stringify(body);
	}
	const response = await fetch(url, init);
	absorbSetCookies(response);
	const text = await response.text();
	return {
		response,
		status: response.status,
		text,
		bytes: Buffer.byteLength(text),
	};
}

function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Reads SSE frames off a streaming response until `stop()` or the deadline. */
async function readSse(
	config,
	path,
	{ wantFrames = 1, timeoutMs = STREAM_READ_MS } = {},
) {
	/* `readSseUntil` is `readSse` with a stopping CONDITION, which is what a step
	 * that must wait for the relay to publish something needs: the session stream's
	 * seed frame is the projection as of subscribe time, so a step that reads one
	 * frame sees the state an instant ago, not the state the step is about. */
	return await readSseInner(config, path, {
		wantFrames,
		timeoutMs,
		stopWhen: null,
	});
}

async function readSseUntil(
	config,
	path,
	stopWhen,
	{ timeoutMs = STREAM_READ_MS } = {},
) {
	return await readSseInner(config, path, {
		wantFrames: Number.MAX_SAFE_INTEGER,
		timeoutMs,
		stopWhen,
	});
}

async function readSseInner(
	config,
	path,
	{ wantFrames = 1, timeoutMs = STREAM_READ_MS, stopWhen = null } = {},
) {
	const init = {
		method: "GET",
		redirect: "manual",
		cache: "no-store",
		headers: {
			accept: "text/event-stream",
			origin: config.baseUrl,
			cookie: cookieHeader(),
		},
		signal: AbortSignal.timeout(timeoutMs),
	};
	const response = await fetch(`${config.baseUrl}${path}`, init);
	if (!response.ok) {
		const text = await response.text();
		return {
			status: response.status,
			frames: [],
			bytes: Buffer.byteLength(text),
			error: text.slice(0, 120),
		};
	}
	const reader = response.body?.getReader();
	if (!reader)
		return {
			status: response.status,
			frames: [],
			bytes: 0,
			error: "no readable body",
		};

	const decoder = new TextDecoder();
	let buffer = "";
	let bytes = 0;
	const frames = [];
	try {
		while (frames.length < wantFrames) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			buffer += decoder.decode(value, { stream: true });
			/* The relay terminates a frame with a blank line and sends `: keepalive`
			 * comments, which carry no event name — both are handled the same way a
			 * browser's parser handles them. */
			let boundary = buffer.indexOf("\n\n");
			while (boundary !== -1) {
				const raw = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const event = {};
				for (const line of raw.split("\n")) {
					if (line.startsWith(":")) continue;
					const separator = line.indexOf(":");
					if (separator === -1) continue;
					const field = line.slice(0, separator);
					const fieldValue = line.slice(separator + 1).trimStart();
					if (field === "event") event.event = fieldValue;
					else if (field === "data")
						event.data = (event.data ? `${event.data}\n` : "") + fieldValue;
				}
				if (event.data !== undefined) {
					frames.push(event);
					if (stopWhen && stopWhen(event))
						return { status: response.status, frames, bytes };
					if (frames.length >= wantFrames)
						return { status: response.status, frames, bytes };
				}
				boundary = buffer.indexOf("\n\n");
			}
		}
	} catch (cause) {
		if (frames.length === 0)
			return { status: response.status, frames, bytes, error: cause.message };
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	return { status: response.status, frames, bytes };
}

const skipped = [];

/* --------------------------------------------------------------------- steps */

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		process.stdout.write(
			"usage: node scripts/relay-smoke.mjs --base-url <url> --password-file <path>\n",
		);
		return 0;
	}
	const config = resolveConfig(args);
	if (!config.baseUrl) {
		process.stderr.write(
			"no --base-url and no RELAY_BASE_URL: refusing to guess which relay to touch\n",
		);
		return 2;
	}
	/* A guard rather than a comment: the operator's live relay is on 4098 and this
	 * script must never touch it, nor a live tunnel. */
	const target = new URL(config.baseUrl);
	const looksLive =
		target.port === "4098" || target.hostname.endsWith("radienthq.com");
	const wantsOnly = config.only.size > 0;

	process.stdout.write(`relay smoke run against ${target.origin}\n`);
	if (looksLive) {
		process.stderr.write(
			"refusing to run: that address looks like a live relay or a live tunnel. Use an isolated `lop mobile serve` on its own port.\n",
		);
		return 2;
	}

	const run = (name) => !wantsOnly || config.only.has(name);
	const skip = (name, reason) => {
		if (run(name)) {
			record(name, "SKIP", reason);
			skipped.push({ name, reason });
		}
	};

	/* 1. The public probe: no cookie, no auth. */
	if (run("healthz")) {
		try {
			const health = await request(config, "/healthz");
			const body = parseJson(health.text);
			if (health.status === 200 && body?.ok === true) {
				record(
					"healthz",
					"PASS",
					`200, version=${body.version}, sessions=${body.sessions}, ${health.bytes}B`,
				);
			} else {
				record(
					"healthz",
					"FAIL",
					`expected 200 {"ok":true}, got ${health.status}`,
				);
			}
		} catch (cause) {
			record("healthz", "FAIL", cause.message);
		}
	}

	/* 2. The unauthenticated API path, which is the 401 the client must detect on a
	 * stream too. Asserted BEFORE signing in so the cookie jar is still empty. */
	if (run("unauth-401")) {
		try {
			const unauth = await request(config, "/api/sessions");
			const body = parseJson(unauth.text);
			if (unauth.status === 401 && typeof body?.error === "string") {
				record("unauth-401", "PASS", `401, error="${body.error}"`);
			} else {
				record(
					"unauth-401",
					"FAIL",
					`expected 401 {"error":…}, got ${unauth.status}`,
				);
			}
		} catch (cause) {
			record("unauth-401", "FAIL", cause.message);
		}
	}

	/* 3. The form login, which is the custom route's only credential path. */
	if (!config.password) {
		skip(
			"login",
			"no --password-file / RELAY_PASSWORD_FILE / RELAY_PASSWORD given",
		);
	} else if (run("login")) {
		try {
			const login = await request(config, "/login", {
				method: "POST",
				form: { password: config.password },
			});
			if (login.status === 303 && jar.size > 0) {
				/* The cookie's VALUE is never printed: its length is enough to show a
				 * credential was issued. */
				record(
					"login",
					"PASS",
					`303, ${jar.size} cookie(s), ${cookieHeader().length}B of cookie header`,
				);
			} else if (login.status === 401) {
				record("login", "FAIL", "401: the password was refused");
			} else {
				record("login", "FAIL", `expected 303, got ${login.status}`);
			}
		} catch (cause) {
			record("login", "FAIL", cause.message);
		}
	}

	/* 4. The wrong-password arm, so a 401 with an HTML body is exercised rather than
	 * only described. It must not disturb the session obtained above, so it runs
	 * before the jar is relied on and its cookies are dropped. */
	if (config.password && run("login-rejected")) {
		const saved = new Map(jar);
		try {
			const rejected = await request(config, "/login", {
				method: "POST",
				form: { password: `${config.password}-definitely-wrong` },
			});
			const looksHtml = /^\s*<(!doctype|html)/i.test(rejected.text);
			if (rejected.status === 401 && looksHtml) {
				record(
					"login-rejected",
					"PASS",
					"401 with an HTML login page (not JSON)",
				);
			} else {
				record(
					"login-rejected",
					"FAIL",
					`expected 401 HTML, got ${rejected.status}`,
				);
			}
		} catch (cause) {
			record("login-rejected", "FAIL", cause.message);
		} finally {
			jar.clear();
			for (const [name, value] of saved) jar.set(name, value);
		}
	}

	/* 5. A cross-origin mutation must be refused: this is the check that proves the
	 * `Origin` the client sends is load-bearing. */
	if (jar.size > 0 && run("cross-origin-403")) {
		try {
			const refused = await request(config, "/api/sessions/start", {
				method: "POST",
				body: { cwd: "." },
				origin: "https://not-this-relay.example",
			});
			if (refused.status === 403) {
				record(
					"cross-origin-403",
					"PASS",
					`403 "${(parseJson(refused.text)?.error ?? refused.text).slice(0, 60)}"`,
				);
			} else {
				record(
					"cross-origin-403",
					"FAIL",
					`expected 403, got ${refused.status}`,
				);
			}
		} catch (cause) {
			record("cross-origin-403", "FAIL", cause.message);
		}
	}

	/* 6. The list, on both transports: the JSON route and the SSE stream that the
	 * home screen actually uses. */
	if (jar.size > 0 && run("sessions")) {
		try {
			const list = await request(config, "/api/sessions");
			const body = parseJson(list.text);
			if (list.status === 200 && Array.isArray(body?.sessions)) {
				record(
					"sessions",
					"PASS",
					`200, ${body.sessions.length} session(s), degraded=[${body.degraded ?? []}], ${list.bytes}B`,
				);
			} else {
				record(
					"sessions",
					"FAIL",
					`expected 200 with a sessions array, got ${list.status}`,
				);
			}
		} catch (cause) {
			record("sessions", "FAIL", cause.message);
		}
	}

	if (jar.size > 0 && run("list-sse")) {
		try {
			const stream = await readSse(config, "/api/sessions/events", {
				wantFrames: 1,
			});
			const first = stream.frames[0];
			const body = first ? parseJson(first.data) : null;
			if (stream.status === 200 && first?.event === "sessions" && body) {
				record(
					"list-sse",
					"PASS",
					`200, event=${first.event}, ${stream.bytes}B, ${body.sessions?.length ?? 0} session(s)`,
				);
			} else {
				record(
					"list-sse",
					"FAIL",
					`status=${stream.status} event=${first?.event} ${stream.error ?? ""}`,
				);
			}
		} catch (cause) {
			record("list-sse", "FAIL", cause.message);
		}
	}

	/* 7. Start a session over the mock provider, so every later step has a real
	 * session to talk to. */
	let sessionId = null;
	if (jar.size > 0 && run("start-session")) {
		try {
			const started = await request(config, "/api/sessions/start", {
				method: "POST",
				body: {},
			});
			const body = parseJson(started.text);
			if (started.status === 200 && typeof body?.session_id === "string") {
				sessionId = body.session_id;
				record(
					"start-session",
					"PASS",
					`200, session_id=${body.session_id}, pid=${body.pid}`,
				);
			} else {
				record(
					"start-session",
					"FAIL",
					`expected 200 {session_id}, got ${started.status} ${started.text.slice(0, 120)}`,
				);
			}
		} catch (cause) {
			record("start-session", "FAIL", cause.message);
		}
	} else if (jar.size === 0) {
		skip("start-session", "not signed in");
	}

	/* 8. The session stream's seed frame: the relay sends the current projection
	 * immediately, which is what makes reconnect-and-resync work without a replay
	 * protocol. */
	if (sessionId && run("session-sse")) {
		try {
			const stream = await readSse(
				config,
				`/api/sessions/${sessionId}/events`,
				{ wantFrames: 1 },
			);
			const first = stream.frames[0];
			const body = first ? parseJson(first.data) : null;
			if (
				stream.status === 200 &&
				first?.event === "projection" &&
				body?.session_id === sessionId
			) {
				record(
					"session-sse",
					"PASS",
					`200, event=projection, version=${body.version}, pid=${body.pid}, ${stream.bytes}B`,
				);
			} else {
				record(
					"session-sse",
					"FAIL",
					`status=${stream.status} event=${first?.event} ${stream.error ?? ""}`,
				);
			}
		} catch (cause) {
			record("session-sse", "FAIL", cause.message);
		}
	}

	/* 9. A durable command with its UUID — the retry envelope's identity. Sent
	 * twice, because "already admitted" is the whole point of persisting it. */
	const commandId = randomUUID();
	if (sessionId && run("command-prompt")) {
		try {
			const first = await request(
				config,
				`/api/sessions/${sessionId}/command`,
				{
					method: "POST",
					body: {
						op: "prompt",
						command_id: commandId,
						text: "smoke run: reply with the word ready",
					},
				},
			);
			const body = parseJson(first.text);
			if (first.status === 200 && body?.ok === true) {
				record("command-prompt", "PASS", `200, detail="${body.detail}"`);
			} else {
				record(
					"command-prompt",
					"FAIL",
					`expected 200 {ok:true}, got ${first.status} ${first.text.slice(0, 120)}`,
				);
			}
		} catch (cause) {
			record("command-prompt", "FAIL", cause.message);
		}
	}

	if (sessionId && run("command-duplicate")) {
		try {
			const second = await request(
				config,
				`/api/sessions/${sessionId}/command`,
				{
					method: "POST",
					body: {
						op: "prompt",
						command_id: commandId,
						text: "smoke run: reply with the word ready",
					},
				},
			);
			const body = parseJson(second.text);
			if (second.status === 200 && body?.detail === "already admitted") {
				record(
					"command-duplicate",
					"PASS",
					`200, detail="already admitted" for the same command_id`,
				);
			} else if (second.status === 200) {
				record(
					"command-duplicate",
					"PASS",
					`200, detail="${body?.detail}" (not "already admitted"; the runtime may have already finished)`,
				);
			} else {
				record(
					"command-duplicate",
					"FAIL",
					`expected 200, got ${second.status} ${second.text.slice(0, 120)}`,
				);
			}
		} catch (cause) {
			record("command-duplicate", "FAIL", cause.message);
		}
	}

	if (sessionId && run("command-refused")) {
		try {
			const refused = await request(
				config,
				`/api/sessions/${sessionId}/command`,
				{
					method: "POST",
					body: { op: "frobnicate" },
				},
			);
			const body = parseJson(refused.text);
			if (refused.status === 422 && typeof body?.error === "string") {
				record(
					"command-refused",
					"PASS",
					`422 "${body.error}" — a pre-admission rejection, which clears the envelope`,
				);
			} else {
				record(
					"command-refused",
					"FAIL",
					`expected 422, got ${refused.status}`,
				);
			}
		} catch (cause) {
			record("command-refused", "FAIL", cause.message);
		}
	}

	if (sessionId && run("history")) {
		try {
			const history = await request(
				config,
				`/api/sessions/${sessionId}/history?limit=5`,
			);
			const body = parseJson(history.text);
			if (history.status === 200 && Array.isArray(body?.entries)) {
				record(
					"history",
					"PASS",
					`200, ${body.entries.length} entr(y/ies), has_more=${body.has_more}, ${history.bytes}B`,
				);
			} else {
				record(
					"history",
					"FAIL",
					`expected 200 with entries, got ${history.status}`,
				);
			}
		} catch (cause) {
			record("history", "FAIL", cause.message);
		}
	}

	/* 10. The side payloads the composer and the new-session screen need. */
	for (const [name, path, key] of [
		["models", "/api/models", "models"],
		["commands", "/api/commands", "commands"],
		["directories", "/api/directories", null],
		["past-sessions", "/api/sessions/past", "sessions"],
	]) {
		if (!jar.size || !run(name)) continue;
		try {
			const result = await request(config, path);
			const body = parseJson(result.text);
			const ok =
				result.status === 200 && (key === null || Array.isArray(body?.[key]));
			if (ok) {
				const count =
					key === null ? `home=${body.home}` : `${body[key].length}`;
				record(
					name,
					"PASS",
					`200, ${key === null ? count : `${count} item(s)`}, ${result.bytes}B`,
				);
			} else {
				record(
					name,
					"FAIL",
					`expected 200, got ${result.status} ${result.text.slice(0, 120)}`,
				);
			}
		} catch (cause) {
			record(name, "FAIL", cause.message);
		}
	}

	/* 11. The unread handshake, using the completion token the projection carries.
	 * Skipped when no completion has landed yet, which is a real state rather than a
	 * failure. */
	if (sessionId && run("seen")) {
		try {
			/* Wait for the turn to COMPLETE: the token is minted at completion, so
			 * sampling the seed frame only ever proves that nothing has finished yet.
			 * The wait is bounded, and exhausting it is a SKIP that says so. */
			const projection = await readSseUntil(
				config,
				`/api/sessions/${sessionId}/events`,
				(event) => {
					const frame = parseJson(event.data);
					return Boolean(frame?.attention?.completion_token);
				},
				{ timeoutMs: COMPLETION_WAIT_MS },
			);
			const last = projection.frames[projection.frames.length - 1];
			const body = last ? parseJson(last.data) : null;
			const token = body?.attention?.completion_token ?? null;
			if (!token) {
				skip(
					"seen",
					`no completion_token within ${COMPLETION_WAIT_MS}ms: the turn had not completed`,
				);
			} else {
				const seen = await request(config, `/api/sessions/${sessionId}/seen`, {
					method: "POST",
					body: { completion_token: token },
				});
				if (seen.status === 200)
					record(
						"seen",
						"PASS",
						`200 for completion_token=${token.slice(0, 8)}…`,
					);
				else
					record(
						"seen",
						"FAIL",
						`expected 200, got ${seen.status} ${seen.text.slice(0, 120)}`,
					);
			}
		} catch (cause) {
			record("seen", "FAIL", cause.message);
		}
	}

	/* 12. Logout, which is not auth-gated: a client calling it must expect to be
	 * signed out regardless of the cookie it presented. */
	if (jar.size > 0 && run("logout")) {
		try {
			const logout = await request(config, "/logout");
			if (logout.status === 303) {
				record("logout", "PASS", `303, cookie jar now ${jar.size} item(s)`);
			} else {
				record("logout", "FAIL", `expected 303, got ${logout.status}`);
			}
		} catch (cause) {
			record("logout", "FAIL", cause.message);
		}
	}

	process.stdout.write(`\n${results.length} step(s), ${failures} failure(s)\n`);
	for (const { name, reason } of skipped)
		process.stdout.write(`SKIP  ${name}: ${reason}\n`);
	return failures === 0 ? 0 : 1;
}

main()
	.then((code) => process.exit(code))
	.catch((cause) => {
		process.stderr.write(
			`the smoke run itself failed: ${cause.stack ?? cause.message}\n`,
		);
		process.exit(2);
	});
