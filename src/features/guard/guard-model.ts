/**
 * Radient Guard on the phone: what the host's answer MEANS, as pure functions.
 *
 * Why a model module. Guard (RFC v0.9) is Team-plan guardrail analytics that the
 * Local Operator HOST enforces, whatever surface the member happens to be on. The
 * phone is one of those surfaces and has exactly three jobs:
 *
 *  1. SHOW the host's own account of the state (the indicator, what is shared);
 *  2. RELAY the member's answer to the host over the paired channel;
 *  3. say nothing the host did not say.
 *
 * It never grants. A grant is the host's signed act (`guard_consent`, RFC §5.2),
 * so nothing here builds a scope list to send, and the only thing the answer
 * carries is the two digests of the card the member actually read. Every rule
 * below that decides what a sentence SAYS lives here, away from React, because a
 * wrong sentence about whether data is being shared is the defect that matters:
 *
 *  - `sharing_pending` ("still sharing, a widening is waiting") is NEVER painted
 *    as paused (RFC §13.3' `consent_stale`);
 *  - an enum the build does not know falls to a plain, non-claiming line, never
 *    to "sharing" and never to a guess;
 *  - a scope this build cannot describe makes the card UNANSWERABLE here, because
 *    a member cannot consent to something the screen cannot say.
 *
 * Copy: every sentence is a catalogue key (`mobile.guard.*`); the strings are the
 * RFC's §15.4' wording, and most mirror the core TUI catalogue key for key
 * (`tui.guard.*`), so one request reads the same on every surface.
 */

import type { Capabilities, Payload } from "@/contracts";
import { activeLocale, t } from "@/i18n";

export type GuardStatus = Payload<"guardStatus">;
export type GuardOrg = GuardStatus["orgs"][number];
export type GuardNonTeamCard = Payload<"guardNonTeamCard">;
export type GuardConsentCard = Payload<"guardConsentCard">;

/** RFC §5.2.3: input received within 500 ms of the card rendering is ignored, so
 *  a typed-ahead or double tap cannot answer it. A UX debounce, not a security
 *  bound — the host's digest check is the security control. */
export const CONSENT_DEBOUNCE_MS = 500;

/** The relay advertises Guard as `capabilities.features.guard` (the twin of the
 *  desktop's `features.guard = 1`). Same truth rule as every other feature gate
 *  in this app: absent, false, 0 and "" are all "this host does not offer it",
 *  so an older host never gets a route it can only answer 404. */
export function guardEnabled(capabilities: Capabilities): boolean {
	const value = capabilities.features?.guard;
	if (value === undefined || value === null || value === false) return false;
	if (typeof value === "number") return value > 0;
	if (typeof value === "string") return value !== "" && value !== "0";
	return true;
}

/* ------------------------------------------------------------------ scopes */

/** `guard.consent.SCOPES` as the host names them, in the RFC's display order. */
export const KNOWN_SCOPES = [
	"decisions",
	"posture",
	"task_time",
	"review_cycles",
	"reports",
	"trace_detail",
	"admin_share",
] as const;
export type KnownScope = (typeof KNOWN_SCOPES)[number];

export const isKnownScope = (scope: string): scope is KnownScope =>
	(KNOWN_SCOPES as readonly string[]).includes(scope);

/** True only when every scope can be put into words by THIS build. A card that
 *  fails this is shown but cannot be answered from the phone. */
export const allDescribable = (scopes: readonly string[]): boolean =>
	scopes.every(isKnownScope);

/** The scopes in display order, unknown ones dropped (callers check
 *  `allDescribable` first when dropping would hide something being agreed to). */
export const orderedScopes = (scopes: readonly string[]): KnownScope[] =>
	KNOWN_SCOPES.filter((scope) => scopes.includes(scope));

/** The one-line scope description in the prompt (§15.4' C4). `org` fills the
 *  reports line's "<Org> admins" wording. */
export function scopeLine(scope: KnownScope, org: string): string {
	switch (scope) {
		case "decisions":
			return t("mobile.guard.scope_decisions");
		case "posture":
			return t("mobile.guard.scope_posture");
		case "task_time":
			return t("mobile.guard.scope_task_time");
		case "review_cycles":
			return t("mobile.guard.scope_review_cycles");
		case "reports":
			return t("mobile.guard.scope_reports", { org });
		case "trace_detail":
			return t("mobile.guard.scope_trace_detail");
		case "admin_share":
			return t("mobile.guard.scope_admin_share", { org });
	}
}

