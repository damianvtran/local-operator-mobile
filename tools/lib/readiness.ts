/**
 * Is a captured cell actually in the state it declares?
 *
 * This is the check that decides whether a frame is EVIDENCE, so its failure modes
 * are the expensive ones. Round 1 shipped it as a single prohibition — "a populated
 * cell must not show `*-empty`" — and a review round then executed the hole: a page
 * with the screen root, one request to the relay and NO marker of any kind was
 * accepted for `S4/populated` and `S4/streaming`, exit 0. A rule that can only say
 * what a page is not is satisfied by a page that is nothing in particular.
 *
 * So the rule is AFFIRMATIVE, and the marker it asks for comes from the APP:
 *
 *     a cell declaring `<screen>/<state>` must carry the id the app declares for
 *     `<subject>/<state>` in `src/ui/a11y.ts` `STATE_MARKER`
 *
 * where `<subject>` is the app's own testid subject for that screen (`sessions`,
 * `past`, `computers`, …). The table is IMPORTED, not re-derived: asking for
 * `<subject>-<state>` built here was a harness dialect beside the app's, and it read
 * every relay-backed cell as NOT MEASURABLE while the app rendered the states
 * perfectly well. The state name is normalised first (`STATE_MARKER_ALIASES`), because
 * several declared states are renderings of one state: `populated-long`, `narrow` and
 * `scroll` are all the populated screen, and `approval` is the pending-approval card.
 *
 * A state the app declares NO marker for is not a pass and not a silent `undefined`:
 * it fails BY NAME, quoting the subject and state the contract has no entry for, so
 * the gap reads as "not measurable yet" everywhere it is reported — the manifest, the
 * stdout line and the audit's BLOCKED rows all quote the same sentence (`markerGapProblem`).
 * A caller that knows the gap is a DECLARED SKIP (a cell whose state is a named,
 * owned dependency) drops exactly that sentence and records the skip instead; a marker
 * the app DECLARES but the frame does not show is never droppable, which is what keeps
 * a marker that stopped rendering from hiding behind an expected gap.
 *
 * Ad-hoc pages (`--cells path:/…`, which is how the canary drives its own fixtures)
 * carry no subject: such a page makes no claim about an app state, so the marker rule
 * does not apply to it and the `*-empty` prohibition still does.
 */

import { markerMatches, stateMarkerFor } from "../../src/ui/a11y.ts";

/**
 * The surface subject a harness SCREEN names, e.g. `S4` → `sessions`.
 *
 * This is the harness's own vocabulary — the app never learns `S4` — and it is the
 * ONLY thing left here: the marker NAMES come from the app's contract
 * (`src/ui/a11y.ts` `STATE_MARKER`, imported below), never from a table re-derived
 * here. Kept in step with the app's screens by the cross-checks in `verify.ts`,
 * which fail when a subject is not one the app declares ids for.
 */
export const SCREEN_MARKER_SUBJECT: Record<string, string> = {
	S1: "sign-in",
	"S1-welcome": "welcome",
	// `S2`, `S3` and `S13` are one screen in three states: `/tunnels` renders
	// `computers-screen` whether it is listing, setting up or refusing.
	S2: "computers",
	S3: "computers",
	"S3-custom": "own-tunnel",
	S4: "sessions",
	S5: "session",
	S6: "subagent",
	S7: "new-session",
	S8: "session",
	S9: "session",
	S10: "past",
	S11: "settings",
	S13: "computers",
	S14: "welcome",
};

/**
 * Declared states that are a rendering of another state, mapped to the state whose
 * marker affirms them. Keep this table short: an entry here is a statement that the
 * app has no distinct look for the variant, which is usually true of a width or a
 * scroll position and never true of a different card.
 */
export const STATE_MARKER_ALIASES: Record<string, string> = {
	"populated-long": "populated",
	narrow: "populated",
	scroll: "populated",
	approval: "pending-approval",
	ask: "pending-ask",
	"ask-multi": "pending-ask",
};

/** Every empty-state marker ends with this, which is what the prohibition matches. */
export const EMPTY_MARKER_SUFFIX = "-empty";

/**
 * The marker a cell must carry to count as being in its declared state.
 *
 * `null` means the cell makes NO state claim: an ad-hoc `path:` page (which is how
 * the audit's own canary drives a fixture) claims nothing about the app, so the
 * affirmative rule does not apply to it. A real screen whose subject the app
 * declares no marker for is a DECLARED GAP and is never `null`-quiet — read
 * `markerGapReason` for the sentence the report quotes.
 */
export function requiredStateMarker(
	screen: string,
	state: string,
): string | null {
	const subject = SCREEN_MARKER_SUBJECT[screen];
	if (subject === undefined || state === "") return null;
	return stateMarkerFor(subject, STATE_MARKER_ALIASES[state] ?? state);
}

