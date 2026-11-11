import { memo } from "react";
import { Pressable, Text, View } from "react-native";

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
import {
	TRACE_COLUMN_GAP_CLASS,
	TRACE_GLYPH_BOX_CLASS,
	TRACE_ROW_OUTER_CLASS,
} from "@/features/session/components/trace-rail";
import { TranscriptImage } from "@/features/session/components/transcript-image";
import { imageGenView } from "@/features/session/imagegen";
import {
	bridgeReceiptLabel,
	bridgeReceiptMeta,
	canonicalRowKey,
	classifyEntry,
	hubLabel,
	isBridgeReceipt,
	isHubReceipt,
	peerLabel,
	transcriptRowTestID,
} from "@/features/session/projection";
import {
	USER_BUBBLE_BOX_CLASS,
	userBubbleFill,
} from "@/features/session/user-bubble";
import { t } from "@/i18n";
import { ROLE, SURFACE, transcriptImageId } from "@/ui/a11y";
import { useTheme } from "@/ui/appearance";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

/**
 * One transcript row, dispatched by kind (`docs/design/components.md` § 14).
 *
 * The treatments are not interchangeable, and the two that look most similar are
 * the two most worth separating:
 *
 *   - **The reader's own turn is a bubble**: right-aligned, capped at 85 % of the
 *     column, filled with `user-bubble` (a solved step off the page; no border
 *     and no accent edge) — it is something to be told apart from the answer.
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
	/** Whether this row's fold is open, when the list owns that state (it keeps
	 *  a set keyed by row id, so the answer survives windowing and a find
	 *  landing can open the row — review round 1, Q5 / U6 / U2). Omitted, a
	 *  folded row keeps its own state. */
	open?: boolean;
	/** Asks the owner to open or close this row's fold. Must be stable across
	 *  frames: it is a prop of a memoised row. */
	onToggleOpen?: (id: string, open: boolean) => void;
	/** This row opens a turn the list currently shows CONDENSED behind its
	 *  `TurnBar`. The prompt clamps to one line and its image strip waits for
	 *  the bar to open — the relay's `transcript.tsx` treatment: a collapsed
	 *  turn is one landmark line plus its bar, so a long prompt cannot undo the
	 *  condensing it heads. Only meaningful on a `user` row. */
	condensed?: boolean;
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

/**
 * The box of the reader's own turn: the bubble for a prompt, a quiet block for a
 * steer.
 *
 * A prompt is a BORDERLESS FILL, the relay's own bubble box (its
 * `transcript.tsx`: `rounded-md bg-surface px-3 py-1.5`; visual audit D3). It
 * carried a hairline on all sides plus a 2 px accent start rule: the hairline
 * measured 1.25:1 on the light canvas — an edge with no separation — and the
 * rule put a green-edged box on every exchange. The fill and the right
 * alignment say whose turn it is.
 *
 * THE FILL IS `user-bubble`, NOT `surface` (`USER_BUBBLE_BOX_CLASS`). With the
 * edges gone the fill is the bubble's only signal, and `surface` sits
 * 1.06-1.14:1 off `canvas` in every shipped theme (`surface`/`canvas` across
 * all 59 palettes in `tokens.gen.ts`): on a phone the reader's turn rendered as
 * bare indented text, indistinguishable from the assistant's prose (operator
 * report on the iOS build, 2026-11-09). Do not swap it back for a panel ground.
 *
 * The fill ALSO rides `style` (`userBubbleFill`), read from the active palette
 * rather than through uniwind's variable: on that build the box's padding
 * applied and its fill did not (design round 1, D1; the module comment in
 * `user-bubble.ts` records what was ruled out). A separate component so the
 * theme hook runs only for the reader's own rows, never for every row kind.
 */
const UserBox = ({
	isSteer,
	children,
}: {
	isSteer: boolean;
	children: React.ReactNode;
}) => {
	const { active } = useTheme();
	if (isSteer) {
		// No fill, no accent edge: a quiet right-aligned block.
		return <View className="max-w-[85%] px-1">{children}</View>;
	}
	return (
		<View
			className={cx("max-w-[85%]", USER_BUBBLE_BOX_CLASS)}
			style={userBubbleFill(active)}
		>
			{children}
		</View>
	);
};

