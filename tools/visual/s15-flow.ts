import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CONTROL, SCREEN, SURFACE } from "../../src/ui/a11y.ts";
import type { CdpPage } from "../lib/cdp.ts";
import type { launchChrome } from "../lib/chrome.ts";
import { applySafeAreaInsets, freshPage } from "../lib/page.ts";
import { seedQuery } from "../lib/readiness.ts";
import { selectScenario } from "../lib/relay.ts";
import { DEFAULT_PASSWORD } from "../mock-relay/relay.ts";
import { DEVICES, MEASURE_PROBE, textScaleFactor } from "./matrix.ts";

/* The footer's ROUTES — each pushes a screen with its own back control. The
 *  computer row (`sidebarComputers`) is not one any more: since M2b it opens the
 *  switcher SHEET over Home (ux-flows F5), so a navigate-and-return walk would
 *  wait for a screen that never comes. */
export const FOOTER_DESTINATIONS = [
	{ control: CONTROL.sidebarPast, root: SCREEN.past, back: CONTROL.pastBack },
	{
		control: CONTROL.sidebarProjects,
		root: SCREEN.projects,
		back: CONTROL.projectsBack,
	},
	{
		control: CONTROL.sidebarSchedules,
		root: SCREEN.schedules,
		back: CONTROL.schedulesBack,
	},
] as const;
// The workspace row opens a modal rather than a route, but is still the tail
// target most exposed to clipping. Keep it in reachability and first-tap coverage.
export const FOOTER_TAIL_CONTROLS = [
	...FOOTER_DESTINATIONS.map((destination) => destination.control),
	CONTROL.sidebarComputers,
];
const selector = (id: string) => `[data-testid=${JSON.stringify(id)}]`;

export interface ScrollReading {
	top: number;
	client: number;
	height: number;
	listTop: number;
	listBottom: number;
	footerTop: number;
	footerBottom: number;
	footerHit: boolean;
	footerInsideList: boolean;
	viewportHeight: number;
}
/** Virtualized rows change their estimated extent after wheel delivery. A
 * transient old maximum is not a tail: require unchanged extents plus a real
 * final target inside the clip before ending input. */
export const scrollBoundarySettled = (
	now: ScrollReading,
	before: ScrollReading | undefined,
	tail: boolean,
) => {
	if (
		!before ||
		now.top !== before.top ||
		now.height !== before.height ||
		now.client !== before.client
	)
		return false;
	return tail
		? now.top > 0 &&
				now.top + now.client >= now.height - 1 &&
				now.footerHit &&
				now.footerTop >= 0 &&
				now.footerBottom <= now.viewportHeight + 1 &&
				(!now.footerInsideList ||
					(now.footerTop >= now.listTop - 1 &&
						now.footerBottom <= now.listBottom + 1))
		: now.top === 0;
};

/** Reuse the capture/audit seed contract: cleartext synthetic HTTP must carry
 * the app's explicit opt-in, and a second hand-built seed silently disconnects. */
export const s15FlowQuery = (
	baseUrl: string,
	theme: string,
	deviceId: string,
) => {
	const device = DEVICES[deviceId];
	assert(device, "unknown flow device");
	const query = new URLSearchParams({
		"lo-theme": theme,
		// The flow is the 200% case; keep it tied to the matrix rather than
		// re-declaring the factor independently of the capture's scale table.
		"lo-text-scale": String(textScaleFactor("200")),
		"lo-reduce-motion": "0",
		"lo-inset-top": String(device.insets.top),
		"lo-inset-bottom": String(device.insets.bottom),
		"lo-inset-left": String(device.insets.left),
		"lo-inset-right": String(device.insets.right),
	});
	for (const [key, value] of new URLSearchParams(
		seedQuery(baseUrl, DEFAULT_PASSWORD),
	))
		query.set(key, value);
	return query;
};

/** CI-only interaction proof on the existing capture browser. Navigation inside
 * each journey uses controls, never location/history assignment; wheel input is
 * real scrolling, not a fixture switch or a scrollTop mutation. Booting a fresh
 * scenario is isolated setup, explicitly distinguished in the journal. */
