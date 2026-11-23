import { useLayoutEffect, useMemo, useRef } from "react";
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
