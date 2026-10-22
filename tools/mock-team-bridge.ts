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
import { deflateSync } from "node:zlib";
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
/** Upload/delete (`/conversations/:cid/attachments[/:aid]`) and the byte read
 *  (`/conversations/:cid/messages/:mid/attachments/:aid`). */
const ATTACHMENT_ROUTE =
	/^\/conversations\/[^/]+(\/messages\/[^/]+)?\/attachments(\/[^/]+)?$/;

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
/*
 * IMAGE ATTACHMENTS (opt-in cases only: every case whose name starts with
 * `attachments`). The other cases keep the pre-attachments hub exactly: no
 * `status.attachments` block, so the composer offers no attach affordance and
 * their frames do not move. Shapes mirror agent-server #170
 * (`BridgeAttachmentView`, the upload/send/byte routes); bytes are generated
 * PNGs held in memory, never read from or written to disk.
 *
 * - `attachments`: capability on; uploads stage, sends bind, bytes serve.
 *   `thread=1` history adds a 1-image, a 4-image, an image-only, an expired and
 *   an unavailable (unknown state) message.
 * - `attachments_uploading`: uploads hang 30 s (chips stay "uploading").
 * - `attachments_upload_failed`: uploads answer 503 (retryable failed chip).
 * - `attachments_upload_refused`: uploads answer 415 (final failed chip).
 * - `attachments_send_expired`: a send with images answers 404
 *   `attachment_not_found` (chips turn "expired", final).
 * - `attachments_fetch_error`: byte reads answer 500 ("did not load" + Retry).
 */