/** The short noun phrase for a scope ("guardrail results"), used in lists. */
export function scopeLabel(scope: KnownScope): string {
	switch (scope) {
		case "decisions":
			return t("mobile.guard.scope_label_decisions");
		case "posture":
			return t("mobile.guard.scope_label_posture");
		case "task_time":
			return t("mobile.guard.scope_label_task_time");
		case "review_cycles":
			return t("mobile.guard.scope_label_review_cycles");
		case "reports":
			return t("mobile.guard.scope_label_reports");
		case "trace_detail":
			return t("mobile.guard.scope_label_trace_detail");
		case "admin_share":
			return t("mobile.guard.scope_label_admin_share");
	}
}

/** "a, b and c" where the engine has `Intl.ListFormat`, a comma join where it
 *  does not (the same fallback the Team Bridge chips use). */
export function listLabels(labels: readonly string[]): string {
	if (labels.length <= 1) return labels.join("");
	try {
		return new Intl.ListFormat(activeLocale(), {
			style: "long",
			type: "conjunction",
		}).format([...labels]);
	} catch {
		return labels.join(", ");
	}
}

/* --------------------------------------------------------------- indicator */

/** The short date a Console stop names ("Nov 16"), in the reader's locale. */
export function shortDate(epochSeconds: number): string {
	return new Intl.DateTimeFormat(activeLocale(), {
		month: "short",
		day: "numeric",
	}).format(new Date(epochSeconds * 1000));
}

/** The pause reason as plain words (§13.3', §15.4' C9) — never the enum. `null`
 *  for a reason this build does not know, so the caller shows the bare "paused"
 *  line rather than an invented cause. */
function pauseReason(org: GuardOrg): string | null {
	switch (org.reason) {
		case "entitlement_lapsed":
			return t("mobile.guard.reason_entitlement_lapsed");
		case "org_off":
			return t("mobile.guard.reason_org_off", { org: org.org });
		case "membership_ended":
			return t("mobile.guard.reason_membership_ended", { org: org.org });
		case "scope_revoked":
			return t("mobile.guard.reason_scope_revoked");
		case "revoke_pending":
			return t("mobile.guard.reason_revoke_pending");
		case "console_revoked":
			// The RFC names the date; a stop with no date still says it was a stop.
			return org.since === null
				? t("mobile.guard.reason_scope_revoked")
				: t("mobile.guard.reason_console_revoked", {
						date: shortDate(org.since),
					});
		default:
			return null;
	}
}

/** The passive indicator for one org (§5.3, §13.3'). */
export function indicatorFor(org: GuardOrg): string {
	switch (org.state) {
		case "sharing":
			return t("mobile.guard.indicator_sharing", { org: org.org });
		case "sharing_pending":
			// Still sharing the PREVIOUS scopes: never rendered as paused.
			return t("mobile.guard.indicator_sharing_pending", { org: org.org });
		case "waiting":
			return t("mobile.guard.indicator_waiting", { org: org.org });
		case "not_sharing":
			return t("mobile.guard.indicator_not_sharing", { org: org.org });
		case "will_ask":
			return t("mobile.guard.indicator_will_ask", { org: org.org });
		case "paused": {
			const reason = pauseReason(org);
			return reason === null
				? t("mobile.guard.indicator_paused_plain")
				: t("mobile.guard.indicator_paused", { reason });
		}
		default:
			// A state a newer host invented: say nothing about sharing.
			return t("mobile.guard.indicator_unknown");
	}
}

/** What the member can DO about an org, from the host's own predicates. */
export type OrgAction = "review" | "stop" | "share_again";

export function orgActions(org: GuardOrg): OrgAction[] {
	const actions: OrgAction[] = [];
	if (org.prompt !== null) actions.push("review");
	if (org.can_revoke) actions.push("stop");
	if (org.can_share_again) actions.push("share_again");
	return actions;
}

/** "Answered on <surface>" for a card another surface answered. */
export function answeredOnLine(surface: string): string {
	const name = (() => {
		switch (surface) {
			case "tui":
				return t("mobile.guard.surface_terminal");
			case "desktop":
				return t("mobile.guard.surface_desktop");
			case "mobile":
				return t("mobile.guard.surface_mobile");
			default:
				return null;
		}
	})();
	return name === null
		? t("mobile.guard.answered_elsewhere")
		: t("mobile.guard.answered_on", { surface: name });
}

