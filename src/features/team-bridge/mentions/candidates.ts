/**
 * Who the Team Bridge composer can @-mention, built ONLY from data the screen
 * already holds.
 *
 * WHY NO FETCH. The suggestion strip must open on the `@` keystroke, in the
 * same frame. The organization directory (`orgs[tenantId].people`, cached by
 * the store for `DIRECTORY_TTL_MS` and kept on a 429 or any other error) and
 * the open conversation's `members` are already in memory, so the candidate
 * list is a pure projection of the two and costs no request. That matters
 * twice over here: the directory route draws on the hub's shared per-account
 * "reads" bucket (120/min across desktop and phone), which is what produced
 * the raw 429 banner fixed in #297. A directory that has never answered still
 * offers the conversation's own members by their participant labels.
 *
 * Mirrors desktop `buildMentionCandidates` (local-operator-ui
 * `src/renderer/src/features/team-bridge/mentions/candidates.ts` @ 3786d6e8fb)
 * on mobile's own labels: a person is `personLabel`, an agent is
 * "{agent} ({owner})" (`mobile.team_bridge.profile.name_with_owner`), the same
 * name the People list, the chiefs-of-staff section and message rows show, so
 * the name inserted after `@` is the one the reader sees everywhere else.
 */
import { t } from "@/i18n";
import type {
	Conversation,
	DirectoryMember,
	Participant,
} from "@/team-bridge/contract";
import { personLabel, personRowState } from "@/team-bridge/model";
import type { MentionCandidate } from "./matcher";

/** A candidate plus the directory row its avatar is drawn from. */
export type MentionCandidateRow = MentionCandidate & {
	profile?: DirectoryMember;
};

/** `kind:account_id`, the key the hub resolves `mentions[]` rows by. */
export const memberKey = (kind: "human" | "agent", accountId: string) =>
	`${kind}:${accountId}`;

/*
 * ACTIVE AND INVITED ARE DIFFERENT FACTS HERE. The hub resolves `mentions[]`
 * against ACTIVE members only and refuses the WHOLE message for any other row
 * (`not_a_member`, or `inactive` for an invited or departed member). So an
 * invited member is offered like a non-member (inserted as text, with a
 * notice) and is never serialized until a refetch shows them active.
 */
export function memberKeys(
	members: readonly Participant[] | undefined,
	state: "active" | "invited",
): ReadonlySet<string> {
	return new Set(
		(members ?? [])
			.filter((m) => m.state === state)
			.map((m) => memberKey(m.kind, m.account_id)),
	);
}

const agentLabel = (agent: string, owner: string) =>
	t("mobile.team_bridge.profile.name_with_owner", { agent, owner });

export function buildMentionCandidates(input: {
	conversation: Pick<Conversation, "members"> | null | undefined;
	people: readonly DirectoryMember[];
	selfAccountId: string | null;
}): MentionCandidateRow[] {
	const { conversation, people, selfAccountId } = input;
	const members = memberKeys(conversation?.members, "active");
	const invited = memberKeys(conversation?.members, "invited");
	const rows: MentionCandidateRow[] = [];
	const seen = new Set<string>();
	for (const person of people) {
		// A person with no name cannot be typed after `@` ("Former member" is a
		// placeholder, not a name), so neither they nor their agent is offered.
		const named = person.display_label.trim() !== "";
		if (!named) continue;
		const owner = personLabel(person);
		const state = personRowState(person, selfAccountId);
		const personOff = state === "unavailable";
		/*
		 * The reader's own human row is left out: mentioning yourself notifies
		 * nobody and only adds a row above the people the reader is looking for.
		 * Their own AGENT stays, because addressing it is a real action.
		 */
		if (state !== "self") {
			const key = memberKey("human", person.account_id);
			seen.add(key);
			rows.push({
				kind: "human",
				accountId: person.account_id,
				label: owner,
				secondary: person.profile?.title || undefined,
				member: members.has(key),
				invited: invited.has(key),
				bridgeOff: personOff,
				profile: person,
			});
		}
		const agent = person.agent;
		if (!agent) continue;
		const key = memberKey("agent", person.account_id);
		seen.add(key);
		const agentName = agent.name.trim();
		rows.push({
			kind: "agent",
			accountId: person.account_id,
			endpointId: agent.endpoint_id,
			// The chiefs-of-staff section's own fallback for an unnamed agent.
			label: agentLabel(
				agentName || t("mobile.team_bridge.profile.chief"),
				owner,
			),
			// "@ben" finds Ben's agent too; "@aida" finds it by its own name.
			aliases: [agentName, owner].filter((name) => name !== ""),
			/*
			 * The label already names the owner, so the second line states the
			 * ROLE, and only when the label does not already say it (desktop
			 * design N3): an unnamed agent is labelled "Chief of staff (Ben)".
			 */
			secondary: agentName ? t("mobile.team_bridge.profile.chief") : undefined,
			member: members.has(key),
			invited: invited.has(key),
			bridgeOff:
				personOff || !(agent.state === "active" || agent.state === "paused"),
			profile: person,
		});
	}
	/*
	 * Members the directory does not list (it has not answered yet, or a guest
	 * from another organization) are still in the room, so they are offered by
	 * their participant label. A participant row carries no endpoint id, so an
	 * agent offered this way inserts as text and is left out of `mentions[]`
	 * (`serializeMentions` drops an agent without one), never sent as a row the
	 * hub would refuse.
	 */
	for (const member of conversation?.members ?? []) {
		const key = memberKey(member.kind, member.account_id);
		if (seen.has(key) || !(members.has(key) || invited.has(key))) continue;
		if (member.kind === "human" && member.account_id === selfAccountId)
			continue;
		const label = member.display_label.trim();
		if (label === "") continue;
		seen.add(key);
		const endpoint = (member as { endpoint_id?: unknown }).endpoint_id;
		rows.push({
			kind: member.kind,
			accountId: member.account_id,
			...(member.kind === "agent" && typeof endpoint === "string"
				? { endpointId: endpoint }
				: {}),
			label,
			...(member.kind === "agent"
				? { secondary: t("mobile.team_bridge.profile.chief") }
				: {}),
			member: members.has(key),
			invited: invited.has(key),
			bridgeOff: false,
		});
	}
	return rows;
}

/**
 * Whether picking this candidate produces a NOTIFYING mention: an active
 * member the hub can resolve. A non-member, an invited member, or an agent
 * with no endpoint still gets the name in the text, but no wire row.
 */
export function notifiable(candidate: MentionCandidate): boolean {
	return (
		candidate.member && (candidate.kind !== "agent" || !!candidate.endpointId)
	);
}
