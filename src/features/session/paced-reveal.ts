/**
 * Paced reveal of streamed answer text (native).
 *
 * WHY THIS EXISTS. The daemon sends the whole conversation at most every
 * 100 ms, so a streamed answer reaches the phone as a burst of words ten times a
 * second. Drawn as received, that is the "jerky chunks" the operator reported;
 * natively nothing animated words appended to a paragraph that was already on
 * screen (the block-level fade only covers NEW blocks, and the word-level web
 * fade is gated to `Platform.OS === "web"`). This module owns the pacing the
 * projection stream deliberately does not (`stream-arrival.ts`): it holds back
 * what has been received and releases it a word at a time at a steady pace, and
 * says how recently each released word appeared so the newest ones can be drawn
 * dimmer (`fadeRuns`).
 *
 * CONSTRAINTS (each one has a test in `paced-reveal.test.ts`):
 *  - NOTHING IS DROPPED, REORDERED OR DUPLICATED. The revealed text is always a
 *    prefix of the received text; `flush()` reveals the rest. The text a row
 *    ends on is byte-for-byte the text it received.
 *  - BOUNDED LAG. A word is never held longer than `MAX_LAG_MS` after the frame
 *    that delivered it, however large a burst is (a 400 ms stall then a burst
 *    drains inside that bound, not at reading speed).
 *  - WORD BOUNDARIES. A word is released once the whitespace after it has
 *    arrived, so a half-received "wor" never shows and then "ds" jumps in. The
 *    exceptions are the very first word (first-text latency must not regress),
 *    ideographic text (no spaces: each character is a unit), and the lag bound.
 *    A unit never ends before a combining mark, joiner or emoji modifier.
 *  - A REWRITE IS NOT PACED. If the new text is not an extension of the old
 *    (a correction), everything is shown at once: pacing text the reader has
 *    already seen would replay it.
 *
 * PURE: no timers, no React, no clock of its own; the caller passes `now`. That
 * keeps the state machine unit-testable and the scheduling (one ≤30 Hz timer,
 * only while there is something to reveal or fade) in `use-paced-text.ts`.
 */

/** Tick period: 34 ms (≤30 Hz; 33 ms would be 30.3 Hz). The cursor, and so the
 *  paragraph's render, moves no faster than this. */
export const TICK_MS = 34;
/** The backlog is drained exponentially on this time constant, which spreads a
 *  burst over a few ticks instead of dropping it in one. */
const DRAIN_MS = 200;
/** No word waits longer than this after the frame that delivered it. */
export const MAX_LAG_MS = 300;
/** A released word is drawn dimmer for this long, in three steps. */
export const FADE_MS = 240;
/** Text alpha of the three steps, newest first. The last step is followed by
 *  full ink, so the visible ramp is 4 levels over `FADE_MS`. */
export const FADE_ALPHAS = [0.4, 0.7, 0.9] as const;
/** Units scanned per tick when sizing the backlog; a first-open burst of
 *  thousands of words only needs to know it is "large". */
const SCAN_CAP = 400;

