import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import type { TranscriptEntry } from "@/contracts";
import {
	createStreamArrivalSlot,
	useStreamArrival,
} from "@/features/session/stream-arrival";
import { installDomShim } from "@/testing/dom-shim";

const row = (id: string, text: string, final = false) =>
	({
		id,
		text,
		kind: "assistant",
		final,
		text_complete: final,
	}) as TranscriptEntry;

it("uses only new live content from the same connection; seals the cue at commit", async () => {
	const dom = installDomShim();
	const root = createRoot(dom.container as Element);
	let answer: ReturnType<typeof useStreamArrival> | undefined;
	type Params = Parameters<typeof useStreamArrival>;
	const Probe = ({ params }: { params: Params }) => {
		answer = useStreamArrival(...params);
		return null;
	};
	const present = async (
		epoch: number | null,
		tail: TranscriptEntry,
		earlier: TranscriptEntry[] = [],
		reduce = false,
		session = "test",
	) => {
		await act(async () =>
			root.render(
				createElement(Probe, {
					params: [
						session,
						epoch,
						tail,
						tail.final ? null : tail.id,
						[...earlier, tail],
						reduce,
					],
				}),
			),
		);
		return answer;
	};
	try {
		const seed = row("a", "Already on screen");
		expect((await present(1, seed))?.arrival).toBeNull();
		const live = row("a", "Already on screen. Live.");
		const delivered = await present(1, live);
		expect(delivered?.arrival).toEqual({
			previousText: seed.text,
			sealed: true,
		});
		expect(
			await present(1, live, [row("history", "backfilled")]),
		).toMatchObject({ arrival: null, motion: delivered?.motion });
		expect((await present(1, row("a", "Corrected")))?.motion).not.toBe(
			delivered?.motion,
		);
		expect(
			(await present(2, row("a", "Corrected from reconnect")))?.arrival,
		).toBeNull();
		const afterReconnect = row("a", "Corrected from reconnect. Live suffix.");
		expect((await present(2, afterReconnect))?.arrival?.previousText).toBe(
			"Corrected from reconnect",
		);
		expect(
			(await present(2, row("b", "Fresh block"), [afterReconnect]))?.arrival
				?.previousText,
		).toBe("");
		expect((await present(2, afterReconnect))?.arrival).toBeNull();
		expect(
			await present(2, row("a", `${afterReconnect.text} Final.`, true)),
		).toMatchObject({ arrival: null, motion: null });
		expect(
			await present(
				2,
				row("a", `${afterReconnect.text} Final. New text.`),
				[],
				true,
			),
		).toMatchObject({ arrival: null, motion: null });
		expect(
			(
				await present(
					2,
					row("a", `${afterReconnect.text} Final. New text. Other session.`),
					[],
					false,
					"other",
				)
			)?.arrival,
		).toBeNull();
	} finally {
		await act(async () => root.unmount());
		dom.dispose();
	}
});

it("delivers arrival through a slot: writes are silent, and only notify() reaches a subscriber", () => {
	/* The point of the slot (streaming-perf audit hotspot #1): the list writes a
	 * per-frame value every render without waking anyone, and announces only the
	 * motion token's change. A write that notified would re-render the streaming
	 * row for a value it already reads at render. */
	const slot = createStreamArrivalSlot();
	const heard: number[] = [];
	const stop = slot.subscribe(() => heard.push(heard.length));
	const motion = {};
	slot.write({ arrival: { previousText: "a", sealed: false }, motion });
	slot.write({ arrival: { previousText: "ab", sealed: false }, motion });
	expect(heard).toEqual([]);
	expect(slot.read().arrival?.previousText).toBe("ab");
	slot.notify();
	expect(heard).toEqual([0]);
	stop();
	slot.notify();
	expect(heard).toEqual([0]);
	expect(createStreamArrivalSlot().read()).toEqual({
		arrival: null,
		motion: null,
	});
});
