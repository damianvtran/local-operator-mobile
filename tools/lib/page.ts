/**
 * Driving a real Chrome page over CDP: the bounded step, the armed target, and the
 * fresh target every cell gets.
 *
 * ONE implementation, because the two tools that drive a browser — the capture
 * harness (`tools/visual/capture.ts`) and the audit checker (`tools/audit/audit.ts`)
 * — must not drift on the parts that decide whether a run finishes at all. They
 * already did: the audit carried its own copy of `withDeadline`, and it was the
 * version BEFORE the fix below, so a `Page.navigate` that stalled past CDP's 30 s
 * command timeout rejected straight through the race and killed the run with no
 * report written. Nothing activated that path until the audit started re-driving
 * cells WITH the seed the capture applied — a seeded app holds a live relay stream,
 * which is the stall `freshPage` exists for.
 *
 * `armPage` and `freshPage` moved here unchanged, because the audit re-drives the
 * same stream screens the capture captures and needs the same target-per-cell shape;
 * the measurements that justify it are on `freshPage` itself.
 */

import { PRE_PAINT_PROBE } from "../visual/matrix.ts";
import type { CdpPage } from "./cdp.ts";
import type { launchChrome } from "./chrome.ts";

/**
 * Run `promise`, and give up on it after `ms` with a named reason.
 *
 * Every cell is bounded, and the reason is a *value* rather than a thrown
 * message: a cell that never settles must be recorded as a FAILED cell with the
 * deadline it hit, because a capture run that silently skips a cell and one that
 * hangs both leave a reviewer with no frame and no explanation. The timer is
 * unref'd so a resolved promise does not keep the process alive.
 */
