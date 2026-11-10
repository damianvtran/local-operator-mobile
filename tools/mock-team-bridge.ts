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
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { extname, resolve, sep } from "node:path";
import { deflateSync } from "node:zlib";
import {
	ADA,
	agentDm,
	BEN,
	CONSENT_V2,
	CY,
	conversation,
	deliveryFixtureHistory,
	dm,
	message,
	OTHER_TENANT,
	person,
	SELF,
	settings,
	status,
	TENANT,
} from "../src/team-bridge/__tests__/fixtures.ts";

import { fixtureWorld } from "../src/testing/team-bridge-options.ts";

import { TEAM_BRIDGE_FIXTURE_TOKEN } from "../src/testing/team-bridge-token.ts";
import { DEVICES } from "./visual/matrix.ts";

const MOCK_ROUTE = /^\/mock-hub\/([a-z0-9_~-]+)\/v1\/messaging(.*)$/;
/* The profile slice's avatar route sits beside messaging, not under it. */
const AVATAR_ROUTE =
	/^\/mock-hub\/([a-z0-9_~-]+)\/v1\/accounts\/([A-Za-z0-9_-]+)\/avatar$/;
/** Upload/delete (`/conversations/:cid/attachments[/:aid]`) and the byte read
 *  (`/conversations/:cid/messages/:mid/attachments/:aid`). */
const ATTACHMENT_ROUTE =
	/^\/conversations\/[^/]+(\/messages\/[^/]+)?\/attachments(\/[^/]+)?$/;

const ADA_HASH = "0123456789abcdef";
const LONG = "acct_long_0005";
/* Ben's row advertises a photo the hub then 404s: the "photo removed between
 * the directory read and the image read" case, which must render initials. */
const BEN_HASH = "fedcba9876543210";
/*
 * A synthetic 64x64 PNG, generated here rather than committed as an asset so
 * the fixture carries no image of anyone: a flat accent-coloured square.
 */
