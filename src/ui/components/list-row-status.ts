import { SURFACE } from "@/ui/a11y";

/** The row's one status word, as an IDENTIFIER, never as copy. `ListRow` turns
 *  it into the reader's language at render (`mobile.sidebar.row_status.*`), so
 *  this projection stays a pure precedence rule a Node test can pin. The two
 *  multi-word states are snake_case on purpose: a value spelled like English
 *  prose ("not answering") is indistinguishable from copy, to a reviewer and to
 *  the string scanner, and it shipped rendered raw until O3-c keyed it. */
export type ListRowStatusWord =
	| "approval"
	| "question"
	| "not_reachable"
	| "ended"
	| "not_answering";

/** The catalogue key each status word paints. The precedence (and the testID a
 *  receipt carries) stays here as identifiers; the word becomes the reader's
 *  language only at render, in `ListRow` — and `rowAccessibilityLabel` reads the
 *  same keys, so the painted word and the spoken one cannot drift apart. */
export const ROW_STATUS_KEY = {
	approval: "mobile.sidebar.row_status.approval",
	question: "mobile.sidebar.row_status.question",
	not_reachable: "mobile.sidebar.row_status.not_reachable",
	ended: "mobile.sidebar.row_status.ended",
	not_answering: "mobile.sidebar.row_status.not_answering",
} as const satisfies Record<ListRowStatusWord, string>;

/** A receipt marker must describe the word the reader actually gets. Attention
 * outranks receipts, so attaching identifiers directly to ended/degraded flags
 * would claim a state that has no rendered evidence. Keep precedence and its
 * observable identifier in one projection for ListRow and the readiness gate. */
export const listRowStatus = ({
	pending,
	attentionWord,
	remoteUnreachable,
	ended,
	degraded,
}: {
	pending: boolean;
	attentionWord: "approval" | "question";
	remoteUnreachable: boolean;
	ended: boolean;
	degraded: boolean;
}): { word: ListRowStatusWord | null; testID: string | undefined } => {
	const word: ListRowStatusWord | null = pending
		? attentionWord
		: remoteUnreachable
			? "not_reachable"
			: ended
				? "ended"
				: degraded
					? "not_answering"
					: null;
	const testID =
		word === "ended"
			? SURFACE.sessionEnded
			: word === "not_answering"
				? SURFACE.sessionDegraded
				: word === "not_reachable"
					? SURFACE.sessionRemoteUnreachable
					: undefined;
	return { word, testID };
};
