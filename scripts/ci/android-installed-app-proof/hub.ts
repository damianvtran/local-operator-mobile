/**
 * HOSTED INSTALLED-APP PROOF ONLY. A loopback Team Bridge hub for the debug
 * proof APK: the repository's own mock (`tools/mock-team-bridge.ts` at the
 * CANDIDATE checkout, so its fixtures match the app under test) behind a thin
 * proxy that adds the one thing the mock cannot do — make unread controllable.
 *
 * WHY a proxy instead of a mock change: the mock answers a fixed `/unread`
 * total of 11 and fixed per-conversation counts. The "Bridge unread reaches 0
 * → Bridge notifications leave the shade while a session alert stays" receipt
 * needs the real app's poll to observe a drop to zero; rewriting the counts on
 * the wire keeps the candidate's mock byte-identical and the control
 * job-local.
 *
 * Reached by the emulator only through `adb reverse tcp:54832 tcp:54832`; binds
 * 127.0.0.1. No credential exists here: the app's patched fixture seam sends the
 * mock's synthetic, unsigned token.
 *
 * Run: node hub.ts <candidate-root> <requests-log>
 * Control: GET /__proof/ping · GET /__proof/unread?zero=1|0 · GET /__proof/requests
 *
 * Push avatar: `GET /push-avatar/ada` with `Authorization: PushAvatar <nonce>`
 * stands in for the cloud's nonce-gated push photo route (ADR 0010 S5). The
 * mock's own avatar route needs `?v=<hash>`, which the native fetcher rightly
 * refuses (no query strings), so the proxy serves the mock's synthetic PNG on a
 * query-free path and only for the one synthetic nonce the run posts.
 */
import { appendFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PORT = 54832;
const UNREAD_PATH = /\/v1\/messaging\/(unread|conversations)$/;
const [root, log] = process.argv.slice(2);
if (!root || !log)
	throw new Error("usage: node hub.ts <candidate-root> <requests-log>");

const { createTeamBridgeFixture } = (await import(
	pathToFileURL(join(root, "tools/mock-team-bridge.ts")).href
)) as typeof import("../../../tools/mock-team-bridge.ts");
const upstream = await createTeamBridgeFixture({}).listen({ port: 0 });

let zero = false;
export const PUSH_NONCE = "proofnonce0123456789AB";
const seen: { at: string; method: string; path: string }[] = [];

/** Every unread figure the hub contract carries, zeroed in place. */
function zeroUnread(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(zeroUnread);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, inner] of Object.entries(value)) {
			out[key] =
				(key === "unread" || key === "unread_count" || key === "total") &&
				typeof inner === "number"
					? 0
					: zeroUnread(inner);
		}
		return out;
	}
	return value;
}

const server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	if (url.pathname.startsWith("/__proof/")) {
		res.setHeader("content-type", "application/json");
		if (url.pathname === "/__proof/ping") {
			res.end(JSON.stringify({ ok: true, upstream: upstream.url }));
		} else if (url.pathname === "/__proof/unread") {
			zero = url.searchParams.get("zero") === "1";
			res.end(JSON.stringify({ zero }));
		} else if (url.pathname === "/__proof/requests") {
			res.end(JSON.stringify(seen));
		} else {
			res.statusCode = 404;
			res.end("{}");
		}
		return;
	}
	const entry = {
		at: new Date().toISOString(),
		method: req.method ?? "GET",
		path: url.pathname,
	};
	seen.push(entry);
	appendFileSync(log, `${JSON.stringify(entry)}\n`);
	if (url.pathname === "/push-avatar/ada") {
		if (req.headers.authorization !== `PushAvatar ${PUSH_NONCE}`) {
			res.statusCode = 401;
			res.end();
			return;
		}
		void fetch(
			`${upstream.url}/mock-hub/populated/v1/accounts/acct_ada_0002/avatar?v=0123456789abcdef&size=256`,
			{ headers: { authorization: "Bearer synthetic-push-avatar" } },
		).then(
			async (up) => {
				res.writeHead(up.status, {
					"content-type": up.headers.get("content-type") ?? "image/png",
				});
				res.end(Buffer.from(await up.arrayBuffer()));
			},
			() => {
				res.statusCode = 502;
				res.end();
			},
		);
		return;
	}
	const headers = { ...req.headers, host: new URL(upstream.url).host };
	delete headers["accept-encoding"];
	const proxied = request(
		`${upstream.url}${req.url}`,
		{ method: req.method, headers },
		(up) => {
			const unreadPath = UNREAD_PATH.test(url.pathname);
			if (!zero || !unreadPath || req.method !== "GET") {
				res.writeHead(up.statusCode ?? 502, up.headers);
				up.pipe(res);
				return;
			}
			const chunks: Buffer[] = [];
			up.on("data", (c: Buffer) => chunks.push(c));
			up.on("end", () => {
				const body = JSON.stringify(
					zeroUnread(JSON.parse(Buffer.concat(chunks).toString("utf8"))),
				);
				const outHeaders = { ...up.headers };
				delete outHeaders["content-length"];
				delete outHeaders.etag;
				res.writeHead(up.statusCode ?? 200, outHeaders);
				res.end(body);
			});
		},
	);
	proxied.on("error", () => {
		res.statusCode = 502;
		res.end();
	});
	req.pipe(proxied);
});
server.listen(PORT, "127.0.0.1", () =>
	console.log(`installed-proof hub on 127.0.0.1:${PORT} -> ${upstream.url}`),
);