/**
 * Why a cell's state cannot be affirmed, or `null` when it can.
 *
 * The distinction this draws is the one the whole readiness rule turns on: a cell
 * whose state the APP DOES NOT MARK is not "not yet measured" in the same sense as
 * one whose marker the app renders and the frame lacks. The first is a declared gap
 * (named here, so the report can carry it); the second is a failure, and a caller
 * that treated the two as one would let a marker that stopped rendering hide behind
 * a gap that was expected anyway.
 */
export function markerGapReason(screen: string, state: string): string | null {
	const subject = SCREEN_MARKER_SUBJECT[screen];
	// An ad-hoc page declares no state, so it has no gap to report.
	if (subject === undefined || state === "") return null;
	if (requiredStateMarker(screen, state) !== null) return null;
	return (
		`the app declares no state marker for '${subject}/${state}' ` +
		"(src/ui/a11y.ts STATE_MARKER), so nothing in a frame can affirm that state: " +
		"the cell is NOT MEASURABLE for it"
	);
}

/**
 * The full sentence a declared gap produces, or `null` when the cell's state can be
 * affirmed.
 *
 * One builder, so the capture harness can drop exactly this sentence when the gap is
 * a DECLARED SKIP (a cell whose state is a named, owned dependency) and keep it when
 * it is not. Composing the string in two places is how the two would drift.
 */
export function markerGapProblem(screen: string, state: string): string | null {
	const reason = markerGapReason(screen, state);
	return reason === null ? null : `the cell declares '${state}' but ${reason}`;
}

export interface ReadinessFacts {
	/** The screen the cell names, as the matrix spells it (`S4`, or `path:/x`). */
	screen: string;
	/** The state the cell names (`populated`, `pending-approval`, …). */
	state: string;
	/** The route the cell asked for, with `{sessionId}` placeholders. */
	askedPath: string;
	/** The route the page reports it is on. */
	actualPath: string;
	/** The app's screen-root testid for this screen, when it is a real app screen. */
	root: string | undefined;
	/** Every `data-testid` in the DOM. */
	testIds: readonly string[];
	/** True when the RELAY's own registry declared this cell. */
	relayRegistryBacked: boolean;
	/** True when the relay served at least one request for this cell. */
	relayReached: boolean;
}

/**
 * What sort of thing is wrong with a frame, as a machine-readable kind beside the
 * sentence a reader gets.
 *
 * The kinds exist because ONE caller has to tell the issues apart rather than just
 * print them: `tools/visual/capture.ts` decides whether a cell's absence of evidence
 * is a DECLARED SKIP (a state this head does not render, with an owner) or a
 * failure. A skip may only cover the consequences of the gap itself — the empty
 * screen a placeholder draws, and the relay the app therefore never asks — and must
 * never cover a wrong route or a missing screen root, which are defects wherever
 * they appear.
 */
export type ReadinessIssueKind =
	/** The page is not on the route the cell asked for. */
	| "route"
	/** The app's screen root for this screen is not in the DOM. */
	| "root"
	/** The app declares a marker for this state and the frame does not carry it. */
	| "marker"
	/** The app declares NO marker for this state: the gap a declared skip may cover. */
	| "marker-gap"
	/** The frame shows an empty state while the cell declares another one. */
	| "empty"
	/** The relay served this cell nothing, so the state cannot have come from it. */
	| "relay";

export interface ReadinessIssue {
	kind: ReadinessIssueKind;
	message: string;
}

/**
 * The issue kinds a DECLARED SKIP may cover, and nothing else.
 *
 * Each is a CONSEQUENCE of the gap rather than a defect of its own: the app declares
 * no marker for the state (`marker-gap`), so its placeholder draws an empty screen
 * (`empty`) and it never asks the relay for anything (`relay`). A wrong route
 * (`route`), a missing screen root (`root`) or a marker the app DOES declare and the
 * frame does not show (`marker`) is a failure wherever it appears — which is what
 * stops a rotted route or root on a skipped cell from reading as "not implemented
 * yet". A caller with issue kinds of its own (capture's `reading` and `seed`) adds
 * them to the blocking side by simply not listing them here.
 */
export const SKIP_COVERED_ISSUES: readonly string[] = [
	"marker-gap",
	"empty",
	"relay",
];

/** What a declared skip says: who owns the gap, and which gap it is. */
export interface DeclaredSkip {
	owner: string;
	reason: string;
}

/**
 * Whether these issues may be covered by a declared skip owned by `owner`.
 *
 * The rule, in one place so it can be asserted without a browser: a skip needs an
 * owner, needs the app to declare NO marker for the cell's state, and needs EVERY
 * issue to be one the gap itself explains. Honouring a skip on the gap alone made a
 * rotted route or screen root indistinguishable from unlanded work — with `--no-seed`
 * a cell whose app never left `/welcome` and never drew its own root came back as a
 * skip and the run exited 0.
 */
