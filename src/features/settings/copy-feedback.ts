/**
 * The "Copy diagnostics" button's label state, as a small machine the Node
 * suite can drive over a fake clock (PR #261 R7, U7, D9).
 *
 * Round 1 set a "copied" flag that never reset, so the button read
 * "Diagnostics copied" for the rest of the screen's life and a second copy
 * after the state changed gave no feedback; and a refused clipboard (the web's
 * permission prompt, a locked device) was an unhandled rejection with nothing
 * on screen. Now: `copied` or `failed` shows for `resetMs`, then the label
 * returns to "Copy diagnostics"; a new press restarts the window.
 */

export type CopyFeedback = "idle" | "copied" | "failed";

/** How long the confirmation stays. The design reviews asked for "about 2 s";
 *  it is above the kit's own floor for reading one short line
 *  (`TOAST_MIN_MS`, 1050 ms) with room for a screen reader to announce it. */
export const COPY_FEEDBACK_MS = 2_000;

export type CopyFeedbackTimers = {
	setTimeout: (run: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
};

export function createCopyFeedback(deps: {
	write: (text: string) => Promise<unknown>;
	onChange: (state: CopyFeedback) => void;
	resetMs?: number;
	timers?: CopyFeedbackTimers;
}): { copy: (text: string) => Promise<void>; dispose: () => void } {
	const timers: CopyFeedbackTimers = deps.timers ?? {
		setTimeout: (run, ms) => setTimeout(run, ms),
		clearTimeout: (handle) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>),
	};
	let timer: unknown = null;
	let disposed = false;
	const show = (state: CopyFeedback) => {
		if (disposed) return;
		if (timer !== null) timers.clearTimeout(timer);
		deps.onChange(state);
		timer = timers.setTimeout(() => {
			timer = null;
			if (!disposed) deps.onChange("idle");
		}, deps.resetMs ?? COPY_FEEDBACK_MS);
	};
	return {
		copy: async (text) => {
			try {
				await deps.write(text);
				show("copied");
			} catch {
				show("failed");
			}
		},
		dispose: () => {
			disposed = true;
			if (timer !== null) timers.clearTimeout(timer);
			timer = null;
		},
	};
}
