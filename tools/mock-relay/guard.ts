/**
 * The mock relay's Radient Guard twin (`/api/guard*`): the routes the phone's
 * Guard surfaces call, with the HOST's own rules rather than a canned answer.
 *
 * WHY A STORE. The claims worth photographing and testing are transitions: a
 * "Share" on the card turns a waiting org into a sharing one (and only because
 * the host, here this store, said so); a "Don't share" does not; a stop is
 * sticky; a digest the host did not queue is refused with nothing recorded. A
 * canned body would make "it is sharing now" a claim about a constant.
 *
 * WHAT IT IS NOT. It is not a capture of a real host. The relay twin does not
 * exist in Local Operator yet (`docs/guard.md` is the contract proposed for it),
 * and L2c's desktop routes it mirrors are not implemented either, so every
 * frame and test that uses this store is labelled SYNTHETIC. Org names are
 * placeholders (the repository is public).
 *
 * The store records every request it serves (`log`) so a test can assert what
 * the phone sent — most importantly that a non-Team account makes no Guard
 * write and that an answer carries exactly the two digests.
 */

import type { Json } from "../lib/json.ts";

export interface GuardSeed {
	/** The `GET /api/guard` body. */
	status: Record<string, Json>;
	/** The consent card for the seeded waiting org, if any. */
	card?: Record<string, Json>;
	/** The `GET /api/guard/non-team-card` body. */
	nonTeamCard?: Record<string, Json>;
	/** Make accept/decline fail as a dropped connection would after the host
	 *  acted (the answer lands, the response is lost). */
	dropAnswerResponse?: boolean;
}

export interface GuardReply {
	status: number;
	body: Json;
}

export interface GuardLogEntry {
	method: string;
	path: string;
	body: Json | undefined;
}

type Org = Record<string, Json> & { tenant: string };

export interface GuardStore {
	log: GuardLogEntry[];
	handle(
		method: string,
		pathname: string,
		body: Json | undefined,
	): GuardReply | null;
}

const refuse = (status: number, code: string, error: string): GuardReply => ({
	status,
	body: { code, error },
});