const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();
const pngChunk = (type: string, data: Buffer) => {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typed = Buffer.concat([Buffer.from(type), data]);
	let c = 0xffffffff;
	for (const byte of typed) c = (crcTable[(c ^ byte) & 255] ?? 0) ^ (c >>> 8);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
	return Buffer.concat([length, typed, crc]);
};
/** A soft two-colour gradient PNG; `hue` keeps the four images distinct. */
function fixturePng(width: number, height: number, hue: number): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	const raw = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y++) {
		const row = y * (width * 3 + 1);
		for (let x = 0; x < width; x++) {
			const t = (x / width + y / height) / 2;
			raw[row + 1 + x * 3] = Math.round(60 + 150 * t + hue) & 255;
			raw[row + 2 + x * 3] = Math.round(110 + 80 * (1 - t)) & 255;
			raw[row + 3 + x * 3] = Math.round(170 - 60 * t + hue / 2) & 255;
		}
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", deflateSync(raw)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}
type Stored = {
	bytes: Buffer;
	width: number;
	height: number;
	mime: "image/png" | "image/jpeg";
};
const images = new Map<string, Stored>();
const descriptor = (id: string, state?: string) => {
	const image = images.get(id);
	return {
		id,
		mime: image?.mime ?? "image/png",
		size: image?.bytes.length ?? 0,
		width: image?.width ?? 1024,
		height: image?.height ?? 768,
		sha256: "fixture",
		state: state ?? "bound",
		expires_at: at(60 * 24 * 400),
	};
};
const seed = (id: string, width: number, height: number, hue: number) => {
	images.set(id, {
		bytes: fixturePng(width, height, hue),
		width,
		height,
		mime: "image/png",
	});
	return id;
};
const showcase = () => [
	message(7, ADA, at(14), {
		sender: { account_id: ADA, kind: "human", display_label: "Ada" },
		body: "Here is the new onboarding screen.",
		attachments: [descriptor(seed("batt_one", 1024, 768, 0))],
	}),
	message(8, ADA, at(15), {
		sender: { account_id: ADA, kind: "human", display_label: "Ada" },
		body: "And the four variants we discussed:",
		attachments: [
			descriptor(seed("batt_four_a", 800, 800, 10)),
			descriptor(seed("batt_four_b", 768, 1024, 40)),
			descriptor(seed("batt_four_c", 1024, 576, 70)),
			descriptor(seed("batt_four_d", 640, 640, 100)),
		],
	}),
	message(9, SELF, at(16), {
		sender: { account_id: SELF, kind: "human", display_label: "Sam" },
		body: "",
		attachments: [descriptor(seed("batt_image_only", 900, 600, 30))],
	}),
	message(10, ADA, at(17), {
		sender: { account_id: ADA, kind: "human", display_label: "Ada" },
		body: "Last year's version, for comparison.",
		attachments: [descriptor("batt_expired", "expired")],
	}),
	message(11, BEN, at(18), {
		sender: { account_id: BEN, kind: "human", display_label: "Ben" },
		body: "This one is in a state this build does not know.",
		attachments: [descriptor("batt_unknown", "quarantined")],
	}),
];
let uploads = 0;
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
			const withImages = qaCase.startsWith("attachments");
			const attachmentRoute = ATTACHMENT_ROUTE.exec(path);
			if (withImages && attachmentRoute) {
				if (req.method === "POST") {
					const parts: Buffer[] = [];
					for await (const part of req) parts.push(part as Buffer);
					if (qaCase === "attachments_uploading")
						await new Promise((r) => setTimeout(r, 30000));
					if (qaCase === "attachments_upload_failed") {
						send(503, {
							error: "Messaging is unavailable.",
							code: "messaging_unavailable",
						});
						return;
					}
					if (qaCase === "attachments_upload_refused") {
						send(415, {
							error: "That image type is not supported.",
							code: "attachment_type_unsupported",
						});
						return;
					}
					uploads++;
					const id = `batt_upload_${uploads}`;
					const bytes = Buffer.concat(parts);
					// The phone already bounded it. A PNG's IHDR carries its true size;
					// a JPEG's is not parsed here, so its chip/bubble uses the 4:3 default.
					const isPng = bytes.length > 24 && bytes[0] === 0x89;
					images.set(id, {
						bytes,
						width: isPng ? bytes.readUInt32BE(16) : 1024,
						height: isPng ? bytes.readUInt32BE(20) : 768,
						mime: isPng ? "image/png" : "image/jpeg",
					});
					res.writeHead(201, { "content-type": "application/json" });
					res.end(
						JSON.stringify({
							msg: "Attachment staged",
							result: { attachment: descriptor(id, "staged") },
						}),
					);
					return;
				}
				if (req.method === "DELETE") {
					res.writeHead(204);
					res.end();
					return;
				}
				const id = attachmentRoute[2]?.slice(1) ?? "";
				const image = images.get(id);
				if (qaCase === "attachments_fetch_error") {
					send(500, { error: "Fixture byte read failed." });
					return;
				}
				if (!image) {
					send(404, {
						error: "Attachment not found",
						code: "attachment_not_found",
					});
					return;
				}
				// The real route's headers (agent-server #170 FetchHandlerEcho).
				res.writeHead(200, {
					"content-type": image.mime,
					"x-content-type-options": "nosniff",
					"cache-control": "private, no-store",
				});
				res.end(image.bytes);
				return;
			}
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
						...(withImages
							? {
									attachments: {
										enabled: true,
										max_count: 4,
										max_bytes: 5242880,
										max_pixels: 16777216,
										mime_types: ["image/png", "image/jpeg"],
									},
								}
							: {}),
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
				const shown =
					withImages && id === "bcv_humans"
						? [...history, ...showcase()]
						: history;
				ok({
					messages: qaCase === "empty" ? [] : shown,
					has_more: false,
				});
				return;
			}
			if (path.endsWith("/messages") && req.method === "POST") {
				const ids: string[] = body.attachment_ids ?? [];
				if (
					withImages &&
					ids.length > 0 &&
					qaCase === "attachments_send_expired"
				) {
					send(404, {
						error: "Attachment not found",
						code: "attachment_not_found",
					});
					return;
				}
				const msg = message(
					history.length + 1,
					SELF,
					new Date().toISOString(),
					{
						conversation_id: id,
						body: body.body,
						sender: { account_id: SELF, kind: "human", display_label: "Sam" },
						...(ids.length > 0
							? { attachments: ids.map((aid) => descriptor(aid)) }
							: {}),
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
