import { describe, expect, it } from "vitest";
import {
	colorWithAlpha,
	FADE_MS,
	MAX_LAG_MS,
	PacedReveal,
	splitFade,
	TICK_MS,
	unitEnd,
} from "@/features/session/paced-reveal";

/** Run the reveal on its real cadence and record what the reader saw. */
const play = (
	reveal: PacedReveal,
	from: number,
	to: number,
): { at: number; shown: string }[] => {
	const seen: { at: number; shown: string }[] = [];
	for (let now = from; now <= to; now += TICK_MS) {
		reveal.tick(now);
		seen.push({ at: now, shown: reveal.shown() });
	}
	return seen;
};

describe("unitEnd", () => {
	it("ends a word only once the whitespace after it has arrived", () => {
		expect(unitEnd("hello", 0)).toBe(-1);
		expect(unitEnd("hello ", 0)).toBe(6);
		expect(unitEnd("hello world", 0)).toBe(6);
		expect(unitEnd("hello world", 6)).toBe(-1);
	});

	it("treats each ideograph as a unit, and never cuts before a joiner", () => {
		expect(unitEnd("日本語", 0)).toBe(1);
		expect(unitEnd("日本語", 1)).toBe(2);
		// A combining mark after the space would be orphaned by a cut.
		expect(unitEnd("a \u0301", 0)).toBe(-1);
		// A surrogate pair is one character.
		expect(unitEnd("😀 x", 0)).toBe(3);
	});
});

describe("PacedReveal", () => {
	it("shows the first word immediately, even before it is complete", () => {
		expect(new PacedReveal("Hello wor", 0, true).shown()).toBe("Hello ");
		// No complete word yet: still shows what exists, so first text is not late.
		expect(new PacedReveal("Hel", 0, true).shown()).toBe("Hel");
	});

	it("does not pace a row that was already on screen when it mounted", () => {
		const reveal = new PacedReveal("already here ", 0, false);
		expect(reveal.shown()).toBe("already here ");
		reveal.push("already here and new ", 50);
		expect(reveal.shown()).toBe("already here ");
		reveal.tick(50 + TICK_MS);
		expect(reveal.shown().length).toBeGreaterThan("already here ".length);
	});

	it("never drops, reorders or duplicates text, and always shows a prefix", () => {
		const words = Array.from({ length: 400 }, (_, at) => `w${at}`).join(" ");
		const reveal = new PacedReveal("", 0, true);
		let now = 0;
		let sent = 0;
		let nextFrame = 0;
		let frame = 0;
		const seen: string[] = [];
		while (now < 20_000) {
			// A frame every 100 ms carrying a pseudo-random number of characters.
			if (now >= nextFrame && sent < words.length) {
				frame += 1;
				sent = Math.min(words.length, sent + 17 + (frame % 7) * 13);
				reveal.push(words.slice(0, sent), now);
				nextFrame += 100;
			}
			reveal.tick(now);
			const shown = reveal.shown();
			expect(words.startsWith(shown)).toBe(true);
			seen.push(shown);
			now += TICK_MS;
		}
		// Monotonic growth: nothing reordered or taken back.
		for (let at = 1; at < seen.length; at += 1) {
			expect((seen[at] as string).startsWith(seen[at - 1] as string)).toBe(
				true,
			);
		}
		expect(reveal.shown()).toBe(words);
	});

	it("releases a received word within the lag bound, even after a 400 ms stall and burst", () => {
		const reveal = new PacedReveal("", 0, true);
		const burst = Array.from({ length: 120 }, (_, at) => `word${at}`).join(" ");
		reveal.push("start ", 0);
		play(reveal, 0, 500);
		reveal.push(`start ${burst}`, 500);
		const seen = play(reveal, 500, 500 + MAX_LAG_MS + TICK_MS);
		expect(seen.at(-1)?.shown).toBe(`start ${burst}`);
		// And it was spread out, not dropped in one go.
		const distinct = new Set(seen.map((frame) => frame.shown.length));
		expect(distinct.size).toBeGreaterThan(4);
	});

	it("releases a half-received word once the lag bound passes", () => {
		const reveal = new PacedReveal("one ", 0, true);
		reveal.push("one two thr", 10);
		play(reveal, 10, 10 + MAX_LAG_MS - TICK_MS);
		expect(reveal.shown()).toBe("one two ");
		reveal.tick(10 + MAX_LAG_MS);
		expect(reveal.shown()).toBe("one two thr");
	});

	it("flush reveals everything at once and leaves nothing fading", () => {
		const reveal = new PacedReveal("a ", 0, true);
		reveal.push("a b c d e f g ", 0);
		reveal.flush();
		expect(reveal.shown()).toBe("a b c d e f g ");
		expect(reveal.idle(0)).toBe(true);
		expect(reveal.fadeRuns(0)).toEqual([]);
	});

	it("shows a rewrite at once instead of replaying it", () => {
		const reveal = new PacedReveal("the first draft ", 0, true);
		play(reveal, 0, 400);
		reveal.push("a corrected answer ", 400);
		expect(reveal.shown()).toBe("a corrected answer ");
	});

	it("fades the newest words in three steps over the fade window, then stops", () => {
		const reveal = new PacedReveal("", 0, true);
		reveal.push("alpha ", 0);
		reveal.push("alpha beta ", 0);
		reveal.tick(TICK_MS);
		const early = reveal.fadeRuns(TICK_MS);
		expect(early.reduce((sum, run) => sum + run.len, 0)).toBeGreaterThan(0);
		const alphas = new Set<number>();
		for (let now = 0; now < FADE_MS + TICK_MS; now += TICK_MS) {
			for (const run of reveal.fadeRuns(now)) alphas.add(run.alpha);
		}
		expect([...alphas].sort()).toEqual([0.4, 0.7, 0.9]);
		expect(reveal.fadeRuns(TICK_MS + FADE_MS)).toEqual([]);
		expect(reveal.idle(TICK_MS + FADE_MS)).toBe(true);
	});

	it("measures the fade from the trimmed end so a trailing space shifts nothing", () => {
		const reveal = new PacedReveal("hello world ", 0, true);
		reveal.tick(TICK_MS);
		const runs = reveal.fadeRuns(TICK_MS);
		const total = runs.reduce((sum, run) => sum + run.len, 0);
		expect(total).toBeLessThanOrEqual("hello world".length);
	});
});

