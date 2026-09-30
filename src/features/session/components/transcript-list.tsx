import { useCallback, useMemo, useRef, useState } from "react";
import {
	FlatList,
	type LayoutChangeEvent,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	View,
} from "react-native";

import type { TranscriptEntry } from "@/contracts";
import { TranscriptRow } from "@/features/session/components/transcript-row";
import { windowPolicy } from "@/features/session/windowing";
import { transcriptRowID } from "@/ui/a11y";

/**
 * The transcript: virtualised, tail-following, and never blank.
 *
 * **Virtualised for the long case, not the common one.** The relay's own
 * `long-transcript` scenario is 520 rows and every row can change height while it
 * streams, so the list is a `FlatList` with a window derived from the viewport
 * (`windowing.ts`) rather than a plain scroller. `getItemLayout` is deliberately
 * NOT used: it requires a fixed row height, and lying about it to the virtualiser
 * is how a streaming transcript jumps under the reader's finger.
 *
 * **Auto-follow only at the tail.** The view follows new content while the reader
 * is already at the bottom, and stops the moment they scroll up — the web client
 * learned this the hard way (PR #1784's U27/U28): a repaint that yanks the reader
 * back to the bottom while they are reading is worse than missing the newest line,
 * because the thing they were reading moves. The band is measured in points rather
 * than pixels so it means the same thing on every density.
 *
 * **The last-good rows stay on screen through a connection loss** — that is the
 * projection store's `stale beats blank` rule, and this component inherits it by
 * simply rendering whatever rows it is given. It never clears on its own.
 */
export type TranscriptListProps = {
	sessionId: string;
	entries: TranscriptEntry[];
	/** The row that carries `transcript-row-streaming`, or `null` when settled. */
	streamingRowId: string | null;
	/** Resolves an attachment's bytes. */
	loadImage?: (entryId: string, index: number) => Promise<string | null>;
	/** Opens a subagent's own view. */
	onOpenAgent?: (jobId: string) => void;
	/** Rendered when there are no rows at all (a seeded but empty session). An
	 *  ELEMENT rather than arbitrary nodes, because `ListEmptyComponent` takes a
	 *  component or an element and not a node list. */
	empty?: React.ReactElement | null;
	/** Rendered above the rows, inside the scroller: the status strip. */
	header?: React.ReactNode;
	testID: string;
};

/** How close to the bottom still counts as "at the tail", in points. A finger
 *  leaves the viewport within a few points of the end; demanding exact equality
 *  would silently stop following on almost every device. */
const TAIL_BAND_PT = 48;

/**
 * Scroll offsets, per session, for the life of the process.
 *
 * In memory rather than in device storage on purpose: this is a navigational
 * convenience, and making it durable would put a write on the scroll path — the
 * one path on this screen that runs at frame rate.
 */
const scrollOffsets = new Map<string, number>();

export const TranscriptList = ({
	sessionId,
	entries,
	streamingRowId,
	loadImage,
	onOpenAgent,
	empty,
	header,
	testID,
}: TranscriptListProps) => {
	const listRef = useRef<FlatList<TranscriptEntry>>(null);
	const atTail = useRef(true);
	/** Which session's offset has already been restored, held as a ref rather than
	 *  in an effect keyed on `sessionId`: the restore has to run when the list first
	 *  has content, which is an event the list emits, not a render this hook sees. */
	const restoredFor = useRef<string | null>(null);
	const [viewportPt, setViewportPt] = useState(0);

	const policy = useMemo(
		() => windowPolicy(viewportPt > 0 ? viewportPt : 844, entries.length),
		[viewportPt, entries.length],
	);

	const onLayout = useCallback((event: LayoutChangeEvent) => {
		setViewportPt(event.nativeEvent.layout.height);
	}, []);

	const onScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const { contentOffset, contentSize, layoutMeasurement } =
				event.nativeEvent;
			const distance =
				contentSize.height - contentOffset.y - layoutMeasurement.height;
			atTail.current = distance < TAIL_BAND_PT;
			scrollOffsets.set(sessionId, contentOffset.y);
		},
		[sessionId],
	);

	/* The offset is restored once, after the first content change: before that there
	 * is nothing to scroll, and a restore that ran into an empty list would silently
	 * lose the position (F-6.11 — Back preserves scroll). Keyed on the session so a
	 * session switch restores ITS offset rather than the previous one's. */
	const onContentSizeChange = useCallback(() => {
		if (restoredFor.current !== sessionId) {
			restoredFor.current = sessionId;
			const saved = scrollOffsets.get(sessionId);
			if (saved !== undefined && saved > 0) {
				listRef.current?.scrollToOffset({ offset: saved, animated: false });
				return;
			}
		}
		if (atTail.current) {
			listRef.current?.scrollToEnd({ animated: false });
		}
	}, [sessionId]);

	const renderItem = useCallback(
		({ item }: { item: TranscriptEntry }) => (
			<TranscriptRow
				entry={item}
				streaming={streamingRowId !== null && item.id === streamingRowId}
				loadImage={loadImage}
				onOpenAgent={onOpenAgent}
			/>
		),
		[streamingRowId, loadImage, onOpenAgent],
	);

	return (
		<FlatList
			ref={listRef}
			testID={testID}
			data={entries}
			keyExtractor={(entry) => entry.id}
			renderItem={renderItem}
			onLayout={onLayout}
			onScroll={onScroll}
			scrollEventThrottle={16}
			onContentSizeChange={onContentSizeChange}
			// Keyboard stays open while scrolling: the reader is scrolling to read the
			// answer to what they just typed.
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="interactive"
			ListHeaderComponent={
				<>
					{/* A session-keyed anchor for the row list itself.
					 *
					 * `08-connection-loss-recovery` addresses the transcript by
					 * `transcript-row-<SESSION_ID>` while it samples across a stream cut, to prove
					 * the rows survived it — an assertion whose whole point is that a row IS still
					 * mounted, so it needs a name that is stable across the cut. Individual rows
					 * are keyed by their own entry id (`transcript-row-<entry.id>`, which is what
					 * the per-row flows address), so the session-keyed id belongs to the list
					 * that survives: it is the row CONTAINER, named by the thing that identifies
					 * the conversation.
					 *
					 * Zero-size and hidden from the accessibility tree: it is an anchor, and a
					 * screen reader should not announce it. */}
					<View testID={transcriptRowID(sessionId)} aria-hidden />
					{header}
				</>
			}
			ListEmptyComponent={empty ?? undefined}
			// `removeClippedSubviews` is left OFF deliberately: it detaches rows that
			// scroll out of view, and a detached row loses the open/closed state of its
			// tool-row disclosure — so a reader who expands a diff, scrolls away and
			// comes back finds it shut. The window already bounds what is mounted.
			initialNumToRender={policy.initialNumToRender}
			maxToRenderPerBatch={policy.maxToRenderPerBatch}
			windowSize={policy.windowSize}
			updateCellsBatchingPeriod={40}
			contentContainerStyle={{ paddingBottom: 8 }}
		/>
	);
};
