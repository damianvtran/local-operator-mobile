// biome-ignore-all lint/suspicious/noArrayIndexKey: the settled record's question list is regenerated whole on every render — a parsed detail, not an editable collection — so position IS the identity, the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import { ArrowUpRight, Check } from "lucide-react-native";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import {
	AccessibilityInfo,
	findNodeHandle,
	Keyboard,
	Platform,
	Pressable,
	Text,
	TextInput,
	View,
} from "react-native";

import type { AskQuestion, PendingAsk, SessionSummary } from "@/contracts";
import {
	askDraftKeyFor,
	dropAskDraft,
	readAskDraft,
	retainAskDrafts,
	secretQuestionIds,
	writeAskDraft,
} from "@/features/session/ask-drafts";
import {
	type AskOther,
	answeredPairs,
	askActions,
	askBands,
	askBarLabel,
	askProgress,
	askResponseBody,
	askStateLine,
	asksPopulationSignature,
	asksReadFailureLine,
	askToneInk,
	DISMISS_REASONS,
	type DismissReason,
	dismissNeedsReason,
	durationLabel,
	EMPTY_OTHER,
	hasOtherDoor,
	isAnswerable,
	isLapsed,
	nextActionableAsk,
	orderedForDisplay,
	outstandingAsks,
	questionIsAnswered,
	READ_FAILED,
	readFailureNotice,
	refusalText,
	unansweredQuestions,
} from "@/features/session/asks";
import {
	drawnRows,
	type ExpansionChoice,
	reduceExpansion,
	shownExpansion,
} from "@/features/session/asks-open-policy";
import { useKeyboardFrame } from "@/features/session/keyboard-frame";
import { type NoParamKey, t } from "@/i18n";
import type { RelayEndpoints } from "@/relay";
import {
	askAnswerFieldId,
	askDismissReasonId,
	askFieldId,
	askOtherFieldId,
	askOtherId,
	askQuestionId,
	askRowId,
	CONTROL,
	ROLE,
	SURFACE,
	state,
	timedOutAskRowId,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Button } from "@/ui/components/button";
import { IconButton } from "@/ui/components/icon-button";
import { Sheet } from "@/ui/components/sheet";
import { useSheetBodyScroll } from "@/ui/components/sheet-body-scroll";
import { useIsRTL } from "@/ui/direction";
import { TOUCH_FLOOR } from "@/ui/layout";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { choiceRowClasses, cx } from "@/ui/variants";

import { AnsweredValues } from "./answered-values";

/**
 * The asks sheet — every queued ask, across conversations (design §5.3's
 * EXPANDED state, the walked queue).
 *
 * WHY A SHEET AND NOT A LIST ON THE SESSION SCREEN. An ask is durable: it
 * outlives the runtime that queued it and belongs to a CONVERSATION rather than
 * to the screen the reader happens to be on. The phone's session screen can only
 * show the asks of the session it addresses, which is exactly the case that
 * matters least — the ask the reader has not seen is the one in the
 * conversation they are not looking at. So the sheet reads the AGGREGATE route
 * (`GET /api/asks`), which is index-backed, needs no live runtime, and answers
 * the same way whether the owning runtime is alive or long gone. The frame's
 * `asks[]` is deliberately NOT the source here: its rows carry no `cwd` and no
 * reliable `session_id`, so a queue stitched from frames would silently render
 * session-less rows (E2 spec §6.4).
 *
 * THE ANSWER SURFACE IS HERE. The OPEN ask is one card at the top of the sheet
 * (the other waiting asks are one-line rows under it, settled ones under
 * "Earlier") holding the ask's own form —
 * every question of the ask together, ONE submit — because `ask_respond` is
 * atomic per ask: the wire refuses a partial map, so a wizard would have to
 * hold the answers anyway, and a form is what makes "you have answered 2 of 3"
 * visible. Answering advances the expansion to the next outstanding ask, which
 * is the walk §5.3 promises: one sitting clears asks from several conversations
 * without navigating. And the form's free-text door is explicit: every
 * non-secret question that offers options ends in the trailing `Other` row with
 * its own input (design §5.0), so a reader can answer in their own words, not
 * only with the offered options.
 *
 * NOTHING IS PERSISTED. The draft map lives in this component and dies with it —
 * that is the app's rule, not an omission (ADR 0005 §2: the queue's authority is
 * the relay and the app caches nothing for asks). Secret answers are masked
 * fields whose value never leaves the submit that carries it: no draft survives
 * a close, no retry envelope is built, and nothing is written to device storage.
 * It also means the two drafts §5.0 keeps apart cannot mix by construction: the
 * composer is never mounted into an ask's field, and this form never feeds the
 * composer.
 *
 * REFUSALS KEEP THE RELAY'S OWN SENTENCE. `expired`, `declined`-elsewhere and
 * `answered`-elsewhere all render the sentence the relay returns rather than a
 * fourth wording authored here; only a transport failure with no sentence falls
 * back to "could not reach the computer".
 */

/** How often the open sheet re-reads the aggregate as a deadline backstop — the
 *  one event the list cannot announce is a deadline passing in a conversation
 *  whose runtime is gone, where nothing publishes a frame at all. */
const BACKSTOP_MS = 20000;
/** How long a single aggregate read may hang before the sheet says so. The
 *  wait is the failure for a merely flaky connection, so the wait is what is
 *  bounded; on engines without `AbortSignal.timeout` the read is simply
 *  unbounded rather than unavailable. */
const READ_TIMEOUT_MS = 8000;
/** The countdown tick. Deadlines are stated in minutes, so a coarse one keeps
 *  the crossing within half a minute of the truth without a per-second redraw. */
const TICK_MS = 20000;

/** A capitalised sentence, like the sheet's empty state (design D4). */
const READ_TIMED_OUT = "The read timed out — the computer is not answering.";

/** The two dismissal reasons' copy, keyed by the reason the wire carries. The
 *  label is the reason; the note is what the agent will do, in the relay card's
 *  own shape (a row that names the act and states its consequence). */
const REASON_COPY = {
	moot: {
		label: "mobile.asks.dismiss_reason.moot",
		note: "mobile.asks.dismiss_reason.moot_note",
	},
	answered_in_chat: {
		label: "mobile.asks.dismiss_reason.chat",
		note: "mobile.asks.dismiss_reason.chat_note",
	},
} as const satisfies Record<
	DismissReason,
	{ label: NoParamKey; note: NoParamKey }
>;

/** The start of an ask's first question, on one line, for a collapsed row: the
 *  state sentence alone says nothing about WHICH question waits. */
const questionStart = (row: PendingAsk): string => {
	const first = Array.isArray(row.questions) ? row.questions[0] : undefined;
	return String(first?.question ?? "")
		.replace(/\s+/g, " ")
		.trim();
};

type SettleKind = "respond" | "decline" | "dismiss";
type PendingAction = { askId: string; kind: SettleKind } | null;

export type AsksSheetProps = {
	visible: boolean;
	onClose: () => void;
	/** The relay client, or `null` while nothing is connected: the sheet then
	 *  states the read failed rather than pretending an empty queue. */
	client: RelayEndpoints | null;
	/** The conversation this sheet was opened from, if any — its rows are not
	 *  labelled with a conversation name (the reader is already there). */
	currentSessionId?: string;
	/** Navigate to a row's conversation (and close). Absent on screens that
	 *  cannot navigate — the row then carries no such control. `askIds` are the
	 *  destination's outstanding asks this sheet is listing, i.e. the ones the
	 *  reader was just shown: the destination's dismissal is recorded against
	 *  exactly them (see `AsksOpenLedger.dismiss`). */
	onOpenConversation?: (sessionId: string, askIds: string[]) => void;
	/** The list frame's rows, for conversation names `GET /api/asks` does not
	 *  carry. Optional: without it a foreign row names its session id. */
	sessions?: readonly SessionSummary[];
	/** The ask to show EXPANDED when the sheet opens, in place of the collapsed
	 *  list. Read once, on the opening transition: it is how an auto-open puts the
	 *  head question in front of a reader who did not ask to see anything (design
	 *  D1 / UX U1), while a sheet the reader opened from the bar passes nothing and
	 *  keeps the collapsed walk. An id the read does not return expands nothing. */
	initialOpenAsk?: string | null;
	/** The conversation's own frame rows, as the projection frame that raised the
	 *  sheet already holds them. Drawn MERGED into the aggregate on every open and
	 *  live while it is up (see `drawnRows`): the aggregate carries the
	 *  `session_id`/`cwd` a frame row lacks and can answer for another
	 *  conversation, while a frame row is the question the conversation itself
	 *  still holds - and the aggregate is not always complete when the sheet is
	 *  opened by hand (issue #247). A frame row absent from the aggregate is kept
	 *  only while it is outstanding, and settlement from this sheet outranks it. */
	frameRows?: readonly PendingAsk[] | null;
	/** The sheet's FIRST read after opening failed. The screen decides what to do
	 *  (an auto-opened sheet with NOTHING drawn closes back to the bar; one that
	 *  is drawing rows stays, with the error line under the rows - round 2,
	 *  U9). `drawn` is how many rows the sheet is drawing, which is what that
	 *  decision turns on. Only the opening read reports, so a backstop or
	 *  population re-read failing later - while the reader may be mid-answer - can
	 *  never reach it. */
	onReadFailed?: (info: { drawn: number }) => void;
};

