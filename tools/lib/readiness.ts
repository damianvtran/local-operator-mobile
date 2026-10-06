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
 *
 * PRESENCE vs VISIBILITY — two different questions, and conflating them was a real
 * failure of this rule rather than a refinement of it. A **state marker counts by
 * PRESENCE**: it is a machine-readable assertion about what a screen is showing, not an
 * affordance a person taps, and the app's own derived markers are zero-size `View`s by
 * design (`src/features/session/state-markers.tsx`), so asking a marker to have a
 * non-zero box excluded exactly the states this check exists to affirm — measured, that
 * made `populated`, `streaming`, `aborted`, `queued`, `error`, `rich-rows`,
 * `pending-approval`, `pending-ask` and `subagents` unmeasurable on a head that renders
 * every one of them. A **screen ROOT still requires VISIBILITY**: the root IS the
 * screen, and a zero-size root really would mean nothing rendered. The two lists arrive
 * as separate fields (`presentIds`, `visibleIds`) so neither rule can be satisfied by
 * the other's evidence, and both directions are pinned in `scripts/readiness.test.ts`.
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
	// S4 is the composer home since the Part 2 slice: `/` is Home, and the
	// sessions list moved into the panel (S15). The four measured cells that used
	// to be S4/* re-homed: the list ones kept their names under S15, and the home
	// gained its own idle cell. The relabel table diff is flagged for the plan
	// lane in the PR body — these two lines are the whole mapping change.
	S4: "home",
	S5: "session",
	S6: "subagent",
	S7: "new-session",
	S8: "session",
	S9: "session",
	S10: "past",
	S11: "settings",
	S13: "computers",
	S14: "welcome",
	/** The conversations panel: a screen of its own for the harness because its
	 *  route (`/conversations`) is the programmatic open and a deep-link failure's
	 *  landing — the sessions list's cells and their markers live here now. */
	S15: "sidebar",
	/* The projects read path: the list and its pushed detail are one surface in two
	 * routes, and each declares its own subject so a capture says which of the two
	 * drew. */
	S16: "projects",
	"S16-detail": "project-detail",
};

/**
 * Declared states that are a rendering of another state, mapped to the state whose
 * marker affirms them. Keep this table short: an entry here is a statement that the
 * app has no distinct look for the variant, which is usually true of a width or a
 * scroll position and never true of a different card.
 *
 * An entry can OUTLIVE the cell that declared it — `scroll` has, since
 * `long-transcript` stopped declaring `S5/scroll`, and `narrow` has, since the `many`
 * scenario stopped declaring `S4/narrow` — because what it states is a fact about the
 * APP rather than about the registry: a width or a scroll position has no distinct
 * look whether or not a cell still names it. It is kept for that reason, and never as
 * a licence to declare the name again — a variant whose only difference from another
 * state is its VIEWPORT has no cell of its own, because the device axis is where a
 * width lives (see `many`'s comment in tools/mock-relay/scenarios.ts).
 */
