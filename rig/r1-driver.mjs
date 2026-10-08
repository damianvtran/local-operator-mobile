/**
 * The asks-sheet open-policy evidence rig — SCRATCH, outside every repo.
 *
 * WHAT IT DOES. Drives the repo's own web-target harness pieces at phone size
 * over CDP and produces, for BOTH builds (before = the pre-change export,
 * after = this branch's export), the four-state matrix the operator asked for:
 *
 *   1. no asks          -> sheet closed
 *   2. pending on open  -> sheet OPEN (after) / bar only (before)
 *   3. all addressed    -> sheet closed
 *   4. dismissed        -> stays closed, incl. after leave-and-re-enter (after only;
 *                          the before build can never enter this state — nothing opens)
 *
 * HOW IT REUSES, RATHER THAN RESEMBLES, THE HARNESS:
 *  - `tools/mock-relay/relay.ts`   the repo's mock relay, in-process. Its scenario
 *    registry is a plain object, so this rig ADDS three scratch scenarios to the
 *    instance instead of editing the repo (PR #53 owns those files).
 *  - `tools/lib/static-server.ts`  `serveDir` — the same SPA-aware static server +
 *    same-origin relay proxy the capture harness serves cells from.
 *  - `tools/lib/chrome.ts`         `launchChrome` — headless, `--use-mock-keychain`,
 *    throwaway profile in the scratchpad, process-group teardown by exact pid.
 *
 * THE ONE BRIDGE, named so nobody mistakes it for harness behaviour: the mock
 * relay has no `GET /api/asks` route (a pre-existing gap noted in
 * `tools/mock-relay/transcribe.ts`), so a thin in-process facade sits between
 * `serveDir`'s proxy and the relay and answers THAT ONE ROUTE from the pinned
 * scenario's own rows. Everything else is a straight pipe to the relay.
 *
 * Run:  WT=<worktree> node rig.mjs
 */
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WT = process.env.WT;
const SCRATCH = process.env.LOCAL_OPERATOR_SCRATCHPAD;
if (!WT || !SCRATCH) throw new Error("WT and LOCAL_OPERATOR_SCRATCHPAD are required");
const OUT = join(SCRATCH, "evidence", "frames");
mkdirSync(OUT, { recursive: true });

const imp = (rel) => import(pathToFileURL(join(WT, rel)).href);
const { createRelay, DEFAULT_PASSWORD } = await imp("tools/mock-relay/relay.ts");
const { serveDir } = await imp("tools/lib/static-server.ts");
const { launchChrome } = await imp("tools/lib/chrome.ts");

const SESSION = "6714def86197";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- the relay -- */

const relay = createRelay({ password: DEFAULT_PASSWORD, quiet: true });
const relayHandle = await relay.listen();
const relayUrl = relayHandle.url;

/* The scratch scenarios. `asks` + `asks_open` are the published wire fields; the
 * legacy `pending` mirror stays exactly as captured (the app ignores it for asks
 * once `asks` is published — `blockingPending`). */
const askProjection = relay.fixtures.projection("sse-projection-asks");
const worldWith = (mutate) => {
	const projection = structuredClone(askProjection);
	/* The corpus row's `expires_at` is a fixed instant in the past, so a frame
	 * taken today would show "deadline passed 8 d ago". Move it into the future
	 * for the frames (the state under test is "a question is waiting", not "the
	 * corpus was captured on a Tuesday"); `created_at` stays old, which is what
	 * the policy's arrival test reads. */
	if (Array.isArray(projection.asks) && projection.asks.length > 0) {
		projection.asks[0].expires_at = Date.now() + 15 * 60 * 1000;
	}
	mutate(projection);
	return { projections: { [SESSION]: projection } };
};
const SCENARIOS = {
	"ev-none": {
		world: () =>
			worldWith((p) => {
				p.asks = [];
				p.asks_open = 0;
				quiet(p);
			}),
	},
	"ev-open": { world: () => worldWith(() => {}) },
	"ev-answered": {
		world: () =>
			worldWith((p) => {
				p.asks[0].status = "answered";
				p.asks[0].delivered = true;
				p.asks_open = 0;
				quiet(p);
			}),
	},
};

/** The corpus's own `activity` line is "continuing while a question waits" — the
 *  runtime's folded string — and its legacy `pending` mirror still names the ask.
 *  Both are true of the PENDING state and false of a queue with nothing in it, so
 *  the states with no outstanding ask clear them; a frame that kept them would
 *  tell a reviewer a question was waiting beside a closed sheet (measured: the
 *  first `ev-none` frames did exactly that). */