/** The orgs that have a consent request waiting, with the card that answers it.
 *  A prompt with no `approval_id` means this computer has no operator key to
 *  file a card against: the member answers in the terminal, so the phone offers
 *  no answer (but the org still reads as waiting in Settings). */
export function pendingPrompts(status: GuardStatus): GuardOrg[] {
	return status.orgs.filter((org) => org.prompt !== null);
}

/* ----------------------------------------------------------- consent card */

/** The reason line for a prompt (§15.4' C4). `null` for a reason the build does
 *  not know: the title and scopes still say what is being asked. */
export function promptReasonLine(
	reason: string,
	org: string,
	addedScopes: readonly string[],
): string | null {
	switch (reason) {
		case "new_org":
			return t("mobile.guard.prompt_reason_new_org", { org });
		case "widened":
			return t("mobile.guard.prompt_reason_widened", {
				org,
				scopes: listLabels(orderedScopes(addedScopes).map(scopeLabel)),
			});
		case "reactivated":
			return t("mobile.guard.prompt_reason_reactivated", { org });
		case "plan_gap":
			return t("mobile.guard.prompt_reason_plan_gap", { org });
		case "new_device":
			return t("mobile.guard.prompt_reason_new_device");
		case "rejoined":
			return t("mobile.guard.prompt_reason_rejoined", { org });
		default:
			return null;
	}
}

/** The visibility sentence, in the RFC's four variants. */
export function visibilityLine(scopes: readonly string[]): string {
	const posture = scopes.includes("posture");
	const adminShare = scopes.includes("admin_share");
	if (adminShare && posture)
		return t("mobile.guard.prompt_visibility_admin_share_posture");
	if (adminShare) return t("mobile.guard.prompt_visibility_admin_share");
	if (posture) return t("mobile.guard.prompt_visibility_posture");
	return t("mobile.guard.prompt_visibility");
}

export interface ConsentView {
	title: string;
	reasonLine: string | null;
	wouldSend: string;
	scopeLines: string[];
	neverSent: string;
	visibility: string;
	background: string;
	/** The non-sharing answer, listed first and never pre-selected. */
	declineLabel: string;
	laterLabel: string;
	shareLabel: string;
	/** False when a scope cannot be described here: the buttons are withheld. */
	answerable: boolean;
}

/**
 * The card, drawn from the host's CARD READ (the thing whose digests the answer
 * echoes), not from the status summary: what the member reads must be what the
 * host signs, so a status that moved under an open sheet cannot change the text
 * above a stale digest.
 */
export function consentView(card: GuardConsentCard): ConsentView {
	const widened = card.widening || card.reason === "widened";
	const describable = allDescribable(card.asked_scopes);
	return {
		title: t("mobile.guard.prompt_title", { org: card.org }),
		reasonLine: promptReasonLine(card.reason, card.org, card.asked_scopes),
		wouldSend: t("mobile.guard.prompt_would_send"),
		scopeLines: orderedScopes(card.asked_scopes).map((scope) =>
			scopeLine(scope, card.org),
		),
		neverSent: t("mobile.guard.prompt_never_sent"),
		visibility: visibilityLine(card.asked_scopes),
		background: t("mobile.guard.prompt_background"),
		declineLabel: widened
			? t("mobile.guard.button_keep_current")
			: t("mobile.guard.button_dont_share"),
		laterLabel: t("mobile.guard.button_decide_later"),
		shareLabel: widened
			? t("mobile.guard.button_share_new")
			: t("mobile.guard.button_share"),
		answerable: describable && card.asked_scopes.length > 0 && card.signable,
	};
}

/* --------------------------------------------------------------- revoke */

/** The confirm body (§15.4' C2). The trace-detail sentence appears only when
 *  that scope is being shared AND the host measured the backup window; without
 *  the number the sentence cannot be written, so the plain one stands. */
export function revokeBody(org: GuardOrg, backupDays: number | null): string {
	if (org.scopes_shared.includes("trace_detail") && backupDays !== null) {
		return t("mobile.guard.revoke_body_trace", { backup_days: backupDays });
	}
	return t("mobile.guard.revoke_body");
}

/* ------------------------------------------------------------- non-Team */

export type NonTeamCta = "trial" | "see" | "ask_owner" | "none";

export interface NonTeamView {
	title: string;
	body: string;
	footer: string;
	cta: NonTeamCta;
	ctaLabel: string | null;
	/** The first-party URL the CTA opens, or null when it may not be opened. */
	url: string | null;
}

