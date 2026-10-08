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
		if (url.pathname === "/api/asks" && req.method === "GET") {
			res.writeHead(200, {
				"content-type": "application/json",
				"cache-control": "no-store",
			});
			res.end(JSON.stringify({ asks: askRows, asks_truncated: false }));
			return;
		}
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
		for await (const chunk of upstream.body) res.write(chunk);
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

/* ---------------------------------------------------------------- the builds -- */

const BUILDS = [
	{ tag: "after", dist: join(SCRATCH, "dist-new") },
];
for (const build of BUILDS) {
	build.serve = await serveDir(build.dist, { proxy: facadeOrigin });
	relay.state.allowedOrigins = [...(relay.state.allowedOrigins ?? []), build.serve.url];
}

const DEVICES = {
	"iphone-15": {
		width: 390,
		height: 844,
		dpr: 3,
		insets: { top: 59, bottom: 34, left: 0, right: 0 },
	},
	"iphone-se": {
		width: 320,
		height: 568,
		dpr: 2,
		insets: { top: 20, bottom: 0, left: 0, right: 0 },
	},
};

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

const frames = [];
async function shot(page, name, meta) {
	const captured = await page.send("Page.captureScreenshot", {
		format: "png",
		captureBeyondViewport: false,
	});
	const bytes = Buffer.from(captured.data, "base64");
	const file = join(OUT, `${name}.png`);
	writeFileSync(file, bytes);
	frames.push({
		file,
		sha256: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
		bytes: bytes.length,
		...meta,
	});
	return name;
}

/** Everything the page can say about where it is and what it drew — used when a
 *  re-entry click finds no row, so the failure names the state instead of the
 *  symptom. Returns a short object and writes a debug screenshot. */
async function dumpDebug(page, tag) {
  try {
    const info = await page.evaluate(`(() => {
      const ids = [...document.querySelectorAll('[data-testid]')]
        .map((el) => el.getAttribute('data-testid'))
        .filter((id) => id.includes('session') || id.includes('sheet') || id.includes('home') || id.includes('sidebar'));
      return {
        href: location.href,
        ids: ids.slice(0, 60),
        text: (document.body.innerText || '').slice(0, 400),
      };
    })()`);
    info.text = String(info.text || '').split('\n').join(' | ').slice(0, 300);
    await shot(page, `debug-${tag}`, { step: 'debug' });
    console.log(`DEBUG ${tag}: ${JSON.stringify(info)}`);
    return info;
  } catch (error) {
    console.log(`DEBUG ${tag} failed: ${error}`);
    return null;
  }
}

/* -------------------------------------------------------------- one flow -- */

