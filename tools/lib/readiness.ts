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
 * So the rule is AFFIRMATIVE, and uniform on purpose:
 *
 *     a cell declaring `<screen>/<state>` must carry `<subject>-<state>`
 *
 * where `<subject>` is the app's own testid subject for that screen (`sessions`,
 * `session`, `subagent`, …). That is the app's existing convention — `sessions-empty`
 * on the list screen, `session-empty` on the session screen — extended to the other
 * states, so there is ONE naming rule rather than a harness dialect beside the app's.
 * The state suffix is normalised first (`STATE_MARKER_ALIASES`), because several
 * declared states are renderings of one state: `populated-long`, `narrow` and
 * `scroll` are all the populated screen, and `approval` is the pending-approval card.
 *
 * A state whose marker the app does not emit yet is NOT a pass and NOT a silent
 * `undefined`: the cell fails by name, naming the marker it wanted, so the missing
 * marker reads as "not measurable yet" everywhere it is reported — the manifest, the
 * stdout line and the audit's BLOCKED rows all quote the same sentence.
 *
 * Ad-hoc pages (`--cells path:/…`, which is how the canary drives its own fixtures)
 * carry no subject: such a page makes no claim about an app state, so the marker rule
 * does not apply to it and the `*-empty` prohibition still does.
 */

/** The app's testid subject per harness screen, e.g. `S4` → `sessions`. */
export const SCREEN_MARKER_SUBJECT: Record<string, string> = {
	S1: "sign-in",
	"S1-welcome": "welcome",
	S2: "custom",
	S3: "computers",
	"S3-custom": "custom",
	S4: "sessions",
	S5: "session",
	S6: "subagent",
	S7: "new-session",
	S8: "session",
	S9: "session",
	S10: "past",
	// The app names this one `settings-connection-empty`, not `settings-empty`: the
	// cross-check in `verify` reads the app's own a11y module and would fail either way
	// round, which is the point of deriving the requirement from the app's contract
	// rather than from a harness dialect.
	S11: "settings-connection",
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
 * The marker a cell must carry to count as being in its declared state, or `null`
 * for a cell that makes no state claim (an ad-hoc `path:` page).
 */
export function requiredStateMarker(
	screen: string,
	state: string,
): string | null {
	const subject = SCREEN_MARKER_SUBJECT[screen];
	if (subject === undefined) return null;
	const normalised = STATE_MARKER_ALIASES[state] ?? state;
	return `${subject}-${normalised}`;
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

/** Why a cell is not ready, in the order a reader needs to hear it. */
export function readinessProblems(facts: ReadinessFacts): string[] {
	const problems: string[] = [];
	if (!routeMatches(facts.askedPath, facts.actualPath)) {
		problems.push(
			`the app is on '${facts.actualPath}' but the cell asked for '${facts.askedPath}'`,
		);
	}
	const { root, testIds, state } = facts;
	if (root !== undefined && !testIds.includes(root)) {
		problems.push(
			`no '${root}' root in the DOM: the app did not render screen ${facts.screen}`,
		);
	}
	// The affirmative half: a state the app drew leaves its own marker behind.
	const required = requiredStateMarker(facts.screen, state);
	if (required !== null && !testIds.includes(required)) {
		problems.push(
			`the cell declares '${state}' but the marker '${required}' is not in the DOM: ` +
				"nothing in the frame affirms that state, so the cell is NOT MEASURABLE for it",
		);
	}
	// The prohibition half, kept for the states that are not `empty` themselves: a
	// populated cell showing an empty marker is in the empty state whatever else it
	// carries.
	const emptyMarkers = testIds.filter((id) => id.endsWith(EMPTY_MARKER_SUFFIX));
	if (state !== "empty" && emptyMarkers.length > 0) {
		problems.push(
			`the cell declares '${state}' but the app is showing an empty state (${emptyMarkers.join(", ")}): ` +
				"the state was never reached",
		);
	}
	// A cell the RELAY's own registry declared is a state the relay serves, so the app
	// has to have talked to the relay to render it.
	if (facts.relayRegistryBacked && !facts.relayReached) {
		problems.push(
			"the app made no request to the mock relay for this cell, so the state it " +
				`declares (${state}) cannot have come from the relay`,
		);
	}
	return problems;
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
 * The query the harness hands the page when a seed route is configured.
 *
 * This is the harness's HALF of the web-only seed hook the README describes: the app
 * side (reading the parameters at startup and adopting them as the configured
 * connection, with its own configured route still winning) does not exist yet, and a
 * cell it does not reach still fails by name. What this buys today is that the option
 * is one app-side change away instead of two, and that the parameters are on the page
 * for a run to assert rather than assumed.
 */
export function seedQuery(
	route: string | null,
	session: string | null,
): string {
	const params = new URLSearchParams();
	if (route !== null && route !== "") params.set("lo-seed-route", route);
	if (session !== null && session !== "")
		params.set("lo-seed-session", session);
	return params.toString();
}