/** The recommendation's suffix (capitalised after the dot, like every string
 *  in the panel; the relay page's lowercase wording is a follow-up). */
const RecommendedMark = () => (
	<Text className="text-meta text-ink-dim">
		{" "}
		{t("mobile.asks.recommended")}
	</Text>
);

/** The shared shell of an option row and the `Other` row: the tinted fill, the
 *  accent edge and a trailing indicator that is an empty ring (single choice) or
 *  empty square (multi-select) at rest and fills to a check when selected
 *  (`choiceRowClasses` holds the rules and the contrast numbers). Press state is
 *  read from the Pressable, so the fill steps while a finger is down. `children`
 *  is given the ink classes the state implies, so the label and its note never
 *  disagree with the fill under them. A multi-select row is a checkbox, a
 *  single-select row a radio. */
const ChoiceRow = ({
	selected,
	multi,
	disabled,
	onPress,
	accessibilityLabel,
	accessibilityHint,
	testID,
	children,
}: {
	selected: boolean;
	multi: boolean;
	disabled: boolean;
	onPress: () => void;
	accessibilityLabel: string;
	accessibilityHint?: string;
	testID?: string;
	children: (ink: { label: string; note: string }) => ReactNode;
}) => {
	const checkInk = useTokenColor("on-accent");
	return (
		<Pressable
			accessibilityRole={multi ? ROLE.checkbox : ROLE.radio}
			accessibilityLabel={accessibilityLabel}
			accessibilityHint={accessibilityHint}
			/* A checkbox reports `checked`, a radio `selected`: reading `selected`
			 *  off a checkbox told a screen reader nothing about its tick. */
			accessibilityState={
				multi
					? state({ checked: selected, disabled })
					: state({ selected, disabled })
			}
			disabled={disabled}
			onPress={onPress}
			testID={testID}
		>
			{({ pressed }) => {
				const classes = choiceRowClasses({
					selected,
					pressed,
					disabled,
					multi,
				});
				return (
					<View className={classes.row} style={{ minHeight: TOUCH_FLOOR }}>
						<View className={classes.edgeSlot}>
							<View className={classes.edge} />
						</View>
						<View className="min-w-0 flex-1 justify-center px-2 py-1.5">
							{children({ label: classes.label, note: classes.note })}
						</View>
						{/* The mark that makes selection more than colour; decorative
						 *  to a screen reader, which reads `selected` from the state. */}
						<View className="justify-center pe-2" aria-hidden>
							<View className={classes.indicator}>
								{selected ? (
									<Check color={checkInk} size={14} strokeWidth={3} />
								) : null}
							</View>
						</View>
					</View>
				);
			}}
		</Pressable>
	);
};

/** One question's control: a picker of consequence-carrying options — ended by
 *  the explicit `Other` row, the free-text door of design §5.0 (a requirement,
 *  2026-10-05: every question accepts free text, not only the offered options)
 *  — or a free-text/secret field. Mirrors `PendingCard`'s option row (§13: every
 *  option carries its consequence line) without reusing the component — that
 *  one is bound to the single-slot `PendingView`, and this form is per-ask. */
const QuestionField = ({
	question,
	value,
	other,
	onChange,
	onOtherChange,
	onFieldFocus,
	disabled,
}: {
	question: AskQuestion;
	/** Chosen labels, or the typed string. Empty means "not answered yet"; a
	 *  deliberate skip is a separate state, because an empty value IS an answer
	 *  to the queue (the contract's spelling for "no answer"). */
	value: string[];
	/** The `Other` door's own record (`AskOther` in `asks.ts`): never folded into
	 *  `value`, so a typed string cannot read back as an option tick. */
	other: AskOther;
	onChange: (next: string[]) => void;
	onOtherChange: (next: AskOther) => void;
	/** The field that took focus, so the sheet can scroll it above the footer. */
	onFieldFocus?: (node: View | null) => void;
	disabled: boolean;
}) => {
	const options = Array.isArray(question.options) ? question.options : [];
	const chosen = new Set(value);
	/* The placeholder ink, read exactly as `Input` reads it: a raw `TextInput`
	 *  has no class to hang a placeholder colour on — `placeholderTextColor` is
	 *  a colour VALUE — so the raw field rendered its placeholder at full ink,
	 *  reading as a prefilled answer (design D4). */
	const placeholderColour = useTokenColor("ink-muted");
	/* One ref for whichever field this question shows: only one is ever mounted,
	 *  and focus is what makes it the reader's position. */
	const fieldRef = useRef<TextInput | null>(null);
	/* A MULTILINE FIELD GROWS UNDER THE CARET, and the reveal ran before the
	 *  growth: the first evidence frames showed line two of the answer cut by the
	 *  pinned footer (2-line and 4-line states alike). So growth while the field
	 *  is focused asks the sheet for the reveal again — the same anchor, measured
	 *  against the taller field. Only growth triggers it; deleting text does not
	 *  scroll the page under the reader. */
	const fieldFocused = useRef(false);
	const lastFieldHeight = useRef(0);
	const takeGrowth = (height: number) => {
		/* The CURRENT height, recorded on shrink too: a maximum-ever figure stopped
		 *  re-revealing after four lines were deleted and three typed again
		 *  (review r2-m4), which is the same cut line this reveal exists to stop. */
		const grew = height > lastFieldHeight.current + 1;
		lastFieldHeight.current = height;
		if (!grew || !fieldFocused.current) return;
		if (fieldRef.current !== null)
			onFieldFocus?.(fieldRef.current as unknown as View);
	};
	/* Set by the DOOR's own press, so the field it just revealed takes the caret —
	 *  one tap, keyboard up, exactly as the approved prototype behaves (UX r1 U2).
	 *  A draft restored on reopen arrives with this false, so it comes back
	 *  quietly (no keyboard over the sheet the reader just opened).
	 *
	 *  THREE paths reach the field because a single one was measured not to:
	 *  the tick's effect (the field is already mounted — a re-tap of an open
	 *  door), `autoFocus` at mount (the press IS what mounted it), and the
	 *  field's own `onLayout` as the fallback when focus() ran before iOS had a
	 *  frame to give it (the evidence run's first attempt: the door opened and
	 *  the keyboard never came up). */
	const doorFocusWanted = useRef(false);
	const [doorFocusTick, setDoorFocusTick] = useState(0);
	const takeDoorFocus = () => {
		if (!doorFocusWanted.current) return;
		doorFocusWanted.current = false;
		fieldRef.current?.focus();
	};
	useEffect(() => {
		if (doorFocusTick === 0 || !doorFocusWanted.current) return;
		/* A null ref means the field mounts in this same commit: the flag STAYS set
		 *  so `autoFocus` / `onLayout` takes it. Clearing it first made that
		 *  fallback dead code (review r2 N1 / UX U10). */
		const field = fieldRef.current;
		if (field === null) return;
		doorFocusWanted.current = false;
		field.focus();
	}, [doorFocusTick]);
	if (options.length === 0) {
		return (
			<View>
				{question.secret ? (
					<Text className="pb-1 text-meta text-ink-dim">
						{question.persist
							? t("mobile.asks.secret_notice_saved")
							: t("mobile.asks.secret_notice")}
					</Text>
				) : null}
				<TextInput
					ref={fieldRef}
					onFocus={() => onFieldFocus?.(fieldRef.current as unknown as View)}
					testID={askAnswerFieldId(String(question.id))}
					className="min-h-11 rounded-sm border border-border-control bg-elevated px-3 text-body text-ink"
					value={value[0] ?? ""}
					onChangeText={(text) => onChange([text])}
					editable={!disabled}
					placeholder={
						question.secret
							? t("mobile.asks.secret_placeholder")
							: t("mobile.asks.answer_placeholder")
					}
					placeholderTextColor={placeholderColour}
					secureTextEntry={question.secret}
					/* Done puts the keyboard away and NEVER submits — the same rule the
					 *  `Other` field follows (design D6 / review r1 N4): a phone Return
					 *  must not send an irreversible answer. */
					returnKeyType="done"
					submitBehavior="blurAndSubmit"
					// 16 pt or the OS zooms the whole page on focus, which moves
					// every control the reader was about to press.
					style={{ fontSize: 16 }}
					accessibilityLabel={
						question.question || t("mobile.asks.answer_placeholder")
					}
				/>
			</View>
		);
	}
	const door = hasOtherDoor(question);
	return (
		<View className="gap-1">
			{/* The caption belongs to the WHOLE group, so it leads it: it used to
			 *  render between the last option and the door, splitting the family the
			 *  door exists to join (design D3). */}
			{question.multi ? (
				<Text className="text-meta text-ink-dim">
					{t("mobile.asks.choose_any")}
				</Text>
			) : null}
			{options.map((option, index) => {
				/* Single-select: the `Other` row and the option rows exclude each other
				   (design §5.0's door), so while it is selected no option reads as
				   chosen beside it. Multi-select: `Other` is additive, and the ticks
				   stand on their own. */
				const on = chosen.has(option.label) && (question.multi || !other.open);
				/* The recommendation is an INDEX into `options` AS CARRIED (the
				   runtime hoists the recommended option to 0 and states the
				   position); a client that re-sorted and kept the index would mark
				   the wrong one. */
				const recommended = question.recommended === index;
				return (
					<ChoiceRow
						key={option.label}
						selected={on}
						multi={question.multi}
						disabled={disabled}
						accessibilityLabel={option.label}
						onPress={() => {
							Keyboard.dismiss();
							if (!question.multi) {
								onChange([option.label]);
								/* Choosing an option closes the door — the exclusion's card
								   half — but its text stays for a mis-click. */
								if (other.open) onOtherChange({ ...other, open: false });
								return;
							}
							const next = new Set(chosen);
							if (next.has(option.label)) next.delete(option.label);
							else next.add(option.label);
							onChange(Array.from(next));
						}}
					>
						{(ink) => (
							<>
								<Text className={cx("text-body-sm", ink.label)}>
									{option.label}
									{recommended ? <RecommendedMark /> : null}
								</Text>
								{(option.description ?? "").length > 0 ? (
									<Text className={cx("text-meta", ink.note)}>
										{option.description}
									</Text>
								) : null}
							</>
						)}
					</ChoiceRow>
				);
			})}
			{door ? (
				/* THE EXPLICIT FREE-TEXT DOOR (design §5.0, core note
				 *  `docs/design/ask-nonblocking.md`): every non-secret question that
				 *  offers options ends in this trailing `Other` row, with its own
				 *  input, so an answer the list did not offer is on the card rather
				 *  than something the reader has to know. It is the same kind of choice
				 *  as the rows above — same mark and ground on press — not a bare
				 *  afterthought; what it composes is `asks.ts`'s `composedAnswer`. */
				<ChoiceRow
					selected={other.open}
					multi={question.multi}
					disabled={disabled}
					accessibilityLabel={t("mobile.asks.other_label")}
					/* The hint follows the row's own line: with text kept, "Type your
					 *  answer" told a screen reader the opposite of what the row shows
					 *  (UX r2 U8). */
					accessibilityHint={
						other.open || other.text.trim() === ""
							? t("mobile.asks.other_hint")
							: t("mobile.asks.other_kept")
					}
					onPress={() => {
						/* A ticked multi-select `Other` unticks, as any checkbox does;
						 *  the single-select radio re-selects rather than toggling off. */
						if (question.multi && other.open) {
							Keyboard.dismiss();
							onOtherChange({ ...other, open: false });
							return;
						}
						/* ONE TAP puts the caret in the field this press reveals (UX r1 U2),
						 *  and deliberately does NOT dismiss the keyboard first: the field
						 *  asks for it in the next frame, and a dismiss in between made the
						 *  keyboard drop and rise again. */
						doorFocusWanted.current = true;
						setDoorFocusTick((tick) => tick + 1);
						onOtherChange({ ...other, open: true });
					}}
					testID={askOtherId(String(question.id))}
				>
					{(ink) => (
						/* The label and its hint share ONE line ("Other   Your answer"),
						 *  as the relay page draws them. The hint stays in EVERY state —
						 *  it is what holds the row's height: it used to unmount while the
						 *  door was open, shrinking the row 51.1 → 34.3 pt, below the
						 *  sheet's own touch floor, exactly as the field appeared (design
						 *  D1). A kept-text row gets its own sentence, because a closed row
						 *  otherwise looks empty (UX N1 / design D6). */
						<View className="flex-row flex-wrap items-baseline gap-x-2">
							<Text className={cx("text-body-sm", ink.label)}>
								{t("mobile.asks.other_label")}
							</Text>
							<Text className={cx("text-meta", ink.note)}>
								{other.open || other.text.trim() === ""
									? t("mobile.asks.other_hint")
									: t("mobile.asks.other_kept")}
							</Text>
						</View>
					)}
				</ChoiceRow>
			) : null}
			{door && other.open ? (
				/* THE TYPED ANSWER, GROWN TO FOUR LINES (spec 3.3). Multiline so a
				 *  sentence is readable while it is written; capped at ~100 pt so the
				 *  question above it keeps its place; 16 pt text or the OS zooms the
				 *  page on focus, which moves every control the reader was about to
				 *  press. Done (the Return key) puts the keyboard away and NEVER
				 *  submits — a phone Return must not send an irreversible answer
				 *  (Ben, a-5712). */
				<TextInput
					ref={fieldRef}
					onFocus={() => {
						fieldFocused.current = true;
						onFieldFocus?.(fieldRef.current as unknown as View);
					}}
					onBlur={() => {
						fieldFocused.current = false;
					}}
					onContentSizeChange={(event) =>
						takeGrowth(event.nativeEvent.contentSize.height)
					}
					onLayout={takeDoorFocus}
					autoFocus={doorFocusWanted.current}
					multiline
					returnKeyType="done"
					submitBehavior="blurAndSubmit"
					className="rounded-sm border border-border-control bg-elevated px-3 py-2 text-body text-ink"
					value={other.text}
					onChangeText={(text) => onOtherChange({ open: true, text })}
					editable={!disabled}
					placeholder={t("mobile.asks.answer_placeholder")}
					placeholderTextColor={placeholderColour}
					style={{
						fontSize: 16,
						minHeight: 44,
						maxHeight: 100,
						textAlignVertical: "top",
					}}
					accessibilityLabel={t("mobile.asks.answer_label", {
						question: question.question,
					})}
					testID={askOtherFieldId(String(question.id))}
				/>
			) : null}
		</View>
	);
};

