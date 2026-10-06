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
 * WHAT IT RETURNS, and why each answer is its own: a JSON object whose `result`
 * is `"ok"` when it acted, `"missing"` when the element is not in the DOM (the
 * caller polls before believing that), `"inert"` when the element is DISABLED,
 * `"not-a-field"` when a `type` action addressed something that is not an
 * input or a textarea, and `"unreachable"` when a reader could not have put a
 * finger on the control: no box at all, nothing painted, something else under
 * the point a press would land on, or a position only a HIDDEN ancestor's
 * programmatic scroll could reach. A missing element is a harness/cell
 * disagreement about the id; an inert one is a cell asserting a state its own
 * control refuses to reach; an unreachable one is a control behind something —
 * the shape a second modal produces — where reporting it as "missing" would send
 * the next reader looking for the wrong thing.
 *
 * `"ok-after-scroll"` IS `ok` WITH A FACT ATTACHED, and the distinction is the
 * point of this version. A control a reader reaches by scrolling is genuinely
 * pressable, so refusing it would fail states the app really ships (a milestone
 * row on a 320 pt phone at 200 %), and the action therefore scrolls it in — but
 * `ok` alone would silently convert "the reader could not see this control" into
 * a pass, which is exactly the class this harness exists to catch. So the answer
 * names it and carries the control's PRE-SCROLL box, the scroll is RESTORED
 * after the press (the frame is of the resting page again, which is what the
 * design round's bounds were reasoned against), and a control declared as one
 * that must be reachable without a scroll can fail by name on that answer.
 *
 * `THE READER'S OWN TEST` is the shared preamble of both scripts: nothing is
 * pressed through a hidden or transparent box, nothing is pressed off the
 * viewport or through whatever is painted over it, and the only scrolling it does
 * is the scrolling a reader has — through ancestors whose own `overflow` is
 * `auto`/`scroll`. Measured classes this refuses, each of which the previous
 * version pressed and reported `ok`: a control covered by a modal, a zero-size
 * one, one with `pointer-events: none` (it falls out of the hit test for free), a
 * transparent one, and one an `overflow: hidden` ancestor would have to be
 * scrolled to reveal.
 */
const READER = `
  const finish = (result, pre) => JSON.stringify(pre ? { result, pre } : { result });
  const paints = (node) => {
    for (let n = node, hops = 0; n && hops < 12; n = n.parentElement, hops++) {
      const s = getComputedStyle(n);
      if (s.opacity === "0" || s.visibility === "hidden" || s.display === "none") return false;
    }
    return true;
  };
  const onScreen = (node) => {
    const r = node.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) return false;
    const hit = document.elementFromPoint(cx, cy);
    return !!hit && (hit === node || node.contains(hit));
  };
  const boxOf = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  const scrollers = [];
  let behindAHiddenClip = false;
  for (let n = el.parentElement, hops = 0; n && hops < 12; n = n.parentElement, hops++) {
    const s = getComputedStyle(n);
    const scrollable = /(auto|scroll)/.test(s.overflowY) || /(auto|scroll)/.test(s.overflowX);
    if (scrollable) { scrollers.push(n); continue; }
    if (s.overflowX === "visible" && s.overflowY === "visible") continue;
    const outer = n.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.bottom <= outer.top || r.top >= outer.bottom || r.right <= outer.left || r.left >= outer.right) behindAHiddenClip = true;
  }
  const marks = () => scrollers.map((n) => [n, n.scrollTop, n.scrollLeft]);
  const restore = (saved) => { for (const [n, top, left] of saved) { n.scrollTop = top; n.scrollLeft = left; } };`;

export function affordanceScript(action: Affordance): string {
	if ("click" in action) {
		return `(() => {
  const el = document.querySelector(${selector(action.click)});
  if (!el) return JSON.stringify({ result: "missing" });
  if (el.disabled === true || el.getAttribute("aria-disabled") === "true") return JSON.stringify({ result: "inert" });${READER}
  if (!paints(el)) return finish("unreachable");
  const wasOnScreen = onScreen(el);
  if (!wasOnScreen && behindAHiddenClip) return finish("unreachable");
  const before = boxOf(el.getBoundingClientRect());
  const saved = marks();
  if (!wasOnScreen && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", inline: "center" });
  if (!onScreen(el)) { restore(saved); return finish("unreachable"); }
  const fire = (type) => el.dispatchEvent(
    type.startsWith("pointer")
      ? new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })
      : new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
  );
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) fire(type);
  restore(saved);
  return wasOnScreen ? finish("ok") : finish("ok-after-scroll", before);
})()`;
	}
	const { testID, text } = action.type;
	return `(() => {
  const el = document.querySelector(${selector(testID)});
  if (!el) return JSON.stringify({ result: "missing" });
  if (el.disabled === true || el.getAttribute("aria-disabled") === "true") return JSON.stringify({ result: "inert" });
  if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return JSON.stringify({ result: "not-a-field" });${READER}
  if (!paints(el)) return finish("unreachable");
  const wasOnScreen = onScreen(el);
  if (!wasOnScreen && behindAHiddenClip) return finish("unreachable");
  const before = boxOf(el.getBoundingClientRect());
  const saved = marks();
  if (!wasOnScreen && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", inline: "center" });
  if (!onScreen(el)) { restore(saved); return finish("unreachable"); }
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  restore(saved);
  return wasOnScreen ? finish("ok") : finish("ok-after-scroll", before);
})()`;
}

/** The result of one affordance, as the page reported it. */
/** The box a control had BEFORE the action scrolled it into view. */
export interface AffordanceBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface AffordanceOutcome {
	action: Affordance;
	/** `ok`, `ok-after-scroll`, `inert`, `missing`, `unreachable`, or `not-a-field`. */
	result: string;
	/** Present on `ok-after-scroll` only: where the control was before the scroll. */
	preScroll?: AffordanceBox;
}

/**
 * Whether an outcome is one the caller must report as a failure.
 *
 * `ok-after-scroll` is NOT a failure — the press happened, the way a reader
 * would have made it — and it is separate from this question because a caller may
 * still care about it: the capture fails a cell by name when the control that
 * answers it is one this repository declares must be reachable without a scroll,
 * and the audit counts it as a measured replay rather than a gap.
 */
export const outcomeFailed = (result: string): boolean =>
	result !== "ok" && result !== "ok-after-scroll";

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

/** The page's JSON reply, or a `missing` outcome when it is not one. */
const readOutcome = (
	reading: unknown,
	action: Affordance,
): AffordanceOutcome => {
	if (typeof reading !== "string") return { action, result: "missing" };
	try {
		const parsed = JSON.parse(reading) as {
			result?: unknown;
			pre?: unknown;
		};
		const result =
			typeof parsed.result === "string" ? parsed.result : "missing";
		const pre = parsed.pre as AffordanceBox | undefined;
		return pre === undefined
			? { action, result }
			: { action, result, preScroll: pre };
	} catch {
		// A reply this parser cannot read is not evidence the press happened.
		return { action, result: "missing" };
	}
};

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
		let outcome: AffordanceOutcome = { action, result: "missing" };
		for (;;) {
			outcome = readOutcome(
				await page.evaluate(affordanceScript(action)),
				action,
			);
			/* TWO ANSWERS ARE NOT RETRYABLE. `ok` (and `ok-after-scroll`) is the
			 *  press landing, and `not-a-field` is a DOM fact that cannot change —
			 *  retrying either would only spend the bound. `missing`, `inert` and
			 *  `unreachable` are all "not yet": an element still arriving, a control
			 *  inert until React has re-rendered with the typed value, and a control
			 *  covered while a scrim or a sheet is still animating. Every one of them
			 *  was measured as a flake class, and a bounded retry keeps the honest
			 *  answer at the end of the bound. */
			if (
				outcome.result === "ok" ||
				outcome.result === "ok-after-scroll" ||
				outcome.result === "not-a-field"
			)
				break;
			if (Date.now() >= deadline) break;
			await sleep(pollMs);
		}
		outcomes.push(outcome);
	}
	return outcomes;
}
