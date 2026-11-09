import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchChrome, resolveChrome } from "../lib/chrome.ts";
import { freshPage } from "../lib/page.ts";
import { serveDir } from "../lib/static-server.ts";
import { type AuditRecord, auditCell } from "./audit.ts";
import { RECORD } from "./u08-geometry-proof.ts";

/**
 * The audit canary must read the EMULATED viewport, whatever it overflows by.
 *
 * WHY THIS EXISTS (hosted run 40213370013): the u08 fragment verification's
 * positive control re-drives `e2e/fixtures/audit-canary` `/defects` under the
 * canonical iPhone 15 / 150 % emulation and asserts the page reports exactly
 * 390 x 844 @3x. It reported 1560 x 3376 @3x — exactly 4 x on both axes — and the
 * stage that proves the instrument can still FAIL never ran.
 *
 * THE CAUSE is the page, not the emulation or the reader. `/defects` overflows
 * horizontally on purpose (#too-wide, full-width bars: 1728 px of scroll width at
 * 150 %). Under `Emulation.setDeviceMetricsOverride({ mobile: true })` Chrome lets
 * the LAYOUT viewport grow to fit overflowing content, down to its 0.25 minimum
 * page scale (4 x), and `window.innerWidth/Height` — which `probe.ts` records as
 * `state.viewport` — follow it, while `visualViewport` and
 * `documentElement.clientWidth` stay at the emulated 390. `/clean` does not
 * overflow and always read 390, so only the defect page was wrong. The canary's
 * `minimum-scale=1` viewport meta is what holds the layout viewport still.
 *
 * Two halves, so neither can be satisfied by an instrument that cannot fail:
 * the canary reads the emulated size on every device/scale/path the canary run
 * uses, and a control page that overflows the same way WITHOUT `minimum-scale`
 * still reads the inflated size — the premise this fix rests on, which a Chrome
 * change would otherwise silently retire.
 *
 * No Chrome locally is a skip; no Chrome under CI is a failure, because a
 * silently skipped browser test is a gate that passes without having measured
 * anything.
 */