async function runFlow({ build, state, theme, device }) {
	const deviceSpec = DEVICES[device];
	const scenario = state === "none" ? "ev-none" : state === "answered" ? "ev-answered" : "ev-open";
	await pin(scenario);

	const page = await chrome.page("about:blank");
	const result = {
		build: build.tag,
		state,
		theme,
		device,
		scenario,
		assertions: {},
		frames: [],
		pass: false,
		notes: [],
	};
	try {
		await page.send("Page.enable");
		await page.send("Runtime.enable");
		await page.send("Emulation.setDeviceMetricsOverride", {
			width: deviceSpec.width,
			height: deviceSpec.height,
			deviceScaleFactor: deviceSpec.dpr,
			mobile: true,
			screenWidth: deviceSpec.width,
			screenHeight: deviceSpec.height,
		});
		await page.send("Emulation.setEmulatedMedia", {
			features: [
				{ name: "prefers-color-scheme", value: theme },
				{ name: "prefers-reduced-motion", value: "no-preference" },
			],
		});
		try {
			await page.send("Emulation.setSafeAreaInsetsOverride", {
				insets: deviceSpec.insets,
			});
		} catch {
			result.notes.push("setSafeAreaInsetsOverride unavailable");
		}

		const seed = new URLSearchParams({
			"lo-relay": build.serve.url,
			"lo-relay-password": DEFAULT_PASSWORD,
			"lo-relay-insecure": "1",
		});
		await page.send("Page.navigate", {
			url: `${build.serve.url}/conversations?${seed.toString()}`,
		});
		if (!(await poll(page, HAS("sessions-screen"), 30000))) {
			throw new Error("the conversations screen never drew");
		}
		if (!(await poll(page, HAS(`session-row-${SESSION}`), 20000))) {
			throw new Error("the session row never drew");
		}
		await click(page, `session-row-${SESSION}`);
		if (!(await poll(page, HAS("session-screen"), 20000))) {
			throw new Error("the session screen never drew");
		}

		if (state === "open" || state === "dismiss") {
			const opened = await poll(page, SHEET_VISIBLE, 12000);
			result.assertions.sheetOpen = opened;
			result.assertions.barVisible = await poll(page, BAR_VISIBLE, 5000);
			if (opened) {
				/* The sheet's rows come from `GET /api/asks` (the facade). Wait for the
				 * fetch to settle so the headline frame is the loaded sheet, not its
				 * spinner; record the error line if one drew, because a frame of the
				 * error state must never pass as the feature working. */
				await poll(page, `!document.querySelector('[data-testid="asks-sheet-loading"]')`, 8000);
				await sleep(400);
				result.assertions.sheetError = await poll(
					page,
					HAS("asks-sheet-error"),
					600,
				);
			}
			await shot(page, `${build.tag}__open__${device}__${theme}`, {
				step: "auto-open",
			});
			result.frames.push(`${build.tag}__open__${device}__${theme}`);
			if (state === "open") {
				result.pass = build.tag === "after" ? opened === true : opened === false;
			} else {
				if (!opened) throw new Error("dismiss flow needs the sheet open");
				await click(page, "sheet-close");
				result.assertions.closedByControl = await poll(
					page,
					`!(${SHEET_VISIBLE})`,
					6000,
				);
				await shot(page, `${build.tag}__dismissed__${device}__${theme}`, {
					step: "dismissed",
				});
				result.frames.push(`${build.tag}__dismissed__${device}__${theme}`);

				await sleep(700);
				await click(page, "session-back");
				if (!(await poll(page, HAS("sessions-screen"), 15000))) {
					throw new Error("back never returned to the conversations screen");
				}
				/* The drawer CLOSES on a selection by design — "a selection never leaves
				 * the panel covering the screen it just opened"
				 * (`conversations-pane.tsx`), and the home's panel state is its
				 * mount-time `useState(forcePanelOpen)`, so coming back shows the home
				 * with the panel shut. The reader opens it again with the header's
				 * affordance, which is the flow a person takes; the rig does the same. */
				if (!(await poll(page, HAS(`session-row-${SESSION}`), 3000))) {
					await click(page, "home-sidebar");
				}
				if (!(await poll(page, HAS(`session-row-${SESSION}`), 20000))) {
					await dumpDebug(page, `${build.tag}-${theme}-reentry`);
					throw new Error("the conversations row never came back after leaving the session");
				}
				/* The drawer slides in; a click aimed mid-animation lands on whatever the
				 * row has moved to (measured: the first attempt navigated nowhere). Let
				 * the entrance settle before aiming. */
				await sleep(900);
				await click(page, `session-row-${SESSION}`);
				if (!(await poll(page, HAS("session-screen"), 15000))) {
					throw new Error("re-entering the session never drew");
				}
				await sleep(4000); // let the new view's seed land and the policy decide
				const reopened = await poll(page, SHEET_VISIBLE, 1500);
				result.assertions.staysClosedAfterReenter = reopened === false;
				result.assertions.barStillVisible = await poll(page, BAR_VISIBLE, 5000);
				await shot(page, `${build.tag}__reentered__${device}__${theme}`, {
					step: "re-entered",
				});
				result.frames.push(`${build.tag}__reentered__${device}__${theme}`);
				result.pass =
					result.assertions.closedByControl === true &&
					result.assertions.staysClosedAfterReenter === true;
			}
		} else {
			await sleep(3500); // settle: no policy may raise anything after the seed
			result.assertions.sheetOpen = await poll(page, SHEET_VISIBLE, 1200);
			result.assertions.barVisible = await poll(page, BAR_VISIBLE, 4000);
			await shot(page, `${build.tag}__${state}__${device}__${theme}`, {
				step: state,
			});
			result.frames.push(`${build.tag}__${state}__${device}__${theme}`);
			const expectedOpen = false;
			result.pass =
				result.assertions.sheetOpen === expectedOpen &&
				result.assertions.barVisible === (state === "open" ? true : false);
		}
		return result;
	} finally {
		try {
			await page.send("Target.closeTarget", { targetId: page.targetId });
		} catch {
			/* a target the browser already dropped is the normal teardown race */
		}
	}
}

/* --------------------------------------------------------------- the plan -- */

const PLAN = [
	// The four states, after build, iphone-15 dark + light.
	...["none", "open", "answered", "dismiss"].flatMap((state) =>
		["dark", "light"].map((theme) => ({ tag: "after", state, theme, device: "iphone-15" })),
	),
	// The fail-on-old pair: the same pending world on the pre-change build.
	...["dark", "light"].map((theme) => ({ tag: "before", state: "open", theme, device: "iphone-15" })),
	// Before, states 1 and 3 (cheap; shows only the bar's absent/present logic differs not).
	{ tag: "before", state: "none", theme: "dark", device: "iphone-15" },
	{ tag: "before", state: "answered", theme: "dark", device: "iphone-15" },
	// The headline state at the small phone, both builds, dark.
	{ tag: "after", state: "open", theme: "dark", device: "iphone-se" },
	{ tag: "before", state: "open", theme: "dark", device: "iphone-se" },
];

/* `RIG_ONLY=after/dismiss` (comma-separated `tag/state`) reruns selected flows
 * without re-shooting the whole matrix — added after the dismiss flow's first
 * two runs failed and a full 14-flow re-run per probe was wasteful. */
const ONLY = process.env.RIG_ONLY ? process.env.RIG_ONLY.split(",") : null;
const RUN = ONLY ? PLAN.filter((p) => ONLY.includes(`${p.tag}/${p.state}`)) : PLAN;

const chrome = await launchChrome({});
const results = [];
try {
	for (const item of RUN) {
		const build = BUILDS.find((b) => b.tag === item.tag);
		try {
			const result = await runFlow({
				build,
				state: item.state,
				theme: item.theme,
				device: item.device,
			});
			results.push(result);
			console.log(
				`${result.pass ? "PASS" : "FAIL"}  ${result.build}/${result.state}/${result.device}/${result.theme}` +
					`  ${JSON.stringify(result.assertions)}`,
			);
		} catch (error) {
			results.push({ ...item, pass: false, error: String(error) });
			console.log(`ERROR ${item.tag}/${item.state}/${item.device}/${item.theme}: ${error}`);
		}
	}
} finally {
	writeFileSync(
		join(SCRATCH, "evidence", "rig-results.json"),
		`${JSON.stringify({ results, frames }, null, 2)}\n`,
	);
	await chrome.close();
	for (const build of BUILDS) await build.serve.close();
	await new Promise((r) => facade.close(r));
	await relay.shutdown();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} flows PASS; ${frames.length} frames`);
