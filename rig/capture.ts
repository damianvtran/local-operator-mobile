// Scratch capture rig for M1 evidence (outside the repo). Uses the repo's own
// Chrome launcher (mock keychain, own process group, reap on close).
import { mkdirSync, writeFileSync } from "node:fs";
import { launchChrome } from "~/work/local-operator-mobile/.worktrees/no-terminal-refusals/tools/lib/chrome.ts";
import { sleep } from "~/work/local-operator-mobile/.worktrees/no-terminal-refusals/tools/lib/cdp.ts";

const [, , label, outDir] = process.argv;
const BASE = "http://localhost:8099";
const STATES: Array<[string, string, string | null]> = [
	["phone-access-off", "/zz-m1-evidence?state=phone-access-off", null],
	["phone-access-off-howto", "/zz-m1-evidence?state=phone-access-off", "refusal-how-to"],
	["balance-out", "/zz-m1-evidence?state=balance-out", null],
	["suspended", "/zz-m1-evidence?state=suspended", null],
	["console-disabled", "/zz-m1-evidence?state=console-disabled", null],
	["provisioning", "/zz-m1-evidence?state=provisioning", null],
	["computer-offline", "/zz-m1-evidence?state=computer-offline", null],
	["relay-stopped", "/zz-m1-evidence?state=relay-stopped", null],
	["relay-stopped-terminal", "/zz-m1-evidence?state=relay-stopped", "refusal-terminal-toggle"],
	["tunnel-gone", "/zz-m1-evidence?state=tunnel-gone", null],
	["radient-unreachable", "/zz-m1-evidence?state=radient-unreachable", null],
	["relay-wait-503-kind", "/zz-m1-evidence?state=relay-wait", null],
	["setup-computer", "/zz-m1-evidence?state=setup", null],
	["setup-computer-terminal", "/zz-m1-evidence?state=setup", "setup-terminal-toggle"],
	["own-tunnel", "/own-tunnel", null],
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
			const ready = name.startsWith("setup") ? null : name === "own-tunnel" ? 'input[type="password"]' : '[data-testid="connection-refusal"]';
			let ok = false;
			for (let i = 0; i < 400 && !ok; i++) {
				await sleep(500);
				ok = Boolean(await page.evaluate(ready ? `!!document.querySelector('${ready}')` : "document.body.innerText.includes('Your code stays on it')").catch(() => false));
			}
			if (click) {
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
