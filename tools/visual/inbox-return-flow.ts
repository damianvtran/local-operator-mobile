import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONTROL,
	notificationRowId,
	SCREEN,
	SURFACE,
} from "../../src/ui/a11y.ts";
import type { CdpPage } from "../lib/cdp.ts";
import type { launchChrome } from "../lib/chrome.ts";
import { applySafeAreaInsets, freshPage } from "../lib/page.ts";
import { readRelayRecord, selectScenario } from "../lib/relay.ts";
import { DEVICES, MEASURE_PROBE } from "./matrix.ts";
import { s15FlowQuery } from "./s15-flow.ts";

const selector = (id: string) => `[data-testid=${JSON.stringify(id)}]`;
const present = (id: string) =>
	`document.querySelector(${JSON.stringify(selector(id))})`;
const target = notificationRowId("n_audit");
/** The existing row has no read-state testID. Measure its 8px round unread dot,
 * first asserting it exists on the seeded unread row (the negative control).
 * Do not infer read state from the relay alone: that was the original defect. */
export const inboxRowProbe = `(() => {
 const row = ${present(target)};
 return {present:!!row, unread:!!row && [...row.querySelectorAll('div')].some(el=>{
  const r=el.getBoundingClientRect(),s=getComputedStyle(el);
  return Math.abs(r.width-8)<.5 && Math.abs(r.height-8)<.5 && parseFloat(s.borderRadius)>=4;
 })};
})()`;
export const matchesInboxRow = (
	value: { present: boolean; unread: boolean },
	state: "read" | "gone",
) => (state === "gone" ? !value.present : value.present && !value.unread);

/** One CI-only scenario on the capture job's browser/relay. Each journey starts
 * with an isolated fixture reset. ALL transitions thereafter press controls;
 * neither history/location warps nor direct mutation requests stand in for UI.
 * Undo is a second journey because popping the detail destroys its receipt. */