function quiet(projection) {
	projection.pending = null;
	projection.pending_count = 0;
	projection.activity = "";
	projection.activity_started_s = null;
	projection.streaming = false;
}
for (const [name, spec] of Object.entries(SCENARIOS)) {
	relay.scenarios[name] = {
		name,
		description: `evidence rig scratch state: ${name}`,
		shows: [],
		world: spec.world,
	};
}

/* ------------------------------------------------------------------ facade -- */

/** The rows `GET /api/asks` answers for the pinned scenario. The aggregate route
 *  carries `session_id`/`cwd` on every row (that is what makes foreign rows
 *  answerable), so the facade serves the corpus row plus those two columns. */
const EVT = { delayMs: 0, createdNow: false, logged: false, failAsks: false };
let askRows = [];
const aggregateRow = () => {
	const row = structuredClone(askProjection.asks[0]);
	row.session_id = SESSION;
	row.cwd = "~/work";
	/* Same freshness as the world's copy: the sheet renders the deadline from THIS
	 * row, and the corpus's fixed instant is 8 days past — a frame would read
	 * "deadline passed 8 d ago" over a state that is really "waiting". */
	row.expires_at = Date.now() + 15 * 60 * 1000;
	return row;
};

const facade = createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? "/", "http://facade.invalid");
		if (url.pathname === "/api/asks" && req.method === "GET" && EVT.failAsks) {
			res.writeHead(503, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "unavailable" }));
			return;
		}
		if (url.pathname === "/api/asks" && req.method === "GET") {
			res.writeHead(200, {
				"content-type": "application/json",
				"cache-control": "no-store",
			});
			res.end(JSON.stringify({ asks: askRows, asks_truncated: false }));
			return;
		}
		/* U2 rig: hold the session event stream for EVT.delayMs (the seed arrives
		 * that long after the view began) and, when EVT.createdNow is set, stamp
		 * the fixture ask's created_at with the instant the frame is SENT. */
		const isEvents = /^\/api\/sessions\/[^/]+\/events$/.test(url.pathname);
		if (isEvents && EVT.delayMs > 0) await sleep(EVT.delayMs);
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const headers = {};
		for (const [key, value] of Object.entries(req.headers)) {
			if (key === "host" || value === undefined) continue;
			headers[key] = Array.isArray(value) ? value.join(", ") : value;
		}
		const upstream = await fetch(`${relayUrl}${url.pathname}${url.search}`, {
			method: req.method,
			headers,
			body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
			redirect: "manual",
		});
		const out = {};
		upstream.headers.forEach((value, key) => {
			if (key === "content-length" || key === "content-encoding") return;
			out[key] = value;
		});
		const cookies = upstream.headers.getSetCookie?.() ?? [];
		res.writeHead(
			upstream.status,
			cookies.length > 0 ? { ...out, "set-cookie": cookies } : out,
		);
		if (upstream.body === null) {
			res.end();
			return;
		}
		for await (const chunk of upstream.body) {
			if (isEvents && EVT.createdNow) {
				const text = Buffer.from(chunk).toString("utf8").split("1790727000000").join(String(Date.now()));
				res.write(text);
				if (!EVT.logged) { EVT.logged = true; console.log("   [facade] seed sent at", Date.now()); }
			} else res.write(chunk);
		}
		res.end();
	} catch (error) {
		/* A response already streaming when the browser goes away is torn down,
		 * not re-headed: `writeHead` after the headers is an uncaught crash, and it
		 * took the whole rig's teardown down once (the frames and results were
		 * already on disk, but the process exited 1). */
		try {
			if (!res.headersSent) {
				res.writeHead(500, { "content-type": "text/plain" });
				res.end(String(error));
			} else {
				res.destroy();
			}
		} catch {
			/* the socket is already gone */
		}
	}
});
await new Promise((r) => facade.listen(0, "127.0.0.1", r));
const facadeOrigin = `http://127.0.0.1:${facade.address().port}`;

/** The app's writes hop browser -> serveDir -> facade -> relay, so the relay sees
 *  the FACADE's origin (each hop rewrites `origin`, as `serveDir` documents). */
relay.state.allowedOrigins = [
	...(relay.state.allowedOrigins ?? []),
	facadeOrigin,
];

async function pin(scenario) {
	askRows =
		scenario === "ev-open"
			? [aggregateRow()]
			: scenario === "ev-answered"
				? [{ ...aggregateRow(), status: "answered", delivered: true }]
				: [];
	const res = await fetch(new URL("/__mock/scenario", relayUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ scenario }),
	});
	if (!res.ok) throw new Error(`scenario pin failed: ${scenario} (${res.status})`);
}

