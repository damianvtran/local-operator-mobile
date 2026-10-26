/**
 * The Team Bridge profile card, as pure rules: what the card says about a
 * person or their agent, and where its "Message" action goes.
 *
 * Mirrors the desktop's card (local-operator-ui v0.44.0,
 * `team-bridge-profile-card.tsx`), adapted to a phone: a tap opens a sheet
 * instead of a hover opening a popover. Kept free of React Native so every
 * rule is a Node unit test's subject (`vitest.config.ts`).
 *
 * WHAT IS NEVER SHOWN. Pronouns: the hub publishes them, and this app
 * deliberately shows them nowhere (a product decision). The contract schema
 * strips the key at parse time (`accountProfileSchema`), and this model has
 * no field to carry it, so no card can render it even from a hand-built row.
 */

import type { Conversation, DirectoryMember } from "@/team-bridge/contract";
import * as model from "@/team-bridge/model";

/** Who the card is about: the person, or the person's chief of staff. */
export type ProfileSubject = {
	person: DirectoryMember;
	/** `true` for the person's agent (their directory `agent`). */
	agent: boolean;
};

export type ProfileCard = {
	/** The heading. A person's resolved label; an agent's "Aida (Ben)". */
	name: string;
	/**
	 * What the photo's initials are taken from: the agent's OWN name for an
	 * agent, since "Aida (Ben)" would give "A(" (the parenthesis is a word to
	 * `initialsOf`).
	 */
	markLabel: string;
	kind: "human" | "agent";
	/** The badge's word. */
	badge: string;
	/** For an agent, its role line ("Chief of staff"). `null` for a person. */
	owner: string | null;
	/**
	 * The heading over the title/description/local-time group on an AGENT card,
	 * where those details are the OWNER's (§7: an agent shows its owner's
	 * profile). Without it the owner's job title reads as the agent's. `null`
	 * for a person, whose details are their own.
	 */
	detailsLabel: string | null;
	title: string | null;
	description: string | null;
	/** The person's wall-clock time, or `null` when no usable zone is known. */
	localTime: string | null;
};

/**
 * The person's local time in their own zone, or `null`.
 *
 * `null` rather than the reader's clock when the zone is missing OR invalid
 * (an IANA name this runtime's ICU does not know, or a hand-edited row):
 * showing the reader's own time under someone else's name would be a wrong
 * answer stated confidently.
 */
export function localTime(
	timezone: string | undefined | null,
	now: Date,
	locale?: string,
): string | null {
	const zone = timezone?.trim();
	if (!zone) return null;
	try {
		return new Intl.DateTimeFormat(locale, {
			timeZone: zone,
			hour: "numeric",
			minute: "2-digit",
		}).format(now);
	} catch {
		return null;
	}
}

const present = (value: string | undefined): string | null =>
	value?.trim() ? value.trim() : null;

/**
 * What a subject's initials are taken from: an agent's OWN name, a person's
 * resolved label. "Aida (Ben)" would give "A(", because `initialsOf` reads the
 * parenthesis as a word.
 */
export function subjectMarkLabel(subject: ProfileSubject): string {
	return subject.agent
		? subject.person.agent?.name.trim() || "Chief of staff"
		: model.personLabel(subject.person);
}

/**
 * What the card shows for one subject.
 *
 * The name is the directory's `display_label`, which the hub already resolved
 * (profile display name, then provider name, then email local-part:
 * agent-server `docs/ACCOUNT-PROFILE.md` §5), so the card and the row can
 * never disagree. An agent shows its own name with its owner's, and its
 * owner's details (§7: "Agents show the owner's profile plus their own
 * agent.name").
 */
export function profileCard(
	subject: ProfileSubject,
	now: Date,
	locale?: string,
): ProfileCard {
	const { person } = subject;
	const personName = model.personLabel(person);
	const profile = person.profile;
	const agentName = subject.agent
		? person.agent?.name.trim() || "Chief of staff"
		: null;
	return {
		name: agentName ? `${agentName} (${personName})` : personName,
		markLabel: subjectMarkLabel(subject),
		kind: agentName ? "agent" : "human",
		badge: agentName ? "Agent" : "Person",
		/* Just the role: the heading already reads "Agent (Owner)" and the
		 * details sit under "About {owner}", so naming the owner a third time
		 * pushed their details below the fold for long names (design D8). */
		owner: agentName ? "Chief of staff" : null,
		detailsLabel: agentName ? `About ${personName}` : null,
		title: present(profile?.title),
		description: present(profile?.description),
		localTime: localTime(profile?.timezone, now, locale),
	};
}

/**
 * Where the card's "Message" action goes, or `null` when it offers none.
 *
 * Exactly the rule the People and Chiefs of staff rows already apply: an
 * existing DM opens, otherwise a DRAFT target opens the thread empty and the
 * DM is created on first send by the existing path. Nothing here creates a
 * conversation. No action for yourself, a person whose bridge is off, or an
 * agent that is disabled or absent.
 */
export function profileMessageTarget(
	subject: ProfileSubject,
	conversations: readonly Conversation[],
	selfAccountId: string | null,
	tenantId: string,
): model.Target | null {
	const { person } = subject;
	if (subject.agent) {
		const chief = model.chiefsOfStaff([person], selfAccountId)[0];
		if (!chief) return null;
		const dm = model.dmWithAgent(conversations, person.account_id);
		return dm
			? { kind: "conversation", tenantId: dm.tenant_id, conversationId: dm.id }
			: {
					kind: "agent",
					tenantId,
					ownerAccountId: person.account_id,
					endpointId: chief.endpointId,
					label: chief.label,
				};
	}
	const state = model.personRowState(person, selfAccountId);
	if (state !== "openable" && state !== "paused") return null;
	const dm = model.dmWithPerson(
		conversations,
		person.account_id,
		selfAccountId,
	);
	return dm
		? { kind: "conversation", tenantId: dm.tenant_id, conversationId: dm.id }
		: {
				kind: "person",
				tenantId,
				accountId: person.account_id,
				label: model.personLabel(person),
			};
}

/**
 * Who a DM row is with, for its photo and card: the other party's directory
 * row (an agent party is matched on its owner's account, the same rule as
 * `dmWithAgent`). `null` for channels, groups, and a party the directory does
 * not know, which keep their initials.
 */
export function dmSubject(
	conversation: Conversation,
	people: readonly DirectoryMember[],
	selfAccountId: string | null,
): ProfileSubject | null {
	if (conversation.kind !== "dm") return null;
	const other = conversation.members.find(
		(member) =>
			member.state !== "removed" &&
			!(member.kind === "human" && member.account_id === selfAccountId),
	);
	return other ? senderSubject(other, people) : null;
}

/**
 * The directory row a message sender is, and whether the card is about their
 * agent. `null` when the directory does not know them (a former member): the
 * row then renders as before, with no card to open.
 */
export function senderSubject(
	sender: { account_id: string; kind: "human" | "agent" },
	people: readonly DirectoryMember[],
): ProfileSubject | null {
	const person = people.find((row) => row.account_id === sender.account_id);
	if (!person) return null;
	return { person, agent: sender.kind === "agent" };
}
