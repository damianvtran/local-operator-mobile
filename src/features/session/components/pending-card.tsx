import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import {
	type PendingView,
	pendingBodyCue,
	pendingCueLabel,
	pendingScrollFacts,
	riskDestinationPreview,
} from "@/features/session/pending";
import { CONTROL, ROLE, SURFACE, state } from "@/ui/a11y";
import { Button } from "@/ui/components";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

/**
 * The pending card: an approval or a question, pinned above the composer
 * (`docs/design/components.md` § 13).
 *
 * **The three regions are a contract, not a layout.** The meta row is pinned above
 * the scroller, the content scrolls, and the controls are pinned below it. That
 * split exists because the alternative was measured: putting the whole card in one
 * scroller capped the card properly and then let the *decision* scroll out of
 * reach — an approval with a long detail arrived with `approve` showing 30 of its
 * 44 px at 390×844 and **0 of 44 px — invisible — at 360×780**, while the stale-tap
 * error landed ~26 px below the fold, so a refused tap greyed every option out and
 * explained nothing. Content may scroll; the control that answers the card may not.
 *
 * **A terminal session gets no controls.** `view.terminalOnly` renders the wait and
 * says so, because an approval raised in the reader's own terminal is answered at
 * that terminal: the phone shows the wait and offers nothing that cannot work
 * (`docs/ux/current-relay-audit.md` R10).
 *
 * **The multi-question ask is re-keyed at the RENDER SITE**, on
 * `request_id` + `question_index` — a component cannot key itself. Without the key
 * a stale `busy` flag leaves the next question's options disabled and untappable,
 * and a stale draft carries a typed answer forward into a question it was not
 * written for.
 */
export type PendingCardProps = {
	view: PendingView;
	/** An answer is in flight: every control is disabled and the primary is busy. */
	busy?: boolean;
	/** The refusal to show in the pinned controls region, if the last answer failed. */
	error?: string | null;
	onApprove?: (remember: boolean) => void;
	onDeny?: (remember: boolean) => void;
	/** An ask's answer: the chosen option's label, or the typed value. */
	onAnswer?: (value: string) => void;
	/** Short landscape: the content region's max height in pt, derived from the window
	 *  by the screen. The card's content already scrolls inside a bounded region with
	 *  its controls pinned below; the fixed `max-h-64` (256 pt) is wider than a 390 pt
	 *  screen can spare once the composer is under it, which put Send and the chips 80 pt
	 *  below the fold with a pending approval (UX U2). */
	bodyMaxHeight?: number;
	/** Actual space remaining above the composer; measured by the parent wrapper. */
	maxHeight?: number;
};

/** The least a compact body may shrink to, in pt: about two lines of body text at 100 %.
 *  The pinned header, cue and actions are sized first; the body takes what is left, down to this. */
export const PENDING_BODY_MIN_PT = 56;

/** The frame: `accent-wash` on `accent-border` at `radius.md`, the one card the
 *  kit paints in accent because it is the only thing that needs a decision. */
const FRAME = "rounded-md border border-accent-border bg-accent-wash p-2.5";

