import { View } from "react-native";

import type { ComposerControls } from "@/features/session/composer";
import {
	composerStateFlags,
	type SessionStateFacts,
	sessionStateFlags,
} from "@/features/session/state-marker";
import { STATE_MARKER } from "@/ui/a11y";

/**
 * The state markers, rendered where the fact is known.
 *
 * Each marker is written out as `testID={STATE_MARKER.<name>}` rather than built
 * from a string: the audit reads `data-testid`, and the identifier check
 * (`src/ui/a11y.e2e.test.ts`) requires a marker's name to appear in a file that
 * RENDERS. A derivation module that returned the names as data satisfied that
 * check by mentioning them, which is the same shape of hole as a `BLOCKED` marker
 * claiming an id nothing declared — so the mapping from "the fact is true" to "this
 * id is in the DOM" lives here, one line per state, and is visible in the DOM.
 *
 * `aria-hidden`: a claim for the audit, not a thing a reader should hear. The
 * wrappers and the markers are zero-size, so they add nothing to the column.
 */

export const SessionStateMarkers = ({
	facts,
}: {
	facts: SessionStateFacts;
}) => {
	const flags = sessionStateFlags(facts);
	return (
		<View aria-hidden>
			{flags.error ? <View testID={STATE_MARKER.sessionError} /> : null}
			{flags.streaming ? <View testID={STATE_MARKER.sessionStreaming} /> : null}
			{flags.ended ? <View testID={STATE_MARKER.sessionEnded} /> : null}
			{flags.aborted ? <View testID={STATE_MARKER.sessionAborted} /> : null}
			{flags.degraded ? <View testID={STATE_MARKER.sessionDegraded} /> : null}
			{flags.queued ? <View testID={STATE_MARKER.sessionQueued} /> : null}
			{flags.richRows ? <View testID={STATE_MARKER.sessionRichRows} /> : null}
			{flags.pendingApproval ? (
				<View testID={STATE_MARKER.sessionPendingApproval} />
			) : null}
			{flags.pendingAsk ? (
				<View testID={STATE_MARKER.sessionPendingAsk} />
			) : null}
			{flags.subagents ? <View testID={STATE_MARKER.sessionSubagents} /> : null}
			{flags.populated ? <View testID={STATE_MARKER.sessionPopulated} /> : null}
			{flags.idle ? <View testID={STATE_MARKER.sessionIdle} /> : null}
		</View>
	);
};

export const ComposerStateMarkers = ({
	controls,
}: {
	controls: ComposerControls;
}) => {
	const flags = composerStateFlags(controls);
	return (
		<View aria-hidden>
			{flags.sending ? <View testID={STATE_MARKER.composerSending} /> : null}
			{flags.ended ? <View testID={STATE_MARKER.composerEnded} /> : null}
			{flags.steering ? <View testID={STATE_MARKER.composerSteering} /> : null}
			{flags.idle ? <View testID={STATE_MARKER.composerIdle} /> : null}
		</View>
	);
};
