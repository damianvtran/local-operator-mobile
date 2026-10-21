/**
 * Loopback-only Team Bridge HTTP fixtures + exported web bundle. The actual
 * screens and actual hub client run unchanged. Response values mirror
 * agent-server internal/responses/{bridge,bridge_conversation}.go (321a7be),
 * including the {msg,result} envelope and coded failures. No real credential
 * can reach this server: its opted-in web client creates a synthetic token.
 *
 * Run: node tools/mock-team-bridge.ts <export-dir> <port>
 * Open /__phone?case=populated&theme=light (390x844 iframe viewport), then use
 * browser tool for interactions/screenshots. A fixture is NOT hub integration
 * or native-push evidence; README records those limits explicitly.
 */

import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import {
	ADA,
	agentDm,
	BEN,
	CY,
	conversation,
	dm,
	message,
	OTHER_TENANT,
	person,
	SELF,
	status,
	TENANT,
} from "../src/team-bridge/__tests__/fixtures.ts";

const MOCK_ROUTE = /^\/mock-hub\/([a-z_-]+)\/v1\/messaging(.*)$/;

const root = resolve(process.argv[2] ?? "dist");
const port = Number(process.argv[3] ?? 18743);
const conversations = [
	conversation({
		id: "bcv_humans",
		name: "humans",
		builtin: "humans",
		unread_count: 4,
		latest_seq: 9,
	}),
	conversation({
		id: "bcv_agents",
		name: "agents",
		builtin: "agents",
		unread_count: 0,
		notify: "mention",
	}),
	conversation({ id: "bcv_general", name: "general", unread_count: 2 }),
	conversation({
		id: "bcv_product",
		name: "product",
		unread_count: 0,
		muted: true,
		notify: "mute",
	}),
	conversation({
		id: "bcv_group",
		kind: "group",
		name: "Launch planning",
		visibility: "private",
		unread_count: 1,
	}),
	dm(ADA, "Ada", { unread_count: 3 }),
	agentDm(BEN, "Aida (Ben)", { unread_count: 1 }),
];
const people = [
	person(SELF, "Sam"),
	person(ADA, "Ada", {
		agent: { endpoint_id: "bep_ada", name: "Nova", state: "active" },
	}),
	person(BEN, "Ben", {
		agent: { endpoint_id: "bep_ben", name: "Aida", state: "active" },
	}),
	person(CY, "Cy", { bridge_enabled: false, bridge_state: "none" }),
];
const today = new Date();
today.setHours(9, 0, 0, 0);
const at = (minutes: number) =>
	new Date(today.getTime() + minutes * 60000).toISOString();