export const PendingCard = ({
	view,
	busy = false,
	error = null,
	onApprove,
	onDeny,
	onAnswer,
	bodyMaxHeight,
	maxHeight,
}: PendingCardProps) => {
	/** The typed answer. Seeded empty and NOT carried across a question: the screen
	 *  remounts this component per question, which is what makes that true. */
	const [text, setText] = useState("");
	/** The option the reader has chosen, as an index into the options AS CARRIED. */
	const [chosen, setChosen] = useState<number | null>(null);
	const [remember, setRemember] = useState(false);
	/* The compact body's own scroll state, measured, so the cue below it shows only while
	 *  something is actually hidden and clears at the end (UX U11). The strict end test is
	 *  safe HERE because the cue sits OUTSIDE the scroller's own box, so showing it cannot
	 *  change how far the body can scroll. */
	const [bodyScroll, setBodyScroll] = useState({ y: 0, view: 0, content: 0 });

	const isApproval = view.kind === "approval";
	/* The card's own root, which is TWO ids: an approval gate and a question are the
	 *  same component in two states, and a flow that waits for the card has to be able
	 *  to say which. Declared rather than spelled at the render site, because a literal
	 *  bound to a local is the second spelling this contract exists to prevent (review
	 *  round 6: the guard could not see it, and each id sat outside the contract). */
	const rootTestID = isApproval ? SURFACE.pendingCard : SURFACE.askCard;

	/* The answer an ask would submit: a chosen option's label, else the typed text. */
	const answerValue =
		chosen !== null ? (view.options[chosen]?.label ?? "") : text.trim();
	const answerDisabled = busy || answerValue.length === 0;

	/* The "remember this choice" row, a 44 pt target. In the full form it is pinned under
	 *  Approve/Deny. In short landscape (`bodyMaxHeight` set) it rides at the END of the
	 *  scrolling body instead: pinned it cost a 48 pt strip the 390 pt screen cannot spare, which
	 *  left the composer's chips below the fold with an approval pending (UX U2). Approve and
	 *  Deny stay pinned; only this secondary option scrolls. */
	const compactBody = bodyMaxHeight !== undefined;
	/* A 44-high row with a 16 checkbox. The label NAMES THE SCOPE (`R12`): "remember
	 *  this choice" never said which choice. */
	const rememberRow = (
		<Pressable
			accessibilityRole={ROLE.checkbox}
			accessibilityLabel={view.rememberLabel}
			accessibilityState={{ checked: remember, disabled: busy }}
			disabled={busy}
			onPress={() => setRemember((current) => !current)}
			testID={CONTROL.pendingRemember}
		>
			<View className="min-h-11 flex-row items-center gap-2">
				<View
					className={cx(
						"h-4 w-4 items-center justify-center rounded-sm border",
						remember ? "border-accent bg-accent" : "border-control bg-surface",
					)}
				>
					{remember ? (
						<Text className="text-meta text-on-accent" aria-hidden>
							✓
						</Text>
					) : null}
				</View>
				<Text className="min-w-0 flex-1 text-body-sm text-ink-muted">
					{view.rememberLabel}
				</Text>
			</View>
		</Pressable>
	);

	/* The destination, named rather than implied. In the full form it is the last line of
	 *  the body. In the compact form it moves to the PINNED title row: with the body cut to
	 *  72 pt the line was 0 % visible at 200 % on a force-push approval, so the one piece of
	 *  text that says "Destructive" could be scrolled out of sight under a pinned, enabled
	 *  Approve (UX U11). The full destination remains in the body. The PINNED preview is one middle-ellipsised
	 * line: two lines plus a 56 pt command and 48 pt actions cannot fit the 205 pt left
	 * above the composer at 844×390 @200 %. A longer preview used to push Approve under
	 * Message (D20). This does not alter the command, risk classification or approval. */
	const markerNode = view.runsOnComputer ? (
		compactBody ? (
			<View
				className="flex-row items-center"
				accessible
				accessibilityLabel={view.riskLabel}
				testID={SURFACE.pendingCardDestructiveMarker}
			>
				{/* The classification is NEVER ellipsised (D20). Only the variable destination yields. */}
				<Text
					className={cx(
						"shrink-0 text-meta",
						view.destructive ? "text-danger" : "text-ink-dim",
					)}
				>
					{view.destructive ? "Destructive — runs on " : "Runs on "}
				</Text>
				<Text
					className={cx(
						"min-w-0 flex-1 text-meta",
						view.destructive ? "text-danger" : "text-ink-dim",
					)}
					numberOfLines={1}
					ellipsizeMode="middle"
				>
					{riskDestinationPreview(view.riskDestination)}
				</Text>
			</View>
		) : (
			<Text
				className={cx(
					"pt-1 text-meta",
					view.destructive ? "text-danger" : "text-ink-dim",
				)}
				testID={SURFACE.pendingCardDestructiveMarker}
			>
				{view.riskLabel}
			</Text>
		)
	) : null;

	const { scrolls: bodyScrolls, atEnd: bodyAtEnd } = pendingScrollFacts(
		bodyScroll.y,
		bodyScroll.view,
		bodyScroll.content,
	);
	const bodyCue = compactBody
		? pendingBodyCue(view, bodyScrolls, bodyAtEnd)
		: null;

	// The key lives at the RENDER SITE and is built from the two numbers, so a
	// re-render for the next question remounts the form: without it a stale `busy`
	// flag leaves the next question's options disabled and untappable, and a stale
	// draft carries a typed answer into a question it was not written for.
	return (
		<View
			key={`${view.requestId}:${view.questionTestID ?? "single"}`}
			className={FRAME}
			// Compact: the card may shrink so the composer below it keeps its chips on screen.
			// RN's default `flexShrink` is 0, so without this the card kept its natural height
			// and pushed the composer off a 390 pt window (measured: chips 439 of 390).
			style={
				compactBody ? { flexShrink: 1, minHeight: 0, maxHeight } : undefined
			}
			testID={rootTestID}
		>
			{/* Region 1 — meta, pinned above the scroller. In the compact form this is the
			    ONE pinned header for everything the bounded body might hide: line one is the
			    meta, the body's cue and the badge; line two is the destructive marker. Putting
			    the cue on this line costs no extra row (a separate cue line pushed the chips 49 pt
			    off a 390 pt screen), and the marker can never be scrolled out of sight (UX U11). */}
			<View className="shrink-0 pb-1">
				<View className="flex-row items-center gap-2">
					<Text
						className="min-w-0 shrink text-meta text-accent"
						numberOfLines={compactBody ? 1 : undefined}
					>
						{view.meta}
					</Text>
					<View className="flex-1" />
					{bodyCue !== null ? (
						<Text
							className="shrink-0 text-meta text-ink-dim"
							accessibilityLabel={pendingCueLabel(bodyCue)}
							testID={SURFACE.pendingCardMore}
						>
							{bodyCue}
						</Text>
					) : null}
					{view.badge !== null ? (
						// The badge is the count of decisions, not the count of questions:
						// a reader who does not know more are waiting will answer one and
						// wonder why the session is still blocked.
						<Text className="text-meta text-ink-dim">{view.badge}</Text>
					) : null}
				</View>
				{compactBody ? markerNode : null}
			</View>

			{/* Region 2 — the content, scrollable and bounded. */}
			<ScrollView
				className={bodyMaxHeight === undefined ? "max-h-64" : undefined}
				style={
					bodyMaxHeight === undefined
						? undefined
						: {
								maxHeight: bodyMaxHeight,
								// The body gives way to the pinned header, cue and actions, but never
								// below two lines of body text: a command you cannot read is not
								// something to approve.
								flexShrink: 1,
								minHeight: PENDING_BODY_MIN_PT,
							}
				}
				testID={SURFACE.pendingCardBody}
				scrollEventThrottle={64}
				onScroll={(event) => {
					const { contentOffset, contentSize, layoutMeasurement } =
						event.nativeEvent;
					setBodyScroll((prev) => {
						const next = {
							y: contentOffset.y,
							view: layoutMeasurement.height,
							content: contentSize.height,
						};
						return prev.y === next.y &&
							prev.view === next.view &&
							prev.content === next.content
							? prev
							: next;
					});
				}}
				onContentSizeChange={(_width, height) =>
					setBodyScroll((prev) => ({ ...prev, content: height }))
				}
				onLayout={(event) =>
					setBodyScroll((prev) => ({
						...prev,
						view: event.nativeEvent.layout.height,
					}))
				}
			>
				{view.boundarySentence !== null ? (
					/* The honest boundary. One sentence, no control: either the approval
					   belongs to the reader's terminal, or the session is over. The
					   sentence is the projection's, so the two cases cannot drift into
					   saying the same thing. */
					<Text className="pb-1 text-body-sm text-ink-muted">
						{view.boundarySentence}
					</Text>
				) : null}
				{view.questionLabel !== null ? (
					<Text
						className="pb-1 text-meta text-ink-dim"
						testID={view.questionTestID ?? undefined}
					>
						{view.questionLabel}
					</Text>
				) : null}
				{view.title.length > 0 &&
				!(
					compactBody &&
					isApproval &&
					view.meta.endsWith(` · ${view.title}`)
				) ? (
					<Text className="text-body font-medium text-ink">{view.title}</Text>
				) : null}
				{/* The detail is presented VERBATIM and `pre-wrap`: a command keeps its
				    own line breaks, and rewrapping it would show the reader a different
				    command from the one they are approving. */}
				{view.detail.length > 0 ? (
					<Text
						className="whitespace-pre-wrap text-body-sm text-ink-muted"
						testID={SURFACE.pendingCardDetail}
					>
						{view.detail}
					</Text>
				) : null}
				{compactBody && view.runsOnComputer ? (
					<Text
						className="pt-1 text-meta text-ink-dim"
						testID={SURFACE.pendingCardDestination}
					>
						{view.riskLabel}
					</Text>
				) : null}
				{compactBody ? null : markerNode}

				{/* Ask options: each a tap target with its own consequence line. */}
				{view.options.length > 0 ? (
					<View className="gap-1 pt-1.5">
						{view.options.map((option) => (
							<Pressable
								key={option.index}
								accessibilityRole={ROLE.radio}
								accessibilityLabel={option.label}
								accessibilityState={state({
									selected: chosen === option.index,
									disabled: busy,
								})}
								disabled={busy}
								onPress={() => setChosen(option.index)}
								testID={option.testID}
							>
								<View
									className={cx(
										"rounded-sm border px-2 py-1.5",
										chosen === option.index
											? "border-accent-border bg-accent-muted"
											: "border-control bg-surface",
									)}
								>
									<Text className="text-body-sm text-ink">
										{option.label}
										{option.recommended ? (
											<Text className="text-meta text-ink-dim">
												{" "}
												· recommended
											</Text>
										) : null}
									</Text>
									{option.description.length > 0 ? (
										<Text className="text-meta text-ink-dim">
											{option.description}
										</Text>
									) : null}
								</View>
							</Pressable>
						))}
					</View>
				) : null}

				{/* A free-text answer. Masked when the ask is a secret, and the
				    masking is stated rather than silent so the reader knows the value
				    is not going into the transcript. */}
				{!isApproval && view.freeText ? (
					<View className="pt-1.5">
						<TextInput
							className="min-h-11 rounded-sm border border-control bg-elevated px-3 text-body text-ink"
							value={text}
							onChangeText={setText}
							placeholder={view.secret ? "Secret value" : "Your answer"}
							placeholderTextColor={undefined}
							secureTextEntry={view.secret}
							// The field is 16 pt or the OS zooms the whole page on focus,
							// which moves every control the reader was about to press.
							style={{ fontSize: 16 }}
							editable={!busy}
							multiline={false}
							testID={SURFACE.pendingCardAnswer}
							accessibilityLabel={view.title || "Your answer"}
						/>
						{view.secret ? (
							<Text className="pt-1 text-meta text-ink-dim">
								secret — sent directly, not shown in the transcript
							</Text>
						) : null}
					</View>
				) : null}
				{compactBody && isApproval ? rememberRow : null}
			</ScrollView>

			{/* Region 3 — the controls, pinned BELOW the scroller so they can never
			    scroll away from the decision they answer. */}
			<View className="shrink-0 pt-2">
				{view.terminalOnly ? null : isApproval ? (
					<>
						<View className="flex-row gap-2">
							<View className="flex-1">
								<Button
									label="Approve"
									onPress={() => onApprove?.(remember)}
									disabled={busy}
									loading={busy}
									testID={CONTROL.pendingApprove}
								/>
							</View>
							<View className="flex-1">
								<Button
									label="Deny"
									variant="danger"
									onPress={() => onDeny?.(remember)}
									disabled={busy}
									testID={CONTROL.pendingDeny}
								/>
							</View>
						</View>
						{compactBody ? null : rememberRow}
					</>
				) : (
					<Button
						label="Submit"
						onPress={() => onAnswer?.(answerValue)}
						disabled={answerDisabled}
						loading={busy}
						testID={CONTROL.pendingAskSubmit}
					/>
				)}
				{/* The refusal lands in the pinned region for the same reason the
				    controls do: a stale-tap error below the fold explained nothing. */}
				{error !== null ? (
					<Text
						className="pt-1.5 text-body-sm text-danger"
						testID={SURFACE.pendingCardError}
					>
						{error}
					</Text>
				) : null}
			</View>
		</View>
	);
};

/** The card's own minimum height, exported for the screen's column budget: the
 *  card is pinned above the composer, and the column has to know how much of the
 *  transcript it takes before it lays the transcript out. */
export const PENDING_CARD_MIN_PT = TOUCH_FLOOR * 2 + 24;
