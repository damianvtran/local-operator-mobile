// biome-ignore-all lint/suspicious/noArrayIndexKey: every list in this file is regenerated from the same source on each render (a parsed string, a diff, a todo phase), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import {
	Hourglass,
	MessageSquareOff,
	MessagesSquare,
} from "lucide-react-native";
import { useState } from "react";
import {
	Pressable,
	ScrollView,
	Text,
	useWindowDimensions,
	View,
} from "react-native";

import type { TranscriptEntry } from "@/contracts";
import {
	bridgeAccessibleName,
	bridgeBody,
	bridgeCardHeadline,
	bridgeChipLayout,
	bridgeChipShowsCode,
	bridgeCopyOf,
	bridgeGlyphFor,
	bridgeMark,
	bridgeOutcomeView,
	bridgeRowOf,
	bridgeRowSummary,
	isBridgeRow,
	isLoneReceiptLine,
	scrubOpaqueIds,
} from "@/features/session/bridge-row";
import { Markdown } from "@/features/session/components/markdown";
import {
	deliveryAccessibleName,
	isPartialDelivery,
	SEND_DELIVERY_NOTE,
	SEND_DELIVERY_WORD,
	sendDeliveryStateOf,
} from "@/features/session/delivery";
import {
	diffCounts,
	diffLineTone,
	hasToolDetails,
	toolDetailBlocks,
	toolElapsed,
	toolGlyph,
} from "@/features/session/projection";
import { ROLE, toolRowToggleId } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { TYPE_STEPS } from "@/ui/tokens.gen";
import { cx } from "@/ui/variants";

/**
 * The tool row: ONE line per action, everything else one tap away
 * (`docs/design/components.md` § 15).
 *
 * The long-output bound is the load-bearing part. `args`, `diff` and `output` are
 * each capped and scrollable, and the expansion as a whole is capped too — an
 * unbounded output block renders its full height and fills the screen with a
 * sunken ground, and a diff block that scrolls horizontally is a gesture the
 * reader has no cue to perform, so the diff WRAPS and the whole expansion is what
 * scrolls.
 *
 * The args block is dropped for the tools whose args ARE their diff
 * (`write`/`edit`/`apply_patch`/`patch`): showing both says the same thing twice
 * and pushes the diff — the part the reader wants — below the fold.
 *
 * **The row's three fills, stated here because the kit does not state them.**
 * `components.md` § 15 defines the row's anatomy (glyph, name, summary, diff,
 * elapsed, disclosure) and no fill at all, while this row paints two:
 * `bg-elevated` while the action is unfinished (`running`, `queued`,
 * `composing`) and `bg-danger-wash` when it failed; a done row sits on the canvas.
 * The design round measured all three in the shipped frames and called the result
 * coherent — an unfinished row is raised, a failed row is red, and the glyph
 * carries the same fact so colour is never the only channel (§ 2.6) — but flagged
 * that § 2.2 reserves `elevated` for "sheets, dialogs, popovers, hovered and
 * pressed rows", so this is an EXTENSION rather than a reading of the kit.
 *
 * They are kept deliberately: a long transcript is scanned for "what is still
 * moving" and "what broke", and a fill answers both without reading glyphs. The
 * § 15 addition that would make them documented has been routed to the kit's owner
 * (design round 1, D5) — this comment is the interim record on the component, not
 * a second spec.
 *
 * **The send row carries one arm of its own**: a cross-session `send` whose
 * result states a `details.delivery` is painted with the state's own word and
 * mark (the desktop tool row's four-state treatment, local-operator-ui #719),
 * because the incident behind that change is a phone-shaped one too — a message
 * that landed in a busy peer's mailbox must not read as a failure, and must not
 * read as a clean success either. The mapping lives in `session/delivery.ts`;
 * this file only renders it.
 *
 * **The bridge row is the second arm** (`session/bridge-row.ts` owns the
 * mapping): the Team Bridge icon stands in for the tool's name, the relay's
 * localized summary is the headline, and `details.bridge_row.outcome` takes the
 * same trailing-word slot the delivery word uses — so the large-text rule (own
 * line above `LARGE_TEXT_SCALE`) is one rule for both. `inbox_only` takes the
 * warning mark, never the tick: a message that reached no conversation is not a
 * success. A bridge row whose `bridge_row` is missing or unreadable keeps the
 * icon and headline and nothing else — the generic row, honestly labelled.
 */