/* ------------------------------------------------------------------ checks -- */

const SHEET_VISIBLE = `(() => {
  const el = document.querySelector('[data-testid="asks-sheet"]');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 100 || r.height < 100) return false;
  const s = getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
})()`;
const BAR_VISIBLE = `(() => {
  const el = document.querySelector('[data-testid="ask-bar"]');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
})()`;
const HAS = (id) => `!!document.querySelector('[data-testid="${id}"]')`;

async function poll(page, expr, timeout = 15000) {
	const deadline = Date.now() + timeout;
	for (;;) {
		let ok = false;
		try {
			ok = (await page.evaluate(expr)) === true;
		} catch {
			ok = false; // a mid-navigation context is not a result
		}
		if (ok) return true;
		if (Date.now() > deadline) return false;
		await sleep(200);
	}
}

async function click(page, testid) {
	if (!(await poll(page, HAS(testid), 15000))) {
		throw new Error(`no [data-testid="${testid}"] to click`);
	}
	const box = await page.evaluate(`(() => {
    const el = document.querySelector('[data-testid="${testid}"]');
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
	await page.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: box.x,
		y: box.y,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await page.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: box.x,
		y: box.y,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
}


/* ======================= round-1 remediation driver ======================= */
import { mkdirSync as mk } from "node:fs";
const FR = join(SCRATCH, "evidence", "r1-frames");
mk(FR, { recursive: true });
const BUILDS = {
  old: join(SCRATCH, "dist-025da93"),
  new: join(SCRATCH, "dist-new"),
};
const served = {};
for (const [k, d] of Object.entries(BUILDS)) {
  served[k] = await serveDir(d, { proxy: facadeOrigin });
  relay.state.allowedOrigins = [...(relay.state.allowedOrigins ?? []), served[k].url];
}
const DEV = {
  "iphone-15": { width: 390, height: 844, dpr: 3, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
  "iphone-se": { width: 320, height: 568, dpr: 2, insets: { top: 20, bottom: 0, left: 0, right: 0 } },
};
const ACTIVE = `(() => { const a = document.activeElement; return a ? (a.getAttribute('data-testid') || a.tagName) : null })()`;
const SHEET_TEXT = `(() => { const el = document.querySelector('[data-testid="asks-sheet"]'); return el ? el.innerText : '' })()`;
const frameLog = [];
async function snap(page, name) {
  const cap = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const bytes = Buffer.from(cap.data, "base64");
  writeFileSync(join(FR, `${name}.png`), bytes);
  const sha = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  frameLog.push({ name, sha });
  return sha;
}
async function open(chrome, build, { device = "iphone-15", theme = "dark", scenario = "ev-open", delayMs = 0, createdNow = false, failAsks = false, preDwell = 0 }) {
  EVT.delayMs = delayMs; EVT.createdNow = createdNow; EVT.logged = false; EVT.failAsks = failAsks;
  await pin(scenario);
  const d = DEV[device];
  const page = await chrome.page("about:blank");
  await page.send("Page.enable"); await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: d.width, height: d.height, deviceScaleFactor: d.dpr, mobile: true, screenWidth: d.width, screenHeight: d.height });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
  try { await page.send("Emulation.setSafeAreaInsetsOverride", { insets: d.insets }); } catch {}
  const seed = new URLSearchParams({ "lo-relay": served[build].url, "lo-relay-password": DEFAULT_PASSWORD, "lo-relay-insecure": "1" });
  await page.send("Page.navigate", { url: `${served[build].url}/conversations?${seed}` });
  if (!(await poll(page, HAS("sessions-screen"), 30000))) throw new Error("no list");
  if (!(await poll(page, HAS(`session-row-${SESSION}`), 20000))) throw new Error("no row");
  await sleep(900);
  await click(page, `session-row-${SESSION}`);
  await poll(page, HAS("session-screen"), 20000);
  return page;
}
const results = [];
const rec = (r) => { results.push(r); console.log((r.pass ? "PASS " : "FAIL ") + r.name + "  " + JSON.stringify(r.facts)); };
const chrome = await launchChrome({});
try {
  // ---- A. the auto-open frames: does the sheet show the question? old vs new
  for (const [device, theme] of [["iphone-15", "dark"], ["iphone-15", "light"], ["iphone-se", "dark"]]) {
    for (const build of ["old", "new"]) {
      const page = await open(chrome, build, { device, theme });
      try {
        const shown = await poll(page, SHEET_VISIBLE, 12000);
        await poll(page, `!document.querySelector('[data-testid="asks-sheet-loading"]')`, 8000);
        await sleep(700);
        const text = await page.evaluate(SHEET_TEXT);
        const q = /which credential should I use for the staging API\?/.test(text);
        const hasOptions = /the stored key/.test(text);
        const hasAnswer = /Answer/.test(text) && /Decline/.test(text);
        const title = (text.split("\n")[0] || "").trim();
        const caret = await page.evaluate(`(() => { const row=document.querySelector('[data-testid^="ask-row-"]'); if(!row) return null; const t=[...row.querySelectorAll('div')].filter(e=>e.children.length===0 && e.textContent.trim()); const first=t.find(e=>/Queued|Waiting|expire|answer/i.test(e.textContent)) || t[0]; const c=t.find(e=>/^[▸▾]$/.test(e.textContent.trim())); if(!first||!c) return {first:!!first,caret:!!c}; const a=first.getBoundingClientRect(), b=c.getBoundingClientRect(); return {firstLineCentreY:Math.round((a.top+Math.min(a.height,18)/2)*10)/10, caretCentreY:Math.round((b.top+b.height/2)*10)/10, caretBox:[Math.round(b.width),Math.round(b.height)], sameLine: b.top < a.top + 20}})()`);
        const sha = await snap(page, `${build === "old" ? "before" : "after"}-r1__open__${device}__${theme}`);
        const geom = await page.evaluate(`(() => { const r = document.querySelector('[data-testid="asks-sheet-body"]'); if(!r) return null; const b=r.getBoundingClientRect(); return {w:Math.round(b.width),h:Math.round(b.height),top:Math.round(b.top), vh: innerHeight}})()`);
        // D2: collapse the row (the state every NON-head row of a multi-ask queue is in) and measure its caret.
        const rowId = await page.evaluate(`(() => { const r=document.querySelector('[data-testid^="ask-row-"]'); return r? r.getAttribute('data-testid') : null })()`);
        let collapsed = null;
        if (rowId) {
          await click(page, rowId); await sleep(500);
          collapsed = await page.evaluate(`(() => { const row=document.querySelector('[data-testid^="ask-row-"]'); const t=[...row.querySelectorAll('div')].filter(e=>e.children.length===0 && e.textContent.trim()); const first=t[0]; const c=t.find(e=>/^[▸▾]$/.test(e.textContent.trim())); if(!first||!c) return null; const a=first.getBoundingClientRect(), b=c.getBoundingClientRect(); return {firstTop:Math.round(a.top), firstH:Math.round(a.height), caretTop:Math.round(b.top), caretH:Math.round(b.height), centreDeltaPt: Math.round(Math.abs((a.top+a.height/2)-(b.top+b.height/2))*10)/10}})()`);
          await snap(page, `${build === "old" ? "before" : "after"}-r1__collapsed__${device}__${theme}`);
        }
        rec({ name: `${build}/open/${device}/${theme}`, pass: shown && (build === "old" ? !q : q && hasOptions && hasAnswer), facts: { collapsedCaret: collapsed, shown, questionVisibleWithoutTap: q, options: hasOptions, answerDecline: hasAnswer, title, geom, sha } });
      } finally { try { await page.send("Target.closeTarget", { targetId: page.targetId }); } catch {} }
    }
  }
  // ---- B. focus after closing an auto-opened sheet (U3), old vs new; Escape and X
  for (const build of ["old", "new"]) {
    for (const how of ["x", "escape"]) {
      const page = await open(chrome, build, {});
      try {
        await poll(page, SHEET_VISIBLE, 12000); await sleep(600);
        if (how === "x") await click(page, "sheet-close");
        else { await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); }
        const closed = await poll(page, `!(${SHEET_VISIBLE})`, 6000);
        await sleep(600);
        const active = await page.evaluate(ACTIVE);
        rec({ name: `${build}/focus-after-${how}`, pass: closed && (build === "new" ? active === "ask-bar" : true), facts: { closed, activeElement: active } });
      } finally { try { await page.send("Target.closeTarget", { targetId: page.targetId }); } catch {} }
    }
  }
  // ---- C. failed aggregate read (U5/D4)
  for (const build of ["old", "new"]) {
    const page = await open(chrome, build, { failAsks: true });
    try {
      await sleep(3500);
      const sheet = (await page.evaluate(SHEET_VISIBLE)) === true;
      const bar = (await page.evaluate(BAR_VISIBLE)) === true;
      const err = await page.evaluate(HAS("asks-sheet-error"));
      await snap(page, `${build === "old" ? "before" : "after"}-r1__readfail__iphone-15__dark`);
      // the bar still opens it by hand, and then the error IS shown (reader asked)
      let handOpen = null;
      if (build === "new" && bar) { await click(page, "ask-bar"); await sleep(1500); handOpen = { sheet: (await page.evaluate(SHEET_VISIBLE)) === true, error: await page.evaluate(HAS("asks-sheet-error")) }; }
      rec({ name: `${build}/read-fails`, pass: build === "old" ? sheet : (!sheet && bar && handOpen && handOpen.sheet && handOpen.error), facts: { sheetOpenAfter3_5s: sheet, barVisible: bar, errorLineShown: err, handOpen } });
    } finally { try { await page.send("Target.closeTarget", { targetId: page.targetId }); } catch {} }
  }
  // ---- D. U2: late seed. (i) the reported shape: old ask, seed at 9 s, a tap on the transcript at 5 s
  //         (ii) an ask created AT the seed instant never pops.
  for (const [label, createdNow, expectOpen] of [["ask-existed-before-view (fixture, 8 days old)", false, true], ["ask-created-at-seed-instant", true, false]]) {
    const page = await open(chrome, "new", { delayMs: 9000, createdNow });
    try {
      const t0 = Date.now(); let tSheet = null;
      while (Date.now() - t0 < 13000) {
        if ((await page.evaluate(SHEET_VISIBLE)) === true) { tSheet = Date.now() - t0; break; }
        await sleep(150);
      }
      rec({ name: `new/late-seed-9s/${label}`, pass: (tSheet !== null) === expectOpen, facts: { sheetAtMsAfterRowTap: tSheet, expectOpen } });
    } finally { try { await page.send("Target.closeTarget", { targetId: page.targetId }); } catch {} }
  }
  // ---- E. U4 end to end on the real bundle: dismiss with an ask, resolve all, back, new batch, re-enter
  {
    const page = await open(chrome, "new", {});
    try {
      await poll(page, SHEET_VISIBLE, 12000); await sleep(500);
      await click(page, "sheet-close");
      await poll(page, `!(${SHEET_VISIBLE})`, 6000);
      await sleep(500);
      await snap(page, "after-r1__dismissed__iphone-15__dark");
      const facts = { dismissed: true, focusAfterClose: await page.evaluate(ACTIVE) };
      // same batch, leave+return: stays closed
      await sleep(500); await click(page, "session-back");
      await poll(page, HAS("sessions-screen"), 15000);
      if (!(await poll(page, HAS(`session-row-${SESSION}`), 3000))) await click(page, "home-sidebar");
      await poll(page, HAS(`session-row-${SESSION}`), 20000); await sleep(900);
      await click(page, `session-row-${SESSION}`); await poll(page, HAS("session-screen"), 15000);
      facts.sameBatchReenterStaysClosed = !(await poll(page, SHEET_VISIBLE, 3000));
      // resolve all: scenario ev-answered pushes an empty-queue world; re-enter to observe it
      await pin("ev-answered");
      await sleep(300); await click(page, "session-back");
      await poll(page, HAS("sessions-screen"), 15000);
      if (!(await poll(page, HAS(`session-row-${SESSION}`), 3000))) await click(page, "home-sidebar");
      await poll(page, HAS(`session-row-${SESSION}`), 20000); await sleep(900);
      await click(page, `session-row-${SESSION}`); await poll(page, HAS("session-screen"), 15000);
      facts.emptyViewClosed = !(await poll(page, SHEET_VISIBLE, 3000));
      // a NEW batch, then a fresh view
      await pin("ev-open");
      await sleep(300); await click(page, "session-back");
      await poll(page, HAS("sessions-screen"), 15000);
      if (!(await poll(page, HAS(`session-row-${SESSION}`), 3000))) await click(page, "home-sidebar");
      await poll(page, HAS(`session-row-${SESSION}`), 20000); await sleep(900);
      await click(page, `session-row-${SESSION}`); await poll(page, HAS("session-screen"), 15000);
      facts.newBatchAutoOpens = await poll(page, SHEET_VISIBLE, 12000);
      rec({ name: "new/U4-forget-after-empty", pass: facts.sameBatchReenterStaysClosed && facts.emptyViewClosed && facts.newBatchAutoOpens, facts });
    } finally { try { await page.send("Target.closeTarget", { targetId: page.targetId }); } catch {} }
  }
} finally {
  writeFileSync(join(SCRATCH, "evidence", "r1-results.json"), JSON.stringify({ results, frameLog }, null, 2));
  await chrome.close();
  for (const s of Object.values(served)) await s.close();
  await new Promise((r) => facade.close(r)); await relay.shutdown();
}
const bad = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - bad}/${results.length} PASS; ${frameLog.length} frames`);