export async function runS15FlowProof({
	browser,
	previous,
	baseUrl,
	relay,
	out,
}: {
	browser: Awaited<ReturnType<typeof launchChrome>>;
	previous: CdpPage | null;
	baseUrl: string;
	relay: string;
	out: string;
}): Promise<void> {
	mkdirSync(out, { recursive: true });
	const journal: Array<Record<string, unknown>> = [];
	let page = previous;
	let prefix = "";
	const wait = async (expression: string, label: string) => {
		assert(page);
		const answer = await page.evaluate(`(async () => {
		 const until = performance.now() + 15000;
		 while (performance.now() < until) {
		  if (${expression}) return true;
		  await new Promise(requestAnimationFrame);
		 }
		 return false;
		})()`);
		assert.equal(answer, true, label);
	};
	const present = (id: string) =>
		`document.querySelector(${JSON.stringify(selector(id))})`;
	const record = async (label: string) => {
		assert(page);
		const image = await page.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		assert.equal(typeof image.data, "string");
		const file = `${prefix}-${label}.png`;
		writeFileSync(join(out, file), Buffer.from(image.data as string, "base64"));
		journal.push({
			label: `${prefix}-${label}`,
			file,
			measurements: await page.evaluate(MEASURE_PROBE),
			viewport: await page.evaluate(
				`({width:innerWidth,height:innerHeight,focus:document.activeElement?.getAttribute('data-testid'),route:location.pathname})`,
			),
		});
		writeFileSync(
			join(out, "flow.json"),
			JSON.stringify({ verdict: "IN_PROGRESS", journal }, null, 2),
		);
	};
	const rectFor = async (css: string) => {
		assert(page);
		await wait(
			`(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return false;
			 const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
			 return r.height > 0 && hit && (hit===el || el.contains(hit)); })()`,
			`control not yet hit-testable ${css}`,
		);
		return (await page.evaluate(`(() => {
		 const el = document.querySelector(${JSON.stringify(css)}), r = el.getBoundingClientRect();
		 const x=r.left+r.width/2, y=r.top+r.height/2, hit=document.elementFromPoint(x,y);
		 return {x,y,width:r.width,height:r.height,top:r.top,bottom:r.bottom,
		  hit: Boolean(hit && (hit===el || el.contains(hit))),disabled:el.getAttribute('aria-disabled')==='true'};
		})()`)) as {
			x: number;
			y: number;
			width: number;
			height: number;
			top: number;
			bottom: number;
			hit: boolean;
			disabled: boolean;
		};
	};
	const press = async (css: string, holdMs = 0) => {
		assert(page);
		const rect = await rectFor(css);
		assert(
			rect.hit && !rect.disabled && rect.height > 0,
			`control not hit-testable: ${css}`,
		);
		journal.push({
			action: holdMs ? "hold" : "tap",
			selector: css,
			holdMs,
			rect,
		});
		await page.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x: rect.x,
			y: rect.y,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
		if (holdMs)
			await page.evaluate(
				`new Promise(resolve => setTimeout(resolve, ${holdMs}))`,
			);
		await page.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x: rect.x,
			y: rect.y,
			button: "left",
			buttons: 0,
			clickCount: 1,
		});
	};
	const dismissWithEscape = async () => {
		assert(page);
		for (const type of ["keyDown", "keyUp"])
			await page.send("Input.dispatchKeyEvent", {
				type,
				key: "Escape",
				code: "Escape",
				windowsVirtualKeyCode: 27,
			});
		journal.push({
			action: "Escape",
			coverage: "web keyboard; not a native soft-keyboard assertion",
		});
	};
	const wheel = async (tail: boolean) => {
		assert(page);
		const until = Date.now() + 15000;
		let previous: ScrollReading | undefined;
		let stable = 0;
		while (Date.now() < until) {
			const rect = await rectFor(selector("conversations-list"));
			// Keep scrolling through virtualized remeasurement, using actual input.
			// No scrollTop write, sleep inflation or stale maximum is accepted.
			await page.send("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: rect.x,
				y: rect.y,
				deltaX: 0,
				deltaY: tail ? 10000 : -10000,
			});
			await page.evaluate(
				"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
			);
			const reading = (await page.evaluate(`(() => {
			 const el = ${present("conversations-list")}, f = ${present(CONTROL.sidebarSchedules)};
			 const l = el.getBoundingClientRect(), r = f.getBoundingClientRect();
			 const hit = document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
			 return { top:el.scrollTop, client:el.clientHeight, height:el.scrollHeight,
			  listTop:l.top, listBottom:l.bottom, footerTop:r.top, footerBottom:r.bottom,
			  footerHit:Boolean(hit && (hit===f || f.contains(hit))),
			  footerInsideList:el.contains(f), viewportHeight:innerHeight };
			})()`)) as ScrollReading;
			journal.push({ action: "wheel", tail, reading });
			stable = scrollBoundarySettled(reading, previous, tail) ? stable + 1 : 0;
			if (stable >= 2) return;
			previous = reading;
		}
		assert.fail(
			tail
				? "list did not settle at its visible tail by wheel"
				: "list did not settle at top by wheel",
		);
	};

	const returnPane = async () => {
		await wait(
			`Boolean(${present(SURFACE.sidebar)} || ${present(CONTROL.homeSidebar)})`,
			"no real control to return to conversations",
		);
		assert(page);
		if (!(await page.evaluate(`Boolean(${present(SURFACE.sidebar)})`)))
			await press(selector(CONTROL.homeSidebar));
		await wait(
			`Boolean(${present(SURFACE.sidebar)} && document.querySelector('[data-testid^="session-row-"]'))`,
			"returned list has no selectable conversations",
		);
		if (
			await page.evaluate(`Boolean(${present(CONTROL.sidebarSearchField)})`)
		) {
			await press(selector(CONTROL.sidebarSearch));
			await wait(
				`!${present(CONTROL.sidebarSearchField)}`,
				"search toggle did not dismiss field",
			);
		}
		await wheel(false);
	};
	const boot = async (deviceId: string, theme: string, scenario: string) => {
		const device = DEVICES[deviceId];
		assert(device, `unknown proof device ${deviceId}`);
		await selectScenario(relay, scenario);
		const fresh = await freshPage(browser, page, 30000);
		assert(fresh.ok, fresh.ok ? "" : fresh.reason);
		page = fresh.page;
		await page.send("Emulation.setDeviceMetricsOverride", {
			width: device.width,
			height: device.height,
			deviceScaleFactor: device.dpr,
			mobile: true,
		});
		await page.send("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-color-scheme", value: theme }],
		});
		const safe = await applySafeAreaInsets(page, device);
		assert(safe.applied, safe.reason ?? "safe area unavailable");
		const query = s15FlowQuery(baseUrl, theme, deviceId);
		prefix = `${deviceId}-${theme}-${scenario}`;
		journal.push({
			action: "isolated scenario boot",
			scenario,
			theme,
			device: deviceId,
		});
		await page.send("Page.navigate", {
			url: `${baseUrl}/conversations?${query}`,
		});
		await wait(
			`Boolean(${present(SURFACE.sidebar)} && document.querySelector('[data-testid^="session-row-"]')) && document.fonts.status === 'loaded'`,
			"scenario did not render a conversation",
		);
	};
	try {
		for (const theme of ["dark", "light"]) {
			await boot("iphone-15-landscape", theme, "many");
			// Search remains focused while scrolling to the first destination. This
			// is web first-tap coverage; native interception is separately probed.
			await press(selector(CONTROL.sidebarSearch));
			await wait(
				`document.activeElement === ${present(CONTROL.sidebarSearchField)}`,
				"search did not autofocus",
			);
			await wheel(true);
			await record("focused-search-tail");
			await press(selector(CONTROL.sidebarSchedules));
			await wait(
				`Boolean(${present(SCREEN.schedules)}) && !${present(SURFACE.sidebar)}`,
				"focused search footer did not navigate on first tap",
			);
			await record("focused-search-first-tap-destination");
			await press(selector(CONTROL.schedulesBack));
			await returnPane();
			for (const destination of FOOTER_DESTINATIONS) {
				await wheel(true);
				assert(page);
				const listBounds = (await page.evaluate(
					`(() => { const r = document.querySelector('[data-testid="conversations-list"]').getBoundingClientRect(); return {top:r.top,bottom:r.bottom}; })()`,
				)) as { top: number; bottom: number };
				for (const control of FOOTER_TAIL_CONTROLS) {
					const rect = await rectFor(selector(control));
					assert(
						rect.hit && rect.height >= 44,
						`${control} tail target unavailable`,
					);
					assert(
						rect.top >= listBounds.top - 1 &&
							rect.bottom <= listBounds.bottom + 1,
						`${control} not fully inside list clip`,
					);
					journal.push({ tailControl: control, rect, listBounds });
				}
				await record(`tail-before-${destination.control}`);
				await press(selector(destination.control));
				await wait(
					`Boolean(${present(destination.root)}) && !${present(SURFACE.sidebar)}`,
					`${destination.control} did not navigate on first tap`,
				);
				await record(`destination-${destination.control}`);
				await press(selector(destination.back));
				await returnPane();
				await record(`return-${destination.control}`);
				await press('[data-testid^="session-row-"]');
				await wait(
					`Boolean(${present(SURFACE.sessionTranscript)})`,
					`row not selectable after ${destination.control}`,
				);
				await record(`selected-after-${destination.control}`);
				await press(selector(CONTROL.sessionBack));
				await returnPane();
			}
			await wheel(true);
			await press(selector(CONTROL.sidebarComputers));
			await wait(
				`Boolean(${present(SURFACE.computerSwitcherSheet)}) && !${present(SURFACE.sidebar)}`,
				"workspace row did not open sheet on first tap",
			);
			await record("workspace-first-tap-sheet");
			await dismissWithEscape();
			await wait(
				`!${present(SURFACE.computerSwitcherSheet)}`,
				"workspace sheet did not close",
			);
			await returnPane();
			const row = '[data-testid^="session-row-"]';
			await press(row);
			await wait(
				`Boolean(${present(SURFACE.sessionTranscript)})`,
				"short tap did not open transcript",
			);
			await record("short-tap-transcript");
			await press(selector(CONTROL.sessionBack));
			await returnPane();
			await press(row, 1200);
			await wait(
				`Boolean(${present(SURFACE.sessionMenuSheet)})`,
				"1200ms hold did not open menu",
			);
			await record("hold-menu");
			await dismissWithEscape();
			await wait(
				`!${present(SURFACE.sessionMenuSheet)} && Boolean(${present(SURFACE.sidebar)})`,
				"Escape did not return from menu to pane",
			);
			await press(selector(CONTROL.sidebarNewChat));
			await wait(
				`Boolean(${present(SURFACE.homeComposer)}) && document.activeElement?.tagName === 'TEXTAREA'`,
				"New chat did not focus composer",
			);
			assert(page);
			await page.send("Input.insertText", {
				text: "S15 focused composer control",
			});
			await wait(
				`String(document.activeElement?.value).endsWith('S15 focused composer control')`,
				"composer did not accept input",
			);
			await record("new-chat-focused");
			for (const [scenario, receipt] of [
				["ended", SURFACE.sessionEnded],
				["degraded", SURFACE.sessionDegraded],
			] as const) {
				await boot("iphone-15-landscape", theme, scenario);
				await wait(
					`Boolean(${present(receipt)})`,
					`current-head receipt missing: ${receipt}`,
				);
				assert(page);
				const text = await page.evaluate(`${present(receipt)}.textContent`);
				assert.equal(
					String(text).trim(),
					scenario === "ended" ? "ended" : "not answering",
				);
				const rect = await rectFor(selector(receipt));
				journal.push({ receipt, text, rect });
				await record(`receipt-${receipt}`);
			}
		}
		await boot("iphone-15", "light", "many");
		await wheel(true);
		await record("portrait-tail-control");
		await press(selector(CONTROL.sidebarPast));
		await wait(
			`Boolean(${present(SCREEN.past)})`,
			"portrait footer did not navigate",
		);
		await press(selector(CONTROL.pastBack));
		await returnPane();
		await record("portrait-return-control");
		await press(selector(CONTROL.sidebarNewChat));
		await wait(
			`Boolean(${present(SURFACE.homeComposer)}) && document.activeElement?.tagName === 'TEXTAREA'`,
			"portrait New chat did not focus composer",
		);
		assert(page);
		await page.send("Input.insertText", {
			text: "Portrait focused composer control",
		});
		await wait(
			`String(document.activeElement?.value).endsWith('Portrait focused composer control')`,
			"portrait composer did not accept input",
		);
		await record("portrait-new-chat-focused");
		writeFileSync(
			join(out, "flow.json"),
			JSON.stringify(
				{
					verdict: "PASS",
					journal,
					coverage:
						"CI web input; installed native responder probe is separate, no native UI run",
				},
				null,
				2,
			),
		);
	} catch (error) {
		// Preserve the assertion even if a dead target cannot supply its failure
		// frame. A screenshot failure is additional evidence, never a green pass.
		try {
			if (page) await record("FAIL");
		} catch (frameError) {
			journal.push({ failureFrameError: String(frameError) });
		}
		writeFileSync(
			join(out, "flow.json"),
			JSON.stringify(
				{ verdict: "FAIL", error: String(error), journal },
				null,
				2,
			),
		);
		throw error;
	}
}
