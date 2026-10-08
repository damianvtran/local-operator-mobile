// biome-ignore-all lint/suspicious/noArrayIndexKey: the settled record's question list is regenerated whole on every render — a parsed detail, not an editable collection — so position IS the identity, the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import { ArrowUpRight } from "lucide-react-native";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import type { AskQuestion, PendingAsk, SessionSummary } from "@/contracts";
import {
	answeredPairs,
	askStateLine,
	asksPopulationSignature,
	asksReadFailureLine,
	askToneInk,
	durationLabel,
	isAnswerable,
	orderedForDisplay,
	outstandingAsks,
	questionsWaitingLabel,
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
import type { RelayEndpoints } from "@/relay";
import {
	askFieldId,
	askQuestionId,
	askRowId,
	CONTROL,
	ROLE,
	SURFACE,
	state,
	timedOutAskRowId,
} from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { IconButton } from "@/ui/components/icon-button";
import { Sheet } from "@/ui/components/sheet";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

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
 * THE ANSWER SURFACE IS HERE. A row expands in place into the ask's own form —
 * every question of the ask together, ONE submit — because `ask_respond` is
 * atomic per ask: the wire refuses a partial map, so a wizard would have to
 * hold the answers anyway, and a form is what makes "you have answered 2 of 3"
 * visible. Answering advances the expansion to the next outstanding ask, which
 * is the walk §5.3 promises: one sitting clears asks from several conversations
 * without navigating.
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
	/** The session's own outstanding rows, as the projection frame that raised the
	 *  sheet already holds them. Drawn ONLY until the sheet's first aggregate read
	 *  lands, then replaced by it (design D3): without a seed an auto-opened sheet
	 *  paints `reading questions…`, then grows when the rows arrive - and with the
	 *  head question now expanded that growth is a whole answer form, not 28 px.
	 *  The aggregate stays the sheet's source of truth (its rows carry the
	 *  `session_id`/`cwd` the frame's do not); a seed is current-session rows
	 *  only, which need neither. Passed for a policy open only. */
	seedRows?: readonly PendingAsk[] | null;
	/** The sheet's FIRST read after opening failed. The screen decides what to do
	 *  (an auto-opened sheet with NOTHING drawn closes back to the bar; one that
	 *  is drawing the seed stays, with the error line under the rows - round 2,
	 *  U9). `drawn` is how many rows the sheet is drawing, which is what that
	 *  decision turns on. Only the opening read reports, so a backstop or
	 *  population re-read failing later - while the reader may be mid-answer - can
	 *  never reach it. */
	onReadFailed?: (info: { drawn: number }) => void;
};

/** One question's control: a picker of consequence-carrying options, or a
 *  free-text/secret field. Mirrors `PendingCard`'s option row (§13: every
 *  option carries its consequence line) without reusing the component — that
 *  one is bound to the single-slot `PendingView`, and this form is per-ask. */
const QuestionField = ({
	question,
	value,
	onChange,
	disabled,
}: {
	question: AskQuestion;
	/** Chosen labels, or the typed string. Empty means "not answered yet"; a
	 *  deliberate skip is a separate state, because an empty value IS an answer
	 *  to the queue (the contract's spelling for "no answer"). */
	value: string[];
	onChange: (next: string[]) => void;
	disabled: boolean;
}) => {
	const options = Array.isArray(question.options) ? question.options : [];
	const chosen = new Set(value);
	if (options.length === 0) {
		return (
			<View>
				{question.secret ? (
					<Text className="pb-1 text-meta text-ink-dim">
						secret — sent directly, not shown in the transcript
						{question.persist ? ", and saved to your credential store" : ""}
					</Text>
				) : null}
				<TextInput
					className="min-h-11 rounded-sm border border-control bg-elevated px-3 text-body text-ink"
					value={value[0] ?? ""}
					onChangeText={(text) => onChange([text])}
					editable={!disabled}
					placeholder={question.secret ? "Secret value" : "Your answer"}
					secureTextEntry={question.secret}
					// 16 pt or the OS zooms the whole page on focus, which moves
					// every control the reader was about to press.
					style={{ fontSize: 16 }}
					accessibilityLabel={question.question || "Your answer"}
				/>
			</View>
		);
	}
	return (
		<View className="gap-1">
			{options.map((option, index) => {
				const on = chosen.has(option.label);
				/* The recommendation is an INDEX into `options` AS CARRIED (the
				   runtime hoists the recommended option to 0 and states the
				   position); a client that re-sorted and kept the index would mark
				   the wrong one. */
				const recommended = question.recommended === index;
				return (
					<Pressable
						key={option.label}
						accessibilityRole={ROLE.radio}
						accessibilityLabel={option.label}
						accessibilityState={state({ selected: on, disabled })}
						disabled={disabled}
						onPress={() => {
							if (!question.multi) {
								onChange([option.label]);
								return;
							}
							const next = new Set(chosen);
							if (next.has(option.label)) next.delete(option.label);
							else next.add(option.label);
							onChange(Array.from(next));
						}}
					>
						<View
							className={cx(
								"rounded-sm border px-2 py-1.5",
								on
									? "border-accent-border bg-accent-muted"
									: "border-control bg-surface",
							)}
						>
							<Text className="text-body-sm text-ink">
								{option.label}
								{recommended ? (
									<Text className="text-meta text-ink-dim"> · recommended</Text>
								) : null}
							</Text>
							{option.description.length > 0 ? (
								<Text className="text-meta text-ink-dim">
									{option.description}
								</Text>
							) : null}
						</View>
					</Pressable>
				);
			})}
			{question.multi ? (
				<Text className="text-meta text-ink-dim">choose any that apply</Text>
			) : null}
		</View>
	);
};