export function createGuardStore(seed: GuardSeed): GuardStore {
	const state = structuredClone(seed) as GuardSeed;
	const log: GuardLogEntry[] = [];
	const orgs = (): Org[] => (state.status.orgs ?? []) as unknown as Org[];
	const orgFor = (tenant: string): Org | undefined =>
		orgs().find((org) => org.tenant === tenant);

	const settle = (org: Org, patch: Record<string, Json>) => {
		Object.assign(org, patch);
		state.status.badge = orgs().some((o) => o.prompt != null)
			? "waiting"
			: orgs().some((o) => o.state === "sharing")
				? "sharing"
				: "";
	};

	return {
		log,
		handle(
			method: string,
			pathname: string,
			body: Json | undefined,
		): GuardReply | null {
			if (!pathname.startsWith("/api/guard")) return null;
			log.push({ method, path: pathname, body });
			if (pathname === "/api/guard" && method === "GET")
				return { status: 200, body: state.status as Json };
			if (pathname === "/api/guard/non-team-card" && method === "GET") {
				if (state.status.mode !== "non_team")
					return refuse(404, "guard_not_applicable", "not applicable");
				return {
					status: 200,
					body: (state.nonTeamCard ?? {
						trial_days: null,
						org: null,
						url: "https://console.radienthq.com/dashboard/team",
					}) as Json,
				};
			}
			const consent =
				/^\/api\/guard\/consents\/([^/]+)(?:\/(accept|decline))?$/.exec(
					pathname,
				);
			if (consent) {
				const [, id = "", verb] = consent;
				const card = state.card;
				const waiting = orgs().find(
					(o) => (o.prompt as Record<string, Json> | null)?.approval_id === id,
				);
				// The card is KEPT after it is answered (host parity, L2d
				// `guard-relay-twin.md` §1): only an id the host never filed is a 404.
				if (!card || card.approval_id !== id)
					return refuse(404, "approval_not_found", "no such request");
				const settled = card.state !== "requested";
				if (!verb && method === "GET")
					return { status: 200, body: card as Json };
				// A repeat answer to a settled card is the host's 409, not a 404: the
				// phone must read "someone answered first", not "no such request".
				if (verb && method === "POST" && settled)
					return refuse(
						409,
						"approval_decision_conflict",
						"this request was already answered",
					);
				if (!waiting)
					return refuse(404, "approval_not_found", "no such request");
				if (verb === "accept" && method === "POST") {
					const keys = Object.keys((body ?? {}) as object).sort();
					if (keys.join() !== "disclosure_digest,request_digest")
						return refuse(422, "invalid_body", "closed body: two digests only");
					const sent = body as Record<string, Json>;
					if (
						sent.request_digest !== card.request_digest ||
						sent.disclosure_digest !== card.disclosure_digest
					)
						return refuse(
							409,
							"guard_consent_expected_mismatch",
							"this is not the reviewed Guard card",
						);
					settle(waiting, {
						state: "sharing",
						scopes_shared:
							(waiting.prompt as Record<string, Json>).grant_scopes ?? [],
						prompt: null,
						answered_via: "mobile",
						can_revoke: true,
					});
					Object.assign(card, { state: "granted", signable: false });
					return {
						status: state.dropAnswerResponse ? 503 : 200,
						body: { approval_id: id, state: "granted", tenant: waiting.tenant },
					};
				}
				if (verb === "decline" && method === "POST") {
					// Host parity (UX U2): declining a request to COLLECT MORE ("Keep
					// current") keeps sharing what was already agreed; only declining a
					// first request leaves the org not sharing. The twin used to settle
					// both to `not_sharing`, so the phone's wrong "Not sharing" line
					// could not be seen against it.
					const widening =
						(waiting.prompt as Record<string, Json> | null)?.widening ===
							true || card.widening === true;
					settle(
						waiting,
						widening
							? { state: "sharing", prompt: null, answered_via: "mobile" }
							: {
									state: "not_sharing",
									prompt: null,
									answered_via: "mobile",
									can_share_again: true,
								},
					);
					Object.assign(card, { state: "denied", signable: false });
					return {
						status: state.dropAnswerResponse ? 503 : 200,
						body: { approval_id: id, state: "denied", tenant: waiting.tenant },
					};
				}
			}
			const act = /^\/api\/guard\/orgs\/([^/]+)\/(revoke|share-again)$/.exec(
				pathname,
			);
			if (act && method === "POST") {
				const org = orgFor(decodeURIComponent(act[1] ?? ""));
				if (!org) return refuse(404, "guard_org_unknown", "unknown org");
				if (act[2] === "revoke") {
					if (!org.can_revoke)
						return refuse(409, "guard_not_sharing", "nothing to stop");
					settle(org, {
						state: "paused",
						reason: "scope_revoked",
						scopes_shared: [],
						can_revoke: false,
						can_share_again: true,
					});
					return {
						status: 200,
						body: {
							tenant: org.tenant,
							status: "revoked",
							code: "",
							org: org as Json,
						},
					};
				}
				if (!org.can_share_again)
					return refuse(409, "guard_not_stopped", "not stopped");
				settle(org, { state: "will_ask", reason: "", can_share_again: false });
				return { status: 200, body: { tenant: org.tenant, org: org as Json } };
			}
			return refuse(404, "not_found", "no such Guard route");
		},
	};
}

/* ------------------------------------------------------------------ seeds -- */

const TENANT = "tenant_example_1";
const APPROVAL = "req_EXAMPLE0001";
const TEAM_URL = "https://console.radienthq.com/dashboard/team";
const sha = (c: string) => `sha256:${c.repeat(64)}`;

const baseOrg = {
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
};

const baseStatus = {
	mode: "orgs",
	badge: "",
	orgs: [],
	reports: [],
	notices: [],
	insights: [],
	non_team: null,
	backup_days: 31,
	this_computer: "Example Mac",
	can_answer: true,
	team_url: TEAM_URL,
};

const newOrgPrompt = {
	approval_id: APPROVAL,
	collection_rev: 7,
	reason: "new_org",
	widening: false,
	asked_scopes: ["decisions", "posture", "task_time", "review_cycles"],
	grant_scopes: ["decisions", "posture", "task_time", "review_cycles"],
};

