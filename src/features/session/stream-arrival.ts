import { createContext, useLayoutEffect, useMemo, useRef } from "react";
import type { TranscriptEntry } from "@/contracts";

export type StreamArrival = {
	previousText: string;
	/** Only cells in the arrival commit qualify. A virtualized cell can mount
	 * much later, with the same list props and very different provenance. */
	sealed: boolean;
};

type Sample = {
	rowId: string | undefined;
	text: string;
	epoch: number | null;
	sessionId: string;
	revision: object;
	entries: readonly TranscriptEntry[];
};

/** The projection stream owns pacing. Classify the commits it already makes;
 * don't add a frame queue between the first readable text and the transcript. */
export function useStreamArrival(
	sessionId: string,
	epoch: number | null,
	tail: TranscriptEntry | null,
	streamingRowId: string | null,
	entries: readonly TranscriptEntry[],
	reduceMotion: boolean,
) {
	const previous = useRef<Sample | null>(null);
	const rowId = tail?.id;
	const text = tail?.text ?? "";
	const assistLive =
		tail?.kind === "assistant" &&
		tail.id === streamingRowId &&
		!tail.final &&
		!tail.text_complete;
	const next = useMemo(() => {
		const old = previous.current;
		const sameStream =
			old !== null &&
			epoch !== null &&
			old.epoch === epoch &&
			old.sessionId === sessionId;
		const sameRow = sameStream && old.rowId === rowId;
		const prefix = sameRow ? old.text : "";
		const append = text.startsWith(prefix);
		// A different tail isn't necessarily a new row (e.g. a correction removed
		// the last row). Require forward continuity in the held entries.
		const newRow =
			sameStream &&
			!sameRow &&
			(old.rowId === undefined ||
				entries.some((entry) => entry.id === old.rowId)) &&
			!old.entries.some((entry) => entry.id === rowId);
		// Cancelling motion retires its identity, not just the current effect. A
		// later preference change (or a row resuming after settle) must not revive
		// a mounted block whose birth already happened under the old revision.
		const revision =
			sameRow && append && assistLive && !reduceMotion ? old.revision : {};
		const arrival: StreamArrival | null =
			!reduceMotion &&
			assistLive &&
			(sameRow || newRow) &&
			append &&
			text.length > prefix.length
				? { previousText: prefix, sealed: false }
				: null;
		return {
			arrival,
			revision,
			motion: !reduceMotion && assistLive && epoch !== null ? revision : null,
		};
	}, [assistLive, entries, epoch, reduceMotion, rowId, sessionId, text]);
	useLayoutEffect(() => {
		previous.current = {
			epoch,
			entries,
			revision: next.revision,
			rowId,
			sessionId,
			text,
		};
		if (next.arrival) next.arrival.sealed = true;
	}, [entries, epoch, next, rowId, sessionId, text]);
	return next;
}

/* ------------------------------------------------------------- delivery slot */

/** What the streaming row reads: the arrival classification and the motion token. */
export type StreamArrivalValue = {
	arrival: StreamArrival | null;
	motion: object | null;
};

/**
 * WHY A SLOT, NOT PROPS (streaming-perf audit, hotspot #1).
 *
 * `useStreamArrival` builds a NEW `arrival` object on every streamed frame. It
 * used to travel as a prop through `renderItem`'s dependency list, so every frame
 * handed React Native's `CellRenderer` (a `PureComponent`) a new `renderItem`
 * and every mounted cell, up to ~60, re-ran its row subtree to learn that
 * nothing but the streaming row had changed.
 *
 * The slot is ONE stable object per list. The list writes the latest value into
 * it while it renders (the same render-time write the list's other latches use),
 * and only the streaming row's assistant body reads it. Reading at render, with
 * no subscription, is sound because `arrival` only changes when the tail text
 * changes, and that change re-renders the streaming row anyway (its entry is a
 * new object, `reuseRows` keeps unchanged rows only). The one change that is NOT
 * a text change, motion turning off (reduce-motion flipped on, the stream
 * settling), is announced through `subscribe`, and notified from a layout effect
 * only when the `motion` token's identity changed, which is at most a few times
 * per answer rather than per frame.
 */
export type StreamArrivalSlot = {
	read(): StreamArrivalValue;
	write(value: StreamArrivalValue): void;
	subscribe(listener: () => void): () => void;
	/** Notify subscribers; called by the list's layout effect, never in render. */
	notify(): void;
};

const NO_ARRIVAL: StreamArrivalValue = { arrival: null, motion: null };

export function createStreamArrivalSlot(): StreamArrivalSlot {
	let current = NO_ARRIVAL;
	const listeners = new Set<() => void>();
	return {
		read: () => current,
		write(value) {
			current = value;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		notify() {
			for (const listener of [...listeners]) listener();
		},
	};
}

/** No provider = no streaming list above (a Markdown preview, a test): nothing
 *  arrives, nothing paces. */
export const StreamArrivalContext = createContext<StreamArrivalSlot | null>(
	null,
);
