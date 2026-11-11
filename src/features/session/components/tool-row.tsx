// biome-ignore-all lint/suspicious/noArrayIndexKey: every list in this file is regenerated from the same source on each render (a parsed string, a diff, a todo phase), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import {
	Hourglass,
	MessageSquareOff,
	MessagesSquare,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
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
import { LiveGlyph } from "@/features/session/components/live-glyph";
import { Markdown } from "@/features/session/components/markdown";
import {
	SelectableLeafText,
	SelectableMessage,
} from "@/features/session/components/selectable-message";
import {
	TRACE_BAR_PAD_CLASS,
	TRACE_COLUMN_GAP_CLASS,
	TRACE_EXPANDED_INDENT_CLASS,
	TRACE_GLYPH_ROW_CLASS,
	TRACE_GLYPH_SLOT_CLASS,
	TRACE_PRESSABLE_BESIDE_GLYPH_CLASS,
	TRACE_ROW_CHROME_PT,
	TRACE_TEXT_RAIL_INSET_CLASS,
} from "@/features/session/components/trace-rail";
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
	displayToolName,
	hasToolDetails,
	toolDetailBlocks,
	toolElapsed,
	toolGlyph,
	toolRowSummary,
} from "@/features/session/projection";
import { ROLE, toolRowToggleId } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { TOUCH_FLOOR } from "@/ui/layout";
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
 * **The row has no fill, in any state** — which is what `components.md` § 15
 * always said (glyph, name, summary, diff, elapsed, disclosure; no fill). An
 * earlier revision painted `bg-elevated` on unfinished rows and `bg-danger-wash`
 * on failed ones so a long transcript could be scanned for "what is still
 * moving" and "what broke". Rendered, that made every live or failed call a
 * full-width 44 pt card, and consecutive ones a stack of cards (visual audit
 * D4) — against the standing rule that a trace is a borderless single line and
 * against the relay's own row, which never had the fills. The scan is answered
 * by the glyph instead: its ink per state (`toolGlyph`), and an opacity pulse
 * on the running glyph, so colour is still never the only channel (§ 2.6).
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
/** The transcript row's horizontal chrome: `px-4` outside (`16 pt` each side), `px-0` here. */
const ROW_CHROME_PT = TRACE_ROW_CHROME_PT;

export type ToolRowProps = {
	entry: TranscriptEntry;
	testID?: string;
	/** The reader's explicit open/closed override from `TranscriptList` (`rowOpen`
	 *  keyed by `canonicalRowKey`), preserving disclosures across window unmounts
	 *  and the live-to-durable handoff. `undefined` = untouched: `user_run` decides. */
	open?: boolean;
	onToggleOpen?: (next: boolean) => void;
};

const DIFF_TONE_CLASS = {
	added: "text-success",
	removed: "text-danger",
	hunk: "text-info",
	plain: "text-ink-muted",
} as const;

const MONO_CLASS = "whitespace-pre-wrap font-mono text-mono-sm";
const DIFF_SELECTION_CLASS = cx(MONO_CLASS, "text-ink");

const DiffBlock = ({ lines }: { lines: string[] }) => {
	/* Memoised on `lines` (review R1, m1) and still lazy: the diff renders per
	 *  line, so the joined copy is built only when the reader enters the mode. */
	const joined = useCallback(() => lines.join("\n"), [lines]);
	return (
		// `whitespace-pre-wrap` plus per-line block text: the wrap is what makes this
		// readable on a phone, and the tint comes from the diff roles rather than from
		// a colour chosen here.
		<View className="max-h-64 overflow-hidden rounded-sm bg-sunken p-2">
			<ScrollView>
				{/* Output is the thing a reader most often needs to paste elsewhere
				 *  (a path, an error line): drag-select it like any message. The
				 *  selection view takes ONE ink: a TextInput has no per-line spans,
				 *  and RN iOS defaults input text to black (1.10–1.27:1 on `sunken`
				 *  in every dark palette, design R1 D2). The diff tints return on
				 *  exit, like every other dropped format. */}
				<SelectableMessage text={joined} textClassName={DIFF_SELECTION_CLASS}>
					<SelectableLeafText className={MONO_CLASS}>
						{lines.map((line, index) => (
							<Text
								key={index}
								className={cx("block", DIFF_TONE_CLASS[diffLineTone(line)])}
							>
								{line}
							</Text>
						))}
					</SelectableLeafText>
				</SelectableMessage>
			</ScrollView>
		</View>
	);
};

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
}) => {
	/* One join per `lines` (review R1, m1), shared by the body and the mode. */
	const joined = useMemo(() => lines.join("\n"), [lines]);
	return (
		<View
			className={cx(
				"overflow-hidden rounded-sm bg-sunken p-2",
				capPx === undefined && "max-h-48",
			)}
			style={capPx === undefined ? undefined : { maxHeight: capPx }}
		>
			<ScrollView>
				<SelectableMessage text={joined} textClassName={cx(MONO_CLASS, tone)}>
					<SelectableLeafText className={cx(MONO_CLASS, tone)}>
						{joined}
					</SelectableLeafText>
				</SelectableMessage>
			</ScrollView>
		</View>
	);
};

