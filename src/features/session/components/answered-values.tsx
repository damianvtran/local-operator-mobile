// biome-ignore-all lint/suspicious/noArrayIndexKey: the settled frame's value list is a parsed record regenerated whole on every render — position IS the identity, the case React's own key docs exempt; a content-derived key collides when a question holds the same value twice.
import { Text } from "react-native";

import type { AnsweredValue } from "@/features/session/asks";

/**
 * A settled ask's value lines, shared by the two surfaces that show a settled
 * ask — the transcript's response card (`ask-response-row.tsx`) and the asks
 * sheet's settled row — so the `Other` boundary introduced for the settled
 * record (UX U1) cannot exist on one and not the other.
 *
 * ONE VALUE PER LINE, the desktop's answer frame (`ask-panel.tsx`, UI #892):
 * the comma-joined single line this replaces is exactly where a typed answer
 * read as part of the previous option's description ("the option's description
 * contains a comma and answers are comma-joined" — the finding this answers).
 * A value the question's option list did not offer carries the desktop's
 * muted `Other` word as a boundary marker.
 *
 * An empty list is the "no answer given" case and renders the sheet's `—`;
 * callers pass every question, answered or not, so the frame keeps its shape.
 */
export const AnsweredValues = ({
	values,
}: {
	values: readonly AnsweredValue[];
}) =>
	values.length > 0 ? (
		values.map((value, index) => (
			<Text key={index} className="text-body-sm text-ink">
				{value.text}
				{value.other ? (
					<Text className="text-meta text-ink-muted">{" · "}Other</Text>
				) : null}
			</Text>
		))
	) : (
		<Text className="text-body-sm text-ink">—</Text>
	);
