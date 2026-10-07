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
	| { type: { testID: string; text: string } }
	/**
	 * PRESS AND HOLD the control carrying this `data-testid` for `ms`.
	 *
	 * A held press is not a slow click: React Native's `onLongPress` fires on a
	 * timer WHILE the finger is down, so a gesture the app renders (the
	 * conversations row's menu) is unreachable by any amount of clicking. Its
	 * absence is why round 3's BLOCKER — a modal raised inside the drawer's own
	 * `Modal` destroying itself — passed every gate: there was no action in this
	 * file that could make the press at all. It is therefore one affordance with
	 * two page evaluations (down, wait, up), not a pair a cell has to sequence
	 * itself.
	 */
	| { hold: { testID: string; ms: number } };

/** How long a held press lasts when a cell does not say. React Native's own
 *  `delayLongPress` default, so a bare hold is the gesture the app is built for. */
export const DEFAULT_HOLD_MS = 500;

/**
 * The recorded openers, narrowed from a manifest's `unknown`.
 *
 * EVERY SHAPE THIS FILE CAN EMIT BELONGS HERE, and that is not a formality: the
 * audit re-drives a cell by replaying what the manifest recorded, so a shape this
 * function does not know is DROPPED and the re-drive silently runs with no actions
 * at all — the state then never arrives and the cell is reported as
 * `state-not-reproduced`, which reads like the app's defect rather than the
 * harness's. It happened the moment `hold` was added (`S15/menu-open` re-driven
 * with an empty action list), which is why the shapes are enumerated here rather
 * than in the audit, and why `affordance.test.ts` asserts that EVERY action the
 * matrix declares survives this narrowing.
 *
 * A malformed entry is still DROPPED rather than thrown on — the manifest is
 * written by this repository's own capture, and a shape this cannot read is a
 * mismatch the readiness comparison surfaces as a missing state marker: a failure
 * that names the cell, rather than a crash that names nothing.
 */
export function narrowAffordances(value: unknown): Affordance[] {
	if (!Array.isArray(value)) return [];
	const out: Affordance[] = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) continue;
		const row = entry as Record<string, unknown>;
		if (typeof row.click === "string") {
			out.push({ click: row.click });
			continue;
		}
		const hold =
			typeof row.hold === "object" && row.hold !== null
				? (row.hold as Record<string, unknown>)
				: null;
		if (hold !== null) {
			if (typeof hold.testID === "string" && typeof hold.ms === "number") {
				out.push({ hold: { testID: hold.testID, ms: hold.ms } });
			}
			continue;
		}
		const spec =
			typeof row.type === "object" && row.type !== null
				? (row.type as Record<string, unknown>)
				: null;
		if (spec === null) continue;
		if (typeof spec.testID === "string" && typeof spec.text === "string") {
			out.push({ type: { testID: spec.testID, text: spec.text } });
		}
	}
	return out;
}