/** The transcript row's horizontal chrome: `px-4` outside, `px-2` here. */
const ROW_CHROME_PT = 48;

export type ToolRowProps = {
	entry: TranscriptEntry;
	testID?: string;
};

const DIFF_TONE_CLASS = {
	added: "text-success",
	removed: "text-danger",
	hunk: "text-info",
	plain: "text-ink-muted",
} as const;

const DiffBlock = ({ lines }: { lines: string[] }) => (
	// `whitespace-pre-wrap` plus per-line block text: the wrap is what makes this
	// readable on a phone, and the tint comes from the diff roles rather than from
	// a colour chosen here.
	<View className="max-h-64 overflow-hidden rounded-sm bg-sunken p-2">
		<ScrollView>
			<Text className="whitespace-pre-wrap font-mono text-mono-sm">
				{lines.map((line, index) => (
					<Text
						key={index}
						className={cx("block", DIFF_TONE_CLASS[diffLineTone(line)])}
					>
						{line}
					</Text>
				))}
			</Text>
		</ScrollView>
	</View>
);

/**
 * The raw output well's cap, as a LINE COUNT so it survives the text scale
 * (design round 1, D2). The fixed `max-h-48` was 192 px at every scale: it let
 * the well outweigh the note at 100 % (138 pt against 61 pt) and hid 63 % of
 * the 522 pt machine line behind a nested scroll at 200 %. Three mono-sm lines
 * at every scale keeps the note the tallest thing in the expansion and the
 * well scrollable — nothing is lost, it just no longer leads. The pad is the
 * well's own `p-2`, which does NOT scale: spacing stays put.
 */
const OUTPUT_WELL_LINES = 3;
const OUTPUT_WELL_PAD_PX = 16;
const outputWellCap = (scale: number): number => {
	const line = TYPE_STEPS["mono-sm"];
	return Math.round(
		OUTPUT_WELL_LINES * line.size * line.lineHeight * scale +
			OUTPUT_WELL_PAD_PX,
	);
};

const TextBlock = ({
	lines,
	tone,
	capPx,
}: {
	lines: string[];
	tone: string;
	/** The height cap when the caller wants one that scales with the type (the
	 *  raw OUTPUT well — design round 1, D2). Unset keeps the fixed `max-h-48`
	 *  the args block has always had. */
	capPx?: number;
}) => (
	<View
		className={cx(
			"overflow-hidden rounded-sm bg-sunken p-2",
			capPx === undefined && "max-h-48",
		)}
		style={capPx === undefined ? undefined : { maxHeight: capPx }}
	>
		<ScrollView>
			<Text className={cx("whitespace-pre-wrap font-mono text-mono-sm", tone)}>
				{lines.join("\n")}
			</Text>
		</ScrollView>
	</View>
);

