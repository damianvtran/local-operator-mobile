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
 *
 * WHAT A PRESS IS NOT: `dispatchEvent` delivers straight to the target, so it
 * bypasses hit-testing entirely — the first version of this file pressed a
 * control under an open modal, a zero-size control, and one with
 * `pointer-events: none`, and reported `ok` for all three. A frame of such a
 * state is a frame of something no reader could have reached, which is the exact
 * failure this module exists to prevent (review round 1, R1), and the repository
 * had already codified the distinction it was missing: `readiness.ts` separates a
 * marker's PRESENCE from its root's VISIBILITY. So every action now runs the
 * reader's own two tests before it acts — is the thing on screen, and is it the
 * thing under my finger — and answers `unreachable` when they fail.
 *
 * SCROLLING IS PART OF THE READER'S TEST. A control below the fold is one a
 * reader reaches by scrolling, so an action scrolls it into view first (the
 * `block: "center"` shape a reader's own swipe lands on) and hit-tests where the
 * finger would then be. Refusing to press anything off-screen would instead
 * reject states a reader CAN reach — a milestone row on a 320 pt phone at 200 %,
 * say — and the question this guard answers is "could a reader have done this?",
 * not "could a reader have done this without moving?". The position of a control
 * that answers a sheet is a DESIGN question, and it is answered by the frames and
 * the audit's geometry rules (U-05, U-08), not by whether the press could happen.
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
 * (the caller polls before believing that), `"inert"` when the element is
 * DISABLED — a control that cannot be pressed — and `"unreachable"` when it is
 * in the DOM and enabled but a reader could not put a finger on it: no box at
 * all, or something else is under the point the press would land on. The four are
 * separate because they need different readings: a missing element is a
 * harness/cell disagreement about the id, an inert one is a cell asserting a
 * state its own control refuses to reach (a form whose submit is disabled because
 * the field is empty, say), and an unreachable one is a control behind something
 * — the shape a second modal produces — where reporting it as "missing" would
 * send the next reader looking for the wrong thing.
 *
 * `THE READER'S OWN TEST` is the shared preamble of both scripts: scroll the
 * control into view, then require a non-zero box and that `elementFromPoint` at
 * its centre is the element or inside it. `pointer-events: none` falls out of the
 * hit test for free (the point resolves to whatever is painted behind), which is
 * why there is no separate check for it.
 */
const REACHABLE = `
  if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", inline: "center" });
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return "unreachable";
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!hit || !(hit === el || el.contains(hit))) return "unreachable";`;

export function affordanceScript(action: Affordance): string {
	if ("click" in action) {
		return `(() => {
  const el = document.querySelector(${selector(action.click)});
  if (!el) return "missing";
  if (el.disabled === true || el.getAttribute("aria-disabled") === "true") return "inert";${REACHABLE}
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
  if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return "not-a-field";${REACHABLE}
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
	/** `ok`, `inert`, `missing`, `unreachable`, or `not-a-field`. */
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
 *
 * `inert` IS RETRIED, like `missing` — and that is a fix, not symmetry for its
 * own sake. The cells whose submit is opened by a PRECEDING action (`S16/create-busy`,
 * `S16/create-refused` and `S16/detail-busy` all type into a field before they
 * press) submit a control that is correctly inert until React has re-rendered
 * with the typed value, so a single read could report a control as refusing a
 * state it accepts a poll later — the same hazard the capture's screen-root wait
 * was added for, on the other side of the boundary. It stays a bounded wait, so a
 * control that is genuinely disabled still ends as `inert`.
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
			if (
				result === "ok" ||
				result === "unreachable" ||
				result === "not-a-field"
			)
				break;
			if (Date.now() >= deadline) break;
			await sleep(pollMs);
		}
		outcomes.push({ action, result });
	}
	return outcomes;
}