export function declaredSkipFor(
	issues: ReadonlyArray<{ kind: string; message: string }>,
	owner: string | null,
): DeclaredSkip | null {
	if (owner === null) return null;
	const gap = issues.find((issue) => issue.kind === "marker-gap");
	if (gap === undefined) return null;
	if (!issues.every((issue) => SKIP_COVERED_ISSUES.includes(issue.kind)))
		return null;
	return { owner, reason: gap.message };
}

/** Why a cell is not ready, in the order a reader needs to hear it. */
export function readinessIssues(facts: ReadinessFacts): ReadinessIssue[] {
	const issues: ReadinessIssue[] = [];
	if (!routeMatches(facts.askedPath, facts.actualPath)) {
		issues.push({
			kind: "route",
			message: `the app is on '${facts.actualPath}' but the cell asked for '${facts.askedPath}'`,
		});
	}
	const { root, testIds, state } = facts;
	if (root !== undefined && !testIds.includes(root)) {
		issues.push({
			kind: "root",
			message: `no '${root}' root in the DOM: the app did not render screen ${facts.screen}`,
		});
	}
	// The affirmative half: a state the app drew leaves its own marker behind. The
	// marker NAMES come from the app's contract; a state the app declares no marker
	// for is a declared gap, named as its own problem so it can be told apart from a
	// marker that should have been there and was not.
	const required = requiredStateMarker(facts.screen, state);
	if (required !== null && !markerMatches(required, testIds)) {
		issues.push({
			kind: "marker",
			message:
				`the cell declares '${state}' but the marker '${required}' is not in the DOM: ` +
				"nothing in the frame affirms that state, so the cell is NOT MEASURABLE for it",
		});
	}
	const gap = markerGapProblem(facts.screen, state);
	if (gap !== null) issues.push({ kind: "marker-gap", message: gap });
	// The prohibition half, kept for the states that are not `empty` themselves: a
	// populated cell showing an empty marker is in the empty state whatever else it
	// carries.
	const emptyMarkers = testIds.filter((id) => id.endsWith(EMPTY_MARKER_SUFFIX));
	if (state !== "empty" && emptyMarkers.length > 0) {
		issues.push({
			kind: "empty",
			message:
				`the cell declares '${state}' but the app is showing an empty state (${emptyMarkers.join(", ")}): ` +
				"the state was never reached",
		});
	}
	// A cell the RELAY's own registry declared is a state the relay serves, so the app
	// has to have talked to the relay to render it.
	if (facts.relayRegistryBacked && !facts.relayReached) {
		issues.push({
			kind: "relay",
			message:
				"the app made no request to the mock relay for this cell, so the state it " +
				`declares (${state}) cannot have come from the relay`,
		});
	}
	return issues;
}

/**
 * The same issues, as the sentences a report prints.
 *
 * Kept as the stable surface the checks assert on, so a caller that does not care
 * about the distinction between a gap and a defect does not have to know it exists.
 */
export function readinessProblems(facts: ReadinessFacts): string[] {
	return readinessIssues(facts).map((issue) => issue.message);
}

/**
 * Whether the page's route is the one the cell asked for. `{…}` segments are the
 * session/job placeholders, so they match anything.
 */
function routeMatches(asked: string, actual: string): boolean {
	const segments = (value: string) =>
		value
			.split("?")[0]
			?.split("/")
			.filter((part) => part !== "") ?? [];
	const wanted = segments(asked);
	const got = segments(actual);
	if (wanted.length !== got.length) return false;
	return wanted.every(
		(segment, index) => segment.startsWith("{") || segment === got[index],
	);
}

/**
 * The query the harness hands the page to point a web build at one relay.
 *
 * These are the APP's parameter names, not a harness dialect: PR #11's
 * `webRelayOverride()` (`src/features/auth/connection-provider.tsx:169-181` on
 * `feat/screens-lists`) reads exactly `lo-relay`, `lo-relay-password` and
 * `lo-relay-insecure`, and its cold start gives that override PRIORITY over a saved
 * tunnel (`:655-673`) — which is the point of a capture run and the opposite of what an
 * earlier revision of the README claimed. `verify` asserts this name set against that
 * source, so a rename there fails here rather than silently seeding nothing.
 *
 * The PASSWORD is not optional: the relay authenticates by password into a cookie, so a
 * route-only seed renders an unauthenticated page and every cell fails for the missing
 * credential rather than the missing route. There is no session parameter — the session
 * id travels in the route path, which the harness sets itself.
 */
export function seedQuery(
	route: string | null,
	password: string | null,
): string {
	const params = new URLSearchParams();
	if (route !== null && route !== "") {
		params.set("lo-relay", route);
		params.set("lo-relay-password", password ?? "");
		// The app compares this to the string "1" and treats anything else as false, so a
		// cleartext mock relay needs it spelled exactly.
		params.set("lo-relay-insecure", "1");
	}
	return params.toString();
}