const MIN_SCALE_META =
	/<meta name="viewport" content="[^"]*minimum-scale=1[^"]*">/;

const chromeAvailable = resolveChrome() !== null;
if (!chromeAvailable && process.env.CI) {
	throw new Error(
		"CI has no Chrome: the canary viewport test needs the installed browser.",
	);
}

let chrome: Awaited<ReturnType<typeof launchChrome>> | undefined;
let canary: Awaited<ReturnType<typeof serveDir>> | undefined;

beforeAll(async () => {
	if (!chromeAvailable) return;
	chrome = await launchChrome();
	canary = await serveDir(resolve("e2e/fixtures/audit-canary"));
}, 120_000);

afterAll(async () => {
	await canary?.close();
	if (!chrome) return;
	const reaped = await chrome.close();
	expect(reaped.survivors).toBe(0);
}, 60_000);

/** The cell record the verification's positive control builds, with the device/scale/path varied. */
function recordFor(
	path: "/defects" | "/clean",
	device: {
		viewport: AuditRecord["viewport"];
		insets: NonNullable<AuditRecord["insets"]>;
	},
	scale: string,
): AuditRecord {
	return {
		...RECORD,
		screen: `path:${path}`,
		path,
		state: path.slice(1),
		scale,
		viewport: device.viewport,
		insets: device.insets,
		pinnedScenario: null,
		openers: [],
	};
}

/** Drive one cell through the shipped `auditCell` (the same emulation the driver applies). */
async function drive(origin: string, record: AuditRecord) {
	if (!chrome) throw new Error("no chrome");
	const fresh = await freshPage(chrome, null, 30_000);
	if (!fresh.ok) throw new Error(fresh.reason);
	try {
		return await auditCell(fresh.page, record, {
			origin,
			relay: null,
			seed: null,
			settleMs: 600,
			cellTimeoutMs: 45_000,
		});
	} finally {
		await fresh.page
			.send("Target.closeTarget", { targetId: fresh.page.targetId })
			.catch(() => undefined);
	}
}

const IPHONE_15 = {
	viewport: { width: 390, height: 844, dpr: 3 },
	insets: { top: 59, bottom: 34, left: 0, right: 0 },
};
const IPHONE_SE = {
	viewport: { width: 320, height: 568, dpr: 2 },
	insets: { top: 20, bottom: 0, left: 0, right: 0 },
};
const IPHONE_15_LANDSCAPE = {
	viewport: { width: 844, height: 390, dpr: 3 },
	insets: { top: 0, bottom: 21, left: 59, right: 59 },
};

describe.skipIf(!chromeAvailable)("audit canary viewport", () => {
	it("the verification's positive-control cell reads exactly the canonical environment", async () => {
		if (!canary) throw new Error("no canary server");
		// The exact cell that failed on the hosted run: dark, 150 %, iPhone 15, /defects.
		const state = await drive(
			canary.url,
			recordFor("/defects", IPHONE_15, "150"),
		);
		expect(state.viewport).toEqual({ width: 390, height: 844, dpr: 3 });
		expect(state.insets.top).toBe(59);
		expect(state.insets.bottom).toBe(34);
		expect(Number(state.textScale)).toBe(1.5);
		expect(state.theme).toBe("dark");
	}, 60_000);

	it.each([
		["iphone-15", IPHONE_15],
		["iphone-se", IPHONE_SE],
		["iphone-15-landscape", IPHONE_15_LANDSCAPE],
	])(
		"%s reads its emulated size on /defects and /clean at every text scale",
		async (_name, device) => {
			if (!canary) throw new Error("no canary server");
			for (const scale of ["100", "150", "200"]) {
				for (const path of ["/defects", "/clean"] as const) {
					const state = await drive(canary.url, recordFor(path, device, scale));
					expect(state.viewport, `${path} at ${scale}% on ${_name}`).toEqual(
						device.viewport,
					);
				}
			}
		},
		120_000,
	);

	it("control: the same overflow WITHOUT minimum-scale still inflates the layout viewport", async () => {
		// Reuse the canary origin and swap the document in place: it already serves
		// a viewport meta, and this isolates the one attribute under test.
		if (!canary || !chrome) throw new Error("no canary server");
		const fresh = await freshPage(chrome, null, 30_000);
		if (!fresh.ok) throw new Error(fresh.reason);
		const page = fresh.page;
		try {
			await page.send("Emulation.setDeviceMetricsOverride", {
				width: 390,
				height: 844,
				deviceScaleFactor: 3,
				mobile: true,
			});
			await page.send("Page.navigate", { url: `${canary.url}/clean` });
			await new Promise((r) => setTimeout(r, 600));
			const read = async (meta: string) =>
				page.evaluate(
					`(() => { document.head.querySelector('meta[name=viewport]').content = ${JSON.stringify(meta)}; document.body.innerHTML = '<div style="width:1728px;height:20px"></div>'; document.body.offsetHeight; return { w: innerWidth, h: innerHeight, client: document.documentElement.clientWidth }; })()`,
				);
			const unpinned = (await read(
				"width=device-width, initial-scale=1, viewport-fit=cover",
			)) as { w: number; client: number };
			const pinned = (await read(
				"width=device-width, initial-scale=1, minimum-scale=1, viewport-fit=cover",
			)) as { w: number; h: number; client: number };
			// documentElement.clientWidth is the emulated width either way, which is
			// exactly why the inflated innerWidth went unnoticed by a reader of it.
			expect(unpinned.client).toBe(390);
			expect(unpinned.w).toBeGreaterThan(390);
			expect(pinned).toEqual({ w: 390, h: 844, client: 390 });
		} finally {
			await page
				.send("Target.closeTarget", { targetId: page.targetId })
				.catch(() => undefined);
		}
	}, 60_000);

	it("the canary declares the minimum-scale pin the readings depend on", async () => {
		const html = readFileSync(
			resolve("e2e/fixtures/audit-canary/index.html"),
			"utf8",
		);
		expect(html).toMatch(MIN_SCALE_META);
	});
});
