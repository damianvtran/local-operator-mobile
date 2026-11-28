/* Scratch driver for Guard M1 frames (NOT committed). Reuses the repo's own rig:
 * serveDir (static + relay proxy), launchChrome (mock keychain, own profile),
 * the mock relay with the Guard twin store. One browser, reaped by group. */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const WT = process.env.WT as string;
const OUT = process.env.OUT as string;
const WEB = process.env.WEB as string;
const imp = (p: string) => import(join(WT, p));
const { serveDir } = await imp("tools/lib/static-server.ts");
const { launchChrome } = await imp("tools/lib/chrome.ts");
const { sleep } = await imp("tools/lib/cdp.ts");
const { applySafeAreaInsets } = await imp("tools/lib/page.ts");
const { selectScenario, readRelayRecord } = await imp("tools/lib/relay.ts");
const { seedQuery } = await imp("tools/lib/readiness.ts");
const { DEFAULT_PASSWORD } = await imp("tools/mock-relay/relay.ts");

const freePort = () =>
	new Promise<number>((resolve) => {
		const s = createServer();
		s.listen(0, "127.0.0.1", () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => resolve(port));
		});
	});

mkdirSync(join(OUT, "frames"), { recursive: true });
const port = await freePort();
const relayUrl = `http://127.0.0.1:${port}`;
const relay = spawn("node", ["tools/mock-relay/relay.ts", "--scenario", "idle", "--port", String(port)], {
	cwd: WT, detached: true, stdio: "ignore",
});
console.log("mock relay pid", relay.pid);
for (let i = 0; i < 100; i++) {
	try { if ((await fetch(`${relayUrl}/healthz`)).ok) break; } catch {}
	await sleep(200);
}
const server = await serveDir(WEB, { proxy: relayUrl });
const chrome = await launchChrome({ extraArgs: [] });
const device = { width: 390, height: 844, dpr: 2, insets: { top: 59, bottom: 34, left: 0, right: 0 } };
const report: Record<string, unknown>[] = [];

let current: any = null;
async function open(scenario: string, path: string, theme: "light" | "dark") {
	// One page at a time: a page left open keeps its SSE streams on the relay, and
	// the static server's proxy dies on the abort when the next scenario resets them.
	if (current) { try { await current.send("Target.closeTarget", { targetId: current.targetId }); } catch {} current = null; await sleep(300); }
	await selectScenario(relayUrl, scenario);
	const page = await chrome.page();
	current = page;
	(page as any).netUrls = [];
	await page.send("Network.enable");
	page.on("Network.requestWillBeSent", (params: any) => { (page as any).netUrls.push(`${params.request?.method} ${params.request?.url}`); });
	await page.send("Page.enable"); await page.send("Runtime.enable");
	await page.send("Emulation.setDeviceMetricsOverride", { width: device.width, height: device.height, deviceScaleFactor: device.dpr, mobile: true, screenWidth: device.width, screenHeight: device.height });
	await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
	await applySafeAreaInsets(page, device);
	const q = new URLSearchParams({ "lo-theme": theme, "lo-text-scale": "1", "lo-reduce-motion": "0", "lo-inset-top": "59", "lo-inset-bottom": "34", "lo-inset-left": "0", "lo-inset-right": "0", "lo-recorder": "supported" });
	for (const [k, v] of new URLSearchParams(seedQuery(server.url, DEFAULT_PASSWORD))) q.set(k, v);
	await page.send("Page.navigate", { url: `${server.url}${path}?${q}` });
	return page;
}
const guardLog = async () => ((await (await fetch(`${relayUrl}/__mock/guard-log`)).json()) as any).requests.map((r: any) => ({ method: r.method, path: r.path, body: r.body ?? null }));
const netGuard = (page: any) => (page.netUrls as string[]).filter((u) => /guard/i.test(u)).map((u) => u.replace(server.url, ""));
const has = (page: any, id: string) => page.evaluate(`!!document.querySelector('[data-testid="${id}"]')`);
async function waitFor(page: any, id: string, ms = 20000) {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) { if (await has(page, id)) return true; await sleep(250); }
	return false;
}
const click = (page: any, id: string) => page.evaluate(`(()=>{const e=document.querySelector('[data-testid="${id}"]'); if(!e) return false; e.click(); return true})()`);
async function shot(page: any, name: string, extra: Record<string, unknown> = {}) {
	await sleep(500);
	const s = await page.send("Page.captureScreenshot", { format: "png" });
	const buf = Buffer.from(s.data as string, "base64");
	writeFileSync(join(OUT, "frames", `${name}.png`), buf);
	const texts = await page.evaluate(`document.body.innerText`);
	report.push({ frame: name, bytes: buf.length, ...extra, text: String(texts).slice(0, 1500) });
	console.log("frame", name, buf.length);
}
const scrollTo = (page: any, id: string) => page.evaluate(`(()=>{const e=document.querySelector('[data-testid="${id}"]'); if(e){e.scrollIntoView({block:'start'});} return !!e})()`);