/** The expanded detail of ONE ask: its form, its controls, its refusal. */
const AskDetail = ({
	row,
	nowMs,
	busy,
	error,
	onSettle,
}: {
	row: PendingAsk;
	nowMs: number;
	busy: SettleKind | null;
	error: string | null;
	onSettle: (
		kind: SettleKind,
		row: PendingAsk,
		body?: { answers: Record<string, string[]> },
	) => void;
}) => {
	const status = String(row.status || "open");
	const answerable = isAnswerable(status);
	/* `expired` disables every control WITHOUT an error register: nothing went
	 * wrong, the window closed, and the state line names the remedy. Settled
	 * asks render their record instead — a control that cannot work is worse
	 * than no control (the same rule `pending.ts` states for approvals). */
	const expired = status === "expired";
	const questions = useMemo(
		() => (Array.isArray(row.questions) ? row.questions : []),
		[row.questions],
	);
	const openQuestions = useMemo(
		() => (answerable ? unansweredQuestions(row) : []),
		[answerable, row],
	);

	/* The draft map: question id → chosen labels (or the typed string). Lives
	 * with this expansion and dies when it collapses — see the module note. */
	const [answers, setAnswers] = useState<Record<string, string[]>>({});
	const [skipped, setSkipped] = useState<readonly string[]>([]);

	/* Whether every still-open question carries a usable cell. A question counts
	 * as answered when it has a non-empty draft, or was explicitly skipped
	 * (which is sent as the empty list the queue's own contract defines); a
	 * whitespace-only text is not an answer. */
	const filled = (id: string): boolean => {
		if (skipped.includes(id)) return true;
		const cell = answers[id] ?? [];
		return cell.some((value) => value.trim() !== "");
	};
	const complete =
		openQuestions.length > 0 &&
		openQuestions.every((question) => filled(String(question.id)));

	const disabled = !answerable || busy !== null;
	/* Fields to draw: the open set while answerable, every question for an
	 *  expired ask (nothing can be submitted, but the reader still sees what was
	 *  asked — the state line is the whole explanation and no error register is
	 *  drawn). */
	const fields = answerable ? openQuestions : expired ? questions : [];
	const settle = (
		kind: SettleKind,
		body?: { answers: Record<string, string[]> },
	) => {
		if (busy !== null) return;
		onSettle(kind, row, body);
	};

	if (answerable || expired) {
		/* The atomic submit: one body for EVERY question of the ask (the queue
		 * refuses a partial map), a skipped question riding as the empty list. */
		const respondBody = () => {
			const body: Record<string, string[]> = {};
			for (const question of questions) {
				const id = String(question.id);
				if (skipped.includes(id)) body[id] = [];
				else body[id] = (answers[id] ?? []).map((value) => value.trim());
			}
			return body;
		};

		return (
			<View className="gap-2 pb-2 pt-1">
				{/* A question taken elsewhere (the legacy incremental path's drafts)
				 *  is not this card's to submit — say so instead of inviting a tap
				 *  that cannot land (the relay card's R6 fix, same sentence). */}
				{answerable && openQuestions.length === 0 ? (
					<Text className="text-body-sm text-ink-muted">
						nothing left to answer here — another surface has already taken
						these questions.
					</Text>
				) : null}
				{/* Fields for the questions that still need one: the open set while
				 *  answerable, every question for an expired ask (nothing can be
				 *  submitted, but the reader still gets to see what was asked). A
				 *  question already taken elsewhere renders no field, exactly as the
				 *  relay card draws it. */}
				{fields.map((question, index) => {
					const id = String(question.id);
					const isSkipped = skipped.includes(id);
					/* The number is the question's ABSOLUTE position in the full list,
					 *  never the field's ordinal in the unanswered subset: with a legacy
					 *  draft already taken, subset numbering restarted and the second
					 *  question rendered "1/3" (agent review round 1, m3). The testID
					 *  keeps the FIELD's ordinal — it addresses rendered fields for the
					 *  audit, not questions. */
					const position = questions.indexOf(question) + 1;
					return (
						<View key={id} className="gap-1" testID={askFieldId(id)}>
							{questions.length > 1 ? (
								<Text
									className="font-mono text-mono-sm text-ink-dim"
									testID={askQuestionId(index + 1, questions.length)}
								>
									{position}/{questions.length}
								</Text>
							) : null}
							<Text className="text-body font-medium text-ink">
								{question.question}
							</Text>
							<QuestionField
								question={question}
								value={answers[id] ?? []}
								disabled={disabled || isSkipped}
								onChange={(next) =>
									setAnswers((current) => ({ ...current, [id]: next }))
								}
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
									onPress={() =>
										setSkipped((current) =>
											current.includes(id)
												? current.filter((value) => value !== id)
												: [...current, id],
										)
									}
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
											? "answer this after all"
											: "skip — send no answer"}
									</Text>
								</Pressable>
							) : null}
						</View>
					);
				})}
				{error !== null ? (
					<Text className="text-body-sm text-danger">{error}</Text>
				) : null}
				<View className="flex-row gap-2">
					<View className="flex-1">
						<Button
							label="Answer"
							onPress={() => settle("respond", { answers: respondBody() })}
							disabled={disabled || !complete}
							loading={busy === "respond"}
							testID={CONTROL.askRespond}
						/>
					</View>
					<View className="flex-1">
						<Button
							label="Decline"
							variant="danger"
							accessibilityHint="no answer — decide yourself"
							onPress={() => settle("decline")}
							disabled={disabled}
							loading={busy === "decline"}
							testID={CONTROL.askDecline}
						/>
					</View>
				</View>
				{/* Dismiss is a third, quieter action and deliberately not beside
				 *  Decline: declining ANSWERS the agent ("decide yourself"), while
				 *  dismissing answers nobody and buys no turn — and it is offered
				 *  only on a timed-out ask, which is what keeps it from shadowing
				 *  an in-window answer. */}
				{status === "timed_out" ? (
					<Button
						label="Dismiss"
						variant="quiet"
						onPress={() => settle("dismiss")}
						disabled={disabled}
						loading={busy === "dismiss"}
						testID={CONTROL.askDismiss}
					/>
				) : null}
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
						<Text className="text-body-sm text-ink">{pair.answer || "—"}</Text>
					</View>
				))
			) : (
				<Text className="text-body-sm text-ink-muted">
					no answer was recorded for this ask.
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
	seedRows = null,
	onReadFailed,
}: AsksSheetProps) => {
	const [rows, setRows] = useState<PendingAsk[]>([]);
	const [loaded, setLoaded] = useState(false);
	/** Whether the AGGREGATE has been read successfully at least once. Not
	 *  `loaded` (which a failed read also sets): the seed is replaced by the
	 *  aggregate only when there is an aggregate to replace it with, or a failed
	 *  opening read would empty the very form the reader is answering. */
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
	const [pendingAction, setPendingAction] = useState<PendingAction>(null);
	const [rowError, setRowError] = useState<{
		askId: string;
		message: string;
	} | null>(null);

	/* Whether the sheet was open on the previous render, and the frames' own
	 *  outstanding-population signature: together they tell the one load effect
	 *  below WHY it is running — a fresh opening vs a changed population — so the
	 *  opening collapses the walk and a population-driven re-read does not
	 *  (spec §2.3; agent review round 1, m2). */
	const wasVisible = useRef(false);
	/* How many rows the sheet is drawing RIGHT NOW, read when the opening read
	 *  settles rather than captured when it started: the seed is the live frame's
	 *  rows, so it can empty (answered elsewhere) while the read is in flight, and
	 *  a count closed over at the opening would still say "rows drawn" and leave an
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
		}
		void load().then((ok) => {
			/* Only the read that OPENED the sheet reports its failure (see
			 *  `onReadFailed`), with how many rows it is drawing: a seeded sheet is
			 *  already interactive, so the screen must not close it under the reader. */
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

	/* Until the first aggregate read has landed, a policy open draws the frame's own
	 *  rows (see `seedRows`); after it, only the aggregate (`drawnRows`: the first
	 *  SUCCESSFUL read, so a failed one keeps the rows the reader is answering).
	 *  `aggregateRead` is per mount of this component and a policy open is a view's
	 *  FIRST open, so it is `false` exactly when the seed is wanted. */
	const shownRows = useMemo(
		() => [...drawnRows(seedRows, rows, aggregateRead)],
		[seedRows, rows, aggregateRead],
	);
	drawnCount.current = shownRows.length;
	/* The head first, then the wire's own order — the order the bar names. */
	const listed = useMemo(() => orderedForDisplay(shownRows), [shownRows]);
	/* QUESTIONS, the unit the bar counts (E2 spec §1.3, the manager's ruling):
	 *  the header says how much the queue owes in the same unit the bar does. */
	const outstandingQuestions = outstandingAsks(shownRows).reduce(
		(total, row) =>
			total + (Array.isArray(row.questions) ? row.questions.length : 0),
		0,
	);
	/* The bar's own sentence, so the sheet that arrives by itself names what the
	 *  reader was about to meet in the bar's words ("1 question waiting"), not the
	 *  queue's internal noun (design D5). Bare `asks` stays for a queue with nothing
	 *  outstanding - answered rows can still be listed, and they are not waiting. */
	const title =
		outstandingQuestions > 0
			? questionsWaitingLabel(outstandingQuestions)
			: "asks";

	/** Settle one ask, then advance the walk and re-read. On success the
	 *  expansion moves to the next outstanding ask; on refusal the sentence
	 *  stays with the row it answers and the controls come back. */
	const settle = useCallback(
		async (
			kind: SettleKind,
			row: PendingAsk,
			body?: { answers: Record<string, string[]> },
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
					await client.command(sessionId, {
						op: "ask_dismiss",
						ask_id: row.ask_id,
					});
				}
				/* Advance the walk from the list as it stood: the re-read below
				 *  refreshes the truth, but the reader's next ask is already
				 *  visible here. */
				const next = orderedForDisplay(shownRows).find(
					(candidate) =>
						candidate.ask_id !== row.ask_id &&
						isAnswerable(String(candidate.status || "open")),
				);
				dispatchExpansion({ type: "pick", ask: next ? next.ask_id : null });
				await load();
			} catch (failure) {
				setRowError({ askId: row.ask_id, message: refusalText(failure) });
			} finally {
				setPendingAction(null);
			}
		},
		[client, currentSessionId, load, pendingAction, shownRows],
	);

	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title={title}
			testID={SURFACE.asksSheet}
			/* The queue is a list, so it takes the half detent; one ask fits its
			 *  content (the model-list precedent, components.md §8). */
			detent={listed.length > 1 ? "half" : "content"}
		>
			<View className="gap-1" testID={SURFACE.asksSheetBody}>
				{/* §1.4's honesty line, ALWAYS first (§5): the app cannot alert while
				 *  closed, and a queue surface that let a reader believe otherwise
				 *  would be the one lie this design exists to refuse. Dim ink on
				 *  purpose — it is context, not a warning. */}
				<Text className="text-meta text-ink-dim">
					This app shows queued questions while it is open. It cannot reach you
					while it is closed.
				</Text>
				{/* The bounded read naming its own bound: a prefix must never sit
				 *  beside a full count and read as complete. No numeral: the aggregate
				 *  route is uncapped, so any figure here would borrow the projection
				 *  frame's cap rather than state this route's (agent review round 1,
				 *  n1). */}
				{truncated ? (
					<Text className="text-meta text-ink-dim">
						Showing the newest questions — open a conversation to see the rest
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
				 *  Its copy is scoped to the list while rows are drawn (`readFailureNotice`). */}
				{error !== "" ? (
					<Text
						className="text-body-sm text-danger"
						testID={SURFACE.asksSheetError}
					>
						{readFailureNotice(error, shownRows.length)}
					</Text>
				) : null}
				{/* The loading line is not decoration: without it the sheet paints
				 *  its empty state while the read is still in flight, so "nothing
				 *  waiting" is shown about an answer that has not arrived yet. */}
				{!loaded && error === "" && shownRows.length === 0 ? (
					<Text
						className="text-body-sm text-ink-muted"
						testID={SURFACE.asksSheetLoading}
					>
						reading questions…
					</Text>
				) : null}
				{loaded && rows.length === 0 && error === "" ? (
					<Text
						className="text-body-sm text-ink-muted"
						testID={SURFACE.asksSheetEmpty}
					>
						No questions are queued. The agent keeps working without you.
					</Text>
				) : null}
				{listed.map((row) => {
					const status = String(row.status || "open");
					const sessionId = String(row.session_id || currentSessionId || "");
					const foreign = sessionId !== "" && sessionId !== currentSessionId;
					const stateLine = askStateLine(row, nowMs);
					const left = Number(row.expires_at) - nowMs;
					const urgent = row.urgent && isAnswerable(status);
					const expanded = openAsk === row.ask_id;
					const busy =
						pendingAction?.askId === row.ask_id ? pendingAction.kind : null;
					const error =
						rowError?.askId === row.ask_id ? rowError.message : null;
					return (
						<View key={row.ask_id} className="gap-1">
							{foreign ? (
								<Text className="min-w-0 truncate text-meta text-ink-muted">
									{names.get(sessionId) ?? sessionId}
								</Text>
							) : null}
							<Pressable
								accessibilityRole={ROLE.button}
								accessibilityLabel={stateLine.text}
								accessibilityState={state({ expanded })}
								onPress={() =>
									dispatchExpansion({ type: "toggle", ask: row.ask_id })
								}
								testID={askRowId(row.ask_id)}
								style={{ minHeight: TOUCH_FLOOR }}
								className="justify-center"
							>
								{/* NOT `flex-wrap`: the sentence is the flexible child and the
								 *  caret never wraps away from it (see the caret's note). */}
								<View className="flex-row items-baseline gap-x-2">
									<Text
										className={cx(
											"min-w-0 flex-1 text-meta",
											askToneInk(stateLine.tone),
										)}
									>
										{stateLine.text}
									</Text>
									{urgent ? (
										<Text className="shrink-0 text-meta text-ink-dim">
											· urgent
										</Text>
									) : null}
									{/* THE DISCLOSURE CARET LIVES ON THE FIRST LINE, trailing (design
									 *  D2 / rubric U-41: its centre within ±4 pt of the FIRST line's).
									 *  It used to sit on the meta line below, which for a row of THIS
									 *  conversation has nothing else on it - so it rendered as a stray
									 *  6x17 glyph 17 px under the sentence, alone on its own line,
									 *  and an auto-opened sheet shows exactly such rows first. */}
									<Text className="shrink-0 text-meta text-ink-dim" aria-hidden>
										{expanded ? "▾" : "▸"}
									</Text>
								</View>
								{/* The meta line exists only when it has something to carry; an
								 *  empty one would add a blank 'gap' row beneath the sentence. */}
								{(foreign && row.cwd) ||
								left <= 0 ||
								(foreign && onOpenConversation) ? (
									<View className="flex-row flex-wrap items-center gap-x-2">
										{foreign && row.cwd ? (
											<Text className="min-w-0 flex-1 truncate text-mono-sm text-ink-dim">
												{row.cwd}
											</Text>
										) : null}
										{left <= 0 ? (
											<Text className="font-mono text-meta text-ink-dim">
												deadline {durationLabel(-left)} ago
											</Text>
										) : null}
										{/* The route from a foreign ask to its own conversation, as the
										 *  META line's trailing control — below the sentence that says what
										 *  the ask is, in a real control's shape (design D3). As a bare
										 *  "open" word it collided with the status vocabulary, sat ABOVE
										 *  the sentence, and was transparent; an outlined icon button with
										 *  the accessible name "Open conversation" replaces all three. A
										 *  press resolves to the innermost control on both platforms
										 *  (react-native-web runs only the first PressResponder
										 *  ancestor's onPress), so this cannot also toggle the row's
										 *  expansion. The parent owns the transition (clear the sheet,
										 *  then navigate) so the sheet cannot outlive the row it opened. */}
										{foreign && onOpenConversation ? (
											<IconButton
												accessibilityLabel="Open conversation"
												outlined
												onPress={() =>
													onOpenConversation(
														sessionId,
														/* The destination's asks the reader is looking at
														 *  now: what a dismissal there is recorded against. */
														outstandingAsks(shownRows)
															.filter(
																(candidate) =>
																	String(candidate.session_id || "") ===
																	sessionId,
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
							</Pressable>
							{/* The audit's `timed-out-mixed` cell proves the state from
							 *  this zero-size anchor — an EXTRA id on the row, the
							 *  `transcript-streaming` shape, so the row's own id stays
							 *  stable as the ask changes hands with time. */}
							{status === "timed_out" ? (
								<View testID={timedOutAskRowId(row.ask_id)} aria-hidden />
							) : null}
							{expanded ? (
								<AskDetail
									row={row}
									nowMs={nowMs}
									busy={busy}
									error={error}
									onSettle={(kind, target, body) =>
										void settle(kind, target, body)
									}
								/>
							) : null}
						</View>
					);
				})}
			</View>
		</Sheet>
	);
};
