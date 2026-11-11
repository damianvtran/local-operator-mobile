// biome-ignore-all lint/suspicious/noArrayIndexKey: the settled record's question list is regenerated whole on every render — a parsed detail, not an editable collection — so position IS the identity, the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { TranscriptEntry } from "@/contracts";
import {
	answeredPairs,
	askStateLine,
	askToneInk,
} from "@/features/session/asks";
import {
	TRACE_BAR_PAD_CLASS,
	TRACE_COLUMN_GAP_CLASS,
	TRACE_EXPANDED_INDENT_CLASS,
	TRACE_GLYPH_BOX_CLASS,
	TRACE_GLYPH_ROW_CLASS,
	TRACE_GLYPH_SLOT_CLASS,
	TRACE_PRESSABLE_BESIDE_GLYPH_CLASS,
	TRACE_TEXT_RAIL_INSET_CLASS,
} from "@/features/session/components/trace-rail";
import { ROLE } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

import { AnsweredValues } from "./answered-values";

/**
 * The ask response card — a settled ask's record in the transcript
 * (`ask_response` for answered / late / declined, `ask_timeout` for the
 * deadline), design §4/§5.
 *
 * VISUAL FAMILY: the tool row (glyph, one line, a disclosure), NOT the pending
 * card's accent frame — a settled ask is a record, not a decision, and dressing
 * it in the decision surface's ink would make the reader hunt for a control
 * that is not there.
 *
 * ONE LINE AT REST = the §1.1 state line + the ask's head question. The state
 * still comes from the wire's own `details.status` (rendered verbatim through
 * the SAME copy table the sheet uses — never an inferred state), and for a
 * rendered response card `delivered` reads true by construction: this card IS
 * the receipt that the response rows reached the transcript, so "Answered —
 * delivering" is the state a MISSING row would announce, not this one.
 *
 * THE DISCLOSURE IS THE RECORD. `ask_response` expands to the question/answer
 * pairs — a secret answer shows the KEY the runtime stored, never a value,
 * because the wire never carries one. `ask_timeout` expands to the notice the
 * MODEL was given, labelled as such: "proceed without it" is an instruction to
 * the agent, not to the reader, and unlabelled it would read as advice to
 * themselves. The reader can still reach the answer form for a timed-out ask —
 * the minimized bar above the composer names the first answerable timeout and
 * opens the sheet's form (design §5.0's two-state model keeps the answer
 * surface in one place; this card says the trace, the bar says the state).
 */
export type AskResponseRowProps = {
	entry: TranscriptEntry;
	testID: string;
};

const GLYPH: Record<string, string> = {
	answered: "✓",
	late: "✓",
	declined: "✕",
	timed_out: "!",
};

export const AskResponseRow = ({ entry, testID }: AskResponseRowProps) => {
	const [open, setOpen] = useState(false);
	const timeout = entry.kind === "ask_timeout";
	const status = String(
		entry.details.status || (timeout ? "timed_out" : "answered"),
	);
	/* The state line's inputs, from the details the fold already carries. The
	 *  countdown fields are irrelevant here: none of this card's statuses is
	 *  `open`, and `askStateLine` only reads them on that arm. `delivered: true`
	 *  is by construction — this rendered card IS the receipt. */
	const line = askStateLine({ status, delivered: true }, 0);
	const questions = Array.isArray(entry.details.questions)
		? entry.details.questions
		: [];
	const headQuestion = String(questions[0]?.question ?? "").trim();
	const pairs = answeredPairs(questions, entry.details.answers);
	const told = timeout ? String(entry.details.text || "") : "";
	const hasDetails = pairs.length > 0 || told !== "";
	const tone = status === "declined" ? "text-ink-muted" : askToneInk(line.tone);

	return (
		<View className={cx("rounded-sm", TRACE_BAR_PAD_CLASS)} testID={testID}>
			{/* Glyph outside the pressable, baseline-aligned (`TRACE_GLYPH_ROW_CLASS`
			 *  in `trace-rail.ts`): a receipt wrapped onto its second line keeps
			 *  the button's 40 pt rail under U-41. */}
			<View className={TRACE_GLYPH_ROW_CLASS}>
				<View
					className={TRACE_GLYPH_SLOT_CLASS}
					pointerEvents="none"
					aria-hidden
				>
					<Text className={cx(TRACE_GLYPH_BOX_CLASS, tone)} aria-hidden>
						{GLYPH[status] ?? "•"}
					</Text>
				</View>
				<Pressable
					accessibilityRole={hasDetails ? ROLE.button : ROLE.text}
					accessibilityLabel={
						headQuestion.length > 0
							? `${line.text}, ${headQuestion}`
							: line.text
					}
					accessibilityState={hasDetails ? { expanded: open } : undefined}
					disabled={!hasDetails}
					onPress={() => hasDetails && setOpen((value) => !value)}
					style={{ minHeight: TOUCH_FLOOR }}
					className={cx(TRACE_PRESSABLE_BESIDE_GLYPH_CLASS, "justify-center")}
				>
					<View
						className={cx(
							"flex-row items-start py-2",
							TRACE_TEXT_RAIL_INSET_CLASS,
							TRACE_COLUMN_GAP_CLASS,
						)}
					>
						<Text
							className="min-w-0 flex-1 text-trace text-ink-muted"
							numberOfLines={2}
						>
							{headQuestion.length > 0
								? `${line.text} · ${headQuestion}`
								: line.text}
						</Text>
						{hasDetails ? (
							<Text className="text-trace" aria-hidden>
								<Text className="font-mono text-mono-sm text-ink-dim">
									{open ? "▾" : "▸"}
								</Text>
							</Text>
						) : null}
					</View>
				</Pressable>
			</View>
			{open && hasDetails ? (
				<View
					className={cx("flex-col gap-2 pb-1", TRACE_EXPANDED_INDENT_CLASS)}
				>
					{pairs.length > 0
						? pairs.map((pair, index) => (
								<View key={index}>
									<Text className="text-body-sm text-ink-muted">
										{pair.question}
									</Text>
									{/* One value per line with the `Other` boundary — the same frame the
									 *  asks sheet's settled row draws (`answered-values.tsx`). */}
									<AnsweredValues values={pair.values} />
								</View>
							))
						: null}
					{told !== "" ? (
						<View className="gap-1">
							<Text className="text-meta text-ink-dim">
								what the agent was told
							</Text>
							<Text className="whitespace-pre-wrap text-body-sm text-ink-muted">
								{told}
							</Text>
						</View>
					) : null}
				</View>
			) : null}
		</View>
	);
};
