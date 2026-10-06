/**
 * The page actions a cell takes to REACH its state — the harness's own press.
 *
 * WHY THIS EXISTS AT ALL. The harness reaches a screen by URL and nothing else,
 * so a state behind a control — a sheet the header action opens, a confirm whose
 * first tap sends nothing, a form whose submit is the only thing that can produce
 * the relay's own 409 — had no cell and could not be photographed. `S9/populated`
 * (the sheets) was withdrawn as a cell for exactly that reason, which is a
 * surface no frame shows and a reviewer is still asked to sign off.
 *
 * THE ALTERNATIVE, AND WHY IT WAS REJECTED. An app-side `lo-*` hook (the
 * `lo-dictation` family) can force a VIEW, and does, for the dictation states —
 * where the real machine cannot run on the web target at all. It is the wrong
 * tool here in both directions: it would put harness-only state into the screens
 * under review, and it cannot reach the two states that matter most here — a
 * relay REFUSAL and a write IN FLIGHT are facts about the wire. A forced
 * snapshot of a 409 would be the harness writing the very sentence it exists to
 * check. Pressing the control uses the app's own path: the request goes to the
 * relay, the relay answers with its own body, and the frame shows what a reader
 * would see.
 *
 * DETERMINISM IS THE PRICE, and this is how it is paid. The actions are declared
 * PER CELL (`CELL_OPENERS`, `tools/visual/matrix.ts`), recorded in the capture's
 * manifest as they were applied, and REPLAYED by the audit's re-drive from that
 * record — the rule the seed already follows. Nothing here is timed: each action
 * WAITS for its element (up to a bound), so a slower boot costs a slower cell
 * rather than a missing one, and an element that never appears is REPORTED as a
 * fact about the frame rather than silently skipped. A cell whose control moved
 * fails by name.
 *
 * WHAT A PRESS IS: a full pointer+mouse+click sequence, because React Native
 * Web's `Pressable` resolves a press through the responder system rather than
 * through a bare `click`. WHAT TYPING IS: the native value setter plus one
 * `input` event, the shape React's own value tracker does not de-duplicate — no
 * focus, no keyboard emulation, nothing that depends on where the caret is.
 */

import type { CdpPage } from "./cdp.ts";

/** One thing to do to the page before it settles. */
export type Affordance =
	/** Press the control carrying this `data-testid`. */
	| { click: string }
	/** Put this text into the field carrying this `data-testid`. */
	| { type: { testID: string; text: string } };

/** A compact label for a log line, a manifest or a failure sentence. */
export const describeAffordance = (action: Affordance): string =>
	"click" in action ? `click ${action.click}` : `type ${action.type.testID}`;

/** Every action of a cell, as one label. */
export const describeAffordances = (actions: readonly Affordance[]): string =>
	actions.map(describeAffordance).join(", ");

/**
 * A `data-testid` as a quoted JS string literal holding an attribute selector,
 * for splicing into `document.querySelector(...)`.
 *
 * Both layers are quoted by `JSON.stringify` rather than by hand: the OUTER one
 * is what makes it a string literal in the page's source (without it the
 * expression is `querySelector([data-testid="x"])` — a SyntaxError that reads as
 * "Invalid left-hand side in assignment"), and the inner one is what keeps a
 * testID containing a quote from ending the selector early. A cell may name an
 * id built from DATA (a milestone's name), so that is not a theoretical worry.
 */
const selector = (testID: string): string =>
	JSON.stringify(`[data-testid=${JSON.stringify(testID)}]`);

/**
 * The page-side expression for one affordance.
 *
 * Returns `"ok"` when it acted, `"missing"` when the element is not in the DOM
 * (the caller polls before believing that), and `"inert"` when the element is
 * DISABLED — a control that cannot be pressed. The third answer is separate
 * because the two failures need different readings: a missing element is a
 * harness/cell disagreement about the id, while an inert one is a cell asserting
 * a state its own control refuses to reach (a form whose submit is disabled
 * because the field is empty, say), and reporting it as "missing" would send the
 * next reader looking for the wrong thing.
 */
export function affordanceScript(action: Affordance): string {
	if ("click" in action) {
		return `(() => {
  const el = document.querySelector(${selector(action.click)});
  if (!el) return "missing";
  if (el.disabled === true || el.getAttribute("aria-disabled") === "true") return "inert";
  const fire = (type) => el.dispatchEvent(
    type.startsWith("pointer")
      ? new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })
      : new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
  );
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) fire(type);
  return "ok";
})()`;
	}
	const { testID, text } = action.type;
	return `(() => {
  const el = document.querySelector(${selector(testID)});
  if (!el) return "missing";
  if (el.disabled === true || el.getAttribute("aria-disabled") === "true") return "inert";
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return "ok";
})()`;
}

/** The result of one affordance, as the page reported it. */
export interface AffordanceOutcome {
	action: Affordance;
	/** `ok`, `inert`, or `missing`. */
	result: string;
}

/**
 * Whether an element with this `data-testid` is in the DOM.
 *
 * A presence probe, deliberately SEPARATE from `affordanceScript`: the caller that
 * waits for a screen to come up must not press anything on the way.
 */
export function probeScript(testID: string): string {
	return `(() => (document.querySelector(${selector(testID)}) ? "present" : "missing"))()`;
}

/**
 * Wait for an element to appear, and say whether it did.
 *
 * WHY THE CALLER WAITS FOR A SCREEN ROOT FIRST, RATHER THAN ONLY FOR ITS OWN
 * CONTROL. Every wait in this file is a wait on the EVENT, never on the clock —
 * and under fleet load the event can be a long time coming: MEASURED on the
 * `ci`-tier capture that added the lifecycle cells (2026-10-06, this host at load
 * 45 with ~25 sessions live), the app's first render took past eight seconds on
 * thirteen create-family cells, so an opener that waited only for ITS control
 * reported `missing` and the cell was stamped as the state it does not name. The
 * screen root is the app's own declaration that the screen is up; the control
 * lives inside it, so waiting for the root first is both cheaper and honest.
 */
export async function waitForTestID(
	page: CdpPage,
	testID: string,
	{ waitMs = 20_000, pollMs = 150 }: { waitMs?: number; pollMs?: number } = {},
): Promise<boolean> {
	if (testID === "") return true;
	const deadline = Date.now() + waitMs;
	for (;;) {
		const reading: unknown = await page.evaluate(probeScript(testID));
		if (reading === "present") return true;
		if (Date.now() >= deadline) return false;
		await sleep(pollMs);
	}
}

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a cell's actions in order, waiting for each element rather than assuming
 * it is there.
 *
 * The wait is per action and bounded: `waitMs` is generous enough for the app's
 * own boot plus a relay round trip, and a bound that fires produces a `missing`
 * outcome the caller reports rather than a hang. `pollMs` is small because the
 * cost of a poll is one `Runtime.evaluate`.
 */
export async function runAffordances(
	page: CdpPage,
	actions: readonly Affordance[],
	{ waitMs = 8000, pollMs = 100 }: { waitMs?: number; pollMs?: number } = {},
): Promise<AffordanceOutcome[]> {
	const outcomes: AffordanceOutcome[] = [];
	for (const action of actions) {
		const deadline = Date.now() + waitMs;
		let result = "missing";
		for (;;) {
			const reading: unknown = await page.evaluate(affordanceScript(action));
			result = typeof reading === "string" ? reading : "missing";
			if (result !== "missing" || Date.now() >= deadline) break;
			await sleep(pollMs);
		}
		outcomes.push({ action, result });
	}
	return outcomes;
}
