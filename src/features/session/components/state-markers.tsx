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
			{flags.error ? <View testID={STATE_MARKER.session.error} /> : null}
			{flags.streaming ? (
				<View testID={STATE_MARKER.session.streaming} />
			) : null}
			{flags.ended ? <View testID={STATE_MARKER.session.ended} /> : null}
			{flags.aborted ? <View testID={STATE_MARKER.session.aborted} /> : null}
			{flags.degraded ? <View testID={STATE_MARKER.session.degraded} /> : null}
			{flags.queued ? <View testID={STATE_MARKER.session.queued} /> : null}
			{flags.richRows ? (
				<View testID={STATE_MARKER.session["rich-rows"]} />
			) : null}
			{flags.tables ? <View testID={STATE_MARKER.session.tables} /> : null}
			{flags.delivery ? (
				<View testID={STATE_MARKER.session["send-delivery"]} />
			) : null}
			{flags.pendingApproval ? (
				<View testID={STATE_MARKER.session["pending-approval"]} />
			) : null}
			{flags.pendingAsk ? (
				<View testID={STATE_MARKER.session["pending-ask"]} />
			) : null}
			{flags.subagents ? (
				<View testID={STATE_MARKER.session.subagents} />
			) : null}
			{flags.populated ? (
				<View testID={STATE_MARKER.session.populated} />
			) : null}
			{/* The mic is AFFIRMATIVE evidence in its own right: the cell `S5/voice`
			 * declares the voice state, and this is what says the frame reached it.
			 * Rendered beside the session markers rather than in the composer because
			 * the composer is drawn by three other screens (S7/S8/S9) that have no
			 * cell for it, and a marker on all four would be one id claiming four
			 * frames. */}
			{flags.voice ? <View testID={STATE_MARKER.session.voice} /> : null}
			{flags.idle ? <View testID={STATE_MARKER.session.idle} /> : null}
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
			{flags.sending ? <View testID={STATE_MARKER.composer.sending} /> : null}
			{flags.ended ? <View testID={STATE_MARKER.composer.ended} /> : null}
			{flags.steering ? <View testID={STATE_MARKER.composer.steering} /> : null}
			{flags.idle ? <View testID={STATE_MARKER.composer.idle} /> : null}
		</View>
	);
};
