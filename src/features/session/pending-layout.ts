import type { ConnectionView } from "./connection-view";

/** Compact approval layouts suppress the tiny transcript sliver, but the list
 * also owns the full connection-notice/recovery footer. A retained pending ask
 * must never collapse that genuine notice or its auth action after admission
 * is withdrawn. Decide from the typed banner state, not an always-present JSX
 * element or an error string; healthy compact decisions keep their old layout. */
export const collapsePendingTranscript = (
	compact: boolean,
	hasPending: boolean,
	notice: ConnectionView["id"],
): boolean => compact && hasPending && notice === null;
