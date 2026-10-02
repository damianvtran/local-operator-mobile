import { Text, View } from "react-native";

import type { TranscriptEntry } from "@/contracts";
import { Markdown } from "@/features/session/components/markdown";
import { ToolRow } from "@/features/session/components/tool-row";
import { TranscriptImage } from "@/features/session/components/transcript-image";
import {
	classifyEntry,
	transcriptRowTestID,
} from "@/features/session/projection";
import { SURFACE, transcriptImageId } from "@/ui/a11y";
import { cx } from "@/ui/variants";

/**
 * One transcript row, dispatched by kind (`docs/design/components.md` § 14).
 *
 * The treatments are not interchangeable, and the two that look most similar are
 * the two most worth separating:
 *
 *   - **The reader's own turn is a bubble**: right-aligned, capped at 85 % of the
 *     column, with a 2 px accent edge — it is something to be told apart from the
 *     answer.
 *   - **The assistant's turn has NO bubble**: a plain full-width column. The
 *     answer is the page, and wrapping it in a container says it is one more item
 *     among several when it is the thing being read.
 *
 * A `steer` is the reader's turn read quietly: no fill and no accent edge, because
 * a mid-turn instruction is a side note to a turn already in flight, and painting
 * it like a fresh prompt would misreport what it did.
 *
 * An unknown kind renders as a labelled generic row rather than vanishing: the
 * wire's `EntryKind` is open, and a row that silently disappeared would shorten the
 * conversation with no trace.
 */
export type TranscriptRowProps = {
	entry: TranscriptEntry;
	/** The anchor `transcript-row-streaming` belongs on this row. */
	streaming?: boolean;
	/** Resolves an attachment's bytes; threaded from the screen. */
	loadImage?: (entryId: string, index: number) => Promise<string | null>;
	/** Opens a subagent's own view, for a `subagent_message` row. */
	onOpenAgent?: (jobId: string) => void;
};

const SEVERITY_CLASS: Record<string, string> = {
	info: "text-info",
	warning: "text-warning",
	error: "text-danger",
};

/** The one-glyph label each labelled block carries. A glyph plus a word, never
 *  colour alone: colour-only status is an audit failure (`U-03`). */
const BLOCK_LABEL: Record<string, string> = {
	parent: "parent",
	subagent: "subagent",
	peer: "peer",
	generic: "entry",
};

export const TranscriptRow = ({
	entry,
	streaming = false,
	loadImage,
	onOpenAgent,
}: TranscriptRowProps) => {
	const kind = classifyEntry(entry);
	const testID = transcriptRowTestID(entry);
	/* The streaming anchor is an EXTRA id on the row it belongs to, so a flow can
	 * wait for it to appear and then for it to disappear (`04-session-view-steer`).
	 * It is on a zero-size sibling rather than on the row itself because an element
	 * can only carry one `testID`. */
	const anchors = (
		<>
			{streaming ? (
				<View testID={SURFACE.transcriptStreaming} aria-hidden />
			) : null}
		</>
	);

	if (kind === "tool") {
		return (
			<View className="px-3">
				<ToolRow entry={entry} testID={testID} />
				{anchors}
			</View>
		);
	}

	if (kind === "assistant") {
		return (
			<View className="px-3 py-1" testID={testID}>
				<Markdown text={entry.text} />
				{anchors}
			</View>
		);
	}

	if (kind === "user" || kind === "steer") {
		const isSteer = kind === "steer";
		return (
			<View className="items-end px-3 py-1" testID={testID}>
				<View
					className={cx(
						"max-w-[85%]",
						isSteer
							? // No fill, no accent edge: a quiet right-aligned block.
								"px-1"
							: "rounded-md border border-hairline border-l-2 border-l-accent bg-surface px-3 py-1.5",
					)}
				>
					{entry.text.length > 0 ? (
						<Text
							className={cx(
								isSteer ? "text-body-sm text-ink-muted" : "text-body text-ink",
							)}
						>
							{entry.text}
						</Text>
					) : null}
					{entry.images.length > 0 && loadImage ? (
						<View className="flex-row flex-wrap gap-1.5 pt-1.5">
							{entry.images.map((image) => (
								<TranscriptImage
									key={image.index}
									entryId={entry.id}
									index={image.index}
									mimeType={image.mime_type}
									load={loadImage}
									testID={transcriptImageId(entry.id, image.index)}
								/>
							))}
						</View>
					) : null}
				</View>
				{anchors}
			</View>
		);
	}

	if (kind === "notice" || kind === "compaction") {
		const severity = entry.details.severity ?? "info";
		return (
			<View className="flex-row items-start gap-2 px-4 py-1" testID={testID}>
				<Text
					className={cx(
						"text-mono-sm",
						SEVERITY_CLASS[severity] ?? "text-info",
					)}
					aria-hidden
				>
					{kind === "compaction" ? "≡" : severity === "error" ? "✗" : "•"}
				</Text>
				<Text className="min-w-0 flex-1 text-body-sm text-ink">
					{entry.text}
					{/* A wake notice is the one notice whose CAUSE the reader must see: it
					    explains why a session they thought was idle is answering. */}
					{entry.details.notice_kind === "wake" ? (
						<Text className="text-ink-muted"> · woken</Text>
					) : null}
				</Text>
				{anchors}
			</View>
		);
	}

	/* A message from another participant — the parent, a child, a peer session.
	 * Depth is a 2 px left edge and a label, so the row is attributable at a glance
	 * without a card inside the column. */
	const label = BLOCK_LABEL[kind] ?? kind;
	const sender = entry.details.sender;
	const who =
		kind === "peer"
			? (sender?.conversation_name ?? sender?.session_id ?? "another session")
			: label;
	return (
		<View className="px-3 py-1" testID={testID}>
			<View
				className={cx(
					"border-l-2 pl-2",
					kind === "subagent" ? "border-hairline" : "border-accent",
				)}
			>
				<View className="flex-row items-center gap-1">
					<Text className="text-meta text-ink-dim" aria-hidden>
						{kind === "peer" ? "↔" : "↳"}
					</Text>
					<Text className="text-meta text-ink-dim" numberOfLines={1}>
						{who}
					</Text>
					{onOpenAgent && kind === "subagent" && sender?.session_id ? (
						<Text
							className="text-meta text-accent"
							onPress={() => onOpenAgent(sender.session_id ?? "")}
						>
							open
						</Text>
					) : null}
				</View>
				<Text className="text-body-sm text-ink">{entry.text}</Text>
			</View>
			{anchors}
		</View>
	);
};
