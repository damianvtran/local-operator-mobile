import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import type { PendingView } from "@/features/session/pending";
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
};

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
}: PendingCardProps) => {
	/** The typed answer. Seeded empty and NOT carried across a question: the screen
	 *  remounts this component per question, which is what makes that true. */
	const [text, setText] = useState("");
	/** The option the reader has chosen, as an index into the options AS CARRIED. */
	const [chosen, setChosen] = useState<number | null>(null);
	const [remember, setRemember] = useState(false);

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

	// The key lives at the RENDER SITE and is built from the two numbers, so a
	// re-render for the next question remounts the form: without it a stale `busy`
	// flag leaves the next question's options disabled and untappable, and a stale
	// draft carries a typed answer into a question it was not written for.
	return (
		<View
			key={`${view.requestId}:${view.questionTestID ?? "single"}`}
			className={FRAME}
			testID={rootTestID}
		>
			{/* Region 1 — meta, pinned above the scroller. */}
			<View className="shrink-0 flex-row items-center gap-2 pb-1">
				<Text className="text-meta text-accent">{view.meta}</Text>
				<View className="flex-1" />
				{view.badge !== null ? (
					// The badge is the count of decisions, not the count of questions:
					// a reader who does not know more are waiting will answer one and
					// wonder why the session is still blocked.
					<Text className="text-meta text-ink-dim">{view.badge}</Text>
				) : null}
			</View>

			{/* Region 2 — the content, scrollable and bounded. */}
			<ScrollView className="max-h-64" testID={SURFACE.pendingCardBody}>
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
				{view.title.length > 0 ? (
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
				{/* The destination, named rather than implied. */}
				{view.runsOnComputer ? (
					<Text
						className={cx(
							"pt-1 text-meta",
							view.destructive ? "text-danger" : "text-ink-dim",
						)}
						testID={SURFACE.pendingCardDestructiveMarker}
					>
						{view.riskLabel}
					</Text>
				) : null}

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
						{/* A 44-high row with a 16 checkbox. The label NAMES THE SCOPE
						    (`R12`): "remember this choice" never said which choice. */}
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
										remember
											? "border-accent bg-accent"
											: "border-control bg-surface",
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