process.on("uncaughtException", (e) => console.log("UNCAUGHT", String(e).slice(0, 200)));
try {
  for (const theme of ["light", "dark"] as const) {
    // Settings states
    for (const sc of ["guard-waiting", "guard-widening", "guard-sharing", "guard-mixed", "guard-non-team-owner", "guard-non-team-admin", "guard-non-team-member", "idle"]) {
      const page = await open(sc, "/settings", theme);
      const present = await waitFor(page, "settings-section-guard", sc === "idle" || sc === "guard-non-team-member" ? 12000 : 25000);
      if (present) { await sleep(1500); await scrollTo(page, "settings-section-guard"); }
      else { await waitFor(page, "settings-section-diagnostics", 15000); await scrollTo(page, "settings-section-diagnostics"); }
      await shot(page, `settings__${sc}__${theme}`, { guardSectionPresent: present });
    }
  }
  // Inbox + consent flows (light + dark for the card)
  for (const theme of ["light", "dark"] as const) {
    let page = await open("guard-waiting", "/notifications", theme);
    const row = await waitFor(page, "guard-inbox-row", 30000);
    await shot(page, `inbox__guard-waiting__${theme}`, { rowPresent: row });
    await click(page, "guard-review");
    const sheet = await waitFor(page, "guard-consent-sheet", 10000);
    await sleep(900);
    await shot(page, `consent__new_org__${theme}`, { sheetPresent: sheet });
  }
  // Negative: press inside the debounce window sends nothing
  { const page = await open("guard-waiting", "/notifications", "light");
    await waitFor(page, "guard-inbox-row", 30000);
    await click(page, "guard-review"); await waitFor(page, "guard-consent-sheet", 10000);
    const before = (await guardLog()).length;
    await click(page, "guard-consent-share"); // immediately: inside 500 ms of render
    await sleep(300);
    const early = (await guardLog()).filter((r: any) => /\/api\/guard\/consents\/.+\/(accept|decline)/.test(String(r.path)));
    report.push({ check: "answer inside the 500 ms debounce sends nothing", answerRequests: early.length, before });
    // Decide later
    await sleep(700); await click(page, "guard-consent-later"); await sleep(600);
    const still = await has(page, "guard-inbox-row");
    const later = (await guardLog()).filter((r: any) => /\/accept|\/decline/.test(String(r.path)));
    report.push({ check: "Decide later closes the card, row stays pending, nothing sent", rowStillPending: still, answerRequests: later.length });
    await shot(page, "inbox__after-decide-later__light");
  }
  // Share (accept) end to end
  { const page = await open("guard-waiting", "/notifications", "light");
    await waitFor(page, "guard-inbox-row", 30000);
    await click(page, "guard-review"); await waitFor(page, "guard-consent-sheet", 10000);
    await sleep(900); await click(page, "guard-consent-share"); await sleep(1500);
    await shot(page, "inbox__after-share__light");
    report.push({ check: "Share: every Guard request the phone made (host-side ledger)", requests: await guardLog(), browserGuardUrls: netGuard(page) }); }
  // Decline end to end
  { const page = await open("guard-waiting", "/notifications", "light");
    await waitFor(page, "guard-inbox-row", 30000);
    await click(page, "guard-review"); await waitFor(page, "guard-consent-sheet", 10000);
    await sleep(900); await click(page, "guard-consent-dont-share"); await sleep(1500);
    await shot(page, "inbox__after-dont-share__light"); }
  // Widening card
  for (const theme of ["light", "dark"] as const) {
    const page = await open("guard-widening", "/notifications", theme);
    await waitFor(page, "guard-inbox-row", 30000);
    await shot(page, `inbox__guard-widening__${theme}`);
    await click(page, "guard-review"); await waitFor(page, "guard-consent-sheet", 10000); await sleep(900);
    await shot(page, `consent__widened__${theme}`);
  }
  // Stop sharing confirm + result
  { const page = await open("guard-sharing", "/settings", "light");
    await waitFor(page, "settings-section-guard", 25000); await sleep(1200); await scrollTo(page, "settings-section-guard");
    await click(page, "guard-stop"); await waitFor(page, "guard-revoke-sheet", 10000); await sleep(900);
    await shot(page, "revoke__confirm__light");
    await click(page, "guard-stop-confirm"); await sleep(1800); await scrollTo(page, "settings-section-guard");
    await shot(page, "revoke__after__light"); }
  // Non-Team: record that no /api/guard write or any /v1/guard call is ever made
  { const page = await open("guard-non-team-owner", "/settings", "light");
    await waitFor(page, "settings-section-guard", 25000); await sleep(1500);
    report.push({ check: "non-Team owner: every Guard request the phone made", hostLedger: await guardLog(), browserGuardUrls: netGuard(page) }); }
  { // Older relay: zero Guard requests
    const page = await open("idle", "/settings", "light");
    await waitFor(page, "settings-section-diagnostics", 25000); await sleep(1500);
    report.push({ check: "older relay (no features.guard): Guard requests (browser network)", browserGuardUrls: netGuard(page), hostLedger: await guardLog() }); }
} finally {
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
  const reaped = await chrome.close();
  console.log("chrome survivors", reaped.survivors);
  await server.close();
  try { process.kill(-relay.pid!, "SIGTERM"); } catch {}
  await sleep(500);
  try { process.kill(relay.pid!, 0); console.log("relay STILL ALIVE"); } catch { console.log("relay reaped"); }
}
