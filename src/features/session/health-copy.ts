/**
 * The session-health dot's copy: the nine `relay.health.*` strings the relay
 * web client ships (local-operator #3008, catalogues `relay.health.json` at
 * `24d328a19a`), kept VERBATIM. These are reviewed, audited SAFETY COPY — the
 * sheet's explanations say what a send actually does in each state, and a
 * native port that rewords them makes the two clients describe one state two
 * ways.
 *
 * THE COPY ITSELF NOW LIVES IN THE CATALOGUE, not here (convergence onto
 * `8b384da5`, #112). This file used to carry the strings as a source-only
 * table because native main had no catalogue runtime; #112 landed one and
 * moved the four copy modules that already isolated their strings onto it
 * (`home-copy.ts` and `settings.tsx` are two, both `import { t } from
 * "@/i18n"`). The same nine keys now sit in
 * `src/i18n/catalogues/en/relay.health.json` with their translator context
 * beside them, under the relay's OWN key names and in the relay's own file
 * layout, so the native catalogue and the core's agree key for key rather than
 * merely in spirit. Nothing is duplicated: this module reads the catalogue.
 *
 * The two state words the relay keeps in another namespace
 * (`relay.chrome.session.subtitle.not_answering` / `.ended`) moved for the same
 * reason, into `relay.chrome.json`.
 *
 * NO LOCALE SHIP GATE IS CLAIMED HERE. Only `en` exists; the core's seven
 * audited locale catalogues (fr, es, ru, vi, zh-CN, hi, ur) are the
 * translations to adopt unchanged when the app ships locales.
 */
import { t } from "@/i18n";

export const HEALTH_SOURCE_LOCALE = "en" as const;

/**
 * The nine keys as a closed object, so a caller and a test can name them
 * without repeating a string literal — the values resolve through the
 * catalogue AT RENDER, through a function — a module-level table freezes the
 * locale it was imported under, which is exactly what the copy-resolution
 * guard forbids (`src/i18n/__tests__/copy-resolution.test.ts`).
 */
export const healthCopy = () => ({
	"relay.health.live": t("relay.health.live"),
	"relay.health.live_detail": t("relay.health.live_detail"),
	"relay.health.reconnecting": t("relay.health.reconnecting"),
	"relay.health.reconnecting_detail": t("relay.health.reconnecting_detail"),
	"relay.health.dropped_detail": t("relay.health.dropped_detail"),
	"relay.health.quiet_detail": t("relay.health.quiet_detail"),
	"relay.health.ended_detail": t("relay.health.ended_detail"),
	"relay.health.ended_send_failed": t("relay.health.ended_send_failed"),
	"mobile.session_health.ended_placeholder": t(
		"mobile.session_health.ended_placeholder",
	),
});

/**
 * The state's own word, per verdict — the sheet's title and the control's
 * accessible name. Two of them are the web client's `relay.health.*` keys;
 * `not_answering` and `ended` are the relay SPA's own
 * `relay.chrome.session.subtitle.*` words, read from the catalogue under those
 * same keys.
 */
export const healthStateWords = (): Record<
	"live" | "not_answering" | "reconnecting" | "ended",
	string
> => ({
	live: healthCopy()["relay.health.live"],
	not_answering: t("relay.chrome.session.subtitle.not_answering"),
	reconnecting: healthCopy()["relay.health.reconnecting"],
	ended: t("relay.chrome.session.subtitle.ended"),
});

/**
 * The words around the health sheet's Resume and the reopen-on-send line —
 * outside the nine keys, so not catalogue copy, but each is the relay client's
 * own sentence (`components/session-health.tsx` and `lib/refusal.ts` at
 * #3008) or this app's existing one, so the two clients still say one thing:
 *
 * THEY NOW COME FROM THE CATALOGUE TOO (same convergence): #112's checker
 * refuses new un-keyed user-facing literals, and these are user-facing. They
 * sit under `relay.health.*` because they belong to the same surface; they are
 * this app's words, not the relay catalogue's.
 *
 * - `reopening` / `stillReopening` — the acceptance line after a Resume (and
 *   now under the composer while a send to an ended session is in flight, UX
 *   round 1, U2: a send there IS a reopen, and the daemon's engage takes
 *   seconds, so "…" alone said nothing). 20 s is the reference's cap.
 * - `noLongerSaved` — a 404 from `POST /api/sessions/resume`: the session is
 *   gone, and "try again" would invite a retry that can never work (UX round
 *   1, U8). Same sentence as this app's Past sessions screen (`past.tsx`).
 */
export const healthResumeCopy = () => ({
	resume: t("relay.chrome.session.resume"),
	resuming: t("relay.chrome.session.resuming"),
	reopening: t("mobile.session_health.reopening"),
	stillReopening: t("mobile.session_health.still_reopening"),
	reopenReportMs: 20_000,
	refusedTitle: t("mobile.session_health.resume_refused_title"),
	refused: t("mobile.session_health.resume_refused"),
	noLongerSaved: t("mobile.session_health.resume_gone"),
	noRoute: t("mobile.session_health.resume_no_route"),
});

export type HealthCopyKey = keyof ReturnType<typeof healthCopy>;
