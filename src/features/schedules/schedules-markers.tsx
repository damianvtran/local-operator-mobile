import { View } from "react-native";

import { STATE_MARKER } from "@/ui/a11y";

/**
 * The Schedules screen's state markers (`src/features/schedules/schedules.tsx`).
 *
 * A marker is a claim the capture harness can check from the DOM: the screen
 * root says which screen drew, these say which STATE it drew. Each is a
 * zero-size `View` written as `testID={STATE_MARKER.schedules.<name>}` rather
 * than built from a string, because the identifier check
 * (`src/ui/a11y.e2e.test.ts`) reads the contract's own name out of a rendering
 * file.
 *
 * ONLY `empty` lives here. The other four states are carried by the elements
 * that ARE the state, which is stricter than a sibling marker: the loading
 * `Skeleton` carries `SURFACE.schedulesLoading`, the truncation strip carries
 * `SURFACE.schedulesWakesTruncated`, the unreadable strip carries
 * `SURFACE.schedulesWakesUnreadable`, and the row family (`schedule-wake-row-`)
 * is the populated state — a literal `testID="schedule-wake-row-"` would be a
 * second element claiming to be a row.
 *
 * `empty` and the two unreadable strips are mutually exclusive BY
 * CONSTRUCTION, and that is the point of the surface: the empty state renders
 * only when both families read OK and hold nothing (`schedulesEmpty`), so an
 * unreadable store can never satisfy it — a screen that showed both would be
 * asserting two different truths about one answer.
 */
export const SchedulesStateMarkers = ({ empty }: { empty: boolean }) => (
	<View aria-hidden>
		{empty ? <View testID={STATE_MARKER.schedules.empty} /> : null}
	</View>
);