export async function withDeadline<T>(
	promise: Promise<T>,
	ms: number,
	what: string,
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expiry = new Promise<{ ok: false; reason: string }>((resolve) => {
		timer = setTimeout(
			() =>
				resolve({
					ok: false,
					reason: `${what} did not complete within ${ms} ms`,
				}),
			ms,
		);
		timer.unref?.();
	});
	try {
		const winner = await Promise.race([
			promise.then(
				(value) => ({ ok: true as const, value }),
				/*
				 * A cell that THROWS is the same kind of event as one that overruns, and it
				 * used to be the run's own death instead: a `Page.navigate` that stalls past
				 * CDP's 30 s command timeout rejects, the rejection went straight through this
				 * race, and the process exited from inside `captureCell` with a stack trace and
				 * NO manifest at all — the out directory held frames and no summary, so a
				 * 45-minute job reported nothing about what it had measured. Measured
				 * 2026-10-03: the documented 72-cell command died this way on entry 39, twice,
				 * and again on a stashed tree. The caller already knows what to do with a cell
				 * that did not complete — abandon it BY NAME, then open a fresh page so the
				 * next cell cannot inherit a wedged one — so the rejection is turned into that
				 * same shape here rather than being left to unwind the run.
				 */
				(error: unknown) => ({
					ok: false as const,
					reason: `${what} threw: ${error instanceof Error ? error.message : String(error)}`,
				}),
			),
			expiry,
		]);
		return winner;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/**
 * Make a page target capture-ready: the three CDP calls every page the harness
 * drives needs, each BOUNDED and each a value rather than a throw.
 *
 * WHY BOUNDED when the CDP client already fails a command after 30 s: a throw
 * unwinds `runCapture` from inside the cell loop, so the run ends with a stack
 * trace and NO manifest on disk. That is the same shape `withDeadline` was added
 * around the cell itself for, and a browser that accepts the connection and then
 * stops answering is a measured case rather than a hypothetical one (QA hit
 * `Target.createTarget did not answer within 30000 ms`, rc 1, nothing written).
 * The pre-paint probe is part of the set because `captureCell`'s theme reporting
 * reads `window.__loCapture`, so a page without it is not one this harness can
 * report on. It is called from the ONE place a page is opened (`freshPage`),
 * so the arming cannot drift from the page it arms.
 */
/**
 * Apply a device profile's safe-area insets to the page, so the app's own
 * `env(safe-area-inset-*)` resolves them.
 *
 * EXPORTED, and that is the point of where it lives (review round 3, R18/Q9): the
 * capture and the audit both apply it, but a bespoke rig built on this module's
 * `freshPage`/`armPage` used to render a page with **zero** insets and report the
 * result as a property of the frames — two rigs did exactly that tonight, and one
 * of them filed the number as a product defect. A rig that opens its own page MUST
 * call this before it navigates, and the failure it prevents is silent: the page
 * renders, the numbers look plausible, and the clearance is missing.
 *
 * `false` means the browser refused the override (an older CDP), which is reported
 * rather than thrown: frames still carry the harness's custom properties, and the
 * caller decides whether that is fatal for the state it is capturing.
 */
export async function applySafeAreaInsets(
	page: CdpPage,
	device: {
		insets: { top: number; bottom: number; left: number; right: number };
	},
): Promise<{ applied: boolean; reason: string | null }> {
	try {
		await page.send("Emulation.setSafeAreaInsetsOverride", {
			insets: { ...device.insets },
		});
		return { applied: true, reason: null };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		console.error(
			`  note: Emulation.setSafeAreaInsetsOverride unavailable (${reason}); ` +
				"safe-area frames carry custom properties only, so env()-based layout will read 0",
		);
		return { applied: false, reason };
	}
}

export async function armPage(
	page: CdpPage,
	ms: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const steps: Array<[string, Promise<unknown>]> = [
		["Page.enable", page.send("Page.enable")],
		["Runtime.enable", page.send("Runtime.enable")],
		[
			"Page.addScriptToEvaluateOnNewDocument",
			page.send("Page.addScriptToEvaluateOnNewDocument", {
				source: PRE_PAINT_PROBE,
			}),
		],
	];
	for (const [what, call] of steps) {
		const done = await withDeadline(call, ms, what);
		if (!done.ok) return { ok: false, reason: done.reason };
	}
	return { ok: true };
}

/**
 * Close the current page target, if there is one, and open an armed replacement.
 *
 * WHY EVERY CELL GETS A FRESH TARGET, not only a wedged one.
 *
 * The app under test holds an open `text/event-stream` on its session screen, and
 * `serveDir` proxies the relay at the SAME origin it serves the build from (that
 * same-origin proxy is what lets a relay-backed cell be driven at all). Those
 * streams are connections to the app origin, they are long-lived by design, and a
 * run accumulates them across cells. Past a point the next `Page.navigate` NEVER
 * COMMITS, which is the whole of what `CDP Page.navigate did not answer within
 * 30000 ms` was reporting. Measured 2026-10-03: 11 stalls in a 104-cell `S5`
 * block, every one of them `S5/*` (the only screen that opens a stream), at the
 * same cells on every run, reproduced on `ubuntu-latest` as well as here.
 *
 * WHY THIS LAYER, and not the wait or the timeout. Chrome dispatches
 * `Page.navigate`'s reply from the navigation's reset — i.e. at COMMIT — and
 * never from the `load` event (`content/browser/devtools/protocol/page_handler.cc`:
 * `Navigate` parks the callback in `navigate_callbacks_` until
 * `NavigationReset`/`TransferNavigationRequestOwnership` fires). A reply that
 * never arrives therefore means the navigation never committed, so nothing the
 * harness waits on — `load`, `commit`, `DOMContentLoaded`, or the declared-state
 * marker — can change the outcome: the navigation has not started, it is not
 * slow. A longer timeout would only make the stall quieter, which is the failure
 * this PR series exists to remove.
 *
 * WHY CLOSING THE TARGET, and not just destroying the document. A hop through
 * `about:blank` — the one navigation that needs no socket, so it commits even
 * when the origin is busy — is not enough: it leaves the held connections in
 * place (measured: 6 before the hop, 6 after, cell after cell) and the same cells
 * stall behind it. Destroying the TARGET releases them. Measured on the 104-cell
 * `S5` block: 11 stalls and 12 cells with no frame before, 0 and 0 after, 312
 * frames in 240 s.
 *
 * The cost is one target create/close per cell, and it is not a regression in
 * rate: the `ci` tier runs at 2.12 s/cell (measured at a plan of 256 cells; 744 on
 * this head's registry), against the 2.24 s/cell the per-cell budget was titrated from. It
 * also leaves the cell loop with ONE shape instead of two — a wedged cell and a
 * healthy one now take the same path, so the recovery cannot rot out of use as the
 * failure it exists for stops happening.
 */
export async function freshPage(
	chrome: Awaited<ReturnType<typeof launchChrome>>,
	page: CdpPage | null,
	ms: number,
): Promise<{ ok: true; page: CdpPage } | { ok: false; reason: string }> {
	if (page !== null) {
		try {
			await page.send("Target.closeTarget", { targetId: page.targetId });
		} catch {
			// A target wedged beyond answering is closed by the browser when the profile
			// is torn down; the new target is what the next cell needs.
		}
	}
	/*
	 * Bounded, and a FAILURE rather than a throw. A browser that has stopped answering
	 * cannot capture anything else, and the run has to say so in its manifest instead of
	 * dying with a stack trace and nothing on disk — the shape QA hit at startup
	 * (`Target.createTarget did not answer within 30000 ms`, rc 1, no manifest), one cell
	 * later. The caller abandons the rest of the plan by name and breaks.
	 */
	const opened = await withDeadline(
		chrome.page(),
		ms,
		"the browser's next target",
	);
	if (!opened.ok)
		return {
			ok: false,
			reason: `the browser stopped answering: ${opened.reason}`,
		};
	const next = opened.value;
	const armed = await armPage(next, ms);
	if (!armed.ok)
		return {
			ok: false,
			reason: `the browser stopped answering: ${armed.reason}`,
		};
	return { ok: true, page: next };
}
