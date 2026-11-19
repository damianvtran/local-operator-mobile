#!/usr/bin/env node
/*
 * QA r1 local-operator-mobile #344 capture: the exported WEB build of the PR head,
 * served same-origin with a REAL `lop mobile serve` relay proxied behind it (the
 * repo's own tools/lib/static-server.ts), driven in installed headless Chrome.
 *
 *   node capture.mjs --repo <worktree> --dist <dir> --relay http://127.0.0.1:4398 \
 *     --port 8344 --out <frames dir> --label new --themes light,dark \
 *     --passes states[,loading,error,empty,remote]
 * Password: QA_RELAY_PASSWORD in env (never argv, never printed).
 * Chrome: --headless=new --use-mock-keychain --password-store=basic, throwaway profile,
 * spawned detached (own process group) and killed by exact pgid in finally.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const REPO = resolve(flag("repo"));
const DIST = resolve(flag("dist"));
const RELAY = flag("relay");
const PORT = Number(flag("port", "8344"));
const OUT = resolve(flag("out"));
const LABEL = flag("label", "new");
const THEMES = flag("themes", "light,dark").split(",");
const PASSES = flag("passes", "states").split(",");
const LIVE_CMD = flag("live-cmd", "");
const SESSION = "abcdef012345";
const CARDS = ["e_admit", "e_long", "e_held", "e_heldt", "e_refused", "e_deleted", "e_offline", "e_coal"];
const PW = process.env.QA_RELAY_PASSWORD ?? "";
if (!PW) throw new Error("QA_RELAY_PASSWORD missing");
mkdirSync(OUT, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${LABEL}]`, ...a);

const { serveDir } = await import(pathToFileURL(join(REPO, "tools/lib/static-server.ts")).href);
const served = await serveDir(DIST, { port: PORT, proxy: RELAY });
const ORIGIN = `http://127.0.0.1:${PORT}`;
log("serving", DIST, "at", ORIGIN, "proxy", RELAY);

const profile = mkdtempSync(join(process.env.QA_SCRATCH ?? "/tmp", "chrome-344-"));
const chrome = spawn("/usr/bin/google-chrome", [
	"--headless=new", "--use-mock-keychain", "--password-store=basic", `--user-data-dir=${profile}`,
	"--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
	"--disable-extensions", "--disable-background-networking", "about:blank",
], { detached: true, stdio: ["ignore", "ignore", "pipe"] });
writeFileSync(join(OUT, `chrome-${LABEL}.pid`), String(chrome.pid));
log("chrome pid/pgid", chrome.pid);
// run_bounded signals only ITS group; Chrome leads its own, so reap it on any signal too.
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { try { process.kill(-chrome.pid, "SIGKILL"); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(130); });
const wsUrl = await new Promise((res, rej) => {
	let buf = "";
	const t = setTimeout(() => rej(new Error("chrome devtools url timeout")), 60_000);
	chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
});

let ws; let nextId = 1; const pending = new Map(); const listeners = [];
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
	const id = nextId++; pending.set(id, { res, rej, method });
	ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const results = { label: LABEL, relay: RELAY, runs: [] };
try {
	ws = new WebSocket(wsUrl);
	await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
	ws.onmessage = (ev) => {
		const m = JSON.parse(ev.data);
		if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(`${p.method}: ${m.error.message}`)) : p.res(m.result); }
		else for (const l of listeners) l(m);
	};

	for (const pass of PASSES) for (const theme of THEMES) {
		const { targetId } = await send("Target.createTarget", { url: "about:blank" });
		const { sessionId: s } = await send("Target.attachToTarget", { targetId, flatten: true });
		const net = []; const api = [];
		const reqUrl = new Map();
		const onEvt = async (m) => {
			if (m.sessionId !== s) return;
			if (m.method === "Network.requestWillBeSent") reqUrl.set(m.params.requestId, m.params.request.url);
			if (m.method === "Network.loadingFailed") api.push(`FAILED ${m.params.errorText} ${(reqUrl.get(m.params.requestId) ?? "").replace(ORIGIN, "").slice(0, 120)}`);
			if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") api.push(`console ${JSON.stringify(m.params.args.map(a => a.value ?? a.description)).slice(0, 300)}`);
			if (m.method === "Network.responseReceived") {
				const u = m.params.response.url;
				if (!/_expo|\/assets\/|fonts|favicon/.test(u)) api.push(`${m.params.response.status} ${u.replace(ORIGIN, "").slice(0, 120)}`);
				if (/\/bridge-cards\//.test(u)) net.push({ url: u.replace(ORIGIN, ""), status: m.params.response.status, cache: m.params.response.headers["cache-control"] ?? m.params.response.headers["Cache-Control"] ?? null });
			}
			if (m.method === "Fetch.requestPaused") {
				const u = m.params.request.url; const rid = m.params.requestId;
				if (pass === "loading") { log("holding", u.replace(ORIGIN, "")); held.push(rid); return; }
				if (pass === "error" && /bridge-cards/.test(u)) { net.push({ url: u.replace(ORIGIN, ""), status: 503, injected: true }); return send("Fetch.fulfillRequest", { requestId: rid, responseCode: 503, body: Buffer.from('{"error":"qa injected"}').toString("base64") }, s); }
				if (pass === "empty" && /bridge-cards/.test(u)) { net.push({ url: u.replace(ORIGIN, ""), status: 200, injected: "items:[]" }); return send("Fetch.fulfillRequest", { requestId: rid, responseCode: 200, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from('{"v":1,"items":[],"more":0}').toString("base64") }, s); }
				if (pass === "remote" && m.params.responseStatusCode !== undefined) {
					// Response stage on the session list: mark THIS row remote (locality), the
					// only field isRemoteRow reads. Everything else is the real relay's bytes.
					const body = await send("Fetch.getResponseBody", { requestId: rid }, s);
					const text = body.base64Encoded ? Buffer.from(body.body, "base64").toString() : body.body;
					let out = text;
					try { const d = JSON.parse(text); for (const row of d.sessions ?? []) if (row.session_id === SESSION) row.locality = "remote"; out = JSON.stringify(d); remoteRewrites++; } catch {}
					return send("Fetch.fulfillRequest", { requestId: rid, responseCode: m.params.responseStatusCode, responseHeaders: m.params.responseHeaders, body: Buffer.from(out).toString("base64") }, s);
				}
				return send("Fetch.continueRequest", { requestId: rid }, s);
			}
		};
		const held = []; let remoteRewrites = 0;
		listeners.push(onEvt);
		await send("Network.enable", {}, s);
		await send("Page.enable", {}, s);
		await send("Runtime.enable", {}, s);
		if (pass === "loading" || pass === "error" || pass === "empty") await send("Fetch.enable", { patterns: [{ urlPattern: "*bridge-cards*", requestStage: "Request" }] }, s);
		if (pass === "remote") await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/sessions*", requestStage: "Response" }] }, s);
		await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, s);
		await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] }, s);
		const q = new URLSearchParams({ "lo-relay": ORIGIN, "lo-relay-password": PW, "lo-relay-insecure": "1" });
		await send("Page.navigate", { url: `${ORIGIN}${process.env.QA_NAV_PATH ?? `/session/${SESSION}`}?${q}` }, s);
		const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, s)).result.value;
		const shot = async (name) => {
			const { data } = await send("Page.captureScreenshot", { format: "png" }, s);
			const file = `${LABEL}-${pass}-${theme}-${name}.png`;
			writeFileSync(join(OUT, file), Buffer.from(data, "base64"));
			return file;
		};
		// Wait for the transcript: the first bridge row in the DOM.
		const t0 = Date.now(); let ready = false;
		while (Date.now() - t0 < Number(process.env.QA_READY_MS ?? 45000)) {
			if (await evalJs(`!!document.querySelector('[data-testid^="transcript-row-e_"],[data-testid^="transcript-row-peer-"]') || /Peer messages|ہم منصب|Team Bridge/.test(document.body.innerText)`)) { ready = true; break; }
			await pause(500);
		}
		const run = { pass, theme, ready, frames: [], probes: {}, net, api };
		results.runs.push(run);
		if (ready) {
			// The bridge rows sit in a collapsed "Peer messages · N" fold: frame it, then open it.
			await pause(1500);
			run.netBeforeFold = net.length;
			run.frames.push(await shot("fold-collapsed"));
			run.foldClick = await evalJs(`(() => { const e = document.querySelector('[data-testid^="transcript-row-e_"]') ? null : [...document.querySelectorAll('[role=button],button,[tabindex]')].find(x => /·\\s*8|8/.test(x.innerText) && x.innerText.length < 60); if (e) { e.click(); return e.innerText; } return null; })()`);
			const t1 = Date.now();
			while (Date.now() - t1 < 15000 && !(await evalJs(`!!document.querySelector('[data-testid^="transcript-row-e_"]')`))) await pause(400);
			run.rowsAfterFold = await evalJs(`[...document.querySelectorAll('[data-testid^="transcript-row-e_"]')].map(e => e.getAttribute('data-testid')).filter(x => !x.includes('-bridge-body'))`);
		}
		if (!ready) { run.frames.push(await shot("not-ready")); await evalJs(`(() => { const e = [...document.querySelectorAll("*")].find(x => x.childElementCount === 0 && /Show details/.test(x.textContent)); e?.click(); })()`); await pause(800); run.bodyText = await evalJs("document.body.innerText.slice(0,1500)"); run.frames.push(await shot("not-ready-details")); continue; }
		if (pass === "loading") {
			await pause(2500);
			run.held = held.length;
			run.frames.push(await shot("loading"));
			run.probes.loading = await evalJs(`[...document.querySelectorAll('[data-testid$="-bridge-body"]')].map(e=>e.innerText)`);
			for (const rid of held) await send("Fetch.continueRequest", { requestId: rid }, s).catch(() => {});
			await pause(1500);
			run.frames.push(await shot("after-release"));
		} else {
			await pause(3000);
			if (pass === "live") {
				// M1: deliver one card LIVE into the idle session while this page views it.
				const { spawnSync } = await import("node:child_process");
				const before = net.length;
				const r = spawnSync("bash", [LIVE_CMD], { encoding: "utf8", timeout: 170_000 });
				run.liveDriver = { status: r.status, out: (r.stdout ?? "").split("\n").filter(Boolean).slice(-8) };
				await pause(6000);
				await evalJs(`(() => { let e = document.querySelector('[data-testid^="transcript-row-"]'); while (e && !(e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))) e = e.parentElement; if (e) e.scrollTop = e.scrollHeight; })()`);
				await pause(1200);
				run.liveNet = net.slice(before);
				run.liveRows = await evalJs(`[...document.querySelectorAll('[data-testid^="transcript-row-peer-"]')].map(e => ({ id: e.getAttribute('data-testid'), text: e.innerText.slice(0, 200) }))`);
				run.frames.push(await shot("live-delivered"));
				listeners.splice(listeners.indexOf(onEvt), 1);
				await send("Target.closeTarget", { targetId });
				log(pass, theme, "live rows", run.liveRows.length, "live bridge-card responses", run.liveNet.length);
				continue;
			}
			for (const id of CARDS) {
				const info = await evalJs(`(async () => {
					const sel = '[data-testid="transcript-row-${id}"]';
					let row = document.querySelector(sel);
					// The list is virtualized: walk its scroller up, then down, until the row mounts.
					let sc = document.querySelector('[data-testid^="transcript-row-"]');
					while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
					for (let i = 0; !row && sc && i < 60; i++) { sc.scrollTop = i < 30 ? sc.scrollTop - 500 : sc.scrollTop + 500; await new Promise(r => setTimeout(r, 250)); row = document.querySelector(sel); }
					if (!row) return { present: false };
					row.scrollIntoView({ block: "start" });
					await new Promise(r => setTimeout(r, 700));
					const r = row.getBoundingClientRect();
					const body = row.querySelector('[data-testid="transcript-row-${id}-bridge-body"]');
					const more = row.querySelector('[data-testid^="transcript-row-${id}-bridge-body-more-"]');
					const over = [...row.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').length;
					return { present: true, row: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
						text: row.innerText.slice(0, 220), body: !!body, toggle: more ? { text: more.innerText, expanded: more.getAttribute('aria-expanded'), h: Math.round(more.getBoundingClientRect().height) } : null,
						hOverflowEls: over, rowScrollW: row.scrollWidth, rowClientW: row.clientWidth, dir: getComputedStyle(row).direction };
				})()`);
				run.probes[id] = info;
				if (info.present) run.frames.push(await shot(id));
				if (id === "e_long" && info.toggle) {
					await evalJs(`document.querySelector('[data-testid="transcript-row-e_long-bridge-body-more-0"]').click()`);
					await pause(800);
					run.probes.e_long_expanded = await evalJs(`(() => { const row = document.querySelector('[data-testid="transcript-row-e_long"]'); const r = row.getBoundingClientRect(); const t = document.querySelector('[data-testid="transcript-row-e_long-bridge-body-more-0"]'); return { rowH: Math.round(r.height), toggle: t && { text: t.innerText, expanded: t.getAttribute('aria-expanded') }, tail: row.innerText.slice(-120) }; })()`);
					run.frames.push(await shot("e_long-expanded"));
					// Scroll to the expanded body's end, so the full text and Show less are visible.
					await evalJs(`document.querySelector('[data-testid="transcript-row-e_long-bridge-body-more-0"]').scrollIntoView({block:'end'})`);
					await pause(600);
					run.frames.push(await shot("e_long-expanded-end"));
					await evalJs(`document.querySelector('[data-testid="transcript-row-e_long-bridge-body-more-0"]').click()`);
					await pause(600);
					run.probes.e_long_recollapsed = await evalJs(`(() => { const t = document.querySelector('[data-testid="transcript-row-e_long-bridge-body-more-0"]'); return t && { text: t.innerText, expanded: t.getAttribute('aria-expanded'), rowH: Math.round(document.querySelector('[data-testid="transcript-row-e_long"]').getBoundingClientRect().height) }; })()`);
				}
			}
			if (pass === "remote") run.remoteRewrites = remoteRewrites;
			run.htmlDir = await evalJs("document.documentElement.dir || getComputedStyle(document.body).direction");
		}
		listeners.splice(listeners.indexOf(onEvt), 1);
		await send("Target.closeTarget", { targetId });
		log(pass, theme, "ready", ready, "frames", run.frames.length, "bridge-card responses", net.length);
	}
} finally {
	writeFileSync(join(OUT, `results-${LABEL}.json`), JSON.stringify(results, null, 1));
	try { ws?.close(); } catch {}
	try { process.kill(-chrome.pid, "SIGKILL"); } catch {}
	await pause(800);
	let alive = true; try { process.kill(chrome.pid, 0); } catch { alive = false; }
	log("chrome pid", chrome.pid, "alive after kill:", alive);
	rmSync(profile, { recursive: true, force: true });
	await served.close();
}
