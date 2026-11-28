import { act, createElement, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TICK_MS } from "@/features/session/paced-reveal";
import { usePacedText } from "@/features/session/use-paced-text";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * `usePacedText` on its own (the wiring inside `Markdown` is
 * `components/markdown-paced.test.tsx`), on a fake clock: the three properties
 * the hook promises that a Markdown-level test cannot count precisely.
 *
 *  - a text that ends in whitespace does not leave its interval running;
 *  - a tick does not stack a render on top of one a frame just caused;
 *  - an instance that never paces allocates no reveal and subscribes to nothing.
 *
 * NOT PROVEN HERE: native frame rate.
 */

const host = vi.hoisted(() => ({
	constructed: 0,
	selectionListeners: 0,
}));

vi.mock("react-native", () => ({
	AppState: {
		addEventListener: () => ({ remove: () => undefined }),
	},
}));

/* Count what the hook allocates and subscribes to, around the REAL modules. */
vi.mock("@/features/session/paced-reveal", async (original) => {
	const actual =
		await original<typeof import("@/features/session/paced-reveal")>();
	return {
		...actual,
		PacedReveal: class extends actual.PacedReveal {
			constructor(...args: ConstructorParameters<typeof actual.PacedReveal>) {
				super(...args);
				host.constructed += 1;
			}
		},
	};
});
vi.mock("@/features/session/text-selection", async (original) => {
	const actual =
		await original<typeof import("@/features/session/text-selection")>();
	return {
		...actual,
		subscribeTextSelection: (listener: () => void) => {
			host.selectionListeners += 1;
			const off = actual.subscribeTextSelection(listener);
			return () => {
				host.selectionListeners -= 1;
				off();
			};
		},
	};
});

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
let renders = 0;
let shown = "";

function Probe(props: { text: string; active: boolean; paced?: boolean }) {
	const pace = usePacedText(props.text, props.active, props.paced ?? true);
	shown = pace.text;
	return null;
}
const draw = (text: string, active = true, paced = true) =>
	act(async () =>
		root.render(
			createElement(
				Profiler,
				{
					id: "probe",
					onRender: () => {
						renders += 1;
					},
				},
				createElement(Probe, { text, active, paced }),
			),
		),
	);
/* One `act` per tick period, never one for the whole span: React defers the
 * updates a timer schedules until `act` exits, so a single long `act` folds
 * every tick into ONE render and hides exactly the renders under test. */
const advance = async (ms: number) => {
	for (let left = ms; left > 0; left -= TICK_MS)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(Math.min(TICK_MS, left));
		});
};

beforeEach(() => {
	vi.useFakeTimers();
	dom = installDomShim();
	root = createRoot(dom.container as Element);
	renders = 0;
	shown = "";
	host.constructed = 0;
	host.selectionListeners = 0;
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	vi.useRealTimers();
});

describe("usePacedText", () => {
	it("stops its timer when the text ends in a whitespace-only unit", async () => {
		// The last unit revealed is bare whitespace: it paints no fade run, so no
		// render marks the moment the reveal goes idle unless idle is compared.
		await draw("one ");
		await advance(TICK_MS);
		await draw("one \n\n");
		await advance(3000);
		expect(shown).toBe("one \n\n");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not stack a tick render on a render a frame caused (≤1 per tick period)", async () => {
		// A frame (a parent render with longer text) every 100 ms, ticks every
		// TICK_MS: unbounded stacking would be ~10/s + ~29/s.
		const word = "alpha ";
		let text = word.repeat(4);
		await draw(text);
		renders = 0;
		for (let frame = 0; frame < 10; frame += 1) {
			await advance(100);
			text += word.repeat(4);
			await draw(text);
		}
		const frames = 10;
		// 1000 ms of virtual time: the 10 frame renders plus the ticks, at most one
		// render per tick period (and never fewer words shown than a tick-only run).
		expect(renders).toBeLessThanOrEqual(Math.ceil(1000 / TICK_MS));
		expect(renders).toBeGreaterThan(frames);
		await advance(3000);
		expect(shown.trim()).toBe(text.trim());
		expect(vi.getTimerCount()).toBe(0);
	});

	it("allocates nothing and subscribes to nothing while it never paces", async () => {
		await draw("one two three ", false);
		await draw("one two three four ", false);
		expect(shown).toBe("one two three four ");
		expect(host.constructed).toBe(0);
		expect(host.selectionListeners).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("allocates and subscribes once it paces, and does not replay what it showed", async () => {
		await draw("one two three ", false);
		await draw("one two three four five ", true, true);
		// Created late (after mount): everything already there is shown at once.
		expect(host.constructed).toBe(1);
		expect(host.selectionListeners).toBe(1);
		expect(shown.startsWith("one two three ")).toBe(true);
		await advance(3000);
		expect(shown.trim()).toBe("one two three four five");
	});

	it("keeps its hook order when `active` flips both ways", async () => {
		await draw("one ", false);
		await draw("one two ", true);
		await draw("one two three ", false);
		await draw("one two three four ", true);
		await advance(3000);
		expect(shown.trim()).toBe("one two three four");
	});
});
