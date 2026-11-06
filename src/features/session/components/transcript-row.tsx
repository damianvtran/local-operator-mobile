import { memo } from "react";
import { Text, View } from "react-native";

import type { TranscriptEntry } from "@/contracts";
import { AskResponseRow } from "@/features/session/components/ask-response-row";
import {
	CollapsedRow,
	firstLine,
	shouldFold,
} from "@/features/session/components/collapsed-row";
import { ImageGenCard } from "@/features/session/components/imagegen-card";
import { Markdown } from "@/features/session/components/markdown";
import { ToolRow } from "@/features/session/components/tool-row";
import { TranscriptImage } from "@/features/session/components/transcript-image";
import { imageGenView } from "@/features/session/imagegen";
import {
	classifyEntry,
	hubLabel,
	isHubReceipt,
	peerLabel,
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
 *
 * **MEMOISED, AND THAT IS A CORRECTNESS REQUIREMENT, NOT AN OPTIMISATION.**
 * React Native's cell renderer is a `PureComponent`, so a row's identity is its
 * only bail-out: without `memo` every mounted row re-renders on every relay
 * frame (a 60-row window, ten frames a second). The list hands this component a
 * STABLE `entry` object for a row whose content did not change
 * (`transcript-list.tsx`'s `reuseRows`), so a shallow compare is enough. Its
 * props are all either that entry, a boolean, or a callback the screen keeps
 * stable.
 */
export type TranscriptRowProps = {
	entry: TranscriptEntry;
	/** The anchor `transcript-streaming` belongs on this row. */
	streaming?: boolean;
	/** Resolves an attachment's bytes; threaded from the screen. */
	loadImage?: (entryId: string, index: number) => Promise<string | null>;
	/** Opens a subagent's own view, for a `subagent_message` row. */
	onOpenAgent?: (jobId: string) => void;
	/** Opens the full-screen player for a video artifact a generation row
	 *  carries — threaded from the screen so the route push (and its
	 *  session-scoped params) stays the screen's business. */
	onOpenVideo?: (entryId: string, index: number) => void;
	/** The turn interrupt, threaded to the image-gen card's Cancel. The screen
	 *  withholds it while the composer's own Stop is not visible, so the two
	 *  controls share one gate (`composer.controls.stopVisible`). Resolves
	 *  whether the request reached the relay (review round 1, F2). */
	onCancelTurn?: () => Promise<boolean>;
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

const TranscriptRowImpl = ({
	entry,
	streaming = false,
	loadImage,
	onOpenAgent,
	onOpenVideo,
	onCancelTurn,
}: TranscriptRowProps) => {
	const kind = classifyEntry(entry);
	const testID = transcriptRowTestID(entry);
	/* The image-gen arm: a tool row in the detection set renders as the progress
	 *  card instead of the generic tool row (`imagegen.ts` owns the set and the
	 *  view-model; this file only chooses which treatment to hand it to). */
	const imageGen = kind === "tool" ? imageGenView(entry) : null;
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
			<View className="px-4">
				{imageGen !== null ? (
					<ImageGenCard
						view={imageGen}
						entryId={entry.id}
						loadImage={loadImage}
						onCancelTurn={onCancelTurn}
						onOpenVideo={onOpenVideo}
						testID={testID}
					/>
				) : (
					<ToolRow entry={entry} testID={testID} />
				)}
				{anchors}
			</View>
		);
	}

	if (kind === "ask") {
		return (
			<View className="px-4" testID={testID}>
				{/* The card carries the kind's own id (`ask-response-card` /
				 *  `ask-timeout-card`) UNDER the row's standard anchor, because the
				 *  transcript row keeps one addressable name per row while the audit
				 *  cells need the state — the same split the streaming anchor uses. */}
				<AskResponseRow
					entry={entry}
					testID={
						entry.kind === "ask_timeout"
							? SURFACE.askTimeoutCard
							: SURFACE.askResponseCard
					}
				/>
				{anchors}
			</View>
		);
	}

	if (kind === "assistant") {
		/* NEVER COLLAPSIBLE (design item 9). The answer is the page, not an event:
		 *  folding it would hide the thing the reader came for, which is worse than
		 *  the bug the fold exists to fix. Same rule as an `ask` below. */
		return (
			<View className="px-4 py-1" testID={testID}>
				<Markdown text={entry.text} />
				{anchors}
			</View>
		);
	}

	if (kind === "user" || kind === "steer") {
		const isSteer = kind === "steer";
		/* A SENT MESSAGE FOLDS LIKE ANY OTHER EVENT (design item 9: "sent message —
		 *  collapsed"). Only when it does not fit one line, and never when it
		 *  carries an image: there the image IS the payload, and folding it would
		 *  hide the thing that was sent behind a summary of its caption. Its own
		 *  text stays the accessible name, so a fold hides nothing from a screen
		 *  reader. */
		if (entry.images.length === 0 && shouldFold(entry.text)) {
			return (
				<View className="px-4 py-1" testID={testID}>
					<CollapsedRow
						glyph={isSteer ? "↪" : "→"}
						glyphClass={isSteer ? "text-ink-dim" : "text-accent"}
						summary={firstLine(entry.text)}
						bodyClass={isSteer ? "text-ink-muted" : "text-ink"}
						accessibilityLabel={entry.text}
					>
						<Text
							className={cx(
								isSteer
									? "text-body-sm text-ink-muted"
									: "text-body-sm text-ink",
							)}
						>
							{entry.text}
						</Text>
					</CollapsedRow>
					{anchors}
				</View>
			);
		}
		return (
			<View className="items-end px-4 py-1" testID={testID}>
				<View
					className={cx(
						"max-w-[85%]",
						isSteer
							? // No fill, no accent edge: a quiet right-aligned block.
								"px-1"
							: "rounded-md border border-hairline border-s-2 border-s-accent bg-surface px-3 py-1.5",
					)}
				>
					{entry.text.length > 0 ? (
						<Text
							className={cx(
								// The message body's role is `body-sm` 14: the relay's own
								// `--text-body` step (design item 11). It was `body` 16, one step
								// above the reference and 1.23x the tool trace it sits beside.
								isSteer
									? "text-body-sm text-ink-muted"
									: "text-body-sm text-ink",
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
		const glyph =
			kind === "compaction" ? "≡" : severity === "error" ? "✗" : "•";
		const ink = SEVERITY_CLASS[severity] ?? "text-info";
		/* A NOTICE FOLDS, AND AN ERROR FOLDS WITHOUT HIDING ITS OWN FACT (design
		 *  item 9: "a collapsed error that hides why is the bug being fixed"). The
		 *  summary line IS the severity glyph plus the first line of the notice, so
		 *  the fact stays on screen while the stack of machine prose does not. */
		if (shouldFold(entry.text)) {
			return (
				<View className="px-4 py-1" testID={testID}>
					<CollapsedRow
						glyph={glyph}
						glyphClass={ink}
						summary={firstLine(entry.text)}
						accessibilityLabel={entry.text}
					>
						<Text className="min-w-0 flex-1 text-body-sm text-ink">
							{entry.text}
							{entry.details.notice_kind === "wake" ? (
								<Text className="text-ink-muted"> · woken</Text>
							) : null}
						</Text>
					</CollapsedRow>
					{anchors}
				</View>
			);
		}
		return (
			<View className="flex-row items-start gap-2 px-4 py-1" testID={testID}>
				<Text className={cx("text-mono-sm", ink)} aria-hidden>
					{glyph}
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
	const hub = isHubReceipt(entry);
	const who =
		kind === "peer" ? peerLabel(sender) : hub ? hubLabel(entry) : label;
	const body =
		hub && typeof entry.details.body === "string"
			? entry.details.body
			: entry.text;
	const intent = hub
		? [
				entry.details.expects_reply === true ? "Reply requested" : "",
				entry.details.steer === true ? "Steered" : "",
			].filter(Boolean)
		: [];
	/* Already-provided refs retain the message's own ID/index. No producer
	 *  upload support or synthetic media endpoint is implied. */
	const images =
		(kind === "parent" || kind === "subagent") &&
		entry.images.length > 0 &&
		loadImage ? (
			<View className="flex-row flex-wrap gap-1.5 pt-1.5">
				{entry.images.map((image) => (
					<TranscriptImage
						key={image.index}
						entryId={entry.id}
						index={image.index}
						mimeType={image.mime_type}
						testID={transcriptImageId(entry.id, image.index)}
						load={loadImage}
					/>
				))}
			</View>
		) : null;
	/* A MESSAGE FROM ANOTHER PARTICIPANT FOLDS TO ONE EXPANDABLE LINE (design
	 *  item 9 — and the operator's own report: "some things like peer messages
	 *  are not properly condensed into an expandable line… make sure that these
	 *  are properly collapsed").
	 *
	 *  This is where the two references disagree and the design pass settles it:
	 *  the relay leaves a peer body OPEN, the desktop collapses it unless detail
	 *  is asked for. Long bodies follow the DESKTOP (`shouldFold`: more than one
	 *  non-empty line, or more than 80 characters), because the operator's
	 *  complaint is precisely that a peer message ate the screen. A body under
	 *  that budget keeps today's treatment and grows no chevron — a fold that
	 *  hides nothing is chrome that lies about there being more. */
	if (shouldFold(body)) {
		return (
			<View className="px-4 py-1" testID={testID}>
				<CollapsedRow
					glyph={kind === "peer" ? "↔" : "↳"}
					glyphClass={kind === "subagent" ? "text-ink-dim" : "text-accent"}
					label={who}
					summary={firstLine(body)}
					meta={intent.join(" · ")}
					accessibilityLabel={who.length > 0 ? `${who}: ${body}` : body}
				>
					<Text className="text-body-sm text-ink">{body}</Text>
					{images}
				</CollapsedRow>
				{anchors}
			</View>
		);
	}
	return (
		<View className="px-4 py-1" testID={testID}>
			<View
				className={cx(
					"border-s-2 ps-2",
					kind === "subagent" ? "border-hairline" : "border-accent",
				)}
			>
				<View className="flex-row items-center gap-1">
					<Text className="text-meta text-ink-dim" aria-hidden>
						{kind === "peer" ? "↔" : "↳"}
					</Text>
					<Text className="text-meta text-ink-dim" numberOfLines={1}>
						{who}
						{intent.length ? ` · ${intent.join(" · ")}` : ""}
					</Text>
					{/* A supplied job ID owns the agent route. A sender session ID is
					    not that coordinate and must never stand in for one. */}
					{onOpenAgent && kind === "subagent" && entry.details.job_id ? (
						<Text
							className="text-meta text-accent"
							onPress={() => onOpenAgent(entry.details.job_id ?? "")}
						>
							open
						</Text>
					) : null}
				</View>
				{hub && entry.details.direction ? (
					<Text className="text-meta text-ink-muted">
						{entry.details.direction}
						{entry.details.job_id && entry.details.label
							? ` · Job ${entry.details.job_id}`
							: ""}
					</Text>
				) : null}
				<Text className="text-body-sm text-ink">{body}</Text>
				{images}
			</View>
			{anchors}
		</View>
	);
};

/** Memoised at the module boundary: see the header's note — identity is this
 *  row's only bail-out inside React Native's cell renderer. */
export const TranscriptRow = memo(TranscriptRowImpl);
TranscriptRow.displayName = "TranscriptRow";