/** The expanded form's whole draft, keyed to the ask it belongs to. One object so
 *  the reset below is one write, and `ask` so the reset can TELL when the
 *  expansion moved. */
type AnswerDraft = {
	ask: string | null;
	answers: Record<string, string[]>;
	skipped: readonly string[];
	others: Record<string, AskOther>;
};

const emptyDraft = (ask: string | null): AnswerDraft => ({
	ask,
	answers: {},
	skipped: [],
	others: {},
});

const TEXT_FIELD_TAG = /^(INPUT|TEXTAREA)$/;

/** RN's `Text` types omit `tabIndex`; RN-web honours it. `-1` makes the line
 *  addressable (so `focus()` lands) without making it a Tab stop, and a phone
 *  ignores it — spread, the way the home splash does it. */
const WEB_FOCUSABLE = { tabIndex: -1 } as const;

/** Move the reader's place to a node: keyboard focus on the web (a
 *  `tabIndex={-1}` line takes it without becoming a Tab stop), the screen
 *  reader's cursor on a phone. NEVER while a text field has the caret — a
 *  reader typing the next answer keeps their place, the same rule the home
 *  screen follows after its own retry. */
const moveReadingPlace = (node: Text) => {
	if (Platform.OS === "web") {
		const held = document.activeElement;
		if (held instanceof HTMLElement && TEXT_FIELD_TAG.test(held.tagName))
			return;
		(node as unknown as HTMLElement).focus({ preventScroll: true });
		return;
	}
	if (TextInput.State.currentlyFocusedInput() != null) return;
	const handle = findNodeHandle(node);
	if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
};

/** The open ask's card: the surface the relay page draws the same ask on, and
 *  the unit the sheet scrolls to. Opening the sheet or walking on to the next ask
 *  mounts a new card, which asks the sheet to put ITS top under the header —
 *  once per ask, so a field growing under the reader's caret never drags the
 *  page back to the top. */
const AskCard = ({
	askId,
	children,
}: {
	askId: string;
	children: ReactNode;
}) => {
	const scroll = useSheetBodyScroll();
	const cardRef = useRef<View | null>(null);
	const scrolledFor = useRef<string | null>(null);
	return (
		<View
			ref={cardRef}
			onLayout={() => {
				if (scrolledFor.current === askId) return;
				scrolledFor.current = askId;
				scroll?.scrollToBlock(cardRef.current);
			}}
			className="gap-1.5 rounded-md border border-hairline bg-surface p-2.5"
		>
			{children}
		</View>
	);
};

/** The expanded detail of ONE ask: its questions and controls, drawn INSIDE
 *  the sheet's scroll region. THE VERBS ARE NOT HERE — `Send answer`/`Decline`/
 *  `Dismiss…`, the progress line and the refusal line, live in the sheet's pinned footer (`Sheet.footer`),
 *  because a control that answers the sheet must not scroll: measured on
 *  iphone-se the actions sat wholly below the fold, and the door adds ~55 pt
 *  more (design D2; the kit's three-region rule, `Sheet`'s own doc). The draft
 *  is the SHEET's state for the same reason the footer needs it — one draft,
 *  two regions — and it still dies with its expansion (see `draft` below). */
