/**
 * The session's health, as the header's status dot reports it — a pure
 * function of runtime facts the relay publishes, so the dot, its words and the
 * composer all read ONE ladder.
 *
 * Ported from the relay web client's `lib/session-health.ts` (local-operator
 * #3008, `24d328a19a`), which retired the ended banner in favour of the dot.
 * The rules below are the same ones, in the same order, because two clients
 * describing one session two ways is the defect the port exists to avoid.
 */
import { HEALTH_STATE_WORDS } from "@/features/session/health-copy";
import type { ColorRole } from "@/ui/tokens.gen";

/** The four readings the dot can give. Three colours: `not_answering` and
    `reconnecting` share yellow because both mean "a message sent now will not
    reach a running session right away"; they differ in WHOSE side is quiet, so
    they keep separate words. */
export type SessionHealth = "live" | "not_answering" | "reconnecting" | "ended";

/** The fields {@link sessionHealth} reads — named so a caller (and a test) can
    see the whole input, and so no other projection field can creep in. `pid`
    is optional because the projection is `null` until the first frame: absent
    then means "not reported", never a claim that the owner is gone. */
export type HealthInput = {
	ended?: boolean;
	degraded?: boolean;
	pid?: number | null;
	heartbeat_stale?: boolean | null;
};

/**
 * THE RULE, first match wins. Every input is a runtime fact the relay daemon
 * publishes (`local_operator/mobile/types.py::SessionProjection`):
 *
 * 1. GREY `ended` — `ended`: the relay's scan proved the pid gone (history is
 *    kept and resumable). A receipt, not a reading: it stays true however old
 *    the frame is, so it outranks the phone's own link.
 * 2. YELLOW `reconnecting` — the phone's own link to the relay is down
 *    (`connected` false). Everything below is a reading taken from the LAST
 *    frame, which may be stale by now, so neither yellow cause nor a green can
 *    be confirmed; the honest thing to say is whose side is down.
 * 3. YELLOW `not_answering` — `degraded` (the relay cannot reach the owner's
 *    control socket), OR `heartbeat_stale === true` (the owner's heartbeat AND
 *    its frames have both been quiet past the relay's one health window,
 *    `SESSION_HEALTH_WINDOW_S`). `degraded` wins between the two for the
 *    sheet's copy (`healthDetailKey`): with the dial down the send meets the
 *    refusal first, whatever the heartbeat says. `heartbeat_stale`
 *    `null`/absent is "not reported" — an older daemon, or a disk rebuild —
 *    and contributes NOTHING: guessing stale from absence would turn every
 *    session on an older relay yellow. Checked BEFORE the pid rule below
 *    because a live entry whose dial is down is served as a disk rebuild
 *    (pid 0) carrying `degraded`, and that runtime is alive, not ended.
 * 4. GREY `ended` — `pid === 0`: a frame folded from disk with no running
 *    owner behind it. A past conversation opened from history is not running
 *    yet, so it must not read as live; its first live frame turns the dot
 *    green.
 * 5. GREEN `live` — a running owner the relay has heard from inside the
 *    window.
 *
 * BUSY IS GREEN. A streaming turn is alive and answering — it pushes frames
 * many times a second, which is exactly what keeps `heartbeat_stale` false
 * even while the turn starves the runtime's heartbeat writer. `streaming` and
 * `activity` are therefore deliberately NOT inputs.
 */
export function sessionHealth(
	projection: HealthInput | null | undefined,
	connected: boolean,
): SessionHealth {
	if (projection?.ended === true) return "ended";
	if (!connected) return "reconnecting";
	if (projection?.degraded === true || projection?.heartbeat_stale === true)
		return "not_answering";
	if (projection != null && projection.pid === 0) return "ended";
	return "live";
}

/**
 * The phone's own link to the relay, as the dot reads it — three values, not a
 * boolean, because the sheet's reconnecting sentence promises the phone "keeps
 * trying", and that is only true while it does.
 *
 * - `up` — the stream is open and has not dropped since its last frame.
 * - `retrying` — the link that WAS up has dropped and the client is reopening
 *   it: a transport error since the last frame (any drop, the relay's rule —
 *   its store sets `connected: false` on every outage report, `store.ts` at
 *   #3008), a reopen that produced no frame inside `RECONNECT_DEADLINE_MS`, the
 *   platform saying the phone is offline, or a stream the store marked closed.
 *   A clean EOF (the gateway's 60 s lease rotation) is NOT a drop: it is the
 *   connection layer's invisible `C1`, and a dot that flashed yellow once a
 *   minute would teach the reader to ignore it.
 * - `stopped` — the client gave up: a failure the reader must resolve (a 401, a
 *   typed gateway refusal) ended the stream and nothing is reopening it. The
 *   banner names that failure and its remedy; the dot says nothing rather than
 *   "keeps trying" (UX round 1, U4).
 */