const newOrgCard = {
	approval_id: APPROVAL,
	state: "requested",
	tenant: TENANT,
	org: "Example Org",
	reason: "new_org",
	widening: false,
	asked_scopes: ["decisions", "posture", "task_time", "review_cycles"],
	request_digest: sha("a"),
	disclosure_digest: sha("b"),
	signable: true,
};

/** Every Guard state the phone draws, as a scenario seed. */
export const GUARD_SEEDS: Record<
	string,
	{ description: string; seed: GuardSeed }
> = {
	"guard-waiting": {
		description:
			"A Team org turned Guard on: one first-grant request waiting (new_org). Nothing is shared yet.",
		seed: {
			status: {
				...baseStatus,
				badge: "waiting",
				orgs: [
					{
						...baseOrg,
						state: "waiting",
						scopes_shared: [],
						can_revoke: false,
						prompt: newOrgPrompt,
					},
				],
			},
			card: newOrgCard,
		},
	},
	"guard-widening": {
		description:
			"Sharing continues while the org asks to widen (admin_share added): 'new items waiting', never paused.",
		seed: {
			status: {
				...baseStatus,
				badge: "sharing_pending",
				orgs: [
					{
						...baseOrg,
						state: "sharing_pending",
						prompt: {
							...newOrgPrompt,
							reason: "widened",
							widening: true,
							asked_scopes: ["admin_share"],
							grant_scopes: ["decisions", "task_time", "admin_share"],
						},
					},
				],
			},
			card: {
				...newOrgCard,
				reason: "widened",
				widening: true,
				asked_scopes: ["admin_share"],
			},
		},
	},
	"guard-sharing": {
		description: "Sharing with one org: two scopes, a Stop sharing button.",
		seed: {
			status: { ...baseStatus, badge: "sharing", orgs: [baseOrg] },
		},
	},
	"guard-mixed": {
		description:
			"Three orgs in three stopped or waiting states: paused by the org, declined (Share again) and stopped from Console.",
		seed: {
			status: {
				...baseStatus,
				orgs: [
					{
						...baseOrg,
						tenant: "tenant_example_2",
						org: "Example Org Two",
						state: "paused",
						reason: "org_off",
						scopes_shared: [],
						can_revoke: false,
					},
					{
						...baseOrg,
						tenant: "tenant_example_3",
						org: "Example Org Three",
						state: "not_sharing",
						scopes_shared: [],
						can_revoke: false,
						can_share_again: true,
					},
					{
						...baseOrg,
						tenant: "tenant_example_4",
						org: "Example Org Four",
						state: "paused",
						reason: "console_revoked",
						since: 1_794_787_200,
						scopes_shared: [],
						can_revoke: false,
						can_share_again: true,
					},
				],
			},
		},
	},
	"guard-non-team-owner": {
		description:
			"A non-Team account, owner of its org, eligible for a 14-day trial: the card with the trial CTA.",
		seed: {
			status: {
				...baseStatus,
				mode: "non_team",
				non_team: { trial_days: null, org: null, url: TEAM_URL },
			},
			nonTeamCard: { trial_days: 14, org: null, url: TEAM_URL, role: "owner" },
		},
	},
	"guard-non-team-admin": {
		description:
			"A non-Team account, admin: the card with 'Ask your owner to upgrade' and no link.",
		seed: {
			status: {
				...baseStatus,
				mode: "non_team",
				non_team: { trial_days: null, org: null, url: TEAM_URL },
			},
			nonTeamCard: { trial_days: 14, org: null, url: TEAM_URL, role: "admin" },
		},
	},
	"guard-non-team-member": {
		description:
			"A non-Team account, plain member: nothing at all (no section, no card).",
		seed: {
			status: {
				...baseStatus,
				mode: "non_team",
				non_team: { trial_days: null, org: null, url: TEAM_URL },
			},
			nonTeamCard: {
				trial_days: null,
				org: null,
				url: TEAM_URL,
				role: "member",
			},
		},
	},
};