const TranscriptRowImpl = ({
	entry,
	streaming = false,
	loadImage,
	onOpenAgent,
	onOpenVideo,
	onCancelTurn,
	open,
	onToggleOpen,
	condensed = false,
}: TranscriptRowProps) => {
	const kind = classifyEntry(entry);
	const testID = transcriptRowTestID(entry);
	/* The image-gen arm: a tool row in the detection set renders as the progress
	 *  card instead of the generic tool row (`imagegen.ts` owns the set and the
	 *  view-model; this file only chooses which treatment to hand it to). */
	const imageGen = kind === "tool" ? imageGenView(entry) : null;
	/* The fold's open state, owned by the list when it supplies both halves.
	 *  Keyed by the CANONICAL row key (`call:<tool_call_id>` for a tool), so a
	 *  disclosure the reader opened on a live `tc-<call>` row is still open on
	 *  the durable `<msg>:<call>` row that replaces it. Non-tool rows key by id. */
	const rowKey = canonicalRowKey(entry);
	const fold =
		onToggleOpen !== undefined
			? {
					open: open === true,
					onToggle: (next: boolean) => onToggleOpen(rowKey, next),
				}
			: {};
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
					<ToolRow
						entry={entry}
						testID={testID}
						{...(onToggleOpen !== undefined
							? {
									// Pass-through, not `=== true`: `undefined` is "untouched",
									// which lets a bang-mode (`user_run`) row open itself (R1-1).
									...(open !== undefined ? { open } : {}),
									onToggleOpen: (next: boolean) => onToggleOpen(rowKey, next),
								}
							: {})}
					/>
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
				{/* An answer can carry inline images (a pasted chart, a returned
				 *  screenshot) exactly as a prompt can; without this strip they were
				 *  on the wire and nowhere on screen. Same strip as the user row's,
				 *  minus the bubble ground. */}
				{entry.images.length > 0 && loadImage ? (
					<View className="flex-row flex-wrap gap-2 pt-2">
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
				{anchors}
			</View>
		);
	}

	if (kind === "user" || kind === "steer") {
		const isSteer = kind === "steer";
		/* Clamped, not folded: the prompt stays fully readable the moment the
		 *  reader opens the turn's bar, and nothing is hidden that the bar does
		 *  not also stand for. A steer never heads a turn, so it never clamps. */
		const clamp = condensed && !isSteer;
		/* NEVER COLLAPSIBLE, AT ANY LENGTH (review round 1, R1-2 / U1 / D2). The
		 *  reader's own prompt is the turn's landmark: the relay and the desktop
		 *  both keep it open, and folding it hid what was asked while the answer
		 *  stayed in full. The operator's complaint was OTHER participants'
		 *  messages eating the screen; only an outbound send TO a recipient (a hub
		 *  or peer receipt, below) folds. A steer is the same reader's voice. */
		return (
			<View className="items-end px-4 py-1" testID={testID}>
				<UserBox isSteer={isSteer}>
					{entry.text.length > 0 ? (
						<Text
							className={cx(
								// `body-read` 14 / 1.55: the relay's own `--text-body` step and
								// its reading leading (design item 11, round 1 type parity). It
								// was `body` 16, one step above the reference.
								isSteer
									? "text-body-read text-ink-muted"
									: "text-body-read text-ink",
							)}
							numberOfLines={clamp ? 1 : undefined}
						>
							{entry.text}
						</Text>
					) : null}
					{!clamp && entry.images.length > 0 && loadImage ? (
						<View className="flex-row flex-wrap gap-1.5 pt-1.5">
							{entry.images.map((image) => (
								<TranscriptImage
									key={image.index}
									entryId={entry.id}
									index={image.index}
									mimeType={image.mime_type}
									load={loadImage}
									onBubble={!isSteer}
									testID={transcriptImageId(entry.id, image.index)}
								/>
							))}
						</View>
					) : null}
				</UserBox>
				{anchors}
			</View>
		);
	}

	// Reasoning is a first-class producer row, not an unknown participant
	// named "entry". Preserve the text behind the same disclosure as traces;
	// it must not compete with the pinned line's in-progress animation.
	if (kind === "reasoning") {
		return (
			<View className="px-4" testID={testID}>
				<CollapsedRow
					glyph="◇"
					glyphClass="text-ink-dim"
					label={t("mobile.session.reasoning_disclosure")}
					// Even the preview is reasoning content: none is painted or
					// announced until the reader explicitly opens this trace.
					summary=""
					accessibilityLabel={t("mobile.session.reasoning_disclosure")}
					{...fold}
				>
					{/* A sunken well, not bare body text: opened reasoning is the
					 *  model's scratch, and on the page's own ground it read as part of
					 *  the answer beneath it. Muted small type for the same reason. */}
					<View className="rounded-sm bg-sunken px-3 py-2">
						<Text className="text-body-sm text-ink-muted">{entry.text}</Text>
					</View>
				</CollapsedRow>
				{anchors}
			</View>
		);
	}

	if (kind === "notice" || kind === "compaction") {
		const severity = entry.details.severity ?? "info";
		const glyph =
			kind === "compaction" ? "≡" : severity === "error" ? "✗" : "•";
		const ink = SEVERITY_CLASS[severity] ?? "text-info";
		const woken = entry.details.notice_kind === "wake";
		/* A Team Bridge receipt is a message FROM someone, not a status line: it
		 *  leads with the sender (receiver-projected display name, sanitized in
		 *  `bridgeReceiptLabel`) and the channel/DM + attachment facts, on the
		 *  same rail as a peer message, rather than a bare `•` notice. */
		if (isBridgeReceipt(entry)) {
			const sender = bridgeReceiptLabel(entry);
			const where = bridgeReceiptMeta(entry);
			const summary = firstLine(entry.text);
			if (shouldFold(entry.text)) {
				return (
					<View className={TRACE_ROW_OUTER_CLASS} testID={testID}>
						<CollapsedRow
							glyph="↔"
							glyphClass="text-accent"
							label={sender}
							labelClass="text-ink-dim"
							summary={summary}
							meta={where}
							accessibilityLabel={[`${sender}: ${summary}`, where]
								.filter(Boolean)
								.join(", ")}
							{...fold}
						>
							<Text className="text-body-sm text-ink">{entry.text}</Text>
						</CollapsedRow>
						{anchors}
					</View>
				);
			}
			return (
				<View
					className={cx(
						"flex-row items-start py-3",
						TRACE_ROW_OUTER_CLASS,
						TRACE_COLUMN_GAP_CLASS,
					)}
					testID={testID}
				>
					<Text
						className={cx(TRACE_GLYPH_BOX_CLASS, "text-accent")}
						aria-hidden
					>
						↔
					</Text>
					{/* Caption line, then the body on its own line — both on the 40 pt
					 *  text rail (D2). Running the 12 pt caption into the 14 pt body
					 *  started the body mid-line (x = 254 at 390 pt) and wrapped it
					 *  back to 40; the folded Hub receipt beside it reads label-then-
					 *  words on the same rail, so the two coordination rows match. */}
					<View className="min-w-0 flex-1">
						<Text className="text-meta text-ink-dim">
							{where ? `${sender} · ${where}` : sender}
						</Text>
						{entry.text ? (
							<Text className="text-body-sm text-ink">{entry.text}</Text>
						) : null}
					</View>
					{anchors}
				</View>
			);
		}
		/* A LONG NOTICE FOLDS; AN ERROR NEVER DOES (review round 1, R1-2: the relay
		 *  and the desktop both leave an error open — it is the fact the reader
		 *  most needs, and a fold would cost exactly that). A folded wake notice
		 *  keeps its cause on the bar (`woken` as meta, round 1 m5 / Q6), because
		 *  the summary line is ellipsised and a cause at its end would be the
		 *  first thing lost. */
		if (severity !== "error" && shouldFold(entry.text)) {
			const summary = firstLine(entry.text);
			return (
				/* No `py-1`: the fold's touch-floor box is already the line's
				 *  vertical space, and adding the notice row's padding on top
				 *  spread a run of folded lines wider than the notices beside
				 *  them (design round 3, D4). */
				<View className="px-4" testID={testID}>
					<CollapsedRow
						glyph={glyph}
						glyphClass={ink}
						summary={summary}
						meta={woken ? "woken" : undefined}
						accessibilityLabel={woken ? `${summary}, woken` : summary}
						{...fold}
					>
						<Text className="text-body-sm text-ink">{entry.text}</Text>
					</CollapsedRow>
					{anchors}
				</View>
			);
		}
		return (
			/* `py-3` puts a one-line notice (20 pt line + 24 pt) on the 44 pt
			 *  trace rhythm the folded rows and tool rows keep, so a run of short
			 *  notices beside folded ones no longer alternates 28 pt and 44 pt. */
			<View
				className={cx(
					"flex-row items-start py-3",
					TRACE_ROW_OUTER_CLASS,
					TRACE_COLUMN_GAP_CLASS,
				)}
				testID={testID}
			>
				{/* A FIXED 16 pt mono box: the glyph-column recipe the tool row
				 *  and the folded row already use (`w-4 … font-mono text-mono-sm`)
				 *  and the relay's own notice recipe (visual audit D9). Sized to
				 *  its own advance in the proportional face, `•`, `✗` and `≡`
				 *  each started the notice's text on a different x (31 pt
				 *  measured), so a run of notices had no text edge. With the box,
				 *  this row is `px-4` + 16 + `gap-2` — glyph at 16, text at 40 —
				 *  which is exactly `CollapsedRow`'s rail, so an open notice and
				 *  a folded one beside it now share both columns. LEFT-aligned
				 *  for the reason the tool glyph is: the glyph is the rail. */}
				<Text className={cx(TRACE_GLYPH_BOX_CLASS, ink)} aria-hidden>
					{glyph}
				</Text>
				<Text className="min-w-0 flex-1 text-body-sm text-ink">
					{entry.text}
					{/* A wake notice is the one notice whose CAUSE the reader must see: it
					    explains why a session they thought was idle is answering. */}
					{woken ? <Text className="text-ink-muted"> · woken</Text> : null}
				</Text>
				{anchors}
			</View>
		);
	}

	/* A message from another participant — the parent, a child, a peer session.
	 * A glyph and a label attribute it at a glance; no edge rule and no card
	 * inside the column (visual audit D9). */
	// Forward-compatible events keep their actual wire type instead of the
	// meaningless "entry" caption; unknown data must stay visible and attributable.
	const label = kind === "generic" ? entry.kind : (BLOCK_LABEL[kind] ?? kind);
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
			<View className="flex-row flex-wrap gap-2 pt-2">
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
	/* The two lines the unfolded row carries beside its body, built once so a
	 *  fold can never drop one (review round 1, R1-3): the agent route — a
	 *  supplied job ID owns it; a sender session ID is not that coordinate and
	 *  must never stand in for one — and a hub receipt's direction / Job line. */
	/*  A real button (round 2, D10 / U12): a bare `Text onPress` announced as
	 *  text, said only "open", and was a ~17 pt target beside the fold's own
	 *  48 pt one. It is named for the agent it opens (`hubLabel`: the label,
	 *  else the job ID — the identity the row already uses) and carries a
	 *  TOUCH_FLOOR box of REAL geometry, not `hitSlop`: react-native-web drops
	 *  Pressable hitSlop (`ask-bar.tsx`), and a slop reaching into the fold's
	 *  pressable would steal the fold's taps. On the folded bar the box is a
	 *  sibling of the fold's pressable, so the two targets never overlap.
	 *
	 *  The floor applies to the FOLDED bar only (`floored`), whose 48 pt
	 *  height already holds it. The unfolded row's header is a one-line meta
	 *  strip; flooring the control there would grow that strip to 48 pt, an
	 *  unreviewed layout change outside round 2's scope (D10 / U12 name the
	 *  folded row). It still gets the button role and the agent's name. */
	const openAgentControl = (floored: boolean) =>
		onOpenAgent && kind === "subagent" && entry.details.job_id ? (
			<Pressable
				accessibilityRole={ROLE.button}
				accessibilityLabel={t("mobile.session.subagent_open", {
					agent: hubLabel(entry),
				})}
				onPress={() => onOpenAgent(entry.details.job_id ?? "")}
				className={floored ? "items-center justify-center px-2" : undefined}
				style={
					floored
						? { minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }
						: undefined
				}
			>
				<Text className="text-meta text-accent">
					{t("mobile.session.subagent_open_short")}
				</Text>
			</Pressable>
		) : null;
	/* The route line names the job only. The raw `to_child` / `to_parent`
	 *  direction is a wire token: printed above 14 pt prose it read as the
	 *  message's first words. The direction is already in the glyph and the
	 *  `Hub · From …` label. */
	const route =
		hub && entry.details.job_id && entry.details.label ? (
			<Text className="text-meta text-ink-muted">
				{`Job ${entry.details.job_id}`}
			</Text>
		) : null;
	/* EVERY HUB RECEIPT FOLDS, AT ANY LENGTH. A hub message is delegation
	 *  traffic — a brief to a child, a report back — and it sits between the
	 *  reader's prompt and the answer they are waiting for; a short one left
	 *  open still interleaved an attribution strip and a prose block into the
	 *  trace. One line (`Hub · From <label>` + its first line) on the trace rail
	 *  is the relay's receipt treatment; the body is one tap away. */
	if (hub || shouldFold(body)) {
		const summary = firstLine(body);
		/* Named by kind and sender and the summary, not the whole body (UX round
		 *  1, U7): a screen reader reading every paragraph of a folded row gets
		 *  nothing from the fold. The body is read from the expanded children. */
		const named = hub
			? `Hub, from ${who}`
			: who === label
				? label
				: `${label} ${who}`;
		const spoken = [`${named}: ${summary}`, ...intent].join(", ");
		return (
			/* No `py-1`: the fold's touch-floor box is the line's vertical space
			 *  (design round 3, D4 — see the folded notice above). */
			<View className={TRACE_ROW_OUTER_CLASS} testID={testID}>
				<CollapsedRow
					glyph={kind === "peer" ? "↔" : "↳"}
					glyphClass={kind === "subagent" ? "text-ink-dim" : "text-accent"}
					label={hub ? `Hub · From ${who}` : who}
					summary={summary}
					meta={intent.join(" · ")}
					accessibilityLabel={spoken}
					action={openAgentControl(true)}
					{...fold}
				>
					{route}
					<Text className="text-body-read text-ink">{body}</Text>
					{images}
				</CollapsedRow>
				{anchors}
			</View>
		);
	}
	return (
		/* NO START RULE (visual audit D9). The block carried a 2 px accent edge
		 *  (`border-s-2 ps-2`), which put its label at x 26 — a fifth left edge
		 *  on a screen that already had the glyph rail and the text rail — and
		 *  repeated the green rule the reader's own bubble has just lost (D3).
		 *  Attribution is the glyph and the label, as in the folded form above;
		 *  the glyph sits in the same fixed 16 pt mono box and `gap-2` as every
		 *  other row, so `↔` / `↳` stand on the glyph rail (x 16) and the sender
		 *  on the text rail (x 40), and the body starts on the page's own edge
		 *  like the answer it sits between. */
		<View className={cx(TRACE_ROW_OUTER_CLASS, "py-1")} testID={testID}>
			<View className={cx("flex-row items-center", TRACE_COLUMN_GAP_CLASS)}>
				<Text
					className={cx(
						TRACE_GLYPH_BOX_CLASS,
						// The folded bar's inks, so a message does not change colour
						// when it grows past the fold threshold.
						kind === "subagent" ? "text-ink-dim" : "text-accent",
					)}
					aria-hidden
				>
					{kind === "peer" ? "↔" : "↳"}
				</Text>
				<Text
					className="min-w-0 shrink text-meta text-ink-dim"
					numberOfLines={1}
				>
					{who}
					{intent.length ? ` · ${intent.join(" · ")}` : ""}
				</Text>
				{openAgentControl(false)}
			</View>
			{route}
			<Text className="text-body-read text-ink">{body}</Text>
			{images}
			{anchors}
		</View>
	);
};

/** Memoised at the module boundary: see the header's note — identity is this
 *  row's only bail-out inside React Native's cell renderer. */
export const TranscriptRow = memo(TranscriptRowImpl);
TranscriptRow.displayName = "TranscriptRow";
