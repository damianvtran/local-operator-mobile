/**
 * Wire proof for the in-conversation find (transcript-depth) — round 1
 * remediation.
 *
 * Reproduces, from outside the app, exactly what the feature reads:
 *   1. the projection the phone holds (`entries`): the SSE seed frame's
 *      `transcript` length, per `docs/relay/contract.md` §6.2;
 *   2. the history page the screen fetches once at open (`/history`): its
 *      `entries` length and `has_more` — the page facts `olderThanLoaded`
 *      (`src/features/session/runtime.ts`) proves the scope line's caveat
 *      from, together with the page's own rows;
 *   3. the message docs the search actually scans, counted from (1)+(2) with
 *      the same kinds `find.ts` reads — the number the sheet's scope line
 *      renders;
 *   4. BOTH sides of the caveat gate: the control world (where the held rows
 *      reach past the page and the claim must stay OFF) and the new
 *      `long-transcript-history` world (the history-first shape the
 *      `S5/find-caveat` cell captures, where the page is the device's whole
 *      window and the claim must be ON).
 *
 * Run against the harness's own mock relay (`node tools/mock-relay/relay.ts
 * --port 0`), pinning the scenario itself.
 *
 * The verdict lines mirror `olderThanLoaded`'s three clauses in plain JS
 * (the function itself is TypeScript; its clauses are pinned by
 * `runtime.test.ts`). The mirror is deliberately the SIMPLEST reading of
 * each clause — if the two ever disagree, this log is where it shows.
 */
const relay = process.env.RELAY_URL ?? "http://127.0.0.1:51461";
const password = process.env.MOCK_PW ?? "";

/** Every wire kind `find.ts`'s DOC_KINDS reads (the desktop index's rule
 *  mapped onto the folded wire kinds). */
const DOC_KINDS = new Set([
	"user",
	"steer",
	"assistant",
	"parent_message",
	"subagent_message",
	"peer_message",
	"notice",
	"compaction",
	"ask_response",
	"ask_timeout",
]);

const pin = async (scenario) => {
	const res = await fetch(new URL("/__mock/scenario", relay), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-lo-harness": "wire-proof-transcript-depth",
		},
		body: JSON.stringify({ scenario }),
	});
	console.log("pin:", res.status, await res.text());
};

const login = await fetch(new URL("/login", relay), {
	method: "POST",
	headers: { "content-type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams({ password }).toString(),
	redirect: "manual",
});
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
console.log("login:", login.status, "cookie present:", cookie.length > 0);

/** One `projection` frame off the SSE seed, then close. */
const readSeed = async (sessionId) => {
	const stream = await fetch(
		new URL(`/api/sessions/${sessionId}/events`, relay),
		{ headers: { cookie, accept: "text/event-stream" } },
	);
	const reader = stream.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let transcript = null;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const frames = buffer.split("\n\n");
		for (const frame of frames.slice(0, -1)) {
			const line = frame.split("\n").find((l) => l.startsWith("data: "));
			if (line === undefined) continue;
			try {
				const payload = JSON.parse(line.slice(6));
				if (Array.isArray(payload?.transcript)) transcript = payload.transcript;
			} catch {
				/* keepalives and non-JSON frames are not the seed */
			}
			if (transcript !== null) break;
		}
		if (transcript !== null) break;
	}
	await reader.cancel();
	return transcript ?? [];
};

/** `olderThanLoaded`'s clauses, mirrored: a row the page carried that the
 *  held window no longer has; or `has_more` with nothing held past the
 *  page's oldest row. (`slid` false here — a static read cannot watch
 *  frames move; the runtime test drives that channel.) */
const caveatFires = (held, page) => {
	if (page.entries.length === 0) return { fire: false, why: "no page — no claim" };
	const heldIds = new Set(held.map((e) => e.id));
	const missing = page.entries.filter((e) => !heldIds.has(e.id));
	if (missing.length > 0)
		return { fire: true, why: `${missing.length} page row(s) no longer held` };
	if (!page.has_more) return { fire: false, why: "page complete and fully held" };
	const index = held.findIndex((e) => e.id === page.entries[0]?.id);
	return index === 0
		? { fire: true, why: "page incomplete; nothing held past its oldest row" }
		: { fire: false, why: `held extends past the page (oldest at index ${index})` };
};

const prove = async (scenario, sessionId) => {
	console.log(`\n=== ${scenario} (${sessionId}) ===`);
	await pin(scenario);
	const page = await (
		await fetch(
			new URL(`/api/sessions/${sessionId}/history?limit=80`, relay),
			{ headers: { cookie } },
		)
	).json();
	console.log(
		"history page:",
		page.entries?.length,
		"entries; has_more:",
		page.has_more,
		"; oldest id:",
		page.entries?.[0]?.id ?? null,
	);
	const held = await readSeed(sessionId);
	console.log("projection seed: transcript rows:", held.length);
	/* The app's `transcriptRows` falls back to the history page when the
	 *  projection holds no rows (a reopened session's first frames) — the
	 *  effective window is what the derivation reads. */
	const window = held.length > 0 ? held : (page.entries ?? []);
	const scanCount = window.filter((entry) => DOC_KINDS.has(entry.kind)).length;
	console.log("find scans:", scanCount, "message docs held by the window");
	const verdict = caveatFires(window, page);
	console.log(
		`olderThanLoaded(...) -> ${verdict.fire} (${verdict.why})`,
	);
	return verdict;
};

/* `6714def86197` is the fixture session id every session scenario shares. */
const control = await prove("long-transcript", "6714def86197");
const historyFirst = await prove("long-transcript-history", "6714def86197");

console.log("\n=== verdict ===");
console.log(
	"control (long-transcript): caveat",
	control.fire ? "ON — UNEXPECTED" : "off — correct (held extends past the page)",
);
console.log(
	"history-first (long-transcript-history): caveat",
	historyFirst.fire ? "ON — correct (the S5/find-caveat premise)" : "off — UNEXPECTED",
);
process.exitCode = control.fire || !historyFirst.fire ? 1 : 0;
