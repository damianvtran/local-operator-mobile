/**
 * Wire proof for the in-conversation find (transcript-depth).
 *
 * Reproduces, from outside the app, exactly what the feature reads:
 *   1. the projection the phone holds (`entries`): the SSE seed frame's
 *      `transcript` length, per `docs/relay/contract.md` §6.2;
 *   2. the history page the screen fetches once at open (`/history`): its
 *      `entries` length and `has_more` — the page facts `olderThanLoaded`
 *      (`src/features/session/runtime.ts`) must agree with before the sheet
 *      may claim "older messages aren't loaded";
 *   3. the message docs the search actually scans, counted from (1)+(2) with
 *      the same kinds `find.ts` reads — the number the sheet's scope line
 *      renders.
 *
 * Run against the harness's own mock relay (`node tools/mock-relay/relay.ts
 * --port 0`), pinning the scenario itself.
 */
const relay = process.env.RELAY_URL ?? "http://127.0.0.1:51461";
const sessionId = process.env.SESSION_ID ?? "6714def86197";
const password = process.env.MOCK_PW ?? "";

const pin = await fetch(new URL("/__mock/scenario", relay), {
	method: "POST",
	headers: {
		"content-type": "application/json",
		"x-lo-harness": "wire-proof-transcript-depth",
	},
	body: JSON.stringify({ scenario: "long-transcript" }),
});
console.log("pin:", pin.status, await pin.text());

const login = await fetch(new URL("/login", relay), {
	method: "POST",
	headers: { "content-type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams({ password }).toString(),
	redirect: "manual",
});
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
console.log(
	"login:",
	login.status,
	"cookie present:",
	cookie.length > 0,
);

/* `limit=80` is the app's own `HISTORY_LIMIT.default` (`src/relay/endpoints.ts`). */
const page = await (await fetch(
	new URL(`/api/sessions/${sessionId}/history?limit=80`, relay),
	{ headers: { cookie } },
)).json();
const pageOldest = page.entries?.[0]?.id ?? null;
console.log(
	"history page:",
	page.entries?.length,
	"entries; has_more:",
	page.has_more,
	"; oldest id:",
	pageOldest,
);

/* The SSE seed: read exactly one `projection` frame and close. */
const stream = await fetch(new URL(`/api/sessions/${sessionId}/events`, relay), {
	headers: { cookie, accept: "text/event-stream" },
});
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
			if (Array.isArray(payload?.transcript)) {
				transcript = payload.transcript;
			}
		} catch {
			/* keepalives and non-JSON frames are not the seed */
		}
		if (transcript !== null) break;
	}
	if (transcript !== null) break;
}
await reader.cancel();
console.log("projection seed: transcript rows:", transcript?.length ?? null);

/* The message docs, by the kinds find.ts reads. */
const MESSAGE_KINDS = new Set([
	"user",
	"steer",
	"assistant",
	"parent_message",
	"subagent_message",
	"peer_message",
]);
const held = transcript ?? [];
const docs = held.filter((entry) => MESSAGE_KINDS.has(entry.kind)).length;
console.log("find scans:", docs, "message docs held by the projection");
console.log(
	"olderThanLoaded inputs: hasMore=" + page.has_more + " pageOldestId=" + pageOldest +
		" -> pageOldestIndexInHeld=" +
		held.findIndex((entry) => entry.id === pageOldest),
);