export type HealthLink = "up" | "retrying" | "stopped";

/** The stream facts {@link healthLink} reads — each one a fact the session
    runtime already holds for the connection banner, so the dot and the banner
    are fed by the same readings and cannot disagree about a drop. */
export type LinkInput = {
	/** The store's flag: false once the stream has closed. */
	entryConnected: boolean;
	/** A transport error has ended an open since the last accepted frame. */
	droppedSinceFrame: boolean;
	/** A reopen is in flight and has outlived the reconnect deadline. */
	reopenOverdue: boolean;
	/** The platform says there is no network (`null`, unknown, is not offline). */
	online: boolean | null;
	/** The stream stopped on a failure the client will not retry. */
	stoppedOnError: boolean;
	/** The stream's OWN terminal state: `sse.ts`'s loop has ended and nothing
	 *  will reopen it (`facts.state === "closed"`, set in exactly one place —
	 *  the branch that stops the retry loop). Read as well as `stoppedOnError`
	 *  because the error object is not the thing that stops the loop: QA round 3
	 *  (Q10) measured a 401 on the session stream alone that ended every retry
	 *  (no request in 90 s) while the dot still said "Reconnecting — keeps
	 *  trying", because only the provider's `lastError` was consulted and that
	 *  surface had not met the 401. The terminal state is the fact; the error is
	 *  a copy of it that can go missing. */
	streamClosed: boolean;
};

export function healthLink(input: LinkInput): HealthLink {
	if (input.stoppedOnError || input.streamClosed) return "stopped";
	if (
		!input.entryConnected ||
		input.droppedSinceFrame ||
		input.reopenOverdue ||
		input.online === false
	)
		return "retrying";
	return "up";
}

/**
 * What the HEADER shows: {@link sessionHealth}, or `null` for "no reading", in
 * which case the header draws the plain title with no dot and announces
 * nothing.
 *
 * - No projection yet (the first frame has not arrived): the reference renders
 *   no health control at all while `!projection` (`session-view.tsx` at
 *   #3008). "Reconnecting" says a link that WAS up has dropped, and on a first
 *   open nothing has dropped — a yellow dot and a spoken "Reconnecting" on
 *   every open was a false safety claim (review M3, QA Q3, UX U5).
 * - The client has stopped retrying: see {@link HealthLink}. `ended` still
 *   shows, because it is a receipt that holds however old the frame is.
 */
export function headerHealth(
	projection: HealthInput | null | undefined,
	link: HealthLink,
): SessionHealth | null {
	if (projection == null) return null;
	if (projection.ended === true) return "ended";
	if (link === "stopped") return null;
	return sessionHealth(projection, link === "up");
}

/** The state's own word: the sheet's title, the dot's accessibility label and
    what the announcement region says on a transition — colour is never the
    only signal. `not_answering` and `ended` are the web client's own words
    (its `relay.chrome.session.subtitle.*` keys), so the two clients cannot
    disagree. */
export function healthLabel(health: SessionHealth): string {
	return HEALTH_STATE_WORDS[health];
}

/** Which sentence the sheet says, as a copy key — split from the component so
    the precedence tests can tell the two yellow causes apart: both read "Not
    answering", and only the sheet's key says which one won. Pure, so the rule
    is asserted without a mounted catalogue. */
export function healthDetailKey(
	health: SessionHealth,
	projection: HealthInput | null | undefined,
):
	| "relay.health.live_detail"
	| "relay.health.dropped_detail"
	| "relay.health.quiet_detail"
	| "relay.health.reconnecting_detail"
	| "relay.health.ended_detail" {
	switch (health) {
		case "live":
			return "relay.health.live_detail";
		case "not_answering":
			return projection?.degraded === true
				? "relay.health.dropped_detail"
				: "relay.health.quiet_detail";
		case "reconnecting":
			return "relay.health.reconnecting_detail";
		case "ended":
			return "relay.health.ended_detail";
	}
}

/**
 * The dot's fill per state — existing theme tones only, resolved as tokens by
 * the component. `ink-dim` (grey) for ended, `warning` for the two yellow
 * causes, `success` for live: the same mapping the web client ships.
 */
export const HEALTH_DOT_TONE: Record<SessionHealth, ColorRole> = {
	live: "success",
	not_answering: "warning",
	reconnecting: "warning",
	ended: "ink-dim",
};

/** Whether a send to this session is actually a REOPEN. The composer takes the
    verdict from the dot, never from `projection.ended` alone: a conversation
    opened from history is a disk rebuild (`pid: 0`, `ended: false`), and the
    same daemon wake path serves it. */
export const healthIsEnded = (health: SessionHealth): boolean =>
	health === "ended";