export async function runInboxReturnFlow({
	browser,
	previous,
	baseUrl,
	relay,
	out,
	baseline = false,
}: {
	browser: Awaited<ReturnType<typeof launchChrome>>;
	previous: CdpPage | null;
	baseUrl: string;
	relay: string;
	out: string;
	baseline?: boolean;
}): Promise<CdpPage | null> {
	mkdirSync(out, { recursive: true });
	let page = previous,
		prefix = "";
	const journal: Array<Record<string, unknown>> = [];
	const save = (verdict: string, error?: string) =>
		writeFileSync(
			join(out, "flow.json"),
			JSON.stringify(
				{
					verdict,
					error,
					baseline,
					coverage: "Hosted web input, NOT native UI",
					journal,
				},
				null,
				2,
			),
		);
	const evaluate = async <T>(expression: string): Promise<T> => {
		assert(page);
		return (await page.evaluate(expression)) as T;
	};
	const wait = async (expression: string) => {
		assert(
			await evaluate(
				`(async()=>{const end=performance.now()+10000;while(performance.now()<end){if(${expression})return true;await new Promise(requestAnimationFrame);}return false;})()`,
			),
			`timed out: ${expression}`,
		);
	};
	const record = async (label: string) => {
		assert(page);
		// Two successive settled frames make unexpected reflow observable to QA.
		for (let i = 0; i < 2; i++) {
			await evaluate("new Promise(r=>setTimeout(r,250))");
			const image: { data?: unknown } = await page.send(
				"Page.captureScreenshot",
				{
					format: "png",
					captureBeyondViewport: false,
				},
			);
			assert.equal(typeof image.data, "string");
			const file = `${prefix}-${label}-${i}.png`;
			writeFileSync(
				join(out, file),
				Buffer.from(image.data as string, "base64"),
			);
			journal.push({
				label,
				file,
				measurements: await evaluate(MEASURE_PROBE),
				row: await evaluate(inboxRowProbe),
				route: await evaluate("location.pathname"),
			});
		}
		save("IN_PROGRESS");
	};
	const press = async (id: string) => {
		assert(page);
		// Scroll with real input when the detail's From/receipt lies below its body.
		let hit: { x: number; y: number } | null = null;
		for (let i = 0; i < 18; i++) {
			hit =
				await evaluate(`(()=>{const e=${present(id)};if(!e||e.getAttribute('aria-disabled')==='true')return null;
    const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);
    return r.width>0&&r.height>0&&y>0&&y<innerHeight&&h&&(h===e||e.contains(h))?{x,y}:null;})()`);
			if (hit) break;
			await page.send("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: 195,
				y: 450,
				deltaX: 0,
				deltaY: 260,
			});
			await evaluate("new Promise(r=>setTimeout(r,150))");
		}
		assert(hit, `no enabled hit-tested control ${id}`);
		for (const type of ["mousePressed", "mouseReleased"])
			await page.send("Input.dispatchMouseEvent", {
				type,
				...hit,
				button: "left",
				buttons: type === "mousePressed" ? 1 : 0,
				clickCount: 1,
			});
		journal.push({ action: "tap", id, hit });
	};
	const checkReturn = async (label: string, state: "read" | "gone") => {
		await wait(`Boolean(${present(SCREEN.notifications)})`);
		// Baseline records the symptom without treating an expected product bug as
		// a broken instrument. Head must converge; a failure still uploads its frame.
		if (!baseline)
			await wait(
				state === "gone"
					? `!(${inboxRowProbe}).present`
					: `(${inboxRowProbe}).present&&!(${inboxRowProbe}).unread`,
			);
		else await evaluate("new Promise(r=>setTimeout(r,750))");
		await record(label);
		const row = await evaluate<{ present: boolean; unread: boolean }>(
			inboxRowProbe,
		);
		journal.push({
			assertion: label,
			expected: state,
			actual: row,
			pass: matchesInboxRow(row, state),
		});
		if (!baseline) assert(matchesInboxRow(row, state), label);
	};
	const counts = async (expected: number, label: string, reenter = true) => {
		await press(CONTROL.inboxBack);
		await wait(`Boolean(${present(CONTROL.homeNotifications)})`);
		if (!baseline)
			await wait(
				`${present(CONTROL.homeNotifications)}?.getAttribute('aria-label')==='Notifications, ${expected} unread'`,
			);
		await record(`${label}-bell`);
		const bell = await evaluate(
			`${present(CONTROL.homeNotifications)}?.getAttribute('aria-label')`,
		);
		await press(CONTROL.homeSidebar);
		await wait(`Boolean(${present(CONTROL.sidebarNotifications)})`);
		const rail = await evaluate<string>(
			`${present(CONTROL.sidebarNotificationsCount)}?.textContent?.trim()`,
		);
		journal.push({ assertion: "badge agreement", expected, bell, rail });
		await record(`${label}-rail`);
		if (!baseline) assert.equal(rail, String(expected));
		if (!reenter) return;
		await press(CONTROL.sidebarNotifications);
		await wait(`Boolean(${present(CONTROL.inboxFilterAll)})`);
		await press(CONTROL.inboxFilterAll);
		await wait(`Boolean(${present(target)})`);
	};
	try {
		for (const theme of ["light", "dark"]) {
			for (const undo of [false, true]) {
				prefix = `${theme}-${undo ? "undo" : "dismiss"}`;
				await selectScenario(relay, "notifications-populated");
				const fresh = await freshPage(browser, page, 30000);
				assert(fresh.ok, fresh.ok ? "" : fresh.reason);
				page = fresh.page;
				const device = DEVICES["iphone-15"];
				assert(device, "phone profile missing");
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
				const query = s15FlowQuery(baseUrl, theme, "iphone-15");
				query.set("lo-text-scale", "1");
				await page.send("Page.navigate", { url: `${baseUrl}/?${query}` });
				await wait(
					`Boolean(${present(CONTROL.homeNotifications)}) && document.fonts.status==='loaded'`,
				);
				await record("before-bell");
				await press(CONTROL.homeNotifications);
				await wait(`Boolean(${present(CONTROL.inboxFilterAll)})`);
				await press(CONTROL.inboxFilterAll);
				await wait(`(${inboxRowProbe}).present && (${inboxRowProbe}).unread`);
				await record("before-unread");
				await press(target);
				await wait(
					`Boolean(${present(CONTROL.inboxDismissAll)}) && ${present(CONTROL.inboxDismissAll)}.getAttribute('aria-disabled')!=='true'`,
				);
				await record("read-detail");
				await press(CONTROL.inboxDetailBack);
				await checkReturn("read-return", "read");
				await counts(4, "read-return");
				await press(target);
				await wait(
					`Boolean(${present(CONTROL.inboxDismissAll)}) && ${present(CONTROL.inboxDismissAll)}.getAttribute('aria-disabled')!=='true'`,
				);
				await press(CONTROL.inboxDismissAll);
				await wait(`Boolean(${present(CONTROL.dialogConfirm)})`);
				await press(CONTROL.dialogConfirm);
				await wait(`Boolean(${present(CONTROL.inboxDismissAllUndo)})`);
				await record("dismiss-detail");
				if (undo) {
					await press(CONTROL.inboxDismissAllUndo);
					await wait(
						`!${present(CONTROL.inboxDismissAllUndo)} && ${present(SURFACE.inboxDismissAllReceipt)}?.textContent.includes('Restored')`,
					);
					await record("undo-detail");
				}
				await press(CONTROL.inboxDetailBack);
				await checkReturn(
					undo ? "undo-return" : "dismiss-return",
					undo ? "read" : "gone",
				);
				// Assert every Aida update, not only the opened row; n_fraud is the control.
				const ids = await evaluate<string[]>(
					`[...document.querySelectorAll('[data-testid^="notification-row-"]')].map(e=>e.getAttribute('data-testid'))`,
				);
				journal.push({ assertion: "conversation rows", undo, ids });
				if (!baseline) {
					assert(
						ids.includes(notificationRowId("n_fraud")),
						"other conversation disappeared",
					);
					for (const id of ["n_audit", "n_pr", "n_read", "n_deploy"])
						assert.equal(ids.includes(notificationRowId(id)), undo);
				}
				// Snapshot the return BEFORE leaving for badge checks; re-entering the
				// list would mask a stale baseline by triggering a fresh mount.
				await counts(
					undo ? 4 : 2,
					undo ? "undo-return" : "dismiss-return",
					false,
				);
				await press(CONTROL.sidebarNotifications);
				await wait(`Boolean(${present(CONTROL.inboxFilterAll)})`);
				/* TWO FAILURE JOURNEYS, both through the app's own controls.
				 * A: a silent return read fails while rows are on screen. The hook keeps
				 * quiet only because there are rows to keep (use-notifications.ts:201-205),
				 * so the honest expectation is: the rows that were painted STAY, and no
				 * invented "All caught up" or stranded skeleton replaces them. B: with
				 * nothing painted the same failure must be STATED, which is the Try again
				 * door QA round 1 recorded as never pressed. */
				if (!undo) {
					const row = target.replace("n_audit", "n_fraud");
					const arm = async () => {
						const armed = await fetch(`${relay}/__mock/inbox-return`, {
							method: "POST",
						});
						assert(armed.ok, "could not arm the one-shot inbox failure");
					};
					/* WARM THE ROW FIRST, so the measured return performs NO write. A detail
					 * that reads an unread item publishes `noteInboxWrite`, and the list's own
					 * settle re-read would then consume the armed refusal while the reader is
					 * still on the detail — the cell would silently measure the wrong request.
					 * Opening an already-read item writes nothing, so the only list read after
					 * `arm()` is the return's own. */
					await press(CONTROL.inboxFilterAll);
					await wait(`Boolean(${present(row)})`);
					await press(row);
					await wait(`Boolean(${present(CONTROL.inboxDetailBack)})`);
					await press(CONTROL.inboxDetailBack);
					await wait(
						`Boolean(${present(CONTROL.inboxFilterAll)}) && Boolean(${present(row)})`,
					);
					await record("silent-failure-before");
					await arm();
					await press(row);
					await wait(`Boolean(${present(CONTROL.inboxDetailBack)})`);
					await press(CONTROL.inboxDetailBack);
					await wait(`Boolean(${present(CONTROL.inboxFilterAll)})`);
					await evaluate("new Promise(r=>setTimeout(r,750))");
					const silent = await evaluate(
						`(()=>({rows:Boolean(${present(row)}),caughtUp:document.body.innerText.includes('All caught up'),skeleton:Boolean(${present(SURFACE.inboxLoading)})}))()`,
					);
					journal.push({ assertion: "silent return failure", actual: silent });
					assert.deepEqual(
						silent,
						{ rows: true, caughtUp: false, skeleton: false },
						"a silent return failure must keep the painted rows and invent nothing",
					);
					await record("silent-failure-rows");
					/* B: leave the list so the next read is the mount's own, which is NOT
					 * silent and therefore must surface the error and offer Try again. */
					await press(CONTROL.inboxBack);
					await wait(`Boolean(${present(CONTROL.homeNotifications)})`);
					await arm();
					await press(CONTROL.homeNotifications);
					await wait(`Boolean(${present(SURFACE.inboxError)})`);
					const failed = await evaluate(
						`(()=>({error:Boolean(${present(SURFACE.inboxError)}),retry:Boolean(${present(CONTROL.inboxRetry)}),caughtUp:document.body.innerText.includes('All caught up'),skeleton:Boolean(${present(SURFACE.inboxLoading)})}))()`,
					);
					journal.push({ assertion: "stated read failure", actual: failed });
					assert.deepEqual(
						failed,
						{ error: true, retry: true, caughtUp: false, skeleton: false },
						"a failed first read must state the failure with its Try again door",
					);
					await record("failure-error");
					await press(CONTROL.inboxRetry);
					/* RECOVERED MEANS ROWS, not this row: a remount starts on the UNREAD pile,
					 * and the row this cell warmed is read by now — so waiting for it here
					 * would demand the wrong filter rather than measure the recovery. */
					await wait(
						`!Boolean(${present(SURFACE.inboxError)})&&document.querySelectorAll('[data-testid^="notification-row-"]').length>0`,
					);
					await record("failure-after");
					/* The selection cell needs the All pile: it asserts the filter itself, and
					 * the read rows it toggles are only listed there. */
					await press(CONTROL.inboxFilterAll);
					await wait(`Boolean(${present(row)})`);
					journal.push({
						assertion: "inbox request/response journal",
						requests: (await readRelayRecord(relay)).filter(
							(row) =>
								typeof row === "object" &&
								row !== null &&
								"path" in row &&
								typeof row.path === "string" &&
								row.path.startsWith("/api/notifications"),
						),
					});
					/* Selection mode intentionally makes row taps toggle rather than
					 * navigate. End selection before detail, then prove both rows stay
					 * unselected after the real detail return. Filter stays All. */
					await press(CONTROL.inboxSelect);
					await press(target.replace("n_audit", "n_fraud"));
					await wait(`Boolean(${present(SURFACE.inboxSelectionBar)})`);
					await press(CONTROL.inboxSelectionDone);
					await press(target.replace("n_audit", "n_fraud"));
					await wait(`Boolean(${present(CONTROL.inboxDetailBack)})`);
					await press(CONTROL.inboxDetailBack);
					await wait(`Boolean(${present(CONTROL.inboxFilterAll)})`);
					const selection = await evaluate(
						`(()=>({all:${present(CONTROL.inboxFilterAll)}?.getAttribute('aria-checked'),selectionBar:Boolean(${present(SURFACE.inboxSelectionBar)}),selected:[...document.querySelectorAll('[data-testid^="notification-row-"]')].filter(e=>e.getAttribute('aria-checked')==='true'||e.getAttribute('aria-selected')==='true').length}))()`,
					);
					journal.push({
						assertion: "selection/filter return",
						actual: selection,
					});
					assert.deepEqual(selection, {
						all: "true",
						selectionBar: false,
						selected: 0,
					});
					await record("selection-return");
					/* Sustained focus without a detail return must not read again. Then
					 * repeat three real returns; the ledger proves one list GET each. */
					/* THE LIST'S OWN PAGE READ, and nothing else. The detail's From card walks
					 * the SAME route with `session_id`, and counting those would report two
					 * reads per return for a screen that issued one — the ledger has to name
					 * what it counts or its number is meaningless. */
					const notificationsGets = async (): Promise<string[]> =>
						(await readRelayRecord(relay))
							.filter(
								(row): row is { method: string; path: string } =>
									typeof row === "object" &&
									row !== null &&
									"method" in row &&
									row.method === "GET" &&
									"path" in row &&
									typeof row.path === "string" &&
									row.path.startsWith("/api/notifications?"),
							)
							.map((row) => row.path);
					const pageRead = (path: string) =>
						!path.includes("session_id=") && !path.includes("cursor=");
					const listGets = async () =>
						(await notificationsGets()).filter(pageRead);
					const soakStart = (await listGets()).length;
					await evaluate("new Promise(r=>setTimeout(r,3000))");
					const focusedOnly = (await listGets()).length;
					assert.equal(
						focusedOnly,
						soakStart,
						"focused list refetched without a return",
					);
					for (let i = 0; i < 3; i++) {
						await press(target.replace("n_audit", "n_fraud"));
						await wait(`Boolean(${present(CONTROL.inboxDetailBack)})`);
						await press(CONTROL.inboxDetailBack);
						await wait(`Boolean(${present(CONTROL.inboxFilterAll)})`);
						await evaluate("new Promise(r=>setTimeout(r,350))");
					}
					/* Let the LAST return's read land before counting: a fixed sleep would
					 * either be too short (a false "no read") or hide a storm behind one. */
					for (let i = 0; i < 20; i++) {
						if ((await listGets()).length >= soakStart + 3) break;
						await evaluate("new Promise(r=>setTimeout(r,150))");
					}
					const afterSoak = await listGets();
					const allPaths = await notificationsGets();
					journal.push({
						assertion: "bounded focus/refocus request ledger",
						focusedMs: 3000,
						returns: 3,
						listPageReadsBefore: soakStart,
						listPageReadsAfterSustainedFocus: focusedOnly,
						listPageReadsAfter: afterSoak.length,
						pageReads: afterSoak.slice(soakStart),
						/* Recorded, not counted: the detail's conversation-scoped walks share
						 * this route and are a different request from the list page read. */
						conversationScopedReads: allPaths.filter((path) => !pageRead(path)),
					});
					assert.equal(
						afterSoak.length,
						soakStart + 3,
						"not exactly one read per return",
					);
				}
			}
		}
		const response = await fetch(`${relay}/__mock/record`);
		assert(response.ok, "relay request journal unavailable");
		writeFileSync(
			join(out, "requests.json"),
			JSON.stringify(await response.json(), null, 2),
		);
		save(baseline ? "BASELINE_OBSERVATIONS" : "PASS");
		return page;
	} catch (error) {
		try {
			await record("FAIL");
		} catch {
			/* Original failure stays authoritative. */
		}
		save("FAIL", String(error));
		throw error;
	}
}