export const ToolRow = ({ entry, testID }: ToolRowProps) => {
	/**
	 * `user_run` is tracked as an OVERRIDE, not as initial state.
	 *
	 * A bang-mode row (`! cmd`) opens expanded, matching the TUI: the reader typed
	 * this command themselves and is waiting to read its output. But a live bang row
	 * is mounted while still running and only learns `user_run` when its result
	 * settles, and a `useState` initializer runs once at mount — seeding it there
	 * would leave the live card shut. `null` means "the reader has not touched this
	 * row", and only then does `user_run` decide.
	 */
	const [override, setOverride] = useState<boolean | null>(null);
	const open = override ?? entry.details.user_run === true;
	const { effectiveScale } = useTextScale();
	/* The send row's delivery arm. `delivery` is read only for the send tool:
	 * the field is that tool's own, and a row that grew the word because some
	 * other tool attached a lookalike key would be this surface inventing an
	 * interpretation (the core's `SEND_TOOL_NAME` is the gate the TUI and the
	 * desktop row both use; `sendDeliveryStateOf` is that gate, shared with the
	 * state marker so a row and its marker cannot drift). */
	const delivery = sendDeliveryStateOf(entry);
	const word =
		delivery === null ? null : (SEND_DELIVERY_WORD[delivery] ?? null);
	const note =
		delivery === null ? null : (SEND_DELIVERY_NOTE[delivery] ?? null);
	const deliveryName = deliveryAccessibleName(delivery);
	/* The bridge arm. `bridge` is `null` for every other tool and for a bridge
	 * row with no readable payload; `isBridge` alone still swaps the icon and
	 * the scrubbed headline in, because the summary is the relay's localized
	 * line either way. */
	const isBridge = isBridgeRow(entry);
	const bridge = bridgeRowOf(entry);
	const bridgeCopy = bridgeCopyOf(entry);
	const bridgeOutcome = bridgeOutcomeView(bridge, bridgeCopy);
	const bridgeMessage = bridgeBody(entry);
	const mark = bridgeMark(bridge);
	/* The chip's WORD, when the relay sent one — the layout decision needs its
	 * length, and it is the same string the chip renders. */
	const chipWord = bridgeOutcomeView(bridge, bridgeCopy)?.word ?? "";
	/* The ROW keeps the daemon's one-line summary — verb, target and the message
	 * PREVIEW — with the outcome tail stripped, because the chip beside it says
	 * that already (design round 1, D1/D10). The CARD prints the daemon's
	 * rendered headline instead, which names the call rather than repeating the
	 * row. */
	const headline = isBridge
		? bridgeRowSummary(entry, bridgeCopy, bridge)
		: entry.summary;
	const cardTitle = bridgeCardHeadline(bridgeCopy);
	/* The chip's share of the row is a width decision the relay makes with
	 * container queries; RN has none, so it is measured here (D3). */
	/* The row's own width, minus the two paddings the transcript stack applies
	 * (`px-4` on the row wrapper, `px-2` here = 24 pt a side). Measured, not
	 * guessed: the 320 pt frames put the pressable at x 24–296, i.e. 272 pt.
	 * Chosen over `onLayout` because it is the same number on the first frame,
	 * so a chip can never paint wide and then jump. */
	const rowWidthPt = Math.max(0, useWindowDimensions().width - ROW_CHROME_PT);
	const chipLayout = bridgeChipLayout(rowWidthPt, chipWord, mark !== null);
	/* The daemon's sentence already states the outcome; the raw error and output
	 * would say it again (design round 1, D5). */
	const bridgeStated =
		isBridge && bridgeCopy !== null && bridgeCopy.outcomeSentence !== "";

	/* The icon is an SVG and cannot inherit a text colour (`useTokenColor`'s
	 * own reason); `ink-muted` matches the tool name it replaces. */
	const iconInk = useTokenColor("ink-muted");
	/* The two marks the desktop row paints for its own bridge states, in the
	 * inks those states already carry here. */
	const warningInk = useTokenColor("warning");
	const dimInk = useTokenColor("ink-muted");
	/* The amber pair takes the warning mark — neither the silent success tick
	 * nor the danger wash — and the WORD beside it carries the distinction with
	 * colour off. `delivered` and `failed` keep the glyph their tool state
	 * already earned. */
	const partial = isPartialDelivery(delivery);
	/* A bridge outcome overrides the state glyph the same way a partial
	 * delivery does, and for the same reason: `inbox_only`,
	 * `awaiting_acceptance` and `unconfirmed` are writes nobody confirmed, so
	 * none of them may wear the success tick, and a refusal the tool reported as
	 * `done` must still read as one. The decision is keyed on
	 * `bridge_row.outcome` (`bridgeGlyphFor`), NOT on whether the relay sent
	 * words — a copy-less row keeps its honest mark (design round 2, R7). */
	const glyphOverride = bridgeGlyphFor(bridge);
	const tone =
		partial && glyphOverride === null
			? { glyph: "!", inkClass: "text-warning", pulsing: false }
			: (glyphOverride ?? toolGlyph(entry.tool_state));
	/* ONE trailing word per row, from whichever arm owns it, so the inline /
	 * own-line placement below is a single rule. */
	const trailing: { text: string; inkClass: string } | null =
		word !== null
			? {
					text: word,
					inkClass: delivery === "failed" ? "text-danger" : "text-warning",
				}
			: bridgeOutcome !== null
				? {
						text: bridgeOutcome.text,
						/* Both amber tones share one class: `pending` is the same
						 * warning ink as `inbox_only` (design round 1, R3/D2), so a
						 * settled-but-unconfirmed write never reads as a quiet fact. */
						inkClass:
							bridgeOutcome.tone === "danger" ? "text-danger" : "text-warning",
					}
				: null;
	/* Above `LARGE_TEXT_SCALE` the word cannot share the row without taking the
	 * name and the summary with it (design round 1, D1 — 265 pt of word against a
	 * 350 pt row at 200 %), so it moves to a line of its own; the render below
	 * carries the numbers. */
	const deliveryOnOwnLine =
		trailing !== null && effectiveScale > LARGE_TEXT_SCALE;
	const counts = diffCounts(entry);
	const elapsed = toolElapsed(entry);
	/* The delivery note is a reason to allow the expansion on its own: a row
	 * whose hint the reader can only reach by expanding must be expandable. */
	const details =
		hasToolDetails(entry) ||
		note !== null ||
		bridgeOutcome !== null ||
		cardTitle !== "" ||
		(bridgeCopy !== null && bridgeCopy.outcomeSentence !== "");
	const blocks = toolDetailBlocks(entry);
	/* A bridge card also suppresses a lone RECEIPT token (`ok`): one word that
	 * says nothing, sitting in a well heavier than the card's own sentence (QA
	 * round 2, Q2). The no-copy card is the case this exists for — it has no
	 * sentence, so `bridgeStated` cannot suppress the well for it. */
	const bridgeLoneReceipt = isBridge && isLoneReceiptLine(blocks.output);
	/* The bridge body IS the args' substance; printing the args block too would
	 * say it twice (the diff-first tools' rule, `isDiffFirstTool`). */
	const showArgs =
		blocks.showArgs && blocks.args.length > 0 && bridgeMessage === null;
	/* A queued call keeps the raised background of a live row — it is announced and
	 * may still execute — but it does NOT pulse: the pulse is the "work is
	 * happening" signal, and nothing is happening while it waits behind a sibling. */
	const queued = entry.tool_state === "queued";
	/* The bridge row's SECOND LINE, if any: at the larger text scale the chip's
	 * word moves down (the `trailing` arm's rule), and below the width where an
	 * unmarked phrase fits it takes its own line instead of being clipped (Q1).
	 * One value, so the two reasons can never print the line twice — measured at
	 * 390 pt, 150 %, where they did. */
	const bridgeSecondLine =
		deliveryOnOwnLine && trailing !== null
			? trailing
			: bridgeOutcome !== null && chipLayout === "own-line"
				? {
						text: bridgeOutcome.text,
						inkClass: trailing?.inkClass ?? "text-warning",
					}
				: null;

	return (
		<View
			className={cx(
				"rounded-sm px-2",
				(entry.tool_state === "running" ||
					queued ||
					entry.tool_state === "composing") &&
					"bg-elevated",
				entry.tool_state === "failed" && "bg-danger-wash",
			)}
			testID={testID}
		>
			<Pressable
				accessibilityRole={details ? ROLE.button : ROLE.text}
				accessibilityLabel={
					isBridge
						? /* Identity, state, the relay's chip and the row line — see
							 * `bridgeAccessibleName`, which keeps the state so a row the
							 * relay sent no words for still announces that it failed
							 * (design round 1, R1). */
							bridgeAccessibleName(entry, bridge, bridgeCopy)
						: `${entry.tool_name} ${entry.tool_state}${entry.summary ? `, ${entry.summary}` : ""}${deliveryName ? `, ${deliveryName}` : ""}`
				}
				accessibilityState={details ? { expanded: open } : undefined}
				disabled={!details}
				onPress={() => details && setOverride(!open)}
				testID={toolRowToggleId(entry.id)}
			>
				<View className="min-h-11 flex-row items-center gap-1.5">
					<Text
						/* LEFT-aligned in its fixed box, not centred: the delivery word (and the
						 *  expansion's hint) start on the ROW's left edge, so a glyph centred in
						 *  16 pt sat 2.6 pt to the right of line two at 150 % — U-41's "line 2
						 *  starts off the row's rail". Left-aligned, the glyph is the rail. */
						className={cx(
							"w-4 text-start font-mono text-mono-sm",
							tone.inkClass,
						)}
						aria-hidden
					>
						{tone.glyph}
					</Text>
					{/* The NAME yields before the summary does, so the clock is the last
					    thing lost rather than the first: a truncated name is visibly
					    truncated, while a clipped duration is a shorter string that is
					    still a valid duration and so looks correct. */}
					{isBridge ? (
						/* The Team Bridge identity column, in place of the word `bridge`:
						 *  the same fixed width either way, so the row's layout never
						 *  shifts between a mark and the plain mark. The state glyph
						 *  stays in the rail ahead of it rather than being replaced by
						 *  the mark: the glyph is the rail's anchor (U-41 measures the
						 *  row's first text against it) and it still carries the tool
						 *  state, while the mark carries the bridge outcome exactly as
						 *  the desktop row names it. */
						<View className="w-3.5 shrink-0 items-start" aria-hidden>
							{mark === "message-off" ? (
								<MessageSquareOff color={warningInk} size={14} />
							) : mark === "hourglass" ? (
								<Hourglass color={dimInk} size={14} />
							) : (
								<MessagesSquare color={iconInk} size={14} />
							)}
						</View>
					) : (
						<Text
							className="min-w-0 shrink truncate font-mono text-mono-sm text-ink-muted"
							numberOfLines={1}
						>
							{entry.tool_name}
						</Text>
					)}
					<Text
						/* One ink for every row's line: the bridge row's extra weight was
						 *  a side effect of which arm drew it, and inside a condensed
						 *  group it sat beside `send`'s dimmer line in the same list
						 *  (design round 1, D9). The identity icon already carries what
						 *  the muted name carried.
						 *
						 *  A row with a chip holds a floor for this line (D3): at 320 pt
						 *  a floorless line lost to the chip and read `Sent to c…`, so the
						 *  caveat outranked the message. 4.5 rem is the relay's own floor. */
						className={cx(
							"min-w-0 flex-1 text-body-sm text-ink-dim",
							isBridge && bridgeOutcome !== null && "min-w-[4.5rem]",
						)}
						numberOfLines={1}
					>
						{headline}
					</Text>

					{/* The delivery word: the state's own name for what is known (see
					    `session/delivery.ts`), never a bare verdict. Amber for the two
					    unsettled-but-not-failed states, danger for `not delivered`.
					    Rendered inline below `LARGE_TEXT_SCALE`; at and above it the
					    word takes its own line below the row — see the render and its
					    measurements there. */}
					{/* A bridge chip and the send word share this slot, but not its width
					    rule. The send word is `shrink-0` (design round 1, D1) — it is two
					    words at most. The bridge chip is longer and carries a mark, so it
					    is capped and, on a narrow row, sheds its code whole and then its
					    word (see `bridgeChipLayout`); the word it sheds stays in the
					    accessible name, so nothing is only visible. */}
					{bridgeOutcome !== null &&
					!deliveryOnOwnLine &&
					chipLayout === "words" ? (
						/* The chip is the WORD alone: the MARK lives in the identity
						 * column (drawing it twice put two identical icons on one row).
						 * The layout decision above already collapsed or re-lined a word
						 * that would not fit, so this text is never ellipsised mid-phrase
						 * (Q1, round 2). */
						<View
							className={cx(
								"min-w-0 shrink flex-row items-center",
								bridgeOutcome.tone === "danger"
									? "text-danger"
									: "text-warning",
							)}
							/* A percentage cap did not take effect as a class on this row
							 * (measured in the shipped frame), so every width here is a
							 * STYLE — the one place React Native Web always applies it. */
							style={{ maxWidth: rowWidthPt >= 384 ? "55%" : "40%" }}
						>
							<Text
								className={cx(
									"min-w-0 shrink text-body-sm",
									trailing?.inkClass,
								)}
								numberOfLines={1}
							>
								{bridgeOutcome.word}
								{/* The code is dropped WHOLE below the widest bucket — never
								    cut mid-token; the card's sentence repeats it in full. */}
								{bridgeChipShowsCode(rowWidthPt) ? bridgeOutcome.code : null}
							</Text>
						</View>
					) : null}
					{word !== null && !deliveryOnOwnLine && bridgeOutcome === null ? (
						<Text
							className={cx("shrink-0 text-body-sm", trailing?.inkClass)}
							numberOfLines={1}
						>
							{word}
						</Text>
					) : null}
					{/* Suppressed entirely when both counts are zero — `+0 −0` is noise
					    dressed as a measurement. */}
					{counts !== null ? (
						<Text className="shrink-0 font-mono text-mono-sm">
							{counts.added > 0 ? (
								<Text className="text-success">+{counts.added}</Text>
							) : null}
							{counts.added > 0 && counts.removed > 0 ? " " : null}
							{counts.removed > 0 ? (
								<Text className="text-danger">−{counts.removed}</Text>
							) : null}
						</Text>
					) : null}
					{elapsed !== null ? (
						<Text className="shrink-0 font-mono text-mono-sm text-ink-dim tabular-nums">
							{elapsed}
						</Text>
					) : null}
					{details ? (
						<Text className="shrink-0 text-mono-sm text-ink-dim" aria-hidden>
							{open ? "▾" : "▸"}
						</Text>
					) : null}
				</View>
				{/* The word's own line at large text. Left inline, the word is
				 *  `shrink-0` and grows with the type: measured on the 390 pt phone it
				 *  reached 265 pt against the 350 pt row at 200 % and took the tool
				 *  name and the whole summary — the message's TARGET — to 0 pt, which
				 *  the expansion then never repeated (design round 1, D1). On its own
				 *  line the row reads exactly as it did before the word existed
				 *  (name 58 pt, summary 209 pt at 200 % — the base build's own
				 *  numbers) and the word stays whole. It moves by being a sibling of
				 *  the line row rather than by wrapping, so the rule is one rule on
				 *  phone and tablet alike; below the threshold nothing changes. */}
				{/* The row's SECOND LINE, when one is needed (design round 1, D1).
				 *  ONE shape for every arm — the send word and a bridge caveat alike:
				 *  it sits on the row's own rail, which is the convention this
				 *  component already documents for line two (the glyph is left-aligned
				 *  in its box for exactly that reason) and the one U-41 measures.
				 *
				 *  D6 (design round 2) asked for the row's TEXT COLUMN instead, 42 pt
				 *  in. That was built, measured and rejected: 42 pt is off
				 *  `space.scale` (U-42) and the rail check calls it a drift
				 *  ("line 2 starts 42pt off the row's rail", 60 FAIL at 390 pt), so
				 *  the app would then carry two conventions for one thing. The
				 *  orphan read is answered differently: the line lives inside its own
				 *  row's pressable and directly under it, so it cannot sit above
				 *  another row's text or read as that row's. */}
				{isBridge && bridgeSecondLine !== null ? (
					<Text
						className={cx("text-body-sm", bridgeSecondLine.inkClass)}
						numberOfLines={1}
					>
						{bridgeSecondLine.text}
					</Text>
				) : null}
				{!isBridge && deliveryOnOwnLine && trailing !== null ? (
					<Text
						className={cx("text-body-sm", trailing.inkClass)}
						numberOfLines={1}
					>
						{trailing.text}
					</Text>
				) : null}
			</Pressable>
			{open && details ? (
				<View className="flex flex-col gap-1.5 pb-1 ps-6">
					{/* D1's recoverability half: the summary restated at the top of the
					 *  expansion. At 150 % and up the collapsed row keeps it with the word
					 *  moved aside, but even at 100 % it is clipped (`138 of 187`), and a
					 *  resend decision leans on the target being readable somewhere. Only
					 *  rows carrying a delivery word render it: a `delivered` send is the
					 *  row it always was. */}
					{word !== null && entry.summary ? (
						/* The send row's restatement ONLY. A bridge card opens on the
						 *  daemon's headline instead: repeating the row's own line made
						 *  the top of the card say what the row already said (design
						 *  round 1, D1), and the row line is one tap away anyway. */
						<Text className="text-body-sm text-ink-dim">{entry.summary}</Text>
					) : null}
					{entry.intent ? (
						<Text className="text-body-sm text-ink-muted">{entry.intent}</Text>
					) : null}
					{/* A bridge card whose daemon sentence states the outcome does not
					    repeat it in a raw red line: three restatements of one fact led the
					    panel (design round 1, D5), and the relay scrubs the sentence on
					    the wire while this raw line can still carry an id. */}
					{entry.error && !bridgeStated ? (
						<Text className="text-body-sm text-danger">
							{isBridge ? scrubOpaqueIds(entry.error) : entry.error}
						</Text>
					) : null}
					{/* The delivery state's wrapping sentence — what the state means and
					    what to do about it, including the check-before-resending hint the
					    raw result line buries at its far end. The raw text stays below as
					    the output block, where the id and the attempt count live. */}
					{note !== null ? (
						<Text
							className={cx(
								"text-body-sm",
								delivery === "failed" ? "text-danger" : "text-warning",
							)}
						>
							{note}
						</Text>
					) : null}
					{/* The bridge CARD, in the relay SPA's order and hierarchy (design
					    round 1, D1/D6/D7): the daemon's headline as the title, then the
					    message in its own sunken well, then the outcome sentence. No
					    separate target line — the headline already names the target, so
					    a second line printed it twice (D1). The title takes full ink and
					    the sentence recedes, because the card's own name is what a reader
					    scans for (D6: the title measured weaker than its own gloss). */}
					{cardTitle !== "" ? (
						<Text className="text-body-sm text-ink">{cardTitle}</Text>
					) : null}
					{bridgeMessage !== null ? (
						<View className="rounded-sm bg-sunken p-2">
							<Markdown text={bridgeMessage} />
						</View>
					) : null}
					{bridgeCopy !== null && bridgeCopy.outcomeSentence !== "" ? (
						<Text
							className={cx(
								"text-body-sm",
								bridgeOutcome?.tone === "danger"
									? "text-danger"
									: bridgeOutcome?.tone === "warning" ||
											bridgeOutcome?.tone === "pending"
										? "text-warning"
										: "text-ink-muted",
							)}
						>
							{bridgeCopy.outcomeSentence}
						</Text>
					) : null}
					{showArgs ? (
						<TextBlock lines={blocks.args} tone="text-ink-muted" />
					) : null}
					{blocks.diff.length > 0 ? <DiffBlock lines={blocks.diff} /> : null}
					{/* Same rule for the raw output: on a bridge card the tool's text is
					    the receipt the sentence already states — the `ok` well said
					    nothing and outranked everything (design round 1, D5). */}
					{blocks.output.length > 0 && !bridgeStated && !bridgeLoneReceipt ? (
						<TextBlock
							lines={blocks.output}
							tone="text-ink-muted"
							capPx={outputWellCap(effectiveScale)}
						/>
					) : null}
					{/* An interrupted call keeps its partial output and says so: a row that
					    silently looks finished misreports what the tool did. */}
					{entry.tool_state === "interrupted" ? (
						<Text className="text-meta text-warning">
							Interrupted — the output above is partial.
						</Text>
					) : null}
				</View>
			) : null}
		</View>
	);
};