const AskDetail = ({
	row,
	questions,
	fields,
	draft,
	disabled,
	onAnswer,
	onOtherChange,
	onToggleSkip,
	focusQuestion,
	onFocused,
}: {
	row: PendingAsk;
	questions: readonly AskQuestion[];
	fields: readonly AskQuestion[];
	draft: AnswerDraft;
	disabled: boolean;
	onAnswer: (id: string, next: string[]) => void;
	onOtherChange: (id: string, next: AskOther) => void;
	onToggleSkip: (id: string) => void;
	/** Move the reader's place to this ask's first question once, when it has
	 *  just become the open one after a send — set by the sheet, cleared by
	 *  `onFocused`. */
	focusQuestion?: boolean;
	onFocused?: () => void;
}) => {
	/* The sheet's scroll bridge: null when this list renders outside a sheet (a
	 *  test, the settled card), in which case focus simply does not scroll. */
	const scroll = useSheetBodyScroll();
	/* One node per question block, keyed by question id, so the field that takes
	 *  focus can name the question it belongs to: the block is the anchor when the
	 *  whole question fits, the field itself when it does not. */
	const blockRefs = useRef(new Map<string, View | null>());
	/* The first question's own text: where a screen reader's place (web: keyboard
	 *  focus) lands when the sheet walks on to this ask after a send, so the next
	 *  question is the next thing read instead of focus falling to the dead
	 *  buttons the last card left behind. */
	const firstQuestionRef = useRef<Text | null>(null);
	useEffect(() => {
		if (!focusQuestion) return;
		/* A frame later: the card has only just mounted in this commit, and a
		 *  screen reader asked to focus a node the platform has not laid out yet
		 *  ignores the request. */
		const frame = requestAnimationFrame(() => {
			const node = firstQuestionRef.current;
			if (node !== null) moveReadingPlace(node);
			onFocused?.();
		});
		return () => cancelAnimationFrame(frame);
	}, [focusQuestion, onFocused]);
	const status = String(row.status || "open");
	const answerable = isAnswerable(status);
	/* `expired` draws its fields (the reader still sees what was asked) but
	 *  disables every control WITHOUT an error register: nothing went wrong, the
	 *  window closed, and the state line names the remedy. */
	const expired = status === "expired";

	if (answerable || expired) {
		return (
			<View className="gap-2 pb-2 pt-1">
				{/* A question taken elsewhere (the legacy incremental path's drafts)
				 *  is not this card's to submit — say so instead of inviting a tap
				 *  that cannot land (the relay card's R6 fix, same sentence). */}
				{answerable && fields.length === 0 ? (
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.asks.nothing_left")}
					</Text>
				) : null}
				{/* Fields for the questions that still need one: the open set while
				 *  answerable, every question for an expired ask (nothing can be
				 *  submitted, but the reader still gets to see what was asked). A
				 *  question already taken elsewhere renders no field, exactly as the
				 *  relay card draws it. */}
				{fields.map((question, index) => {
					const id = String(question.id);
					const isSkipped = draft.skipped.includes(id);
					/* The number is the question's ABSOLUTE position in the full list,
					 *  never the field's ordinal in the unanswered subset: with a legacy
					 *  draft already taken, subset numbering restarted and the second
					 *  question rendered "1/3" (agent review round 1, m3). The testID
					 *  keeps the FIELD's ordinal — it addresses rendered fields for the
					 *  audit, not questions. */
					const position = questions.indexOf(question) + 1;
					return (
						<View
							key={id}
							ref={(node) => {
								blockRefs.current.set(id, node);
							}}
							className="gap-1"
							testID={askFieldId(id)}
						>
							{questions.length > 1 ? (
								<Text
									className="font-mono text-mono-sm text-ink-dim"
									testID={askQuestionId(index + 1, questions.length)}
								>
									{position}/{questions.length}
								</Text>
							) : null}
							<Text
								ref={index === 0 ? firstQuestionRef : undefined}
								{...WEB_FOCUSABLE}
								className="text-start text-body font-medium text-ink"
							>
								{question.question}
							</Text>
							<QuestionField
								question={question}
								value={draft.answers[id] ?? []}
								other={draft.others[id] ?? EMPTY_OTHER}
								onChange={(next) => onAnswer(id, next)}
								onOtherChange={(next) => onOtherChange(id, next)}
								onFieldFocus={(node) =>
									scroll?.revealField({
										block: blockRefs.current.get(id) ?? null,
										field: node,
									})
								}
								disabled={disabled || isSkipped}
							/>
							{/* A 44 pt target, not a link: it is the only way to say
							 *  "no answer to this question", and the queue needs every
							 *  id present. Offered where a question cannot be submitted
							 *  empty — free-text ones and every question of a
							 *  multi-question ask. */}
							{questions.length > 1 || (question.options ?? []).length === 0 ? (
								<Pressable
									accessibilityRole={ROLE.button}
									accessibilityState={state({ disabled })}
									disabled={disabled}
									onPress={() => onToggleSkip(id)}
									style={{ minHeight: TOUCH_FLOOR }}
									className="justify-center self-start"
								>
									<Text
										className={cx(
											"text-body-sm",
											isSkipped ? "text-ink" : "text-ink-muted",
										)}
									>
										{isSkipped
											? t("mobile.asks.unskip")
											: t("mobile.asks.skip")}
									</Text>
								</Pressable>
							) : null}
						</View>
					);
				})}
			</View>
		);
	}

	/* A LAPSED ask is READ-ONLY (D10, the relay card's lapsed branch): the
	 * questions the agent asked, so the reader knows what lapsed, and nothing to
	 * answer them with. The row's state line already says the agent went ahead;
	 * Dismiss, the only op, sits in the pinned footer. Drawn before the settled
	 * branch, which would otherwise say "no answer was recorded" — true, but it
	 * reads as a fault rather than a deadline. */
	if (isLapsed(status)) {
		const asked = Array.isArray(row.questions) ? row.questions : [];
		return (
			<View className="gap-1 pb-2 pt-1">
				{asked.map((question, index) => (
					<View key={String(question.id ?? index)} className="flex-row gap-2">
						{asked.length > 1 ? (
							<Text className="font-mono text-mono-sm text-ink-dim">
								{index + 1}/{asked.length}
							</Text>
						) : null}
						<Text
							ref={index === 0 ? firstQuestionRef : undefined}
							{...WEB_FOCUSABLE}
							className="min-w-0 flex-1 text-start text-body-sm text-ink-muted"
						>
							{question.question}
						</Text>
					</View>
				))}
			</View>
		);
	}

	/* A settled ask: the questions and the answers chosen, so the reader and the
	 * agent read the same record. Secret answers show the KEY the runtime stored,
	 * never a value — the wire carries no value to show. */
	const pairs = answeredPairs(row.questions, row.answers);
	return (
		<View className="gap-1 pb-2 pt-1">
			{pairs.length > 0 ? (
				pairs.map((pair, index) => (
					<View key={index}>
						<Text className="text-body-sm text-ink-muted">{pair.question}</Text>
						{/* One value per line, the `Other` boundary included — the settled
						 *  frame's own component, shared with the transcript card so the two
						 *  cannot disagree about where an answer ends (UX U1). */}
						<AnsweredValues values={pair.values} />
					</View>
				))
			) : (
				<Text className="text-body-sm text-ink-muted">
					{t("mobile.asks.none_recorded")}
				</Text>
			)}
		</View>
	);
};