/** A compact label for a log line, a manifest or a failure sentence. */
export const describeAffordance = (action: Affordance): string => {
	if ("click" in action) return `click ${action.click}`;
	if ("hold" in action) return `hold ${action.hold.testID} ${action.hold.ms}ms`;
	return `type ${action.type.testID}`;
};

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
  /*
   * WAIT FOR THE LAYOUT TO STOP MOVING, then measure once. Deciding off a live
   * measurement made the answer nondeterministic (review round 3, R15): the
   * description field's box ends at y 564 of a 568 pt phone, and the sheet RISES
   * 40 pt on entry, so the same press read "already on screen" or "needed a
   * scroll" depending on which animation frame the opener happened to run on —
   * the frames were byte-identical and the label was not. Two consecutive
   * animation frames with the same box is the event to wait for; thirty of them
   * is the bound, and a box still moving after ~1 s is measured where it is.
   */
  const settle = async (node) => {
    let last = null;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = node.getBoundingClientRect();
      if (last && r.left === last.left && r.top === last.top && r.width === last.width && r.height === last.height) return;
      last = r;
    }
  };
  const paints = (node) => {
    for (let n = node, hops = 0; n && hops < 12; n = n.parentElement, hops++) {
      const s = getComputedStyle(n);
      if (s.opacity === "0" || s.visibility === "hidden" || s.display === "none") return false;
    }
    return true;
  };
  /* Geometry, not the hit test: whether the box is inside the viewport is a fact
   * about the layout, while whether the centre point resolves to the element can
   * change with what is painted over it — which is what made the same press answer
   * \`ok\` on one run and \`ok-after-scroll\` on the next. */
  const withinViewport = (node) => {
    const r = node.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return cx >= 0 && cy >= 0 && cx <= vw && cy <= vh;
  };
  const hitSelf = (node) => {
    const r = node.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
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
  /*
   * The scrollers an action moved, AND THE DOCUMENT ITSELF: a press that scrolls
   * the document is one a bare \`overflow\` walk does not see, and a frame after it
   * would be of a page displaced by however far the document moved (review round
   * 3, Q6 — latent on this app, whose root leaves the document unscrollable, and
   * cheap to close rather than to leave as a carve-out against the property).
   */
  const marks = () => [
    ...scrollers.map((n) => [n, n.scrollTop, n.scrollLeft]),
    [document.scrollingElement || document.documentElement, (document.scrollingElement || document.documentElement).scrollTop, (document.scrollingElement || document.documentElement).scrollLeft],
  ];
  const restore = (saved) => { for (const [n, top, left] of saved) { if (n) { n.scrollTop = top; n.scrollLeft = left; } } };
  const press = (node, types) => {
    for (const type of types) node.dispatchEvent(
      type.startsWith("pointer")
        ? new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })
        : new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
    );
  };
  const PRESS = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
  /*
   * THE READER'S APPROACH, shared by every action: settle, refuse anything a
   * reader could not touch or see, then bring an off-screen control in with a
   * scroll a reader could actually make. Returns the verdict to report — the
   * press itself is the caller's, because a hold is the same approach with a
   * different release.
   */
  const approach = async () => {
    await settle(el);
    if (!paints(el)) return { stop: finish("unreachable") };
    const atRest = withinViewport(el) && !behindAHiddenClip;
    const before = boxOf(el.getBoundingClientRect());
    const saved = marks();
    if (!hitSelf(el)) {
      if (behindAHiddenClip) return { stop: finish("unreachable") };
      if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", inline: "center" });
      if (!hitSelf(el)) { restore(saved); return { stop: finish("unreachable") }; }
    }
    return { saved, verdict: atRest ? finish("ok") : finish("ok-after-scroll", before) };
  };`;

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
 * that must be reachable without a scroll can fail by name on that answer. The
 * label is decided by the SETTLED geometry, never by whether a scroll happened
 * to be needed, because the same press must give the same answer on the same
 * layout (review round 3, R15).
 *
 * A HOLD is two evaluations — down, wait the cell's own duration, up — because
 * `onLongPress` fires on a timer while the finger is down. The gap is real time
 * in the page rather than a synthetic event pair, which is what makes the state
 * behind a gesture reachable at all (round 3's BLOCKER was invisible to every
 * gate for exactly its absence).
 */
export function affordanceScript(action: Affordance): string {
	if ("click" in action) {
		return `(async () => {
  const el = document.querySelector(${selector(action.click)});
  if (!el) return JSON.stringify({ result: "missing" });
  if (el.disabled === true || el.getAttribute("aria-disabled") === "true") return JSON.stringify({ result: "inert" });${READER}
  const reached = await approach();
  if (reached.stop) return reached.stop;
  press(el, PRESS);
  restore(reached.saved);
  return reached.verdict;
})()`;
	}
	if ("hold" in action) {
		return `(async () => {
  const el = document.querySelector(${selector(action.hold.testID)});
  if (!el) return JSON.stringify({ result: "missing" });
  if (el.disabled === true || el.getAttribute("aria-disabled") === "true") return JSON.stringify({ result: "inert" });${READER}
  const reached = await approach();
  if (reached.stop) return reached.stop;
  /* The gesture is left OPEN: the caller waits the cell's own duration and then
   *  runs the release, which is what makes the hold a hold rather than a click
   *  with a pause after it. */
  window.__loHold = { saved: reached.saved, verdict: reached.verdict };
  press(el, ["pointerdown", "mousedown"]);
  return JSON.stringify({ result: "holding" });
})()`;
	}
	const { testID, text } = action.type;
	return `(async () => {
  const el = document.querySelector(${selector(testID)});
  if (!el) return JSON.stringify({ result: "missing" });
  if (el.disabled === true || el.getAttribute("aria-disabled") === "true") return JSON.stringify({ result: "inert" });
  if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return JSON.stringify({ result: "not-a-field" });${READER}
  const reached = await approach();
  if (reached.stop) return reached.stop;
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  restore(reached.saved);
  return reached.verdict;
})()`;
}

/**
 * The page-side release of a held press, paired with the `hold` script above.
 *
 * It answers with the HELD press's verdict, not its own: the gesture is one
 * action, and what a cell wants to know is whether the control it held was where
 * the reader meets it. A release against an element that has gone (the surface it
 * was on was unmounted mid-hold) is reported as `missing` — a fact about the
 * gesture, and the same reading a `click` on a gone control gives.
 */
export function releaseAffordanceScript(action: Affordance): string {
	const testID = "hold" in action ? action.hold.testID : "";
	return `(() => {
  const held = window.__loHold || null;
  window.__loHold = null;
  const el = document.querySelector(${selector(testID)});
  if (!el) return JSON.stringify({ result: "missing" });
  const fire = (type) => el.dispatchEvent(
    type.startsWith("pointer")
      ? new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true })
      : new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
  );
  for (const type of ["pointerup", "mouseup", "click"]) fire(type);
  if (held && held.saved) {
    for (const [node, top, left] of held.saved) { if (node) { node.scrollTop = top; node.scrollLeft = left; } }
  }
  return held && held.verdict ? held.verdict : JSON.stringify({ result: "ok" });
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
			/* THE TWO HALVES OF A HOLD. The down answers `holding` — the finger is on
			 *  the control and this function owes the release — and the wait between
			 *  them is the cell's own duration. The release reports the DOWN's verdict,
			 *  so the outcome a manifest carries is one gesture rather than an
			 *  implementation detail of how it was made. */
			if ("hold" in action && outcome.result === "holding") {
				await sleep(action.hold.ms);
				outcome = readOutcome(
					await page.evaluate(releaseAffordanceScript(action)),
					action,
				);
				break;
			}
			/* THREE ANSWERS ARE NOT RETRYABLE. `ok` (and `ok-after-scroll`) is the
			 *  press landing, `not-a-field` is a DOM fact that cannot change —
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