const WHITESPACE = /\s/u;
// Ideographs and kana carry no spaces: each character is its own unit, or the
// paragraph would be held until the lag bound and then dropped in one chunk.
const IDEOGRAPH =
	/[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;
// A unit must not end before one of these, or a cluster would be cut in two.
const JOINING_START = /^(?:\p{M}|\p{Emoji_Modifier}|\u200c|\u200d|\ufe0f)/u;

type Arrival = { len: number; at: number };
type Stamp = { end: number; at: number };

/** One run of the faded tail: the last `len` characters before it are at `alpha`. */
export type FadeRun = { len: number; alpha: number };

/**
 * The end of the unit starting at `from`, or -1 when no complete unit is there.
 * A unit is a word plus the whitespace after it (so the space travels with the
 * word that precedes it), or a single ideograph, or a bare whitespace run.
 */
export function unitEnd(text: string, from: number): number {
	let at = from;
	const length = text.length;
	if (at >= length) return -1;
	const first = String.fromCodePoint(text.codePointAt(at) ?? 0);
	if (!WHITESPACE.test(first) && IDEOGRAPH.test(first)) {
		const end = at + first.length;
		return JOINING_START.test(text.slice(end, end + 2)) ? -1 : end;
	}
	// The word's own characters...
	while (at < length) {
		const ch = String.fromCodePoint(text.codePointAt(at) ?? 0);
		if (WHITESPACE.test(ch) || IDEOGRAPH.test(ch)) break;
		at += ch.length;
	}
	// ...then the whitespace after it. No whitespace yet = the word may still grow.
	const wordEnd = at;
	while (at < length) {
		const ch = String.fromCodePoint(text.codePointAt(at) ?? 0);
		if (!WHITESPACE.test(ch)) break;
		at += ch.length;
	}
	if (at === wordEnd && wordEnd === length) return -1;
	return JOINING_START.test(text.slice(at, at + 2)) ? -1 : at;
}

export class PacedReveal {
	private text: string;
	private cursor: number;
	private arrivals: Arrival[] = [];
	private stamps: Stamp[] = [];
	private lastTick: number;

	/**
	 * @param paced false = the row was already on screen when pacing started
	 *   (a virtualised cell mounting mid-stream): show what is there and pace only
	 *   what arrives afterwards.
	 */
	constructor(text: string, now: number, paced: boolean) {
		this.text = text;
		this.cursor = paced ? 0 : text.length;
		this.lastTick = now;
		if (paced) {
			this.arrivals.push({ len: text.length, at: now });
			this.revealFirst(now);
		}
	}

	/** The text the reader should see now: a prefix of everything received. */
	shown(): string {
		return this.text.slice(0, this.cursor);
	}

	/** Everything has been revealed and nothing is still fading. */
	idle(now: number): boolean {
		if (this.cursor < this.text.length) return false;
		const newest = this.stamps[this.stamps.length - 1];
		return newest === undefined || now - newest.at >= FADE_MS;
	}

	/** Reveal everything now (settle, selection, backgrounding, reduced motion). */
	flush(): void {
		this.cursor = this.text.length;
		this.arrivals = [];
		this.stamps = [];
	}

	/** Record what the stream has delivered so far. Idempotent for equal text. */
	push(text: string, now: number): void {
		if (text === this.text) return;
		if (!text.startsWith(this.text)) {
			// A correction rewrote the answer: show it, do not replay it.
			this.text = text;
			this.flush();
			return;
		}
		this.text = text;
		this.arrivals.push({ len: text.length, at: now });
		if (this.cursor === 0) this.revealFirst(now);
	}

	/**
	 * Release the next words. Returns true when the visible text changed.
	 * Called by the caller's timer, at most every `TICK_MS`.
	 */
	tick(now: number): boolean {
		const dt = Math.max(0, Math.min(now - this.lastTick, 100));
		this.lastTick = now;
		if (this.cursor >= this.text.length) return false;
		const ends: number[] = [];
		for (let at = this.cursor; ends.length < SCAN_CAP; ) {
			const end = unitEnd(this.text, at);
			if (end < 0) break;
			ends.push(end);
			at = end;
		}
		let next = this.cursor;
		if (ends.length > 0) {
			const count = Math.min(
				ends.length,
				Math.max(1, Math.ceil((ends.length * Math.max(dt, 1)) / DRAIN_MS)),
			);
			next = ends[count - 1] ?? next;
		}
		// The lag bound: whatever a frame delivered MAX_LAG_MS ago is shown now,
		// even mid-word, so a stalled half-word cannot hold the answer back.
		for (const arrival of this.arrivals) {
			if (now - arrival.at >= MAX_LAG_MS && arrival.len > next)
				next = arrival.len;
		}
		return this.reveal(next, now);
	}

	/**
	 * The faded tail as runs, oldest first, over the last `Σ len` characters of
	 * the TRIMMED shown text (the markdown block's own text is trimmed, so the
	 * trailing space a word carries must not shift the runs).
	 */
	fadeRuns(now: number): FadeRun[] {
		const trimmed = this.shown().trimEnd().length;
		const runs: FadeRun[] = [];
		for (let at = this.stamps.length - 1; at >= 0; at -= 1) {
			const stamp = this.stamps[at];
			if (stamp === undefined) break;
			const age = now - stamp.at;
			if (age >= FADE_MS) break;
			const end = Math.min(stamp.end, trimmed);
			const previous = this.stamps[at - 1];
			const start = Math.min(previous?.end ?? 0, end);
			if (end <= start) continue;
			const step = Math.max(
				0,
				Math.min(
					FADE_ALPHAS.length - 1,
					Math.floor((age / FADE_MS) * FADE_ALPHAS.length),
				),
			);
			const alpha = FADE_ALPHAS[step] ?? 1;
			const last = runs[0];
			if (last && last.alpha === alpha) last.len += end - start;
			else runs.unshift({ len: end - start, alpha });
		}
		return runs;
	}

	private revealFirst(now: number): void {
		// First text must not wait for a boundary: reveal the first word, or the
		// whole of what exists if no word is complete yet.
		const end = unitEnd(this.text, 0);
		this.reveal(end > 0 ? end : this.text.length, now);
	}

	private reveal(next: number, now: number): boolean {
		if (next <= this.cursor) return false;
		this.cursor = Math.min(next, this.text.length);
		this.stamps.push({ end: this.cursor, at: now });
		this.arrivals = this.arrivals.filter(
			(arrival) => arrival.len > this.cursor,
		);
		// Stamps older than the fade are history, but the OLDEST kept stamp must
		// stay as the start boundary of the one after it (`fadeRuns`).
		while (
			this.stamps.length > 1 &&
			now - (this.stamps[1]?.at ?? now) >= FADE_MS
		)
			this.stamps.shift();
		return true;
	}
}

/** A piece of a span's tail and the alpha it is drawn at. */
export type FadePart = { text: string; alpha: number };

/**
 * Cut the end of `text` (one inline span) into the pieces `fadeRuns` describes.
 *
 * The runs were measured on the RAW received text; a span's text has had markup
 * removed (`**`, `[](…)`), so a cut can land a character or two off. Rather than
 * ever drawing half a word at a different alpha, a cut that falls inside a word
 * moves back to the word's start when that is within three characters, and
 * otherwise stays (an unbroken run such as a URL or ideographs). The text is
 * never altered: head + the parts joined is exactly `text`.
 */
export function splitFade(
	text: string,
	runs: readonly FadeRun[],
): { head: string; parts: FadePart[] } {
	const total = Math.min(
		text.length,
		runs.reduce((sum, run) => sum + run.len, 0),
	);
	if (total <= 0) return { head: text, parts: [] };
	const snap = (cut: number): number => {
		if (cut <= 0 || cut >= text.length) return cut;
		if (
			WHITESPACE.test(text.charAt(cut - 1)) ||
			WHITESPACE.test(text.charAt(cut))
		)
			return cut;
		for (let back = 1; back <= 3 && cut - back > 0; back += 1) {
			if (WHITESPACE.test(text.charAt(cut - back - 1))) return cut - back;
		}
		return cut;
	};
	const cuts: { at: number; alpha: number }[] = [];
	let at = text.length - total;
	let skipped = runs.reduce((sum, run) => sum + run.len, 0) - total;
	for (const run of runs) {
		// The oldest runs fall off the front when the span is shorter than the tail.
		const len = Math.max(0, run.len - skipped);
		skipped = Math.max(0, skipped - run.len);
		if (len === 0) continue;
		cuts.push({ at, alpha: run.alpha });
		at += len;
	}
	// Monotonic: a snap must never move a cut behind the one before it, or the
	// text between them would be drawn twice.
	const bounds: number[] = [];
	for (const cut of cuts)
		bounds.push(Math.max(snap(cut.at), bounds[bounds.length - 1] ?? 0));
	const parts: FadePart[] = [];
	for (let index = 0; index < cuts.length; index += 1) {
		const start = bounds[index] ?? 0;
		const end = bounds[index + 1] ?? text.length;
		if (end > start)
			parts.push({
				text: text.slice(start, end),
				alpha: cuts[index]?.alpha ?? 1,
			});
	}
	return { head: text.slice(0, bounds[0] ?? text.length), parts };
}

const LONG_HEX = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i;
const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const RGB_FN =
	/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i;

/**
 * `color` at `alpha`, as `rgba()`. The theme hands the ink as `#rrggbb` (or
 * `#rgb`) from the palette, or as an `rgb()` string when the CSS variable
 * resolves first; both are read. Anything else (a named colour, `hsl()`) comes
 * back unchanged: the tail is then drawn at full ink, which is the legible
 * failure direction, never a wrong colour.
 */
export function colorWithAlpha(color: string, alpha: number): string {
	const value = color.trim();
	let rgb: [number, number, number] | null = null;
	const long = LONG_HEX.exec(value);
	const short = SHORT_HEX.exec(value);
	if (long?.[1]) {
		const hex = long[1];
		rgb = [
			Number.parseInt(hex.slice(0, 2), 16),
			Number.parseInt(hex.slice(2, 4), 16),
			Number.parseInt(hex.slice(4, 6), 16),
		];
	} else if (short) {
		rgb = [1, 2, 3].map((at) =>
			Number.parseInt(`${short[at]}${short[at]}`, 16),
		) as [number, number, number];
	} else {
		const fn = RGB_FN.exec(value);
		if (fn) rgb = [Number(fn[1]), Number(fn[2]), Number(fn[3])];
	}
	if (rgb === null) return color;
	return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}
