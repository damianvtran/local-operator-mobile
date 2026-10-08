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
 *  - **A RE-DRIVEN page is held to the same rule as the captured one.** The audit's
 *    re-drive dropped the capture's relay seed and measured the app's fallback screen
 *    under the cell's name; applying the readiness rule to the re-driven reading catches
 *    that by name instead of counting the wrong screen's rows. Both directions are
 *    asserted below, because a rule that only ever fires is as useless as one that never
 *    does.
 */
import { describe, expect, it } from "vitest";
import {
	type ReadinessFacts,
	readinessIssues,
	readinessProblems,
	reDriveMismatch,
	requiredStateMarker,
	stateStillComing,
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
					screen: "S15",
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
					screen: "S15",
					state: "populated",
					presentIds: ["sessions-screen", "session-row-6714def86197"],
					visibleIds: ["session-row-6714def86197"],
				}),
			),
		).toEqual([
			"no 'sessions-screen' root in the DOM: the app did not render screen S15",
		]);
	});

	it("still refuses a MARKER that is not in the DOM at all", () => {
		// The negative control for the split: presence is not a licence to pass on absence.
		const issues = readinessIssues(
			frame({
				screen: "S15",
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
					screen: "S15",
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

	it("does not read another surface's empty state as this cell's miss", () => {
		// The home composes with the docked conversations panel at tablet-landscape:
		// the panel's empty state beside the home is the OTHER surface's, and the home
		// is not in it. Reading every `*-empty` refused this cell for a panel that was
		// correctly empty (PR #34 review round 2, F1) — the prohibition now reads the
		// empty marker the cell's own surface declares, and the home declares none.
		expect(
			readinessProblems(
				frame({
					screen: "S4",
					state: "idle",
					root: "home-screen",
					presentIds: ["home-screen", "home-idle", "sessions-empty"],
					visibleIds: ["home-screen"],
				}),
			),
		).toEqual([]);
	});

	it("keeps the affirmative half's tooth when the own marker is missing", () => {
		// Scoping the prohibition must not cost the marker rule: a frame showing only
		// the docked panel's empty state and no `home-idle` is still refused — for the
		// missing marker, not for the other surface's empty marker.
		const issues = readinessIssues(
			frame({
				screen: "S4",
				state: "idle",
				root: "home-screen",
				presentIds: ["home-screen", "sessions-empty"],
				visibleIds: ["home-screen"],
			}),
		);
		expect(issues.map((issue) => issue.kind)).toEqual(["marker"]);
		expect(issues[0]?.message).toContain(
			"the marker 'home-idle' is not in the DOM",
		);
	});
});

describe("the marker is the app's, read rather than built", () => {
	/* The title says `${subject}-${state}` in words rather than in a template literal:
	 *  biome's `noTemplateCurlyInString` reads the literal as a missed interpolation,
	 *  and it is a rule this tree carries at ERROR level, so the old title failed the
	 *  pipeline's lint step for every branch cut from this base. Fixed here because it
	 *  blocks this PR's own gate; the rule is right and the title was the mistake. */
	it("asks for the id the app declares, not a subject-and-state pair", () => {
		// `past/populated` is `past-row-`, a family prefix; the derivation would be
		// `past-populated`, which no frame can carry. The old `sessions` subject is
		// the PANEL's `sidebar` now, and the home (`S4`) answers with its own ids.
		expect(requiredStateMarker("S10", "populated")).toBe("past-row-");
		expect(requiredStateMarker("S15", "empty")).toBe("sessions-empty");
		expect(requiredStateMarker("S2", "error")).toBe("connection-refusal");
		expect(requiredStateMarker("S4", "idle")).toBe("home-idle");
	});

	it("keeps a variant on the marker of the state it renders", () => {
		expect(requiredStateMarker("S15", "populated-long")).toBe("session-row-");
		expect(requiredStateMarker("S15", "narrow")).toBe("session-row-");
		// The panel's degraded-listing variant renders the same look as `degraded`.
		expect(requiredStateMarker("S15", "degraded-listing")).toBe(
			"sessions-degraded-banner",
		);
		expect(requiredStateMarker("path:/clean/clean", "clean")).toBeNull();
		// The S5 redesign's two (design pass `fix/hero-tables-strips`): the table's
		// scroll position and the table's arrival both render a look the app has
		// already named, so both cells borrow the marker rather than inventing a
		// second id for an interaction and a streaming frame.
		expect(requiredStateMarker("S5", "tables-end")).toBe("session-tables");
		expect(requiredStateMarker("S5", "streaming-tables")).toBe(
			"session-streaming",
		);
	});
});

/**
 * The WAIT is bounded by what it covers, and that bound is load-bearing in both tools.
 *
 * A state that arrives after the settle window must be waited for — the capture remakes
 * its settled frame and the audit re-reads before judging the re-drive. A wrong route, a
 * missing root or an unreadable page is a defect whenever it appears, and waiting on one
 * would spend the whole bound before reporting what it already knew.
 */
describe("the wait covers a state still arriving, and nothing else", () => {
	it("waits on the marker and the empty prohibition", () => {
		expect(stateStillComing([{ kind: "marker" }])).toBe(true);
		expect(stateStillComing([{ kind: "marker" }, { kind: "empty" }])).toBe(
			true,
		);
	});

	it("does not wait on a defect that waiting cannot fix", () => {
		expect(stateStillComing([{ kind: "route" }])).toBe(false);
		expect(stateStillComing([{ kind: "root" }])).toBe(false);
		expect(stateStillComing([{ kind: "reading" }])).toBe(false);
		expect(stateStillComing([])).toBe(false);
	});
});

/**
 * The re-drive invariant: a page re-driven by the AUDIT has to reach the state its
 * record names, or its rows are not measurements of that cell.
 *
 * The failure this pins is not hypothetical: `tools/audit/audit.ts` rebuilt each cell's
 * URL without the `lo-relay*` seed the capture had put on it, so a relay-backed cell was
 * re-driven against an unseeded app — which falls back to its own default screen — and
 * the checks that passed there were reported under the cell's name.
 */
describe("a re-driven page must reach the state its record names", () => {
	/** `S15/populated` as the capture renders it behind the panel: route
	 *  `/conversations`, root present, marker present. (The list's cells were `S4/*`
	 *  on `/` until the composer home landed; this fixture follows the capture the
	 *  same way the scenario registry's cells took their re-home.) */
	const recorded = {
		screen: "S15",
		state: "populated",
		askedPath: "/conversations",
		root: "sessions-screen",
	};

	it("passes the re-drive that reaches the state the record names", () => {
		expect(
			reDriveMismatch({
				...recorded,
				reading: {
					path: "/conversations",
					testIds: ["sessions-screen", "session-row-6714def86197"],
					visibleTestIds: ["sessions-screen"],
				},
			}),
		).toBeNull();
	});

	it("catches the unseeded re-drive by name, quoting the route and the missing marker", () => {
		// What an unseeded app renders: its own welcome screen, no sessions marker, no root.
		const mismatch = reDriveMismatch({
			...recorded,
			reading: {
				path: "/welcome",
				testIds: ["welcome-screen"],
				visibleTestIds: ["welcome-screen"],
			},
		});
		expect(mismatch).toContain(
			"the app is on '/welcome' but the cell asked for '/conversations'",
		);
		expect(mismatch).toContain("no 'sessions-screen' root in the DOM");
		expect(mismatch).toContain("the marker 'session-row-' is not in the DOM");
	});

	it("treats an unreadable page as its own failure, never as a pass", () => {
		expect(reDriveMismatch({ ...recorded, reading: null })).toContain(
			"returned no readiness reading",
		);
	});

	it("refuses a re-drive on the right route in the wrong state", () => {
		// The route alone is not enough: a populated cell showing the empty marker was never
		// populated, whatever screen it is on.
		expect(
			reDriveMismatch({
				...recorded,
				reading: {
					path: "/conversations",
					testIds: ["sessions-screen", "sessions-empty"],
					visibleTestIds: ["sessions-screen"],
				},
			}),
		).toContain("the app is showing an empty state (sessions-empty)");
	});

	it("judges an ad-hoc page on its route, which is all it claims", () => {
		// The canary's own fixtures (`path:/…`) declare no app state, so no marker applies —
		// but the route still has to be the one the record names.
		const adhoc = {
			screen: "path:/clean/clean",
			state: "clean",
			askedPath: "/clean",
			root: undefined,
		};
		expect(
			reDriveMismatch({
				...adhoc,
				reading: { path: "/clean", testIds: [], visibleTestIds: [] },
			}),
		).toBeNull();
		expect(
			reDriveMismatch({
				...adhoc,
				reading: { path: "/defects", testIds: [], visibleTestIds: [] },
			}),
		).toContain("the app is on '/defects' but the cell asked for '/clean'");
	});
});