export const ToolRow = ({
	entry,
	testID,
	open: controlledOpen,
	onToggleOpen,
}: ToolRowProps) => {
	/**
	 * `user_run` is the DEFAULT under every override, never initial state.
	 *
	 * A bang-mode row (`! cmd`) opens expanded, matching the TUI and the relay's
	 * row (`override ?? user_run`): the reader typed this command themselves and
	 * is waiting to read its output. But a live bang row is mounted while still
	 * running and only learns `user_run` when its result settles, and a
	 * `useState` initializer runs once at mount — seeding it there would leave
	 * the live card shut. So `undefined` (from the list) and `null` (local) both
	 * mean "the reader has not touched this row", and only then does `user_run`
	 * decide. The list's controlled value is an explicit override only (R1-1:
	 * passing `false` for untouched rows shut every bang row).
	 */
	const [override, setOverride] = useState<boolean | null>(null);
	const open = controlledOpen ?? override ?? entry.details.user_run === true;
	const toggle = (next: boolean) => {
		if (onToggleOpen !== undefined) {
			onToggleOpen(next);
			return;
		}
		setOverride(next);
	};
	const { effectiveScale } = useTextScale();
	const displayName = displayToolName(entry.tool_name);
	const cleanSummary = toolRowSummary(entry);
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
		: cleanSummary;
	const cardTitle = bridgeCardHeadline(bridgeCopy);
	/* The chip's share of the row is a width decision the relay makes with
	 * container queries; RN has none, so it is measured here (D3). */
	/* The row's own width, minus the two paddings the transcript stack applies
	 * (`px-4` on the row wrapper, `px-2` here = 24 pt a side). Measured, not
	 * guessed: the 320 pt frames put the pressable at x 24–296, i.e. 272 pt.
	 * Chosen over `onLayout` because it is the same number on the first frame,
	 * so a chip can never paint wide and then jump. */
	const rowWidthPt = Math.max(0, useWindowDimensions().width - ROW_CHROME_PT);
	const chipLayout = bridgeChipLayout(
		rowWidthPt,
		chipWord,
		mark !== null,
		effectiveScale,
	);
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
	/* Memoised on the entry so the output wells' `lines` arrays (and the joins
	 *  memoised on them, review R1 m1) survive an unrelated row re-render. */
	const blocks = useMemo(() => toolDetailBlocks(entry), [entry]);
	/* A bridge card also suppresses a lone RECEIPT token (`ok`): one word that
	 * says nothing, sitting in a well heavier than the card's own sentence (QA
	 * round 2, Q2). The no-copy card is the case this exists for — it has no
	 * sentence, so `bridgeStated` cannot suppress the well for it. */
	const bridgeLoneReceipt = isBridge && isLoneReceiptLine(blocks.output);
	/* The bridge body IS the args' substance; printing the args block too would
	 * say it twice (the diff-first tools' rule, `isDiffFirstTool`). */
	const showArgs =
		blocks.showArgs && blocks.args.length > 0 && bridgeMessage === null;
	/* The bridge row's SECOND LINE, if any: at the larger text scale the chip's
	 * word moves down (the `trailing` arm's rule), and below the width where an
	 * unmarked phrase fits it takes its own line instead of being clipped (Q1).
	 * One value, so the two reasons can never print the line twice — measured at
	 * 390 pt, 150 %, where they did. */
	/* D9: an open card that states the outcome retires the row's second line. The
	 *  same token and the same fact 46 pt apart, the rail line out-dented 24.6 pt
	 *  from the card it introduced, read as the card's heading (measured at 390 pt).
	 *  The accessible name keeps the word either way. */
	const bridgeSecondLine =
		open && bridgeStated
			? null
			: deliveryOnOwnLine && trailing !== null
				? trailing
				: bridgeOutcome !== null && chipLayout === "own-line"
					? {
							text: bridgeOutcome.text,
							inkClass: trailing?.inkClass ?? "text-warning",
						}
					: null;
	/* ONE second line per row, whatever put it there: a bridge caveat that could
	 * not fit its chip, or a send word above `LARGE_TEXT_SCALE`. One value feeds
	 * both the grouping (D8) and the render, so the two can never disagree. */
	const secondLine = isBridge
		? bridgeSecondLine
		: deliveryOnOwnLine && trailing !== null
			? trailing
			: null;

	return (
		/* NO FILL IN ANY STATE (visual audit D4). Running, queued and composing
		 *  rows wore `bg-elevated` and failed rows `bg-danger-wash`, so two live
		 *  rows read as two stacked 44 pt cards — the look the relay's row never
		 *  had (`tool-row.tsx` there carries no state fill). State is the glyph's
		 *  ink (`toolGlyph`) plus the pulse on a running glyph below; a queued
		 *  or composing call is dim and still, because nothing is happening yet. */
		<View className={cx("rounded-sm", TRACE_BAR_PAD_CLASS)} testID={testID}>
			{/* Glyph outside the pressable, baseline-aligned (`TRACE_GLYPH_ROW_CLASS`
			 *  in `trace-rail.ts`): the second line (the send word, a bridge
			 *  caveat) and line one then share the button's 40 pt rail under U-41. */}
			<View className={TRACE_GLYPH_ROW_CLASS}>
				<View
					className={TRACE_GLYPH_SLOT_CLASS}
					pointerEvents="none"
					aria-hidden
				>
					{/* The live-tool indicator (`live-glyph.tsx`): only a RUNNING call
					 *  pulses; composing/queued stay dim and still. */}
					<LiveGlyph
						glyph={tone.glyph}
						inkClass={tone.inkClass}
						live={tone.pulsing}
					/>
				</View>
				<Pressable
					accessibilityRole={details ? ROLE.button : ROLE.text}
					accessibilityLabel={
						isBridge
							? bridgeAccessibleName(entry, bridge, bridgeCopy)
							: `${displayName} ${entry.tool_state}${cleanSummary ? `, ${cleanSummary}` : ""}${deliveryName ? `, ${deliveryName}` : ""}`
					}
					accessibilityState={details ? { expanded: open } : undefined}
					disabled={!details}
					onPress={() => details && toggle(!open)}
					style={{ minHeight: TOUCH_FLOOR }}
					className={cx(TRACE_PRESSABLE_BESIDE_GLYPH_CLASS, "justify-center")}
					testID={toolRowToggleId(entry.id)}
				>
					<View
						className={cx(
							"flex-row",
							secondLine !== null ? "items-start py-1" : "items-center",
							TRACE_TEXT_RAIL_INSET_CLASS,
							TRACE_COLUMN_GAP_CLASS,
						)}
					>
						<View className="min-w-0 flex-1">
							<View className="flex-row items-center gap-2">
								{isBridge ? (
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
										className="min-w-0 shrink truncate text-trace text-ink-muted"
										numberOfLines={1}
									>
										{displayName}
									</Text>
								)}
								<Text
									className={cx(
										"min-w-0 flex-1 text-trace text-ink-dim",
										isBridge && bridgeOutcome !== null && "min-w-[4.5rem]",
										/* A bridge row leads with an icon, which has no text
										 *  baseline: without this the line's baseline — the one
										 *  the outside glyph keys to (`TRACE_GLYPH_ROW_CLASS`)
										 *  — would be synthesised from the icon's bottom edge. */
										isBridge && "self-baseline",
									)}
									numberOfLines={1}
								>
									{headline}
								</Text>

								{bridgeOutcome !== null &&
								!deliveryOnOwnLine &&
								chipLayout === "words" ? (
									<View
										className={cx(
											"min-w-0 shrink flex-row items-center",
											bridgeOutcome.tone === "danger"
												? "text-danger"
												: "text-warning",
										)}
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
											{bridgeChipShowsCode(rowWidthPt)
												? bridgeOutcome.code
												: null}
										</Text>
									</View>
								) : null}
								{word !== null &&
								!deliveryOnOwnLine &&
								bridgeOutcome === null ? (
									<Text
										className={cx("shrink-0 text-body-sm", trailing?.inkClass)}
										numberOfLines={1}
									>
										{word}
									</Text>
								) : null}
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
									<Text
										className="shrink-0 text-mono-sm text-ink-dim"
										aria-hidden
									>
										{open ? "▾" : "▸"}
									</Text>
								) : null}
							</View>
							{/* Line 2 stays inside the `flex-1` text column so it aligns to `x = 40 pt`
							 *  instead of dropping back under the leading glyph. */}
							{secondLine !== null ? (
								<Text
									className={cx("pt-1 text-body-sm", secondLine.inkClass)}
									numberOfLines={1}
								>
									{secondLine.text}
								</Text>
							) : null}
						</View>
					</View>
				</Pressable>
			</View>
			{open && details ? (
				<View
					className={cx(
						"flex flex-col gap-2 pb-1",
						TRACE_EXPANDED_INDENT_CLASS,
					)}
				>
					{word !== null && cleanSummary ? (
						<Text className="text-body-sm text-ink-dim">{cleanSummary}</Text>
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