function syntheticPng(edge: number): Buffer {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (bytes: Buffer) => {
		let c = 0xffffffff;
		for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer) => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const sum = Buffer.alloc(4);
		sum.writeUInt32BE(crc(body));
		return Buffer.concat([length, body, sum]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(edge, 0);
	header.writeUInt32BE(edge, 4);
	header.set([8, 2, 0, 0, 0], 8);
	const row = Buffer.concat([
		Buffer.from([0]),
		Buffer.alloc(edge * 3, Buffer.from([0x2f, 0x6f, 0x5e])),
	]);
	const raw = Buffer.concat(Array.from({ length: edge }, () => row));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

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

/** Pure CLI mapping, shared with source lifecycle tests. */
export function fixtureArguments(args: string[]) {
	const port = Number(args[1] ?? 18743);
	if (!Number.isInteger(port) || port < 0 || port > 65535)
		throw new Error("invalid fixture port");
	return { root: resolve(args[0] ?? "dist"), port };
}

/** One fixture owns its world, sockets, waits and file reads. Importing this
 * module never listens; parent leases close this API normally, not via signals. */
export function createTeamBridgeFixture(options: { root?: string } = {}) {
	const root = resolve(options.root ?? "dist");
	let closing = false;
	let boundPort = 0;
	const io = new AbortController();
	const sockets = new Set<Socket>();
	const responses = new Set<ServerResponse>();
	const handlers = new Set<Promise<void>>();
	const waits = new Map<ServerResponse, () => void>();
	const waitForLoading = (res: ServerResponse) =>
		new Promise<boolean>((done) => {
			if (closing || res.destroyed) {
				done(false);
				return;
			}
			const finish = (ready: boolean) => {
				clearTimeout(timer);
				res.off("close", cancel);
				waits.delete(res);
				done(ready);
			};
			const cancel = () => finish(false);
			const timer = setTimeout(() => finish(true), 12_000);
			waits.set(res, cancel);
			res.once("close", cancel);
		});
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
			// `pronouns` is sent as the real hub sends it, to prove it is never shown.
			profile: {
				display_name: "Ada",
				title: "Staff engineer",
				description: "Builds the mobile client and reviews the hub contract.",
				timezone: "Europe/London",
				pronouns: "she/her",
				avatar: { hash: ADA_HASH },
			} as never,
			avatar_url: `/v1/accounts/${ADA}/avatar?v=${ADA_HASH}`,
		}),
		person(BEN, "Ben", {
			agent: { endpoint_id: "bep_ben", name: "Aida", state: "active" },
			profile: { title: "Founder", timezone: "Not/AZone" },
			avatar_url: `/v1/accounts/${BEN}/avatar?v=${BEN_HASH}`,
		}),
		person(CY, "Cy", { bridge_enabled: false, bridge_state: "none" }),
		/* Long values at the hub's own bounds (64-rune name, 80-rune title), so
		 * the card's wrapping can be judged at phone widths (design round 1, D1). */
		person(LONG, "Maximiliana Konstantinopoulou-Whitfield-Abernathy", {
			agent: {
				endpoint_id: "bep_long",
				name: "Wilhelmina the Extraordinarily Thorough",
				state: "active",
			},
			profile: {
				title: "Principal Programme Manager, Cross-Organisational Partnerships",
				description:
					"Coordinates partner launches across three regions and keeps the shared roadmap honest. See https://example.com/a-very-long-unbroken-reference-path-for-wrapping",
				timezone: "Asia/Tokyo",
			},
		}),
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
	// Long, paginated synthetic history exercises initial admission and prepend
	// through the same HTTP contract as the hub, never by injecting DOM rows.
	const polishHistories = new Map(
		conversations.map((c) => [
			c.id,
			Array.from({ length: 80 }, (_, index) =>
				message(index + 1, ADA, at(index), {
					conversation_id: c.id,
					body: `History ${index + 1}: synthetic release planning notes for the cross-organisation working group.`,
				}),
			),
		]),
	);
	let created = 0;
	const defaultHistories = new Map(
		conversations.map((c) => [
			c.id,
			thread.map((m) => ({ ...structuredClone(m), conversation_id: c.id })),
		]),
	);
	// No bodies, headers or tokens: these counters prove first-send behaviour.
	// Each synthetic world owns bytes, message bindings and retry attempts. Tokens
	// alone must not allow another flow/account to fetch or bind a staged upload.
	const createImageWorld = () => {
		type Stored = {
			conversationId: string;
			messageId?: string;
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
				conversationId: "bcv_humans",
				messageId:
					id === "batt_one"
						? "bcm_7"
						: id === "batt_image_only"
							? "bcm_9"
							: "bcm_8",
				bytes: fixturePng(width, height, hue),
				width,
				height,
				mime: "image/png",
			});
			return id;
		};
		const showcase = () =>
			[
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
			].map((row) => ({ ...row, conversation_id: "bcv_humans" }));
		return {
			images,
			descriptor,
			showcase,
			histories: new Map(
				conversations.map((row) => [
					row.id,
					structuredClone(defaultHistories.get(row.id) ?? []),
				]),
			),
			uploads: 0,
			attempts: 0,
		};
	};
	const imageWorlds = new Map<string, ReturnType<typeof createImageWorld>>();

	const requests: Array<{ method: string; path: string }> = [];
	const handle = async (
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> => {
		try {
			const url = new URL(req.url ?? "/", `http://127.0.0.1:${boundPort}`);
			const send = (code: number, value: unknown) => {
				if (closing || res.destroyed || res.writableEnded) return;
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
				const overrides = new URLSearchParams();
				for (const key of [
					"flow",
					"account",
					"org",
					"locale",
					"scale",
					"source",
				]) {
					const value = url.searchParams.get(key);
					if (value !== null) overrides.set(`tb-${key}`, value);
				}

				const phoneWidth = ["320", "360", "390", "430", "768"].includes(
					requestedWidth,
				)
					? requestedWidth
					: "390";
				// Deliberate preset selection, never arbitrary dimensions. Keep legacy
				// width-only phone links unchanged; tablets use the shared matrix.
				const device = url.searchParams.get("device");
				const profile =
					device === "tablet-768" || device === "tablet-768-landscape"
						? DEVICES[device]
						: undefined;
				const frameWidth = profile?.width ?? phoneWidth;
				const frameHeight = profile?.height ?? 844;
				const threadId =
					url.searchParams.get("conversation") === "group"
						? "bcv_group"
						: url.searchParams.get("conversation") === "dm"
							? dm(ADA, "Ada").id
							: "bcv_humans";
				const route =
					url.searchParams.get("thread") === "1"
						? `/team-bridge/${TENANT}/${threadId}`
						: "/team-bridge";
				const viewer = url.searchParams.get("viewer");
				const viewerParam = viewer
					? `&tb-viewer=${encodeURIComponent(viewer)}`
					: "";
				res.writeHead(200, { "content-type": "text/html" });
				res.end(
					`<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0;background:#777;display:flex;justify-content:center;padding:8px}iframe{width:${frameWidth}px;height:${frameHeight}px;border:0;transform:scale(.75);transform-origin:top center}</style><iframe title="Phone viewport" src="${route}?tb-fixture=${encodeURIComponent(qaCase)}&tb-theme=${encodeURIComponent(theme)}&${overrides.toString()}${viewerParam}"></iframe><pre id="geometry" style="position:fixed;left:8px;top:8px;max-width:300px;white-space:pre-wrap;color:white;font:12px monospace"></pre><script>
const frame=document.querySelector('iframe');
setInterval(()=>{try{
 const doc=frame.contentDocument, win=frame.contentWindow;
 const controls=[...doc.querySelectorAll('[role="button"],button,input,textarea,[role="link"]')].map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.textContent?.trim().slice(0,45),x:Math.round(r.x),right:Math.round(r.right),width:Math.round(r.width),height:Math.round(r.height),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,disabled:e.getAttribute('aria-disabled')==='true'};});
 document.getElementById('geometry').textContent=JSON.stringify({locale:doc.documentElement.lang,direction:doc.documentElement.dir,noticeBodySize:win.getComputedStyle(doc.querySelector('[data-testid="team-bridge-default-on-notice"] [role="status"] > :last-child')||doc.body).fontSize,viewport:[win.innerWidth,win.innerHeight],root:[doc.documentElement.scrollWidth,doc.documentElement.scrollHeight],controls,headings:[...doc.querySelectorAll('[role="heading"],h1')].map(e=>({name:e.textContent,size:win.getComputedStyle(e).fontSize,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),transcript:(()=>{const e=doc.querySelector('[data-testid="team-bridge-messages"]');if(!e)return null;const r=e.getBoundingClientRect();return {scrollTop:e.scrollTop,clientHeight:e.clientHeight,contentHeight:e.scrollHeight,visible:[...e.querySelectorAll('[data-testid^="team-bridge-message-"]')].filter(n=>{const b=n.getBoundingClientRect();return b.bottom>r.top&&b.top<r.bottom}).map(n=>n.getAttribute('data-testid'))}})()},null,2);
}catch{}},1000);
</script>`,
				);
				return;
			}
			if (url.pathname === "/__stats") {
				ok({ created, requests });
				return;
			}
			const avatar = AVATAR_ROUTE.exec(url.pathname);
			if (avatar) {
				// Counted like every hub call, without the bearer, so a capture can
				// show reads are bounded (no retry storm on the 404).
				requests.push({
					method: req.method ?? "GET",
					path: `${url.pathname}${url.search}`,
				});
				const bearer = req.headers.authorization ?? "";
				const authorized =
					avatar[1] !== "revoked" &&
					(process.env.MOCK_TEAM_BRIDGE_STRICT === "1"
						? bearer === `Bearer ${TEAM_BRIDGE_FIXTURE_TOKEN}`
						: bearer.startsWith("Bearer "));
				if (!authorized) {
					send(401, { error: "invalid or expired token" });
					return;
				}
				if (avatar[2] !== ADA || url.searchParams.get("v") !== ADA_HASH) {
					send(404, { error: "Not found" });
					return;
				}
				const size = url.searchParams.get("size") === "256" ? 256 : 64;
				res.writeHead(200, {
					"content-type": "image/png",
					"cache-control": "private, max-age=31536000, immutable",
					vary: "Authorization",
				});
				res.end(syntheticPng(size));
				return;
			}
			const match = MOCK_ROUTE.exec(url.pathname);
			if (match) {
				const world = fixtureWorld(match[1] ?? "");
				const qaCase = world.scenario;
				const noticeTenant = world.secondOrg ? OTHER_TENANT : TENANT;
				const path = match[2] ?? "";
				requests.push({ method: req.method ?? "GET", path });
				if (
					qaCase?.startsWith("notice_") &&
					req.headers.authorization !==
						`Bearer ${world.token ?? TEAM_BRIDGE_FIXTURE_TOKEN}`
				) {
					send(401, { error: "invalid or expired token" });
					return;
				}
				if (qaCase === "loading" && path !== "/status" && path !== "/unread")
					if (!(await waitForLoading(res))) return;
				const withImages = (qaCase ?? "").startsWith("attachments");
				const worldKey = match[1] ?? "";
				let imageWorld = imageWorlds.get(worldKey);
				if (!imageWorld) {
					imageWorld = createImageWorld();
					imageWorlds.set(worldKey, imageWorld);
				}
				const { images, descriptor, showcase } = imageWorld;
				const histories = withImages
					? imageWorld.histories
					: qaCase === "thread_polish"
						? polishHistories
						: defaultHistories;
				const threadRows =
					qaCase === "thread_polish"
						? conversations.map((row) => ({
								...row,
								name:
									row.kind === "dm"
										? row.name
										: row.kind === "group"
											? "Launch planning and cross-organisation programme coordination"
											: "international-partnerships-and-launch-planning",
								members: row.members?.map((member) => ({
									...member,
									display_label:
										"Maximiliana Konstantinopoulou-Whitfield-Abernathy",
								})),
							}))
						: conversations;
				if (
					withImages &&
					req.headers.authorization !==
						`Bearer ${world.token ?? TEAM_BRIDGE_FIXTURE_TOKEN}`
				) {
					send(401, { error: "invalid or expired token" });
					return;
				}
				const attachmentRoute = ATTACHMENT_ROUTE.exec(path);
				if (withImages && attachmentRoute) {
					const conversationId = path.split("/")[2] ?? "";
					if (url.searchParams.get("tenant_id") !== noticeTenant) {
						send(403, { error: "Wrong organization", code: "not_a_member" });
						return;
					}
					if (!conversations.some((row) => row.id === conversationId)) {
						send(404, {
							error: "Conversation not found",
							code: "conversation_not_found",
						});
						return;
					}
					if (req.method === "POST") {
						const parts: Buffer[] = [];
						for await (const part of req) parts.push(part as Buffer);
						imageWorld.attempts++;
						if (
							qaCase === "attachments_upload_plan" ||
							qaCase === "attachments_upload_membership"
						) {
							send(403, {
								error: "Synthetic upload authority refused",
								code:
									qaCase === "attachments_upload_plan"
										? "bridge_not_available"
										: "not_a_member",
							});
							return;
						}
						if (qaCase === "attachments_upload_unauthorized") {
							send(401, { error: "Synthetic session retired" });
							return;
						}
						if (
							qaCase === "attachments_upload_retry" &&
							imageWorld.attempts === 1
						) {
							send(500, {
								error: "Synthetic upload failed",
								code: "internal_error",
							});
							return;
						}
						if (qaCase === "attachments_uploading")
							if (!(await waitForLoading(res))) return;
						if (qaCase === "attachments_upload_failed") {
							send(503, {
								error: "Messaging is unavailable.",
								code: "messaging_unavailable",
							});
							return;
						}
						if (qaCase === "attachments_quota") {
							send(409, {
								error: "Too many images are waiting to be sent.",
								code: "attachment_quota_exceeded",
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
						imageWorld.uploads++;
						const id = `batt_upload_${imageWorld.uploads}`;
						const bytes = Buffer.concat(parts);
						if (bytes.length > 5242880) {
							send(413, {
								error: "Image too large",
								code: "attachment_too_large",
							});
							return;
						}
						const png = bytes
							.subarray(0, 8)
							.equals(
								Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
							);
						const jpeg =
							bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
						if (!png && !jpeg) {
							send(415, {
								error: "Unsupported image",
								code: "attachment_type_unsupported",
							});
							return;
						}
						// The phone already bounded it. A PNG's IHDR carries its true size;
						// a JPEG's is not parsed here, so its chip/bubble uses the 4:3 default.
						const isPng = bytes.length > 24 && bytes[0] === 0x89;
						images.set(id, {
							conversationId,
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
						const stored = images.get(attachmentRoute[2]?.slice(1) ?? "");
						if (stored?.conversationId === conversationId && !stored.messageId)
							images.delete(attachmentRoute[2]?.slice(1) ?? "");
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
					if (
						!image ||
						image.conversationId !== conversationId ||
						image.messageId !== path.split("/")[4]
					) {
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
							// Notice fixtures model a server-enrolled endpoint. The client must
							// never create consent or send an enabling PUT merely by mounting.
							...(qaCase?.startsWith("notice_") ? { consent: CONSENT_V2 } : {}),
							api_version: qaCase === "update_required" ? "2" : "1",
							available: qaCase !== "plan_required",
							tenants: [
								{
									tenant_id: noticeTenant,
									tenant_name: "Example Org",
									eligible: qaCase !== "plan_required",
								},
								{
									tenant_id: world.secondOrg ? TENANT : OTHER_TENANT,
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
				if (path === "/settings" && qaCase?.startsWith("notice_")) {
					if (
						url.searchParams.get("tenant_id") !== noticeTenant &&
						req.method === "GET"
					) {
						send(403, { error: "Wrong organization", code: "not_a_member" });
						return;
					}
					if (req.method === "GET") {
						ok(settings(qaCase === "notice_dialog" ? "dialog" : "default_on"));
						return;
					}
					if (req.method === "PUT") {
						let raw = "";
						for await (const part of req) raw += part;
						const body = JSON.parse(raw);
						if (
							body.state !== "disabled" ||
							body.tenant_id !== noticeTenant ||
							Object.keys(body).length !== 2
						) {
							send(400, {
								error: "Only an explicit scoped opt-out is supported",
							});
						} else if (qaCase === "notice_error") {
							send(500, { error: "Fixture opt-out failed" });
						} else {
							if (qaCase === "notice_pending") await waitForLoading(res);
							ok(settings("default_on", { state: "disabled" }));
						}
						return;
					}
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
							url.searchParams.get("tenant_id") ===
								(withImages
									? world.secondOrg
										? TENANT
										: OTHER_TENANT
									: OTHER_TENANT)
								? []
								: people,
					});
					return;
				}
				if (path === "/conversations" && req.method === "GET") {
					ok({
						conversations:
							qaCase === "empty" ||
							url.searchParams.get("tenant_id") ===
								(withImages
									? world.secondOrg
										? TENANT
										: OTHER_TENANT
									: OTHER_TENANT)
								? []
								: threadRows,
						has_more: false,
					});
					return;
				}
				let raw = "";
				for await (const part of req) {
					if (closing || res.destroyed) return;
					raw += part;
				}
				if (closing || res.destroyed) return;
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
				const row = threadRows.find((c) => c.id === id);
				const history = histories.get(id ?? "") ?? [];
				if (path.endsWith("/messages") && req.method === "GET") {
					// Read failures remain non-2xx, never fake legacy projection absence.
					if (qaCase === "delivery-read-error") {
						send(500, {
							error: "Synthetic message read failed.",
							code: "internal_error",
						});
						return;
					}
					if (qaCase === "thread_polish") {
						const before = Number(
							url.searchParams.get("before_seq") ?? Number.MAX_SAFE_INTEGER,
						);
						const eligible = history.filter((entry) => entry.seq < before);
						const page = eligible.slice(-50).reverse();
						ok({ messages: page, has_more: eligible.length > page.length });
						return;
					}
					ok({
						messages:
							qaCase === "empty" || qaCase === "thread_empty"
								? []
								: (deliveryFixtureHistory(qaCase ?? "", id ?? "") ??
									(withImages && id === "bcv_humans"
										? [...history, ...showcase()]
										: history)),
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
					if (withImages && body.tenant_id !== noticeTenant) {
						send(403, { error: "Wrong organization", code: "not_a_member" });
						return;
					}
					if (
						withImages &&
						(!row ||
							ids.length > 4 ||
							ids.some(
								(aid) =>
									images.get(aid)?.conversationId !== id ||
									images.get(aid)?.messageId,
							))
					) {
						send(404, {
							error: "Attachment not found",
							code: "attachment_not_found",
						});
						return;
					}
					const msg = message(
						withImages
							? Math.max(11, ...history.map((entry) => entry.seq)) + 1
							: history.length + 1,
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
					for (const aid of ids) {
						const image = images.get(aid);
						if (image) image.messageId = msg.id;
					}
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
				if (closing || res.destroyed) return;
				const bytes = await readFile(file, { signal: io.signal });
				if (closing || res.destroyed) return;
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
				res.end(bytes);
			} catch {
				if (closing || res.destroyed || res.writableEnded) return;
				res.writeHead(500);
				res.end("Fixture failed");
			}
		} catch {
			// Leaving a loading scene aborts its HTTP request. That is a normal
			// browser cancellation, not an unhandled rejection that kills QA's hub.
			if (!closing && !res.destroyed && !res.headersSent) {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "Fixture request interrupted" }));
			}
		}
	};
	const server = createServer((req, res) => {
		if (closing) {
			res.destroy();
			return;
		}
		responses.add(res);
		const task = handle(req, res);
		handlers.add(task);
		const settled = () => {
			handlers.delete(task);
			responses.delete(res);
		};
		void task.then(settled, settled);
	});
	const connected = (socket: Socket) => {
		// A connection already queued by Node can arrive during starting/closing.
		// It still belongs to this fixture and must not outlive its normal close.
		if (closing) {
			socket.destroy();
			return;
		}
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	};
	server.on("connection", connected);
	let starting:
		| Promise<{ host: string; port: number; url: string }>
		| undefined;
	let disposal: Promise<void> | undefined;
	return {
		listen({
			host = "127.0.0.1",
			port = 0,
		}: {
			host?: string;
			port?: number;
		} = {}) {
			if (closing) return Promise.reject(new Error("fixture is closed"));
			if (
				host !== "127.0.0.1" ||
				!Number.isInteger(port) ||
				port < 0 ||
				port > 65535
			) {
				return Promise.reject(new Error("invalid fixture listen address"));
			}
			if (starting) return starting;
			starting = new Promise((done, reject) => {
				const failed = (error: Error) => {
					server.off("listening", ready);
					reject(error);
				};
				const ready = () => {
					server.off("error", failed);
					const address = server.address();
					if (!address || typeof address === "string") {
						reject(new Error("fixture address unavailable"));
						return;
					}
					boundPort = address.port;
					if (closing) {
						reject(new Error("fixture closed while starting"));
						return;
					}
					done({ host, port: boundPort, url: `http://${host}:${boundPort}` });
				};
				server.once("error", failed);
				server.once("listening", ready);
				server.listen(port, host);
			});
			return starting;
		},
		close(): Promise<void> {
			if (disposal) return disposal;
			// Fence writes and new admissions synchronously, before awaiting anything.
			closing = true;
			io.abort();
			for (const cancel of waits.values()) cancel();
			for (const response of responses) response.destroy();
			for (const socket of sockets) socket.destroy();
			const drain = (async () => {
				// A rejected bind remains visible to listen()'s caller; disposal still
				// owns any partial listener and must not skip its normal close path.
				if (starting) await starting.catch(() => undefined);
				if (server.listening)
					await new Promise<void>((done, reject) => {
						server.close((error) => (error ? reject(error) : done()));
					});
				const drained = await Promise.allSettled([...handlers]);
				server.off("connection", connected);
				waits.clear();
				responses.clear();
				sockets.clear();
				handlers.clear();
				defaultHistories.clear();
				imageWorlds.clear();
				conversations.splice(0);
				people.splice(0);
				requests.splice(0);
				created = 0;
				if (drained.some((result) => result.status === "rejected"))
					throw new Error("fixture handler drain failed");
			})();
			// A stuck OS callback is a failed closure, never a timer-based success.
			// Owned sockets/IO were already retired synchronously above.
			disposal = new Promise<void>((done, reject) => {
				const deadline = setTimeout(
					() => reject(new Error("fixture close deadline exceeded")),
					10_000,
				);
				void drain.then(
					() => {
						clearTimeout(deadline);
						done();
					},
					(error: unknown) => {
						clearTimeout(deadline);
						reject(error);
					},
				);
			});
			return disposal;
		},
	};
}

if (import.meta.main) {
	const { root, port } = fixtureArguments(process.argv.slice(2));
	const fixture = createTeamBridgeFixture({ root });
	const address = await fixture.listen({ port });
	console.log(`Team Bridge QA listening on ${address.host}:${address.port}`);
}
