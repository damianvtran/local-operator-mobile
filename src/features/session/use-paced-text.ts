import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import {
	type FadeRun,
	PacedReveal,
	TICK_MS,
} from "@/features/session/paced-reveal";
import {
	activeTextSelection,
	subscribeTextSelection,
} from "@/features/session/text-selection";

/** Monotonic where the runtime has it; `Date.now` otherwise (never goes back
 *  far enough to matter for a 300 ms bound). */
const clock = (): number =>
	typeof performance !== "undefined" ? performance.now() : Date.now();

const NOT_SELECTING = () => false;
const selecting = () => activeTextSelection() !== null;
const NO_SUBSCRIBE = () => () => {};

export type PacedText = {
	/** The prefix of the received text the reader should see now. */
	text: string;
	/** The faded tail, oldest first, or null when nothing is fading. */
	fade: readonly FadeRun[] | null;
};

/**
 * Paced reveal of a streamed string, local to the ONE component that draws it.
 *
 * SCOPE IS THE POINT. The pacing state lives in the streaming message's own
 * `Markdown`, never in the list or the screen: a tick re-renders that message
 * (and, through `memo`, only its unsettled last block), not the 60 mounted rows
 * and not the composer. There is ONE timer per streaming message and only
 * while something is still to be revealed or is still fading: an idle or
 * settled answer holds no timer, and a paused stream stops ticking once its
 * last word has faded in.
 *
 * RENDER BOUND: ≤ 1 render per `TICK_MS` (≈30 Hz) from this hook's own timer,
 * INCLUDING the renders the parent forces when a frame extends the text (about
 * every 100 ms): a tick that finds a render has already happened since the
 * previous tick does not stack another one on top (see `drawn` below). Without
 * that the two sources add up (~10/s frame + ~30/s tick = ~40/s).
 *
 * COST WHEN NOT PACING: an instance whose `active` is false and never was (every
 * settled row's Markdown) allocates no `PacedReveal` and does not subscribe to
 * the text-selection store. The hooks are still CALLED, in the same order, on
 * every render (rules of hooks), but they are inert; turning `active` on later
 * creates the reveal then, with nothing to replay.
 *
 * `active` false means "show everything now": the answer settled, the reader
 * is selecting text, the app is backgrounded, motion is reduced (or the OS has
 * not yet said it is not), or this surface does not pace. The state is flushed,
 * not paused, so turning `active` back on never replays text already seen.
 *
 * `paced` is read once, at mount: a row that appears with its stream is paced
 * from its first word; a cell the virtualiser mounts mid-stream shows what
 * exists and paces only what arrives afterwards.
 */
export function usePacedText(
	text: string,
	active: boolean,
	paced: boolean,
): PacedText {
	const [, render] = useReducer((count: number) => count + 1, 0);
	const held = useRef<PacedReveal | null>(null);
	const lastSignature = useRef("");
	// True when a render the PARENT caused (a frame extending the text) has
	// happened since the last tick looked. Written during render on purpose: no
	// effect of ours is told about those renders. The write is idempotent (a
	// flag set to true, never read back in the same render), so a discarded or
	// replayed render can at worst make one tick skip a render it would have
	// done; the next tick (`owed`) then draws it.
	const drawn = useRef(false);
	// A render the tick itself asked for, so the render it causes is not
	// mistaken for a parent's (which would make every other tick skip).
	const asked = useRef(false);
	// A tick moved the picture but skipped its render (a render had just
	// happened); the next tick owes that render unless a render drew it first.
	const owed = useRef(false);
	// Whether this instance has rendered before. `paced` is read once, at mount:
	// a reveal created LATER (motion allowed after mount) must not replay.
	const mounted = useRef(false);
	const reader = useSyncExternalStore(
		active ? subscribeTextSelection : NO_SUBSCRIBE,
		active ? selecting : NOT_SELECTING,
		NOT_SELECTING,
	);
	const live = active && !reader;
	const now = clock();
	if (held.current === null && active) {
		held.current = new PacedReveal(
			text,
			now,
			paced && live && !mounted.current,
		);
	}
	mounted.current = true;
	if (asked.current) asked.current = false;
	else drawn.current = true;
	owed.current = false;
	// Null only while this instance has never been active: nothing to pace.
	const reveal = held.current;
	if (reveal !== null) {
		// Idempotent render-time writes: `push` is a no-op for equal text and
		// `flush` for an already-flushed reveal, and a `PacedReveal` only ever
		// moves forward, so a discarded or replayed render (StrictMode,
		// concurrent) leaves it correct.
		reveal.push(text, now);
		if (!live) reveal.flush();
	}
	const running = live && reveal !== null && !reveal.idle(now);

	useEffect(() => {
		if (!running || reveal === null) return;
		// The render that started this timer is a whole tick period old by the
		// time the first tick fires: it must not make that tick skip.
		drawn.current = false;
		const timer = setInterval(() => {
			const at = clock();
			const moved = reveal.tick(at);
			const runs = reveal.fadeRuns(at);
			// `idle` is part of the signature: when the last unit revealed is
			// whitespace-only it paints no fade run, so nothing else changes at the
			// moment the reveal goes idle, and without this the render that lets
			// `running` fall to false never happens and the interval runs forever.
			const signature = `${reveal.idle(at)}|${runs
				.map((run) => `${run.len}:${run.alpha}`)
				.join()}`;
			// Render only when the picture changed: a tick that moved nothing and
			// left every fade step where it was costs no render at all.
			if (moved || signature !== lastSignature.current || owed.current) {
				lastSignature.current = signature;
				// Coalesce with a render the parent just caused (a frame extending
				// the text): that render drew the cursor as of the previous tick, so
				// this tick's change waits for the next tick instead of stacking a
				// second render inside one tick period.
				if (drawn.current) {
					owed.current = true;
				} else {
					owed.current = false;
					asked.current = true;
					render();
				}
			}
			drawn.current = false;
		}, TICK_MS);
		return () => clearInterval(timer);
	}, [running, reveal]);

	useEffect(() => {
		if (!live || reveal === null) return;
		// Backgrounded: nobody is watching, and a timer that sleeps through a
		// suspension would resume with an arbitrary backlog. Show it all.
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") return;
			reveal.flush();
			render();
		});
		return () => subscription.remove();
	}, [live, reveal]);

	if (reveal === null) return { text, fade: null };
	const runs = running ? reveal.fadeRuns(now) : [];
	return {
		text: reveal.shown(),
		fade: runs.length > 0 ? runs : null,
	};
}