/** Only first-party, https Radient URLs are ever opened from this card. The host
 *  supplies the URL, and a CTA that opens an arbitrary scheme or host from a
 *  settings screen would be an open door for a misbehaving relay. */
export function safeTeamUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	try {
		const url = new URL(raw);
		const host = url.hostname.toLowerCase();
		const first = host === "radienthq.com" || host.endsWith(".radienthq.com");
		return url.protocol === "https:" && first ? url.toString() : null;
	} catch {
		return null;
	}
}

/**
 * The §14' non-Team card for a phone.
 *
 *  - owner → the card with the trial CTA (only when the host supplied a positive
 *    whole `trial_days`; the length is NEVER a literal here) else "See Radient
 *    Team";
 *  - admin → the card's title and body with "Ask your owner to upgrade" in place
 *    of the CTA (an admin cannot buy for the org);
 *  - member → nothing at all (`null`);
 *  - role not stated (a host that predates the optional role, as the L2c desktop
 *    plane is) → the core TUI's own behaviour: the card with its CTA.
 *
 * The footer is org-scoped when the host names the org (the reviewed core wording,
 * since the same account may share with a different Team org elsewhere) and the
 * RFC's account-level sentence otherwise.
 */
export function nonTeamView(
	status: GuardStatus,
	card: GuardNonTeamCard | null,
): NonTeamView | null {
	if (status.mode !== "non_team") return null;
	const role = card?.role ?? status.non_team?.role ?? null;
	if (role === "member") return null;
	const org = card?.org ?? status.non_team?.org ?? null;
	const days = card?.trial_days ?? null;
	const url = safeTeamUrl(card?.url ?? status.non_team?.url ?? status.team_url);
	const footer =
		org === null || org === ""
			? t("mobile.guard.card_footer_account")
			: t("mobile.guard.card_footer", { org });
	const base = {
		title: t("mobile.guard.card_title"),
		body: t("mobile.guard.card_body"),
		footer,
	};
	if (role === "admin") {
		return { ...base, cta: "ask_owner", ctaLabel: null, url: null };
	}
	if (url === null) return { ...base, cta: "none", ctaLabel: null, url: null };
	if (days !== null && days > 0) {
		return {
			...base,
			cta: "trial",
			ctaLabel: t("mobile.guard.card_cta_trial", { trial_days: String(days) }),
			url,
		};
	}
	return {
		...base,
		cta: "see",
		ctaLabel: t("mobile.guard.card_cta_see"),
		url,
	};
}

/* ----------------------------------------------------------------- outcome */

/** The result line under a write, in terms the screen keys to copy. */
export type GuardOutcome =
	| null
	| { kind: "shared" | "declined" | "revoked" | "share_again"; org: string }
	| { kind: "revoke_pending"; org: string }
	| { kind: "changed"; org: string }
	| { kind: "answered_elsewhere"; surface: string }
	| { kind: "failed"; org: string }
	| { kind: "card_unreadable"; org: string };

export interface OutcomeLine {
	text: string;
	/** `error` only for a write that did not land; a changed or answered-elsewhere
	 *  request is information, not a failure. */
	tone: "info" | "success" | "error";
}

/** The sentence under a write. Every one states what the HOST now says; none
 *  claims more than the host confirmed (a stop the server has not confirmed is
 *  "stopped on this computer", not "stopped"). */
export function outcomeLine(outcome: Exclude<GuardOutcome, null>): OutcomeLine {
	switch (outcome.kind) {
		case "shared":
			return {
				text: t("mobile.guard.screen_shared", { org: outcome.org }),
				tone: "success",
			};
		case "declined":
			return {
				text: t("mobile.guard.screen_declined", { org: outcome.org }),
				tone: "info",
			};
		case "revoked":
			return {
				text: t("mobile.guard.screen_revoked", { org: outcome.org }),
				tone: "success",
			};
		case "revoke_pending":
			return { text: t("mobile.guard.revoke_pending_result"), tone: "info" };
		case "share_again":
			return {
				text: t("mobile.guard.share_again_result", { org: outcome.org }),
				tone: "info",
			};
		case "changed":
			return {
				text: t("mobile.guard.screen_prompt_changed", { org: outcome.org }),
				tone: "info",
			};
		case "answered_elsewhere":
			return { text: answeredOnLine(outcome.surface), tone: "info" };
		case "failed":
			return { text: t("mobile.guard.screen_failed"), tone: "error" };
		case "card_unreadable":
			return { text: t("mobile.guard.load_error"), tone: "error" };
	}
}
