import { View } from "react-native";

import { draftExistsFor } from "@/features/home/home-copy";
import { STATE_MARKER } from "@/ui/a11y";

/**
 * The home's state markers, rendered where the fact is known.
 *
 * Each marker is written as `testID={STATE_MARKER.home.<name>}` rather than built
 * from a string: the audit reads `data-testid`, and the identifier check
 * (`src/ui/a11y.e2e.test.ts`) requires a marker's name to appear in a file that
 * RENDERS. `aria-hidden` on the wrapper: a claim for the audit, not a thing a
 * reader should hear; the markers are zero-size `View`s, so they add nothing to
 * the column.
 *
 * **`draft` and `idle` SWAP.** They differ only by the composer's content, so
 * one id present in both states would make the affirmative check vacuous — a
 * frame showing `home-idle` would "pass" for a draft. Everything else is
 * additive: `offline` is present only while the device is known offline.
 *
 * "A draft exists" is `draftExistsFor` — the same predicate the splash's tip
 * and suggestion slot read, so the marker cannot declare `idle` for a frame the
 * splash is treating as a draft (review n2).
 */
export const HomeStateMarkers = ({
	draft,
	offline,
}: {
	draft: string;
	offline: boolean;
}) => (
	<View aria-hidden>
		{draftExistsFor(draft) ? (
			<View testID={STATE_MARKER.home.draft} />
		) : (
			<View testID={STATE_MARKER.home.idle} />
		)}
		{offline ? <View testID={STATE_MARKER.home.offline} /> : null}
	</View>
);
