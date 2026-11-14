// Scratch capture rig for M1 evidence (outside the repo). Uses the repo's own
// Chrome launcher (mock keychain, own process group, reap on close).
import { mkdirSync, writeFileSync } from "node:fs";
import { launchChrome } from "~/work/local-operator-mobile/.worktrees/no-terminal-refusals/tools/lib/chrome.ts";
import { sleep } from "~/work/local-operator-mobile/.worktrees/no-terminal-refusals/tools/lib/cdp.ts";

const [, , label, outDir] = process.argv;
const BASE = "http://localhost:8099";
const STATES: Array<[string, string, string | null]> = [
	["reason-billing-lapsed", "/zz-m1-evidence?state=reason-billing-lapsed", null],
	["reason-server-unavailable", "/zz-m1-evidence?state=reason-server-unavailable", null],
	["kind-wait-network", "/zz-m1-evidence?state=kind-wait-network", null],
	["kind-sign-in", "/zz-m1-evidence?state=kind-sign-in", null],
	["kind-open-console", "/zz-m1-evidence?state=kind-open-console", null],
	["settings-diagnostics", "/zz-m1-evidence?state=settings", "SCROLL"],
];
mkdirSync(outDir, { recursive: true });
const chrome = await launchChrome({ profile: `~/.local-operator/sessions/6d2db15bac62/scratchpad/m1/chrome-profile-${label}` });
const log: string[] = [];
try {
	for (const theme of ["light", "dark"]) {
		for (const [name, path, click] of STATES) {
			const page = await chrome.page();
			await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
			await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
			await page.send("Page.navigate", { url: BASE + path });
			const ready = name.startsWith("settings") ? '[data-testid="settings-section-diagnostics"]' : name.startsWith("setup") ? null : name === "own-tunnel" ? 'input[type="password"]' : '[data-testid="connection-refusal"]';
			let ok = false;
			for (let i = 0; i < 400 && !ok; i++) {
				await sleep(500);
				ok = Boolean(await page.evaluate(ready ? `!!document.querySelector('${ready}')` : "document.body.innerText.includes('Your code stays on it')").catch(() => false));
			}
			if (click === "SCROLL") {
				await page.evaluate(`document.querySelector('[data-testid="settings-section-diagnostics"]')?.scrollIntoView({block:"start"})`);
			} else if (click) {
				await page.evaluate(`document.querySelector('[data-testid="${click}"]')?.click()`);
			}
			await sleep(1200);
			const shot = await page.send("Page.captureScreenshot", { format: "png" });
			const file = `${outDir}/${name}__${theme}.png`;
			writeFileSync(file, Buffer.from(String(shot.data), "base64"));
			const text = await page.evaluate("document.body.innerText").catch(() => "");
			log.push(`## ${name} ${theme} ready=${ok}\n${String(text).slice(0, 1200)}\n`);
			await page.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
		}
	}
} finally {
	writeFileSync(`${outDir}/text.md`, log.join("\n"));
	const r = await chrome.close();
	console.log("reaped", JSON.stringify(r).slice(0, 300));
}
