/**
 * Synthetic Radient Guard answers, shared by the unit tests and the mock relay.
 *
 * Source of the shapes: the desktop plane's own models
 * (`local_operator/server/models/desktop_guard.py`, L2c) and the twin additions
 * written up in `docs/guard.md`. There is NO live capture: the relay twin
 * (`/api/guard*`) does not exist on a host yet, so these are fixtures, labelled
 * as such wherever they are used as evidence. Org names are obvious placeholders
 * (the repository is public).
 */

import type { Payload } from "@/contracts";

export type StatusFixture = Payload<"guardStatus">;
export type OrgFixture = StatusFixture["orgs"][number];
export type CardFixture = Payload<"guardConsentCard">;

export const TENANT = "tenant_example_1";
export const APPROVAL = "req_EXAMPLE0001";
export const DIGEST_A = `sha256:${"a".repeat(64)}`;
export const DIGEST_B = `sha256:${"b".repeat(64)}`;

export function org(over: Partial<OrgFixture> = {}): OrgFixture {
	return {
		tenant: TENANT,
		org: "Example Org",
		role: "member",
		state: "sharing",
		reason: "",
		since: null,
		answered_via: "",
		scopes_shared: ["decisions", "task_time"],
		prompt: null,
		can_revoke: true,
		can_share_again: false,
		...over,
	};
}

export function waitingOrg(over: Partial<OrgFixture> = {}): OrgFixture {
	return org({
		state: "waiting",
		scopes_shared: [],
		can_revoke: false,
		prompt: {
			approval_id: APPROVAL,
			collection_rev: 7,
			reason: "new_org",
			widening: false,
			asked_scopes: ["decisions", "posture", "task_time", "review_cycles"],
			grant_scopes: ["decisions", "posture", "task_time", "review_cycles"],
		},
		...over,
	});
}

export function status(over: Partial<StatusFixture> = {}): StatusFixture {
	return {
		mode: "orgs",
		badge: "",
		orgs: [org()],
		reports: [],
		notices: [],
		insights: [],
		non_team: null,
		backup_days: 31,
		this_computer: "Example Mac",
		can_answer: true,
		team_url: "https://console.radienthq.com/dashboard/team",
		...over,
	};
}

export function nonTeamStatus(
	over: Partial<StatusFixture> = {},
): StatusFixture {
	return status({
		mode: "non_team",
		orgs: [],
		non_team: {
			trial_days: null,
			org: null,
			url: "https://console.radienthq.com/dashboard/team",
		},
		...over,
	});
}

export function card(over: Partial<CardFixture> = {}): CardFixture {
	return {
		approval_id: APPROVAL,
		state: "requested",
		tenant: TENANT,
		org: "Example Org",
		reason: "new_org",
		widening: false,
		asked_scopes: ["decisions", "posture", "task_time", "review_cycles"],
		request_digest: DIGEST_A,
		disclosure_digest: DIGEST_B,
		signable: true,
		...over,
	};
}