describe("splitFade", () => {
	it("cuts the tail without altering the text", () => {
		const text = "the quick brown fox";
		const { head, parts } = splitFade(text, [
			{ len: 4, alpha: 0.7 },
			{ len: 3, alpha: 0.4 },
		]);
		expect(head + parts.map((part) => part.text).join("")).toBe(text);
		expect(parts.map((part) => part.alpha)).toEqual([0.7, 0.4]);
	});

	it("never splits a word that markup shifted by a character or two", () => {
		// A cut three characters into "brown" (markup in the raw text shifted
		// the count) moves to the word's start rather than splitting it.
		const { head, parts } = splitFade("the quick brown fox", [
			{ len: 6, alpha: 0.7 },
		]);
		expect(head).toBe("the quick ");
		expect(parts[0]?.text).toBe("brown fox");
	});

	it("keeps head + parts equal to the text for arbitrary runs", () => {
		const texts = [
			"",
			"a",
			"ab cd",
			"日本語のテキスト",
			"x ".repeat(30),
			"😀😀 ok",
		];
		for (const text of texts) {
			for (let a = 0; a < 8; a += 1) {
				for (let b = 0; b < 8; b += 1) {
					const { head, parts } = splitFade(text, [
						{ len: a * 3, alpha: 0.9 },
						{ len: b * 2, alpha: 0.4 },
					]);
					expect(head + parts.map((part) => part.text).join("")).toBe(text);
				}
			}
		}
	});
});

describe("colorWithAlpha", () => {
	it("reads hex and rgb() ink and leaves unknown formats untouched", () => {
		expect(colorWithAlpha("#102030", 0.5)).toBe("rgba(16, 32, 48, 0.5)");
		expect(colorWithAlpha("#abc", 0.4)).toBe("rgba(170, 187, 204, 0.4)");
		expect(colorWithAlpha("rgb(1 2 3)", 0.7)).toBe("rgba(1, 2, 3, 0.7)");
		expect(colorWithAlpha("hsl(10 20% 30%)", 0.7)).toBe("hsl(10 20% 30%)");
	});
});