export const AsksSheet = ({
	visible,
	onClose,
	client,
	currentSessionId,
	onOpenConversation,
	sessions,
	initialOpenAsk = null,
	frameRows = null,
	onReadFailed,
}: AsksSheetProps) => {
	const [rows, setRows] = useState<PendingAsk[]>([]);
	const [loaded, setLoaded] = useState(false);
	/** Whether the AGGREGATE has been read successfully at least once. Not
	 *  `loaded` (which a failed read also sets): before this the aggregate is
	 *  empty and the frame rows are drawn whole; after it the two are merged, and
	 *  the failed-read branch above is what keeps the reader's rows standing. */
	const [aggregateRead, setAggregateRead] = useState(false);
	/** The read's own bound statement (`asks_truncated`): true only when the wire
	 *  dropped rows, so a prefix is never drawn beside a full count. */
	const [truncated, setTruncated] = useState(false);
	const [error, setError] = useState("");
	const [nowMs, setNowMs] = useState(() => Date.now());
	/* `undefined` = the reader has not chosen yet, so the OPENING's pre-expanded ask
	 *  (`initialOpenAsk`) applies from the very first render. Writing it in the
	 *  opening effect alone would paint one collapsed frame first, and that frame is
	 *  the whole defect (design D1). */
	const [openAskChoice, dispatchExpansion] = useReducer(
		reduceExpansion,
		undefined as ExpansionChoice,
	);
	const openAsk = shownExpansion(openAskChoice, initialOpenAsk);
	/* The expanded form's draft — the SHEET's state because two regions render
	 *  from it (the scrolling questions and the pinned footer's verbs).
	 *
	 *  WHERE IT LIVES NOW (operator, a-5712: "Keep it"; ADR 0005 §2, amended
	 *  2026-11-22). The draft no longer dies with its expansion: a typed `Other`
	 *  answer (and the chosen options) is kept in memory, keyed by conversation +
	 *  ask, by `@/features/session/ask-drafts`. It survives a close and a reopen,
	 *  and it is dropped when the ask is settled or no longer outstanding — and on
	 *  restart. NOTHING REACHES THE DISK, so the ADR's "caches nothing durably"
	 *  rule is intact; a SECRET question's answer is never kept at all.
	 *
	 *  THE RESET RUNS IN RENDER, deliberately: an effect would paint the next
	 *  ask's questions (`q1`… — ids repeat across asks) against the last ask's
	 *  answers for one frame before clearing, and that first frame is the class
	 *  of defect this sheet refuses (`openAskChoice` above). Adjusting state
	 *  during render is React's own answer to "reset state when the identity
	 *  changes": the mismatched pass is discarded before it can commit, so no
	 *  frame exists with the two asks mixed. */
	const [draft, setDraft] = useState<AnswerDraft>(() => emptyDraft(null));
	const expansion = openAsk ?? null;
	/* The ROW of the expanded ask, whatever list drew it: the draft's key is the
	 *  ask's OWN conversation (`askDraftKeyFor`), so a foreign row's answer is
	 *  written, read and pruned under one key. */
	const expansionRow = useMemo(() => {
		if (expansion === null) return null;
		return (
			[...rows, ...(frameRows ?? [])].find(
				(candidate) => candidate.ask_id === expansion,
			) ?? null
		);
	}, [expansion, rows, frameRows]);
	/* The expanded ask's questions, secret ones included: the store strips secret
	 *  answers on write, so the WRITE needs to know which they are. */
	const expansionQuestions = useMemo(
		() =>
			Array.isArray(expansionRow?.questions)
				? (expansionRow.questions as AskQuestion[])
				: ([] as AskQuestion[]),
		[expansionRow],
	);
	const draftKey =
		expansion === null
			? null
			: askDraftKeyFor(expansionRow ?? { ask_id: expansion }, currentSessionId);
	if (draft.ask !== expansion) {
		/* A DRAFT THE READER ALREADY TYPED COMES BACK (Ben, a-5712: "Keep it").
		 *  Keyed by conversation + ask, so it survives the expansion reset below
		 *  and a close-and-reopen; secret questions are never in the store at all
		 *  (`@/features/session/ask-drafts`). */
		const kept = draftKey === null ? null : readAskDraft(draftKey);
		setDraft(
			kept === null
				? emptyDraft(expansion)
				: {
						ask: expansion,
						answers: kept.answers,
						skipped: [...kept.skipped],
						others: kept.others,
					},
		);
	}
	/* Write through on every change, so a close between two keystrokes keeps the
	 *  text. The store's own gate removes secret answers. */
	useEffect(() => {
		if (draftKey === null || draft.ask === null) return;
		writeAskDraft(
			draftKey,
			{
				answers: draft.answers,
				others: draft.others,
				skipped: [...draft.skipped],
			},
			secretQuestionIds(expansionQuestions),
		);
	}, [draft, draftKey, expansionQuestions]);
	const [pendingAction, setPendingAction] = useState<PendingAction>(null);
	/** The ask whose dismissal is asking WHY (the reasons replace the footer's
	 *  buttons). Keyed to the ask, so the panel can never carry over to the next
	 *  one when the walk moves on. */
	const [dismissingAsk, setDismissingAsk] = useState<string | null>(null);
	/** Which reason was pressed, so the row keeps its words and gains the
	 *  in-flight mark while its sibling dims. */
	const [sentReason, setSentReason] = useState<DismissReason | null>(null);
	/** The ask the screen reader's place should move to once it is the open
	 *  card — set by a successful settle, taken by `AskDetail`. */
	const [focusAsk, setFocusAsk] = useState<string | null>(null);
	/* Stable, so `AskDetail`'s focus effect does not re-arm on every render. */
	const clearFocusAsk = useCallback(() => setFocusAsk(null), []);
	const { effectiveScale } = useTextScale();
	const keyboard = useKeyboardFrame();
	const rtl = useIsRTL();
	const [rowError, setRowError] = useState<{
		askId: string;
		message: string;
	} | null>(null);
	/** Ask ids this sheet has settled (answered, declined or dismissed) since it
	 *  mounted, whatever source drew the row. The aggregate re-read after a settle
	 *  reports the truth, but the frame is one SSE beat behind, so `drawnRows`
	 *  suppresses these from the FRAME side rather than letting the question the
	 *  reader just answered reappear under the walk. Never cleared: an ask id is
	 *  settled once and for all. */
	const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());

	/* Whether the sheet was open on the previous render, and the frames' own
	 *  outstanding-population signature: together they tell the one load effect
	 *  below WHY it is running — a fresh opening vs a changed population — so the
	 *  opening collapses the walk and a population-driven re-read does not
	 *  (spec §2.3; agent review round 1, m2). */
	const wasVisible = useRef(false);
	/* How many rows the sheet is drawing RIGHT NOW, read when the opening read
	 *  settles rather than captured when it started: the frame rows are LIVE, so they
	 *  can empty (answered elsewhere) while the read is in flight, and a count
	 *  closed over at the opening would still say "rows drawn" and leave an
	 *  empty sheet up with only an error line. Assigned after `shownRows` below. */
	const drawnCount = useRef(0);
	const population = useMemo(
		() => asksPopulationSignature(sessions),
		[sessions],
	);

	/** Resolves to whether the read succeeded: the opening effect needs to know. */
	const load = useCallback(async (): Promise<boolean> => {
		if (client === null) {
			setRows([]);
			setError(READ_FAILED);
			setLoaded(true);
			return false;
		}
		/* THE READ IS BOUNDED: `AbortSignal.timeout` is the platform's own
		 *  answer where the engine has it; where it does not, the read is
		 *  unbounded rather than unavailable. */
		const signal =
			typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
				? AbortSignal.timeout(READ_TIMEOUT_MS)
				: undefined;
		try {
			const answer = await client.asks(signal);
			setRows(Array.isArray(answer.asks) ? answer.asks : []);
			setAggregateRead(true);
			setTruncated(answer.asks_truncated === true);
			setError("");
			return true;
		} catch (failure) {
			if (failure instanceof DOMException && failure.name === "TimeoutError") {
				setError(READ_TIMED_OUT);
				return false;
			}
			/* The read's failure line lives in `asks.ts` with its own both-directions
			 *  test: a 404 is the older-daemon answer only when the RELAY sent it, and a
			 *  dead tunnel's 404 must read as unreachable rather than as an old daemon. */
			setError(asksReadFailureLine(failure));
			return false;
		} finally {
			setLoaded(true);
		}
	}, [client]);

	/* A NEW OPENING re-reads AND collapses the walk (the walk starts where the
	 *  reader left it, not where the last visit did); a changed outstanding
	 *  population re-reads WITHOUT collapsing it — spec §2.3, the web sheet's
	 *  `asksRevision` trigger, so a new or elsewhere-settled ask cannot sit
	 *  unseen for a backstop interval. ONE effect for both triggers — two effects
	 *  keyed on `visible` would each fire on the opening transition and fetch
	 *  twice for one tap — and the ref tells them apart, so a population-keyed
	 *  load never resets the walk. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: see the comment above — `population` is a TRIGGER, not a read.
	useEffect(() => {
		if (!visible) {
			wasVisible.current = false;
			/* Forget the expansion the last opening left behind. This component
			 *  stays mounted while hidden, so without it a policy open (which put the
			 *  head ask here) followed by a bar press painted one stale EXPANDED frame
			 *  before the opening effect collapsed it (Q5: 292 -> 86 px). The next
			 *  opening then starts from `initialOpenAsk` alone, on its first render. */
			dispatchExpansion({ type: "closed" });
			return;
		}
		const opening = !wasVisible.current;
		wasVisible.current = true;
		if (opening) {
			dispatchExpansion({ type: "opening", initial: initialOpenAsk });
			setRowError(null);
			setDismissingAsk(null);
		}
		void load().then((ok) => {
			/* Only the read that OPENED the sheet reports its failure (see
			 *  `onReadFailed`), with how many rows it is drawing: a sheet drawing frame
			 *  rows is already interactive, so the screen must not close it under the reader. */
			if (opening && !ok) onReadFailed?.({ drawn: drawnCount.current });
		});
	}, [visible, population, load]);

	/* The deadline backstop, while the sheet is open only. */
	useEffect(() => {
		if (!visible) return;
		const timer = setInterval(() => void load(), BACKSTOP_MS);
		return () => clearInterval(timer);
	}, [visible, load]);

	/* The countdowns' own clock: the deadline lines are rendered from
	 *  `expires_at` on the CLIENT clock (§5), and this is what makes them
	 *  advance while the sheet sits open rather than only when a read lands. */
	useEffect(() => {
		if (!visible) return;
		setNowMs(Date.now());
		const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
		return () => clearInterval(timer);
	}, [visible]);

	const names = useMemo(() => {
		const map = new Map<string, string>();
		for (const session of sessions ?? []) {
			map.set(
				session.session_id,
				session.conversation_name.trim() || session.session_id,
			);
		}
		return map;
	}, [sessions]);

	/* The aggregate UNION the frame's own rows, keyed by ask id, on every open and
	 *  live while the sheet is up (`drawnRows` has the rules and the reason - issue
	 *  #247: the aggregate alone was empty on a hand-open and the conversation's
	 *  question vanished with it). `settled` is the sheet's own memory of what it
	 *  has already answered/declined/dismissed: the frame is one SSE beat behind,
	 *  and a stale frame row must not put a settled question back in the list. */
	const shownRows = useMemo(
		() => [
			...drawnRows({
				frame: frameRows,
				aggregate: rows,
				aggregateRead,
				currentSessionId,
				settled,
			}),
		],
		[frameRows, rows, aggregateRead, currentSessionId, settled],
	);
	drawnCount.current = shownRows.length;
	/* Forget every draft whose ask is no longer outstanding — settled here or on
	 *  another surface, withdrawn, or lapsed out of the queue. */
	useEffect(() => {
		/* Nothing is pruned before the first read has answered: an empty `shownRows`
		 *  while the sheet is still loading is not evidence that an ask is gone, and
		 *  pruning on it would throw away the very draft this store exists to keep
		 *  (#247 is the same shape of "short list while reading" the sheet already
		 *  defends against). */
		if (!loaded) return;
		const live = new Set(
			outstandingAsks(shownRows).map((row) =>
				askDraftKeyFor(row, currentSessionId),
			),
		);
		retainAskDrafts(live);
	}, [shownRows, currentSessionId, loaded]);

	/* The head first, then the wire's own order — the order the bar names. */
	const listed = useMemo(() => orderedForDisplay(shownRows), [shownRows]);
	/* Everything that still shows a card, then the settled asks under "Earlier":
	 *  an answered ask must never sit between the open card's options and the
	 *  pinned buttons (ask-panel parity §2). */
	const bands = useMemo(() => askBands(shownRows), [shownRows]);

	/* The expanded ask and its form facts. Both regions read these — the body
	 *  (`AskDetail`) draws the questions, the footer draws the verbs — so the
	 *  `Send answer` gate and the submitted body cannot disagree about the same
	 *  draft. */
	const openRow = useMemo(
		() => listed.find((row) => row.ask_id === openAsk) ?? null,
		[listed, openAsk],
	);
	const openStatus = openRow ? String(openRow.status || "open") : "";
	const openAnswerable = openRow !== null && isAnswerable(openStatus);
	/* `expired` keeps its fields and its disabled controls WITHOUT an error
	 *  register: nothing went wrong, the window closed, and the state line names
	 *  the remedy. */
	const openExpired = openStatus === "expired";
	const openQuestions = useMemo(
		() => (openRow && openAnswerable ? unansweredQuestions(openRow) : []),
		[openRow, openAnswerable],
	);
	const openAllQuestions = useMemo(
		() =>
			openRow && Array.isArray(openRow.questions) ? openRow.questions : [],
		[openRow],
	);
	const openFields = openAnswerable
		? openQuestions
		: openExpired
			? openAllQuestions
			: [];
	const openBusy =
		openRow && pendingAction?.askId === openRow.ask_id
			? pendingAction.kind
			: null;
	const openDisabled = !openAnswerable || openBusy !== null;
	/* What the footer may offer for the expanded ask — the same answer `settle`
	 *  enforces, so a timed-out ask shows Dismiss alone and no answer request
	 *  can leave for it. */
	const openActions = askActions(openStatus);
	const openError =
		openRow && rowError?.askId === openRow.ask_id ? rowError.message : null;
	/* Whether every still-open question carries a usable cell. A question counts
	 *  as answered when its composition (option ticks plus the `Other` door) has
	 *  a non-empty value — and NOT while the door stands open and empty, even
	 *  beside ticks (`questionIsAnswered` holds that rule once for the gate and
	 *  the body both) — or it was explicitly skipped (sent as the empty list the
	 *  queue's own contract defines). */
	const openFilled = (question: AskQuestion): boolean => {
		const id = String(question.id);
		if (draft.skipped.includes(id)) return true;
		return questionIsAnswered(
			question,
			draft.answers[id] ?? [],
			draft.others[id] ?? EMPTY_OTHER,
		);
	};
	const openComplete =
		openQuestions.length > 0 &&
		openQuestions.every((question) => openFilled(question));
	/* WHY Send IS GREY, said in words (2026-11-22 spec §3.4): a disabled button
	 *  alone gives the reader no reason. Only while the form is incomplete and
	 *  nothing is in flight — a busy button is dimmed for a different reason. */
	const progress =
		openAnswerable && openBusy === null
			? askProgress({
					total: openAllQuestions.length,
					unfilled: openQuestions.filter((question) => !openFilled(question))
						.length,
					hasOptions: (openQuestions[0]?.options ?? []).length > 0,
				})
			: null;
	const progressLine =
		progress === null
			? null
			: progress.kind === "tally"
				? t("mobile.asks.progress.tally", {
						answered: progress.answered,
						total: progress.total,
					})
				: progress.kind === "pick_or_type"
					? t("mobile.asks.progress.pick_or_type")
					: t("mobile.asks.progress.type");
	const reasonsOpen = openRow !== null && dismissingAsk === openRow.ask_id;
	/* Large text stacks the footer's pair (see the footer); the keyboard being up
	 *  takes Dismiss… away, which is when the question needs the room. */
	const stackPair = effectiveScale > LARGE_TEXT_SCALE;
	const showDismissLink =
		openRow !== null &&
		openActions.dismiss &&
		dismissNeedsReason(openStatus) &&
		!keyboard.visible;
	/* The atomic submit: one body for EVERY question of the ask (the queue
	 *  refuses a partial map), a skipped question riding as the empty list.
	 *  Built by `asks.ts`'s ONE composition, so the `Other` door's typed text
	 *  rides the way the contract expects: a plain string in the question's
	 *  list — alone on a single-select, last on a multi-select. */
	const respondBody = (): Record<string, string[]> =>
		openRow
			? askResponseBody(openAllQuestions, {
					answers: draft.answers,
					others: draft.others,
					skipped: draft.skipped,
				})
			: {};
	/* The bar's own sentence (`askBarLabel`), so the sheet names what the reader
	 *  met in the bar's words ("1 question waiting", or "1 question timed out" for
	 *  a lapsed-only queue), in QUESTIONS, the unit the bar counts (E2 spec §1.3),
	 *  not the queue's internal noun (design D5). Bare `asks` stays for a queue
	 *  with nothing waiting or lapsed - answered rows can still be listed. */
	const title = askBarLabel(shownRows)?.text ?? t("mobile.asks.title_fallback");

	/** Settle one ask, then advance the walk and re-read. On success the
	 *  expansion moves to the next outstanding ask; on refusal the sentence
	 *  stays with the row it answers and the controls come back. */
	const settle = useCallback(
		async (
			kind: SettleKind,
			row: PendingAsk,
			body?: { answers: Record<string, string[]> },
			reason?: DismissReason,
		) => {
			if (client === null || pendingAction !== null) return;
			const sessionId = String(row.session_id || currentSessionId || "");
			if (sessionId === "") {
				setRowError({
					askId: row.ask_id,
					message: READ_FAILED,
				});
				return;
			}
			/* THE REQUEST GATE, not only the button's: a control that is merely
			 *  hidden still leaves a path (a stale footer, a re-render race) for an
			 *  answer the other surfaces never send (D10). */
			if (!askActions(String(row.status || "open"))[kind]) return;
			/* A waiting ask is dismissed WITH a reason or not at all: the agent is
			 *  still owed an answer, and it is told why none is coming. A lapsed one
			 *  carries none (`dismissNeedsReason`). */
			if (
				kind === "dismiss" &&
				dismissNeedsReason(String(row.status || "open")) &&
				reason === undefined
			)
				return;
			setPendingAction({ askId: row.ask_id, kind });
			setRowError(null);
			try {
				if (kind === "respond") {
					await client.command(sessionId, {
						op: "ask_respond",
						ask_id: row.ask_id,
						answers: body?.answers ?? {},
					});
				} else if (kind === "decline") {
					await client.command(sessionId, {
						op: "ask_decline",
						ask_id: row.ask_id,
					});
				} else {
					/* The reason rides only when there is one, so a lapsed ask's body
					 *  stays the shape every older daemon accepts. */
					await client.command(sessionId, {
						op: "ask_dismiss",
						ask_id: row.ask_id,
						...(reason === undefined ? {} : { reason }),
					});
				}
				/* Recorded BEFORE the re-read: the frame that lands under it may still
				 *  list the ask as open, and the merge must not resurrect it. */
				setSettled((previous) => new Set(previous).add(row.ask_id));
				/* Settled is settled: the typed text has no ask left to belong to. */
				dropAskDraft(askDraftKeyFor(row, currentSessionId));
				/* Advance the walk from the list as it stood: the re-read below
				 *  refreshes the truth, but the reader's next ask is already
				 *  visible here. Any row with a verb — a lapsed ask's Dismiss
				 *  counts (UX r1 U1). */
				const next = nextActionableAsk(shownRows, row.ask_id);
				dispatchExpansion({ type: "pick", ask: next ? next.ask_id : null });
				setDismissingAsk(null);
				setFocusAsk(next ? next.ask_id : null);
				await load();
			} catch (failure) {
				setRowError({ askId: row.ask_id, message: refusalText(failure) });
			} finally {
				setPendingAction(null);
			}
		},
		[client, currentSessionId, load, pendingAction, shownRows],
	);

	/* The footer's settle — the only submit path, and the guard keeps a second
	 *  press out while one is in flight, exactly as the in-body version did. */
	const settleFromFooter = (
		kind: SettleKind,
		body?: { answers: Record<string, string[]> },
		reason?: DismissReason,
	) => {
		if (openRow === null || openBusy !== null) return;
		void settle(kind, openRow, body, reason);
	};

	/* ---- the pieces the body is drawn from ---- */

	/** What a row's lines are drawn from, in one place so the card and the
	 *  collapsed row cannot read the same ask two ways. */
	const factsOf = (row: PendingAsk) => {
		const status = String(row.status || "open");
		const sessionId = String(row.session_id || currentSessionId || "");
		return {
			status,
			sessionId,
			foreign: sessionId !== "" && sessionId !== currentSessionId,
			stateLine: askStateLine(row, nowMs),
			left: Number(row.expires_at) - nowMs,
			urgent: Boolean(row.urgent) && isAnswerable(status),
		};
	};

	/* The audit's `timed-out-mixed` cell proves the state from this zero-size
	 *  anchor — an EXTRA id on the row, the `transcript-streaming` shape, so the
	 *  row's own id stays stable as the ask changes hands with time. */
	const timedOutAnchor = (row: PendingAsk) =>
		String(row.status || "open") === "timed_out" ? (
			<View testID={timedOutAskRowId(row.ask_id)} aria-hidden />
		) : null;

	const toggle = (askId: string) => {
		setDismissingAsk(null);
		dispatchExpansion({ type: "toggle", ask: askId });
	};

	/** The ask's own form, questions and receipt, shared by the open card and an
	 *  expanded "Earlier" row. */
	const detailOf = (row: PendingAsk) => (
		<AskDetail
			row={row}
			questions={openAllQuestions}
			fields={openFields}
			draft={draft}
			disabled={openDisabled}
			focusQuestion={focusAsk === row.ask_id}
			onFocused={clearFocusAsk}
			onAnswer={(id, next) =>
				setDraft((current) => ({
					...current,
					answers: { ...current.answers, [id]: next },
				}))
			}
			onOtherChange={(id, next) =>
				setDraft((current) => ({
					...current,
					others: { ...current.others, [id]: next },
				}))
			}
			onToggleSkip={(id) =>
				setDraft((current) => ({
					...current,
					skipped: current.skipped.includes(id)
						? current.skipped.filter((value) => value !== id)
						: [...current.skipped, id],
				}))
			}
		/>
	);

	/** A collapsed ask. The QUESTION leads (medium weight, up to two lines) because
	 *  it is what tells one ask from another; the state sentence sits under it in
	 *  its tone's ink and is never truncated, so a deadline is never cut off at
	 *  large text. A foreign ask names its conversation on the row's own first
	 *  line. Tapping opens it and closes the current one. An "Earlier" row expands
	 *  in place into its receipt (nothing there is pinned, so it can never sit
	 *  between a card's options and the buttons). */
	const collapsedRow = (row: PendingAsk, expanded: boolean) => {
		const facts = factsOf(row);
		const asked = questionStart(row);
		return (
			<View key={row.ask_id}>
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel={[
						facts.foreign
							? (names.get(facts.sessionId) ?? facts.sessionId)
							: "",
						asked,
						facts.stateLine.text,
					]
						.filter((part) => part !== "")
						.join(", ")}
					accessibilityState={state({ expanded })}
					onPress={() => toggle(row.ask_id)}
					testID={askRowId(row.ask_id)}
					style={{ minHeight: TOUCH_FLOOR }}
					className="justify-center py-1"
				>
					<View className="flex-row items-start gap-x-2">
						<View className="min-w-0 flex-1">
							{facts.foreign ? (
								<Text
									numberOfLines={1}
									className="text-start text-meta text-ink-muted"
								>
									{names.get(facts.sessionId) ?? facts.sessionId}
								</Text>
							) : null}
							{asked === "" ? null : (
								<Text
									numberOfLines={2}
									className="text-start text-body-sm font-medium text-ink"
								>
									{asked}
								</Text>
							)}
							<Text className="text-start text-meta">
								<Text className={askToneInk(facts.stateLine.tone)}>
									{facts.stateLine.text}
								</Text>
								{facts.urgent ? (
									<Text className="font-medium text-warning">
										{" "}
										{t("mobile.asks.urgent")}
									</Text>
								) : null}
							</Text>
						</View>
						{/* The disclosure caret mirrors in a right-to-left layout: a `▸`
						 *  points at the row's far end there, away from where the row
						 *  opens (design D6). */}
						<Text className="shrink-0 text-meta text-ink-dim" aria-hidden>
							{expanded ? "▾" : rtl ? "◂" : "▸"}
						</Text>
					</View>
				</Pressable>
				{timedOutAnchor(row)}
				{expanded ? detailOf(row) : null}
			</View>
		);
	};

	/** The open ask: ONE card — the state line first (a status region, so a
	 *  change of state is announced), the conversation only when it is another
	 *  one, then the form, whose first line is the question itself. */
	const openCard = (row: PendingAsk) => {
		const facts = factsOf(row);
		return (
			<AskCard key={`card-${row.ask_id}`} askId={row.ask_id}>
				<View
					role={ROLE.status}
					testID={askRowId(row.ask_id)}
					className="flex-row flex-wrap items-baseline gap-x-2"
				>
					<Text className={cx("text-meta", askToneInk(facts.stateLine.tone))}>
						{facts.stateLine.text}
					</Text>
					{facts.urgent ? (
						<Text className="text-meta font-medium text-warning">
							{t("mobile.asks.urgent")}
						</Text>
					) : null}
				</View>
				{timedOutAnchor(row)}
				{facts.foreign ? (
					<View className="flex-row items-center gap-2">
						<Text className="min-w-0 flex-1 truncate text-meta text-ink-muted">
							{names.get(facts.sessionId) ?? facts.sessionId}
						</Text>
						{/* The route from a foreign ask to its own conversation, as an
						 *  outlined icon button with the accessible name "Open
						 *  conversation" (design D3). A press resolves to the innermost
						 *  control on both platforms (react-native-web runs only the first
						 *  PressResponder ancestor's onPress). The parent owns the
						 *  transition (clear the sheet, then navigate) so the sheet cannot
						 *  outlive the row it opened. */}
						{onOpenConversation ? (
							<IconButton
								accessibilityLabel={t("mobile.asks.open_conversation")}
								outlined
								onPress={() =>
									onOpenConversation(
										facts.sessionId,
										/* The destination's asks the reader is looking at now:
										 *  what a dismissal there is recorded against. */
										outstandingAsks(shownRows)
											.filter(
												(candidate) =>
													String(candidate.session_id || "") ===
													facts.sessionId,
											)
											.map((candidate) => candidate.ask_id),
									)
								}
								icon={({ color, size }) => (
									<ArrowUpRight color={color} size={size} />
								)}
								testID={CONTROL.askOpenConversation}
							/>
						) : null}
					</View>
				) : null}
				{(facts.foreign && row.cwd) || facts.left <= 0 ? (
					<View className="flex-row flex-wrap items-center gap-x-2">
						{facts.foreign && row.cwd ? (
							<Text className="min-w-0 flex-1 truncate text-mono-sm text-ink-dim">
								{row.cwd}
							</Text>
						) : null}
						{facts.left <= 0 ? (
							<Text className="font-mono text-meta text-ink-dim">
								{t("mobile.asks.deadline_ago", {
									duration: durationLabel(-facts.left),
								})}
							</Text>
						) : null}
					</View>
				) : null}
				{detailOf(row)}
			</AskCard>
		);
	};

	const waitingBand = bands.current.filter((row) => row.ask_id !== openAsk);
	const openInBand = bands.current.find((row) => row.ask_id === openAsk);

	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title={title}
			testID={SURFACE.asksSheet}
			/* The queue is a list, so it takes the half detent; one ask fits its
			 *  content (the model-list precedent, components.md §8). */
			detent={listed.length > 1 ? "half" : "content"}
			/* THE TWO SIZES AND THE KEYBOARD (this sheet's own brief): Medium
			 *  hugs the content and Large gives a long question room for its option
			 *  cards; the platform's own swipe-down puts the keyboard away, and a
			 *  first tap outside it does the same instead of throwing a typed
			 *  answer away. The chosen size is remembered for the app run, in
			 *  memory only — the same rule the draft below follows. */
			resizable
			resizeKey="asks"
			keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
			dismissKeyboardOnScrimTap
			dismissKeyboardOnBodyTap
			/* THE ANSWERING CONTROLS ARE PINNED, and so is the refusal line — the
			 *  kit's three-region rule (`Sheet`'s `footer` doc; the #69 precedent
			 *  on three sibling sheets). Measured on iphone-se at 100 %: the
			 *  actions sat WHOLLY below the fold (design D2), and a scrolling
			 *  control is the one thing an answer sheet must not hide. The
			 *  scrolling body keeps the questions; the footer holds the verbs for
			 *  whichever ask is expanded. */
			footer={
				openRow !== null &&
				(openAnswerable || openExpired || openActions.dismiss) ? (
					<View className="gap-2">
						{openError !== null ? (
							<Text className="text-body-sm text-danger">{openError}</Text>
						) : null}
						{reasonsOpen ? (
							/* WHY, BEFORE A WAITING ASK GOES (the relay card's own door): the
							 *  agent is still owed an answer, so it is told why none is
							 *  coming, and nothing is sent until a reason is chosen. The
							 *  reasons REPLACE the answering pair while they are up, so a
							 *  reader with a drafted answer cannot read "Answered in chat"
							 *  as "send my answer" from eight points beside Send. */
							<View className="gap-1">
								<Text className="text-start text-meta text-ink-dim">
									{t("mobile.asks.dismiss_title", {
										count: Math.max(1, openAllQuestions.length),
									})}
								</Text>
								{DISMISS_REASONS.map((reason) => (
									<Pressable
										key={reason}
										accessibilityRole={ROLE.button}
										accessibilityState={state({
											disabled: openBusy !== null,
											busy: openBusy === "dismiss" && sentReason === reason,
										})}
										disabled={openBusy !== null}
										onPress={() => {
											setSentReason(reason);
											settleFromFooter("dismiss", undefined, reason);
										}}
										testID={askDismissReasonId(reason)}
										style={{ minHeight: TOUCH_FLOOR }}
										className="justify-center rounded-sm px-2 py-1.5"
									>
										<Text
											className={cx(
												"text-start text-body-sm",
												openBusy !== null && sentReason !== reason
													? "text-ink-disabled"
													: "text-ink",
											)}
										>
											{t(REASON_COPY[reason].label)}
										</Text>
										<Text className="text-start text-meta text-ink-dim">
											{t(REASON_COPY[reason].note)}
										</Text>
									</Pressable>
								))}
								<Button
									label={t("mobile.common.cancel")}
									variant="quiet"
									onPress={() => {
										setDismissingAsk(null);
										setRowError(null);
									}}
									disabled={openBusy !== null}
									testID={CONTROL.askDismissCancel}
								/>
							</View>
						) : (
							<>
								{/* The pair only where answering is (or was) the question: live on
								 *  an open ask, drawn disabled on an expired one so the window's
								 *  close reads as a state, absent on a lapsed one (D10). At large
								 *  text the two buttons STACK, one per row at full width: side by
								 *  side "Send answer" wrapped to two lines beside a one-line
								 *  Decline and the footer took a third of the sheet (QA Q1). Side
								 *  by side they `fill`, so the two always match in height. */}
								{openAnswerable || openExpired ? (
									<View className={stackPair ? "gap-2" : "flex-row gap-2"}>
										<View className={stackPair ? undefined : "flex-1"}>
											<Button
												label={
													openAllQuestions.length > 1
														? t("mobile.asks.send_answers")
														: t("mobile.asks.send_answer")
												}
												fill
												onPress={() =>
													settleFromFooter("respond", {
														answers: respondBody(),
													})
												}
												disabled={openDisabled || !openComplete}
												loading={openBusy === "respond"}
												testID={CONTROL.askRespond}
											/>
										</View>
										<View className={stackPair ? undefined : "flex-1"}>
											<Button
												label={t("mobile.asks.decline")}
												variant="danger"
												fill
												accessibilityHint={t("mobile.asks.decline_hint")}
												onPress={() => settleFromFooter("decline")}
												disabled={openDisabled}
												loading={openBusy === "decline"}
												testID={CONTROL.askDecline}
											/>
										</View>
									</View>
								) : null}
								{/* Why Send is grey and the quiet way out share ONE row, so the
								 *  footer stays compact. Dismiss… is a text link, not a button:
								 *  dismissing answers nobody and buys no turn, so it must not
								 *  compete with Send and Decline (design D3). It steps aside
								 *  while the keyboard is up, which is when the question needs
								 *  the room. A WAITING ask's door asks why first (hence the
								 *  ellipsis). */}
								{progressLine !== null || showDismissLink ? (
									<View
										className={
											stackPair ? "gap-1" : "flex-row items-center gap-x-3"
										}
									>
										{progressLine === null ? null : (
											<Text className="min-w-0 flex-1 text-start text-meta text-ink-dim">
												{progressLine}
											</Text>
										)}
										{showDismissLink ? (
											<Pressable
												accessibilityRole={ROLE.button}
												accessibilityState={state({
													disabled: openBusy !== null,
												})}
												disabled={openBusy !== null}
												onPress={() => setDismissingAsk(openRow.ask_id)}
												testID={CONTROL.askDismiss}
												/* A 44 pt box both ways: the label alone is narrower than
												 *  the floor in most languages. At large text the link takes
												 *  its own full-width row under the progress sentence, so it
												 *  never squeezes that sentence into a sliver. */
												style={{
													minHeight: TOUCH_FLOOR,
													minWidth: TOUCH_FLOOR,
												}}
												className={
													stackPair
														? "justify-center self-stretch px-1"
														: "shrink-0 justify-center px-1"
												}
											>
												<Text className="text-start text-meta text-ink-muted">
													{t("mobile.asks.dismiss_open")}
												</Text>
											</Pressable>
										) : null}
									</View>
								) : null}
								{/* A LAPSED ask goes at once — the agent already walked past it —
								 *  and it is the sheet's only verb there, so it stays a button.
								 *  Not `openDisabled`: that is the ANSWER pair's gate and a lapsed
								 *  ask is not answerable, so only the in-flight guard applies. */}
								{openActions.dismiss && !dismissNeedsReason(openStatus) ? (
									<Button
										label={t("mobile.asks.dismiss")}
										variant="quiet"
										onPress={() => settleFromFooter("dismiss")}
										disabled={openBusy !== null}
										loading={openBusy === "dismiss"}
										testID={CONTROL.askDismiss}
									/>
								) : null}
							</>
						)}
					</View>
				) : undefined
			}
		>
			<View className="gap-2" testID={SURFACE.asksSheetBody}>
				{/* The bounded read naming its own bound: a prefix must never sit
				 *  beside a full count and read as complete. No numeral: the aggregate
				 *  route is uncapped, so any figure here would borrow the projection
				 *  frame's cap rather than state this route's (agent review round 1,
				 *  n1). */}
				{truncated ? (
					<Text className="text-meta text-ink-dim">
						{t("mobile.asks.truncated")}
					</Text>
				) : null}
				{/* The read's failure line sits ABOVE the rows, and that is the placement
				 *  that does not move the form. The sheet is bottom-anchored and grows
				 *  UPWARD (`Sheet`: `justify-end`), so a line inserted above the rows
				 *  leaves everything beneath it where it was, while one below them lifts
				 *  the answer form by the line's height (measured on the round-2 build:
				 *  Answer 729 -> 705 px, round 3 U13). One regime still moves: a queue
				 *  tall enough to scroll sits at offset 0, where a line at the top pushes
				 *  the rows down by its height (and none would have moved below them) -
				 *  accepted, because the common failure is a short seeded queue that fits
				 *  its detent, and a line scrolled out of sight would hide the failure.
				 *  Its copy is scoped to the list while rows are drawn (`readFailureNotice`).
				 *  "Try again" re-runs the same read; the rows stay where they are. */}
				{error !== "" ? (
					<View className="gap-1">
						<Text
							className="text-body-sm text-danger"
							testID={SURFACE.asksSheetError}
						>
							{readFailureNotice(error, shownRows.length)}
						</Text>
						<View className="self-start">
							<Button
								label={t("mobile.common.try_again")}
								variant="outline"
								size="sm"
								onPress={() => void load()}
								testID={CONTROL.asksReadRetry}
							/>
						</View>
					</View>
				) : null}
				{/* The loading line is not decoration: without it the sheet paints
				 *  its empty state while the read is still in flight, so "nothing
				 *  waiting" is shown about an answer that has not arrived yet. */}
				{!loaded && error === "" && shownRows.length === 0 ? (
					<Text
						className="text-body-sm text-ink-muted"
						testID={SURFACE.asksSheetLoading}
					>
						{t("mobile.asks.loading")}
					</Text>
				) : null}
				{loaded && rows.length === 0 && error === "" ? (
					<Text
						className="text-body-sm text-ink-muted"
						testID={SURFACE.asksSheetEmpty}
					>
						{t("mobile.asks.empty")}
					</Text>
				) : null}
				{/* THE OPEN ASK, FIRST: one card, whichever position the queue holds
				 *  it in — the reader opened it to read it, and it is the one the
				 *  pinned buttons answer. */}
				{openInBand === undefined ? null : openCard(openInBand)}
				{/* The other asks still waiting (or lapsed), one line each. */}
				{waitingBand.map((row) => collapsedRow(row, false))}
				{/* SETTLED ASKS go under their own heading, below everything that
				 *  still waits: they used to sit between the options and the buttons. */}
				{bands.earlier.length > 0 ? (
					<>
						<Text
							accessibilityRole={ROLE.header}
							className="pt-2 text-meta font-medium text-ink-muted"
						>
							{t("mobile.asks.settled")}
						</Text>
						{bands.earlier.map((row) =>
							collapsedRow(row, openAsk === row.ask_id),
						)}
					</>
				) : null}
				{/* §1.4's honesty line, now LAST (ask-panel parity, Ben 2026-11-23; it
				 *  used to lead the sheet, per §5): the app cannot alert while closed, and a
				 *  queue surface that let a reader believe otherwise would be the one
				 *  lie this design exists to refuse. It stays on the sheet, but it is
				 *  context, not the first thing a reader meets — the question is. Dim
				 *  ink on purpose; it is not a warning. */}
				<Text className="text-meta text-ink-dim">
					{t("mobile.asks.honesty")}
				</Text>
			</View>
		</Sheet>
	);
};
