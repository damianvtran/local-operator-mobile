import { View } from "react-native";

import { STATE_MARKER } from "@/ui/a11y";

/**
 * The projects list's state markers (`src/features/projects/projects.tsx`).
 *
 * A marker is a claim the capture harness can check from the DOM: the screen root
 * says which screen drew, these say which STATE it drew. Each is a zero-size
 * `View` written as `testID={STATE_MARKER.projects.<name>}` rather than built
 * from a string, because the identifier check (`src/ui/a11y.e2e.test.ts`) reads
 * the contract's own name out of a rendering file.
 *
 * `populated` is deliberately NOT rendered here. Its value is the row-family
 * PREFIX (`project-row-`), and the rows themselves satisfy it — a literal
 * `testID="project-row-"` would be a second element claiming to be a row. The
 * same shape `STATE_MARKER.past.populated` has.
 *
 * `empty` and `refused` are two of the four; `loading` is NOT here because the
 * loading `Skeleton` carries the id directly (`SURFACE.projectsLoading`), the same
 * shape `app/(app)/session/[id].tsx` uses for `SURFACE.sessionLoading`.
 *
 * `refused` and `empty` are mutually exclusive by construction: a refusal means
 * nothing was read, and an empty state means something was read and it was empty
 * — a screen that showed both would be asserting two different truths about one
 * answer.
 */
export const ProjectsStateMarkers = ({
	empty,
	refused,
	unknownStatus,
}: {
	empty: boolean;
	refused: boolean;
	unknownStatus: boolean;
}) => (
	<View aria-hidden>
		{empty ? <View testID={STATE_MARKER.projects.empty} /> : null}
		{refused ? <View testID={STATE_MARKER.projects.refused} /> : null}
		{unknownStatus ? (
			<View testID={STATE_MARKER.projects["unknown-status"]} />
		) : null}
	</View>
);

/** The pushed detail's markers, the same shape one route over. `loading` is the
 *  skeleton's own id, and `populated` is the linked-sessions region
 *  (`SURFACE.projectLinks`), which is the fact "the pushed view drew its
 *  content". */
export const ProjectDetailStateMarkers = ({
	refused,
}: {
	refused: boolean;
}) => (
	<View aria-hidden>
		{refused ? <View testID={STATE_MARKER["project-detail"].refused} /> : null}
	</View>
);
