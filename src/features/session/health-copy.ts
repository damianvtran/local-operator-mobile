/**
 * The session-health dot's copy: the nine `relay.health.*` strings the relay
 * web client ships (local-operator #3008, catalogues `relay.health.json` at
 * `24d328a19a`), kept VERBATIM. These are reviewed, audited SAFETY COPY — the
 * sheet's explanations say what a send actually does in each state, and a
 * native port that rewords them makes the two clients describe one state two
 * ways.
 *
 * SOURCE fallback only, in the shape this repo already uses
 * (`account-routing-copy.ts`): native main has no qualified catalogue runtime
 * (the i18n runtime is still an open PR), so these are finite, stable keys
 * with per-key translator context CONDENSED from the core's
 * `relay.health.context.json` notes — the `source` strings are byte-identical
 * to the catalogue, the `context` fields are shortened paraphrases of its
 * `note` (meaning kept, wording not; QA round 1). No other locales ship on native main yet; when
 * the catalogue runtime lands, the core's seven audited locale catalogues
 * (fr, es, ru, vi, zh-CN, hi, ur) are the translations to adopt, unchanged.
 */
export const HEALTH_SOURCE_LOCALE = "en" as const;

export const HEALTH_COPY = {
	"relay.health.live": {
		source: "Live",
		context:
			"Accessible name and sheet title for the GREEN status dot: the session's process is running on the user's computer, its heartbeat is fresh and the phone's link is up. One short state word; avoid 'Connected' (the phone-link word) and 'Active' (whose negation is Idle).",
		role: "status label",
		maxCells: 16,
	},
	"relay.health.live_detail": {
		source: "Running on your computer — messages reach it right away",
		context:
			"Sheet body for the green dot. 'Your computer' is the machine running the agent session, not the phone. 'Right away' means delivered to the running session now, not queued for a restart — never promise an instant reply.",
		role: "status sheet explanation",
	},
	"relay.health.reconnecting": {
		source: "Reconnecting",
		context:
			"Title of the sheet and accessible name of the YELLOW status dot when the PHONE's own connection is down (the computer may be fine). One short state word, no ellipsis.",
		role: "status label",
		maxCells: 16,
	},
	"relay.health.reconnecting_detail": {
		source:
			"This phone lost its connection to your computer and keeps trying. The session may still be running there; sending may fail until the connection is back.",
		context:
			"Sheet body for the reconnecting state. It is the PHONE's connection that is down; the session itself may still be running, and the phone keeps trying on its own. 'Sending may fail' is deliberate — never promise that messages wait or are queued.",
		role: "status sheet explanation",
	},
	"relay.health.dropped_detail": {
		source:
			"Your computer can't reach this session right now and keeps trying. Until it does, a send fails straight away and your text stays in the message box.",
		context:
			"Sheet body for the YELLOW 'Not answering' state when the computer cannot reach the session (degraded). True behaviour to keep: a send fails immediately — it does NOT wait or queue — and the typed text is put back in the message box at the bottom of the screen.",
		role: "status sheet explanation",
	},
	"relay.health.quiet_detail": {
		source:
			"This session on your computer has stopped responding — it may be busy or stuck. A send can show a failure and still arrive once it catches up. Retrying won't send it twice.",
		context:
			"Sheet body for the YELLOW 'Not answering' state when the session is reachable but has gone quiet (heartbeat_stale). True behaviour to keep: a send can report a failure yet still be delivered once the session catches up; retrying under the same command id is safe. Do not promise queueing or delivery.",
		role: "status sheet explanation",
	},
	"relay.health.ended_detail": {
		source:
			"History is kept. Send a message or tap Resume to reopen it in your home folder.",
		context:
			"Sheet body for the GREY 'Ended' state, under the title 'Ended' and above the Resume button — it must add information, not repeat 'ended'. 'Resume' names that button. 'Home folder' is the user's home directory on the computer: the session comes back there, not in its original project folder.",
		role: "status sheet explanation",
	},
	"relay.health.ended_send_failed": {
		source:
			"This session has ended and couldn't be reopened just now. Try again, or tap “Ended” at the top and choose Resume.",
		context:
			"Composer error when sending to an ENDED session failed to reopen it. 'Try again' means sending again. “Ended” (keep the locale's quotation marks) is the status word under the conversation title at the top; tapping it opens the sheet whose button is Resume.",
		role: "composer error message",
	},
	"relay.health.ended_placeholder": {
		source: "Send to reopen in your home folder…",
		context:
			"Placeholder inside the empty message field of an ENDED conversation, replacing the usual 'Message…'. Says, before they send, that sending reopens the session in their home folder on the computer. Keep the trailing ellipsis character (…).",
		role: "message field placeholder",
		maxCells: 36,
	},
} as const;

/**
 * The state's own word, per verdict — the sheet's title and the control's
 * accessible name. Two of them are the web client's `relay.health.*` keys;
 * `not_answering` and `ended` are the words the relay's SPA reuses from
 * `relay.chrome.session.subtitle.*` (there is no native catalogue runtime yet,
 * so they live here as the same two strings, with the same meaning).
 */
export const HEALTH_STATE_WORDS: Record<
	"live" | "not_answering" | "reconnecting" | "ended",
	string
> = {
	live: HEALTH_COPY["relay.health.live"].source,
	/* `relay.chrome.session.subtitle.not_answering` in the relay's catalogue. */
	not_answering: "Not answering",
	reconnecting: HEALTH_COPY["relay.health.reconnecting"].source,
	/* `relay.chrome.session.subtitle.ended` in the relay's catalogue. */
	ended: "Ended",
};

/**
 * The words around the health sheet's Resume and the reopen-on-send line —
 * outside the nine keys, so not catalogue copy, but each is the relay client's
 * own sentence (`components/session-health.tsx` and `lib/refusal.ts` at
 * #3008) or this app's existing one, so the two clients still say one thing:
 *
 * - `reopening` / `stillReopening` — the acceptance line after a Resume (and
 *   now under the composer while a send to an ended session is in flight, UX
 *   round 1, U2: a send there IS a reopen, and the daemon's engage takes
 *   seconds, so "…" alone said nothing). 20 s is the reference's cap.
 * - `noLongerSaved` — a 404 from `POST /api/sessions/resume`: the session is
 *   gone, and "try again" would invite a retry that can never work (UX round
 *   1, U8). Same sentence as this app's Past sessions screen (`past.tsx`).
 */
export const HEALTH_RESUME_COPY = {
	resume: "Resume",
	resuming: "Resuming…",
	reopening: "Reopening — this can take a few seconds.",
	stillReopening: "Still reopening — it has not come up yet.",
	reopenReportMs: 20_000,
	refusedTitle: "Could not resume",
	refused: "This session could not be reopened just now. Try again.",
	noLongerSaved: "This session is no longer saved.",
	noRoute: "Connect to a computer to resume this session.",
} as const;

export type HealthCopyKey = keyof typeof HEALTH_COPY;
