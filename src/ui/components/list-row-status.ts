import { SURFACE } from "@/ui/a11y";

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
}) => {
	const word = pending
		? attentionWord
		: remoteUnreachable
			? "not reachable"
			: ended
				? "ended"
				: degraded
					? "not answering"
					: null;
	const testID =
		word === "ended"
			? SURFACE.sessionEnded
			: word === "not answering"
				? SURFACE.sessionDegraded
				: word === "not reachable"
					? SURFACE.sessionRemoteUnreachable
					: undefined;
	return { word, testID };
};
