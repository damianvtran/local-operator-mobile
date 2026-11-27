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
 * and not the composer. There is ONE timer per streaming message, ≤30 Hz, and
 * only while something is still to be revealed or is still fading: an idle or
 * settled answer holds no timer, and a paused stream stops ticking once its
 * last word has faded in.
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
	const reader = useSyncExternalStore(
		subscribeTextSelection,
		selecting,
		NOT_SELECTING,
	);
	const live = active && !reader;
	const now = clock();
	if (held.current === null)
		held.current = new PacedReveal(text, now, paced && live);
	const reveal = held.current;
	reveal.push(text, now);
	if (!live) reveal.flush();
	const running = live && !reveal.idle(now);

	useEffect(() => {
		if (!running) return;
		const timer = setInterval(() => {
			const at = clock();
			const moved = reveal.tick(at);
			const runs = reveal.fadeRuns(at);
			const signature = runs.map((run) => `${run.len}:${run.alpha}`).join();
			// Render only when the picture changed: a tick that moved nothing and
			// left every fade step where it was costs no render at all.
			if (moved || signature !== lastSignature.current) {
				lastSignature.current = signature;
				render();
			}
		}, TICK_MS);
		return () => clearInterval(timer);
	}, [running, reveal]);

	useEffect(() => {
		if (!live) return;
		// Backgrounded: nobody is watching, and a timer that sleeps through a
		// suspension would resume with an arbitrary backlog. Show it all.
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") return;
			reveal.flush();
			render();
		});
		return () => subscription.remove();
	}, [live, reveal]);

	const runs = running ? reveal.fadeRuns(now) : [];
	return {
		text: reveal.shown(),
		fade: runs.length > 0 ? runs : null,
	};
}
