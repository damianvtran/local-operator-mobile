import { Text, View } from "react-native";

import type {
	ConnectionAction,
	ConnectionView,
} from "@/features/session/connection-view";
import { ROLE } from "@/ui/a11y";
import { Button } from "@/ui/components";
import { cx } from "@/ui/variants";

/**
 * The connection state's inline surface on the session screen
 * (`docs/design/components.md` § 18, `docs/ux/flows.md` § 9).
 *
 * **`view.id === null` renders NOTHING, and that is `C1`.** The gateway ends every
 * relayed stream at its 60-second lease, so an orderly close arrives once a
 * minute, forever; a line — even a quiet one — that appears on that boundary
 * teaches the reader to ignore the indicator that matters. The absence is the
 * feature, which is why it is an explicit early return with a comment rather than
 * a state that happens to render empty: an empty box is a reflow, and a reflow
 * twice a minute is motion the reader sees.
 *
 * **Every sentence here is the gateway's own.** `view.text` is rendered verbatim:
 * `RELAY_DETAIL`'s copy is written for a phone and has already been reviewed, and
 * a client that rewords it gives one refusal two voices. No status code is ever
 * appended — the refusal flow asserts a bare `503`/`502`/`401` appears nowhere on
 * screen.
 */
export type ConnectionBannerProps = {
	view: ConnectionView;
	/** Run the state's own remedy. The caller decides what each kind does. */
	onAction: (action: ConnectionAction) => void;
	/** Whether a remedy request is in flight, so its button can show a busy state. */
	actionBusy?: boolean;
};

/** The container per tone. Kept as a map rather than a switch so a new tone cannot
 *  be added with a half-specified pair. */
const TONE_CLASSES: Record<ConnectionView["tone"], string> = {
	info: "bg-info-wash border-info-border",
	warning: "bg-warning-wash border-warning-border",
	danger: "bg-danger-wash border-danger-border",
};

const TONE_INK: Record<ConnectionView["tone"], string> = {
	info: "text-info",
	warning: "text-warning",
	danger: "text-danger",
};

const GLYPH: Record<ConnectionView["tone"], string> = {
	info: "◌",
	warning: "!",
	danger: "!",
};

export const ConnectionBanner = ({
	view,
	onAction,
	actionBusy = false,
}: ConnectionBannerProps) => {
	// `C1` — see the file header. Nothing renders, and nothing reflows.
	if (view.id === null) return null;
	// Captured before the JSX so the handler closes over the narrowed value: a
	// cast inside `onPress` would be asserting the shape the compiler deliberately
	// stopped tracking once it left this scope.
	const action = view.action;

	return (
		<View
			className={cx("border-t px-4 py-2", TONE_CLASSES[view.tone])}
			testID="connection-banner"
			accessibilityRole={ROLE.alert}
			accessibilityLiveRegion="polite"
		>
			<View className="flex-row items-start gap-2">
				<Text className={cx("text-mono", TONE_INK[view.tone])} aria-hidden>
					{GLYPH[view.tone]}
				</Text>
				<Text className="flex-1 text-body-sm text-ink">{view.text}</Text>
			</View>
			{action !== null ? (
				<View className="pt-2">
					<Button
						label={action.label}
						onPress={() => onAction(action)}
						loading={actionBusy}
						variant="quiet"
						size="sm"
						testID={action.testID}
					/>
				</View>
			) : null}
			{/* The anchors the Maestro refusal flows address by name. They are
			    non-interactive, add no geometry, and are hidden from the
			    accessibility tree: an id a flow needs is not something a screen
			    reader should announce, and a zero-size marker is exactly that. */}
			{view.testIDs.map((id) => (
				<View key={id} testID={id} aria-hidden accessibilityElementsHidden />
			))}
		</View>
	);
};