export const STATE_MARKER_ALIASES: Record<string, string> = {
	"populated-long": "populated",
	narrow: "populated",
	scroll: "populated",
	approval: "pending-approval",
	ask: "pending-ask",
	"ask-multi": "pending-ask",
	/** The panel's degraded-listing cell renders the same look as `degraded`
	 *  (the banner + the short/long note): the app has no second degradation
	 *  look for a list, so the variant borrows the state's marker — which is
	 *  what this table is for. */
	"degraded-listing": "degraded",
	/** The table's scroll position: the same look, one interaction later — the
	 *  cell `S5/tables-end` renders the wide table scrolled to its end so the
	 *  left-mirror fade and the retired right fade have a frame (design pass
	 *  `fix/hero-tables-strips` §4.1 #7; §4.3 says the cue is read from that
	 *  frame, not from a marker). An entry here is what lets the cell borrow the
	 *  `tables` marker rather than invent a second id for a scroll offset. */
	"tables-end": "tables",
	/** The table brought into view: the same state as `tables`, one viewer hook
	 *  later — the cell `S5/tables-in-view` scrolls the TRANSCRIPT so the table
	 *  sits at the viewport top (review round 1, D2: at 200 % text the settled
	 *  frame otherwise shows only chrome, so no frame would show a table). Same
	 *  look, one vertical offset apart; the alias borrows the `tables` marker
	 *  rather than inventing a second id for a scroll position. */
	"tables-in-view": "tables",
	/** The table arriving: the same state as `streaming` — an assistant row whose
	 *  text is still being written — with the row's content being a table. The
	 *  app has no second streaming look for it, which is what the alias table is
	 *  for; §4.1 #10 reads the consecutive frames, not a marker. */
	"streaming-tables": "streaming",
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
	/**
	 * Every `data-testid` in the DOM, rendered or not. This is what a STATE MARKER is
	 * judged on: a marker asserts what the screen is showing, and the app's derived
	 * markers are zero-size by design, so presence is the honest test for one.
	 */
	presentIds: readonly string[];
	/**
	 * The subset of `presentIds` whose element is actually rendered (non-zero box, no
	 * `display:none` / `visibility:hidden` on it or an ancestor). This is what a ROOT is
	 * judged on, and only a root: the root IS the screen, so a zero-size one means
	 * nothing rendered, while a hidden-but-present MARKER still asserts its state.
	 */
	visibleIds: readonly string[];
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
 *
 * A BLANK owner is refused too, not just `null`: "a skip names the work that owns it"
 * is the clause that keeps an ownerless gap from sitting there unfixed, and `""` or
 * `"   "` satisfies a `=== null` test while naming nobody.
 */
export function declaredSkipFor(
	issues: ReadonlyArray<{ kind: string; message: string }>,
	owner: string | null,
): DeclaredSkip | null {
	if (owner === null || owner.trim() === "") return null;
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
	const { root, presentIds, visibleIds, state } = facts;
	if (root !== undefined && !visibleIds.includes(root)) {
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
	if (required !== null && !markerMatches(required, presentIds)) {
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
	// carries — but the marker it reads is the one the cell's OWN surface declares
	// (`STATE_MARKER.<subject>.empty`). A device COMPOSES surfaces: the home docks
	// the conversations panel at tablet-landscape, and the panel's empty state,
	// drawn beside the home, is not the home's miss — reading every `*-empty`
	// refused the home's idle cell for a panel that was correctly empty (PR #34
	// review round 2, F1). An ad-hoc `path:` page declares no surface, so every
	// empty marker is still read for it — the same line `requiredStateMarker`
	// draws for the affirmative half above.
	const subject = SCREEN_MARKER_SUBJECT[facts.screen];
	const ownEmpty =
		subject === undefined ? null : stateMarkerFor(subject, "empty");
	const emptyMarkers = presentIds.filter((id) =>
		id.endsWith(EMPTY_MARKER_SUFFIX),
	);
	const offending =
		subject === undefined
			? emptyMarkers
			: emptyMarkers.filter(
					(id) => ownEmpty !== null && markerMatches(ownEmpty, [id]),
				);
	if (state !== "empty" && offending.length > 0) {
		issues.push({
			kind: "empty",
			message:
				`the cell declares '${state}' but the app is showing an empty state (${offending.join(", ")}): ` +
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
 * How long a cell's declared state is given to APPEAR after the settle window, and
 * how often it is looked for.
 *
 * WHY THIS EXISTS. Readiness used to be a single reading taken `--settle` ms after
 * the page loaded, which silently assumed every scenario's state exists by then.
 * Two do not: `401-mid-session` ends the stream two seconds in (that is the state),
 * and `aborted` is a turn that has to finish before its receipt is painted. At the
 * 1200 ms default both cells were reported `NOT MEASURABLE` — the harness failing
 * its own clock, not the app failing its state — so the run could never be green
 * for a reason that had nothing to do with the app. The alternative (a longer
 * `--settle` for the whole run) is wrong in the other direction: measured
 * 2026-10-03, `--settle 7000` fixes those two and BREAKS `S5/streaming` and
 * `S6/populated`, whose states have already come and gone by then.
 *
 * So the wait is on the EVENT, not the clock: poll for the marker the app declares and
 * stop the moment it appears. It costs nothing for a cell that is already ready, and it
 * never applies to a DECLARED SKIP (those fail on `marker-gap`, not `marker`) or to a
 * wrong route or a missing root, which are defects whenever they appear.
 *
 * BOTH CALLERS NEED IT, which is why it is here rather than in either tool: the capture
 * retakes the settled frame once the state has arrived, and the audit reads the state
 * again before deciding whether the re-drive reached it — an audit that judged the
 * re-drive at the settle window would BLOCK a cell whose state simply arrived late,
 * which is the harness reading its own clock instead of the page.
 */
export const STATE_WAIT_MS = 8_000;
export const STATE_POLL_MS = 400;

/**
 * Whether a cell's issues are all "the declared state has not arrived yet".
 *
 * `marker` is the only issue kind this waits on: the app DECLARES a marker for the
 * state and the frame does not carry it yet. `empty` rides along because it is the
 * same sentence's second half. Everything else — a wrong route, a missing root, a
 * `marker-gap`, a relay the app never asked — is a defect that waiting cannot fix.
 */
export const stateStillComing = (
	issues: ReadonlyArray<{ kind: string }>,
): boolean =>
	issues.length > 0 &&
	issues.some((issue) => issue.kind === "marker") &&
	issues.every((issue) => issue.kind === "marker" || issue.kind === "empty");

/**
 * The facts a RE-DRIVEN page gives, against the cell's own record.
 *
 * `askedPath` is the route the RECORD rendered (the capture's resolved path), not a
 * path re-derived from the matrix: a re-drive is judged against what the capture
 * actually saw, so a route that moved between the two runs is a mismatch rather than
 * something a second derivation could paper over.
 */
export interface ReDriveFacts {
	/** The screen the record names, as the matrix spells it (`S4`, or `path:/x`). */
	screen: string;
	/** The state the record names. */
	state: string;
	/** The route the record rendered. */
	askedPath: string;
	/** The app's screen-root testid for this screen, when it is a real app screen. */
	root: string | undefined;
	/**
	 * What the re-driven page reports (`READINESS_PROBE`), or `null` when the page
	 * returned nothing — an unreadable page is its own failure, never a pass.
	 */
	reading: {
		path: string;
		testIds: readonly string[];
		visibleTestIds: readonly string[];
	} | null;
}

/**
 * Why a RE-DRIVEN page is not in the state its record names, or `null` when it is.
 *
 * This is the invariant that stops a re-drive measuring a screen the cell does not
 * name. The audit renders a page and reports what its checks measured there — so a
 * page that is not the cell (an app that was never pointed at a relay, showing its own
 * welcome screen) contributed rows under the cell's name. The capture already refuses
 * to call a cell ready when the state marker is absent; the same rule is applied here,
 * to the re-driven page, against the route the record itself rendered.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK: the relay clause (`relayRegistryBacked` /
 * `relayReached`). That fact comes from counting the mock relay's requests, which only
 * the capture run does. A re-drive that invented it would report a finding this side
 * cannot substantiate, so it is `false`/`true` here — every clause decidable from the
 * page alone is still applied.
 *
 * ITS BOUND, STATED: this is the capture's readiness rule — route + visible screen root
 * + the app's declared state marker, plus the `*-empty` prohibition — and NOT a content
 * comparison. It is therefore necessary, not sufficient, and two limits follow from that
 * which a reader should not have to discover:
 *
 *  - a state that renders on the right route with the right root and the right marker
 *    passes whatever else is on the page. Measured against the seed sweep, 8 of the 192
 *    seed-affected cells do this: every `S5/empty` cell (all devices, themes and scales)
 *    re-driven unseeded renders the same route with 18 ids where its record had 15 —
 *    extra ids, and `session-transcript-empty` still among them — so route, root and
 *    marker are all satisfied and its rows would be measured as the cell. Those 8 are
 *    the whole residue of `136 same-route changes − 128 marker losses`;
 *  - the marker contract is the app's, so a state the app renders with the same look as
 *    another is held only to the shared marker (`STATE_MARKER_ALIASES`: `populated-long`,
 *    `narrow` and `scroll` are the populated screen), and an ad-hoc `path:` page, which
 *    declares no app state at all, is judged on its route alone. A cell whose DECLARED
 *    state is the fallback (`S14/welcome`) is indistinguishable from the seed failing —
 *    harmless for that cell, and the reason "unseeded is always caught" is not a claim
 *    this rule makes.
 *
 * What it does establish is the case that mattered: a re-drive that reaches another
 * screen — the app's own fallback — cannot contribute rows under this cell's name, and
 * neither can one that reads as unreadable, empty where the record was populated, or on
 * another route or root. Tightening it into a content comparison is a different change:
 * a rule that blocks a real cell costs more than a rule that misses these eight.
 *
 * The result is a SENTENCE, because the caller records it as the reason its rows are
 * not measurements rather than turning it into a verdict of its own: a wrong screen has
 * no verdict to give.
 */
export function reDriveMismatch(facts: ReDriveFacts): string | null {
	const issues = reDriveIssues(facts);
	if (issues.length === 0) return null;
	return issues.map((issue) => issue.message).join("; ");
}

/**
 * One reason a re-drive is not the state its record names: the readiness rule's own
 * kinds, plus "the page could not be read at all" — which is not a rule the page can
 * violate, and is its own kind so a wait cannot mistake it for a state still arriving.
 */
export type ReDriveIssue =
	| ReadinessIssue
	| { kind: "reading"; message: string };

/**
 * The same issues as a LIST, for a caller that has to decide what to do about them.
 *
 * The audit polls on this while the only thing wrong is that the declared state has not
 * arrived yet (`stateStillComing`) — the same wait the capture makes. A state that is
 * simply late is not a re-drive that reached another screen, and blocking such a cell
 * would be the harness reading its own clock instead of the page.
 */
export function reDriveIssues(facts: ReDriveFacts): ReDriveIssue[] {
	if (facts.reading === null) {
		return [
			{
				kind: "reading",
				message:
					"the re-driven page returned no readiness reading, so nothing in the frame " +
					"affirms the state and no row can describe this cell",
			},
		];
	}
	return readinessIssues({
		screen: facts.screen,
		state: facts.state,
		askedPath: facts.askedPath,
		actualPath: facts.reading.path,
		root: facts.root,
		presentIds: facts.reading.testIds,
		visibleIds: facts.reading.visibleTestIds,
		// The relay's request count is a fact the CAPTURE run had and the audit does not:
		// it counts nothing while re-driving, so it must not invent an un-reached relay.
		relayRegistryBacked: false,
		relayReached: true,
	});
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

/**
 * The web-only hooks EVERY harness page carries, beside the relay seed.
 *
 * Today that is `lo-recorder=supported`, and it exists because the two halves
 * of the mic's gate are answered by different things: the RELAY advertises
 * voice (`capabilities.stt`, which a scenario drives) while the BUILD must be
 * able to record, and the web target's `recorderSupported()` is a hard `false`
 * (`src/stt/recorder.ts`) — capture needs a native recorder. The design round
 * audits the web frames (`docs/e2e/ci-notes.md`), so without this hook the
 * mic-visible state has no rendering a reviewer can look at, and the cell would
 * fail readiness for a marker the page can never draw.
 *
 * Unconditional, and that is deliberate rather than lazy: it is a statement
 * about the PAGE (this is a harness page, not a hand-run web build), the same
 * kind `lo-theme`/`lo-insets` make, and it is inert for every cell whose relay
 * does not advertise `stt` — which is every cell but the voice scenario's.
 * Both tools that build a page URL merge it through THIS function, because a
 * second spelling is how the capture and the audit render different screens
 * (the drift `seedQuery`'s own note describes).
 */
export function captureHookQuery(): string {
	return new URLSearchParams({ "lo-recorder": "supported" }).toString();
}

/**
 * Per-cell viewer hooks: a query value that steers ONE cell's page, keyed by the
 * cell name and merged by BOTH halves of the harness through this one builder —
 * the capture and the audit render the same screen, or the audit measures a page
 * the frame was never taken from.
 *
 * `S5/tables-end` is the case: it shows the wide table scrolled to its end, so
 * the left-mirror fade and the retired right fade have a frame, and a scroll
 * offset is a viewport interaction no wire action can declare. The value is the
 * app-side `lo-md-scroll` hook (`src/features/session/table-scroll-hook.ts`),
 * which is scoped to the table's own scroll view and inert everywhere else.
 */
export const CELL_HOOKS: Record<string, Record<string, string>> = {
	"S5/tables-end": { "lo-md-scroll": "end" },
	// Review round 1, D2: the 200 % frames otherwise show chrome above the fold
	// (`S5/tables` shares bytes with `S5/rich-rows` there — the camera limit
	// recorded in the matrix), so no frame showed a table at the largest text.
	// `bring` scrolls the transcript so the last table sits at its viewport top.
	"S5/tables-in-view": { "lo-md-scroll": "bring" },
};

/** The per-cell hook query for one cell name (empty when it declares none). */
export function cellHookQuery(cell: string): string {
	return new URLSearchParams(CELL_HOOKS[cell] ?? {}).toString();
}
