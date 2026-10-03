/**
 * The readiness rule lives in `tools/lib/readiness.ts`, which `vitest` does not reach by
 * itself — its `include` is `src/**` and `scripts/**`, which is why this file tests the
 * tool from here.
 *
 * Two decisions are pinned, both of them a hole once already:
 *
 *  - **PRESENCE vs VISIBILITY.** A state MARKER counts by presence; a screen ROOT
 *    requires visibility. Conflating them made the audit unable to affirm the states the
 *    app declares, because the app's derived markers are zero-size `View`s by design
 *    (`src/features/session/state-markers.tsx`) while the ROOT is the screen itself. Both
 *    directions are asserted here, because a split checked only one way is how the two
 *    lists drifted into one in the first place.
 *  - **The marker is READ from the app's `STATE_MARKER`, never built.** A derived
 *    `${subject}-${state}` is a harness dialect beside the app's, and it fails a cell by
 *    name for an id the app never claimed to emit (PR #12's `session.empty` is
 *    `session-transcript-empty`, not `session-empty`).
 */
import { describe, expect, it } from "vitest";
import {
	type ReadinessFacts,
	readinessIssues,
	readinessProblems,
	requiredStateMarker,
} from "../tools/lib/readiness.ts";

/** A frame: `presentIds` are in the DOM, `visibleIds` are the ones actually rendered. */
const frame = (
	over: Partial<ReadinessFacts> & Pick<ReadinessFacts, "screen" | "state">,
): ReadinessFacts => ({
	askedPath: "/",
	actualPath: "/",
	root: "sessions-screen",
	presentIds: [],
	visibleIds: [],
	relayRegistryBacked: false,
	relayReached: false,
	...over,
});

describe("presence and visibility are two different questions", () => {
	it("counts a MARKER that is present but not rendered", () => {
		// The app's derived markers are zero-size Views: this frame IS the populated state.
		expect(
			readinessProblems(
				frame({
					screen: "S4",
					state: "populated",
					presentIds: ["sessions-screen", "session-row-6714def86197"],
					visibleIds: ["sessions-screen"],
				}),
			),
		).toEqual([]);
	});

	it("refuses a ROOT that is present but not rendered", () => {
		// The root is the screen: present-but-zero-size means nothing drew.
		expect(
			readinessProblems(
				frame({
					screen: "S4",
					state: "populated",
					presentIds: ["sessions-screen", "session-row-6714def86197"],
					visibleIds: ["session-row-6714def86197"],
				}),
			),
		).toEqual([
			"no 'sessions-screen' root in the DOM: the app did not render screen S4",
		]);
	});

	it("still refuses a MARKER that is not in the DOM at all", () => {
		// The negative control for the split: presence is not a licence to pass on absence.
		const issues = readinessIssues(
			frame({
				screen: "S4",
				state: "populated",
				presentIds: ["sessions-screen"],
				visibleIds: ["sessions-screen"],
			}),
		);
		expect(issues.map((issue) => issue.kind)).toEqual(["marker"]);
		expect(issues[0]?.message).toContain(
			"the marker 'session-row-' is not in the DOM",
		);
	});

	it("reads the `*-empty` prohibition on presence too", () => {
		// A hidden-but-present empty marker is still the app saying "empty".
		expect(
			readinessProblems(
				frame({
					screen: "S4",
					state: "populated",
					presentIds: [
						"sessions-screen",
						"session-row-6714def86197",
						"sessions-empty",
					],
					visibleIds: ["sessions-screen", "session-row-6714def86197"],
				}),
			),
		).toEqual([
			"the cell declares 'populated' but the app is showing an empty state (sessions-empty): " +
				"the state was never reached",
		]);
	});
});

describe("the marker is the app's, read rather than built", () => {
	it("asks for the id the app declares, not `${subject}-${state}`", () => {
		// `past/populated` is `past-row-`, a family prefix; the derivation would be
		// `past-populated`, which no frame can carry.
		expect(requiredStateMarker("S10", "populated")).toBe("past-row-");
		expect(requiredStateMarker("S4", "empty")).toBe("sessions-empty");
		expect(requiredStateMarker("S2", "error")).toBe("connection-refusal");
	});

	it("keeps a variant on the marker of the state it renders", () => {
		expect(requiredStateMarker("S4", "populated-long")).toBe("session-row-");
		expect(requiredStateMarker("S4", "narrow")).toBe("session-row-");
		expect(requiredStateMarker("path:/clean/clean", "clean")).toBeNull();
	});
});