const thread = [
	message(1, ADA, at(-1440), {
		body: "Welcome to **Example Org**. This is where we plan work together.",
	}),
	message(2, SELF, at(-1438), {
		sender: { account_id: SELF, kind: "human", display_label: "Sam" },
		body: "Thanks! I'll share the mobile update here.",
	}),
	message(3, ADA, at(0), {
		sender: { account_id: ADA, kind: "human", display_label: "Ada" },
		body: "Morning! How is the new messaging surface coming along?",
	}),
	message(4, ADA, at(2), {
		sender: { account_id: ADA, kind: "human", display_label: "Ada" },
		body: "The checklist:\n- Organization switcher\n- People and chiefs of staff\n- Push notifications",
	}),
	message(5, BEN, at(10), {
		sender: { account_id: BEN, kind: "agent", display_label: "Aida" },
		origin: "agent",
		body: "I checked the API contract. The phone can talk to the hub directly — no laptop needed.",
	}),
	message(6, SELF, at(12), {
		sender: { account_id: SELF, kind: "human", display_label: "Sam" },
		body: "Great. I'll verify **light and dark** frames before review.",
	}),
];
let created = 0;
const histories = new Map(
	conversations.map((c) => [
		c.id,
		thread.map((m) => ({ ...m, conversation_id: c.id })),
	]),
);
// No bodies, headers or tokens: these counters prove first-send behaviour.
const requests: Array<{ method: string; path: string }> = [];
const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
		const send = (code: number, value: unknown) => {
			res.writeHead(code, {
				"content-type": "application/json",
				"cache-control": "no-store",
			});
			res.end(JSON.stringify(value));
		};
		const ok = (result: unknown) =>
			send(200, { msg: "Fixture answer", result });
		if (url.pathname === "/__phone") {
			const qaCase = url.searchParams.get("case") ?? "populated";
			const theme = url.searchParams.get("theme") ?? "light";
			const requestedWidth = url.searchParams.get("width") ?? "390";
			const phoneWidth = ["320", "390", "430"].includes(requestedWidth)
				? requestedWidth
				: "390";
			const route =
				url.searchParams.get("thread") === "1"
					? `/team-bridge/${TENANT}/bcv_humans`
					: "/team-bridge";
			res.writeHead(200, { "content-type": "text/html" });
			res.end(
				`<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0;background:#777;display:flex;justify-content:center;padding:8px}iframe{width:${phoneWidth}px;height:844px;border:0;transform:scale(.75);transform-origin:top center}</style><iframe title="Phone viewport" src="${route}?tb-fixture=${encodeURIComponent(qaCase)}&tb-theme=${encodeURIComponent(theme)}"></iframe><pre id="geometry" style="position:fixed;left:8px;top:8px;max-width:300px;white-space:pre-wrap;color:white;font:12px monospace"></pre><script>
const frame=document.querySelector('iframe');
setInterval(()=>{try{
 const doc=frame.contentDocument, win=frame.contentWindow;
 const controls=[...doc.querySelectorAll('[role="button"],button,input,textarea,[role="link"]')].map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.textContent?.trim().slice(0,45),width:Math.round(r.width),height:Math.round(r.height),disabled:e.getAttribute('aria-disabled')==='true'};});
 document.getElementById('geometry').textContent=JSON.stringify({viewport:[win.innerWidth,win.innerHeight],root:[doc.documentElement.scrollWidth,doc.documentElement.scrollHeight],controls},null,2);
}catch{}},1000);
</script>`,
			);
			return;
		}
		if (url.pathname === "/__stats") {
			ok({ created, requests });
			return;
		}
		const match = MOCK_ROUTE.exec(url.pathname);
		if (match) {
			const qaCase = match[1];
			const path = match[2] ?? "";
			requests.push({ method: req.method ?? "GET", path });
			if (qaCase === "loading" && path !== "/status" && path !== "/unread")
				await new Promise((r) => setTimeout(r, 12000));
			if (path === "/status") {
				if (qaCase === "unavailable") {
					send(503, {
						error: "Messaging is unavailable.",
						code: "messaging_unavailable",
					});
					return;
				}
				ok(
					status({
						api_version: qaCase === "update_required" ? "2" : "1",
						available: qaCase !== "plan_required",
						tenants: [
							{
								tenant_id: TENANT,
								tenant_name: "Example Org",
								eligible: qaCase !== "plan_required",
							},
							{
								tenant_id: OTHER_TENANT,
								tenant_name: "Research Lab",
								eligible: qaCase !== "plan_required",
							},
						],
					}),
				);
				return;
			}
			if (qaCase === "error") {
				send(500, {
					error: "Messaging could not be loaded.",
					code: "messaging_unavailable",
				});
				return;
			}
			if (path === "/unread") {
				ok({
					total: 11,
					organizations: [
						{
							tenant_id: TENANT,
							tenant_name: "Example Org",
							eligible: true,
							unread: 11,
						},
					],
				});
				return;
			}
			if (path === "/directory") {
				ok({
					members:
						qaCase === "empty" ||
						url.searchParams.get("tenant_id") === OTHER_TENANT
							? []
							: people,
				});
				return;
			}
			if (path === "/conversations" && req.method === "GET") {
				ok({
					conversations:
						qaCase === "empty" ||
						url.searchParams.get("tenant_id") === OTHER_TENANT
							? []
							: conversations,
					has_more: false,
				});
				return;
			}
			let raw = "";
			for await (const part of req) raw += part;
			const body = raw ? JSON.parse(raw) : {};
			if (path === "/conversations" && req.method === "POST") {
				created++;
				const row = dm(
					body.members?.[0]?.account_id ?? ADA,
					body.members?.[0]?.display_label ?? "Ada",
					{ id: `bcv_created_${created}`, latest_seq: 0, unread_count: 0 },
				);
				conversations.push(row);
				histories.set(row.id, []);
				ok(row);
				return;
			}
			const id = path.split("/")[2];
			const row = conversations.find((c) => c.id === id);
			const history = histories.get(id ?? "") ?? [];
			if (path.endsWith("/messages") && req.method === "GET") {
				ok({
					messages: qaCase === "empty" ? [] : history,
					has_more: false,
				});
				return;
			}
			if (path.endsWith("/messages") && req.method === "POST") {
				const msg = message(
					history.length + 1,
					SELF,
					new Date().toISOString(),
					{
						conversation_id: id,
						body: body.body,
						sender: { account_id: SELF, kind: "human", display_label: "Sam" },
					},
				);
				history.push(msg);
				histories.set(id ?? "", history);
				ok(msg);
				return;
			}
			if (path.endsWith("/read")) {
				ok({
					conversation_id: id,
					last_read_seq: body.seq ?? 0,
					unread_count: 0,
					muted: body.notify === "mute",
					notify: body.notify ?? "all",
				});
				return;
			}
			if (row) {
				ok(row);
				return;
			}
			send(404, {
				error: "Conversation not found",
				code: "conversation_not_found",
			});
			return;
		}
		try {
			let file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
			if (file !== root && !file.startsWith(root + sep)) {
				send(403, { error: "Forbidden" });
				return;
			}
			try {
				if ((await stat(file)).isDirectory())
					file = resolve(file, "index.html");
				await stat(file);
			} catch {
				file = resolve(root, "index.html");
			}
			const types: Record<string, string> = {
				".html": "text/html",
				".js": "application/javascript",
				".css": "text/css",
				".png": "image/png",
				".ttf": "font/ttf",
			};
			res.writeHead(200, {
				"content-type": types[extname(file)] ?? "application/octet-stream",
			});
			res.end(await readFile(file));
		} catch {
			res.writeHead(500);
			res.end("Fixture failed");
		}
	} catch {
		// Leaving a loading scene aborts its HTTP request. That is a normal
		// browser cancellation, not an unhandled rejection that kills QA's hub.
		if (!res.destroyed && !res.headersSent) {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "Fixture request interrupted" }));
		}
	}
});
server.listen(port, "127.0.0.1", () =>
	console.log(`Team Bridge QA listening on 127.0.0.1:${port}`),
);
