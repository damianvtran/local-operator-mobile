/**
 * Team Bridge render decisions, as pure functions.
 *
 * WHY THIS MODULE EXISTS. Every rule here has a desktop twin in
 * `local-operator-ui` (`src/renderer/src/features/team-bridge/team-bridge-model.ts`,
 * branch `feat/tb-direct-dm`). The phone mirrors that BEHAVIOUR, not its code:
 * the same eligibility ladder, the same title rule, the same "a person's row IS
 * their DM", the same same-sender runs. Keeping the rules here, free of React
 * Native, lets Node tests pin them (`vitest` cannot load a native renderer), and
 * keeps the list row and the thread header from disagreeing about what a
 * conversation is called.
 */

import type {
	Conversation,
	DirectoryMember,
	MemberInput,
	Message,
	Notify,
	Status,
	StatusTenant,
} from "@/team-bridge/contract";

/* -------------------------------------------------------------------------- */
/* Eligibility                                                                */
/* -------------------------------------------------------------------------- */

/** The one hub contract version this build implements (`bridge.APIVersion`). */
export const SUPPORTED_API_VERSION = 1;

/**
 * Why the surface cannot be used, or `null` when it can.
 *
 * THE DESKTOP'S LADDER, in its order (`teamBridgeEligibility`):
 *
 * 1. `signed_out`: no Radient credential. Signing in is the step that can be
 *    taken now, so it wins even if something else is also wrong.
 * 2. `update_required`: the hub speaks a contract version this build does not
 *    implement. The comparison is EXACT, the desktop client's rule
 *    (`SUPPORTED_API_VERSION`): a future number must stop visibly rather than be
 *    half-honoured.
 * 3. `unavailable`: the hub answered 503 `messaging_unavailable` (dark, killed,
 *    or a store failure; the hub does not say which, by design).
 * 4. `plan_required`: signed in and current, and NO organization is eligible.
 *    That is the desktop's surface state A: the organization's plan does not
 *    include Team Bridge.
 *
 * Anything else is eligible. This function may withhold the surface only when
 * the server says so; a status that has not answered yet is the caller's
 * loading state, not a gate.
 */
export type Eligibility =
	| "signed_out"
	| "update_required"
	| "unavailable"
	| "plan_required";

export type StatusRead =
	| { kind: "signed_out" }
	| { kind: "unavailable" }
	| { kind: "ok"; status: Status };

/** Hoisted: the version is a decimal string on the wire. */
const DECIMAL = /^\d+$/;

export function apiVersionSupported(raw: Status["api_version"]): boolean {
	const value =
		typeof raw === "number"
			? raw
			: DECIMAL.test(raw)
				? Number(raw)
				: Number.NaN;
	return value === SUPPORTED_API_VERSION;
}

export function eligibility(read: StatusRead): Eligibility | null {
	if (read.kind === "signed_out") return "signed_out";
	if (read.kind === "unavailable") return "unavailable";
	if (!apiVersionSupported(read.status.api_version)) return "update_required";
	if (!read.status.tenants.some((tenant) => tenant.eligible))
		return "plan_required";
	return null;
}

/* -------------------------------------------------------------------------- */
/* Organizations                                                              */
/* -------------------------------------------------------------------------- */

export type Organization = {
	tenantId: string;
	name: string;
	eligible: boolean;
	/** Retained read-only history: a lapsed or killed org still lists, never composes. */
	readOnly: boolean;
	unread: number;
};

/**
 * The switcher's rows: eligible organizations first, in the hub's order, then
 * retained (ineligible but endpoint-holding) ones as read-only.
 *
 * An ineligible org with NO endpoint is not listed. It has nothing to read, and
 * listing it would invite a tap that can only be refused.
 */
export function organizationsFrom(
	tenants: readonly StatusTenant[],
	unreadByTenant: ReadonlyMap<string, number> = new Map(),
): Organization[] {
	const eligible: Organization[] = [];
	const retained: Organization[] = [];
	for (const tenant of tenants) {
		const row: Organization = {
			tenantId: tenant.tenant_id,
			name: tenant.tenant_name.trim() || "Unnamed organization",
			eligible: tenant.eligible,
			readOnly: !tenant.eligible,
			unread: unreadByTenant.get(tenant.tenant_id) ?? 0,
		};
		if (tenant.eligible) eligible.push(row);
		else if (tenant.endpoint) retained.push(row);
	}
	return [...eligible, ...retained];
}

/**
 * The organization to show: the remembered one if it is still listed, else the
 * first eligible one. A remembered id that the account lost membership of must
 * not resurrect a stale selection.
 */
export function preferredOrganization(
	organizations: readonly Organization[],
	remembered: string | null,
): Organization | null {
	if (remembered) {
		const hit = organizations.find((org) => org.tenantId === remembered);
		if (hit) return hit;
	}
	return organizations[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Conversations                                                              */
/* -------------------------------------------------------------------------- */

/** The label a participant or person row paints: never blank. */
export function displayLabel(label: string, fallback: string): string {
	return label.trim() || fallback;
}

/**
 * The name to render for a conversation, or `null` when nothing can name it.
 *
 * A named group/channel uses its name. A DM is named for the OTHER party (for
 * an agent party, its label), because "Direct message" as a title tells the
 * reader nothing. An unnamed group lists up to three members, capped so a large
 * group does not turn a row into a paragraph.
 */
export function conversationTitle(
	conversation: Conversation,
	selfAccountId: string | null,
): string | null {
	const name = conversation.name?.trim();
	if (name) return name;
	const others = conversation.members.filter(
		(member) =>
			member.state !== "removed" &&
			!(member.kind === "human" && member.account_id === selfAccountId),
	);
	if (conversation.kind === "dm") {
		const other =
			others.find((member) => member.state === "active") ?? others[0];
		const label = other?.display_label.trim();
		return label ? label : null;
	}
	const labels = others
		.filter((member) => member.state === "active")
		.map((member) => member.display_label.trim())
		.filter(Boolean);
	if (labels.length === 0) return null;
	if (labels.length <= 3) return labels.join(", ");
	return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

/** The reader's own notify policy, from the newer field or the legacy boolean. */
export function notifyOf(
	conversation: Pick<Conversation, "notify" | "muted">,
): Notify {
	if (conversation.notify) return conversation.notify;
	return conversation.muted ? "mute" : "all";
}

/**
 * Whether the row shows the bell-off glyph. `mention` shows it too: it is a
 * quieter register than `all`, and the reader set it on purpose.
 */
export const showsMutedGlyph = (
	conversation: Pick<Conversation, "notify" | "muted">,
): boolean => notifyOf(conversation) !== "all";

/**
 * The unread number a row paints. A muted conversation still has unread
 * messages, but Slack's rule (and the desktop's) is that muting removes the
 * BADGE: the row is bolded only by the count staying in the label, not by a
 * loud pill. `mention` keeps the count because a mention may be among them.
 */
export function rowUnread(
	conversation: Pick<Conversation, "unread_count" | "notify" | "muted">,
): { count: number; loud: boolean } {
	const notify = notifyOf(conversation);
	return {
		count: conversation.unread_count,
		loud: conversation.unread_count > 0 && notify !== "mute",
	};
}

/**
 * Whether the caller is previewing a discoverable channel they have not joined.
 * An EXPLICIT pair only: absence means "this server cannot say".
 */
export const isPreview = (
	conversation: Pick<Conversation, "discoverable" | "member">,
): boolean =>
	conversation.discoverable === true && conversation.member === false;

/** Built-in channels first, in this order (agent-server built-in slice). */
const BUILTIN_ORDER = ["humans", "agents"];

export type Sections = {
	channels: Conversation[];
	groups: Conversation[];
	/** DMs the directory will not paint (a person no longer listed, an agent DM
	 *  with no chief-of-staff row). Listed so a conversation is never hidden. */
	directs: Conversation[];
};

/**
 * Split one organization's conversations into Slack's sections.
 *
 * Built-ins lead the channels in a fixed order; everything else keeps the hub's
 * activity order. Archived rows are left out: they are history put away, not a
 * live thread. DMs go to `directs` and the screen folds the ones a People or
 * Chiefs-of-staff row already represents (`dmWithPerson`, `dmWithAgent`).
 */
export function sections(rows: readonly Conversation[]): Sections {
	const builtins: Conversation[] = [];
	const channels: Conversation[] = [];
	const groups: Conversation[] = [];
	const directs: Conversation[] = [];
	for (const row of rows) {
		if (row.status === "archived") continue;
		if (row.kind === "channel") {
			if (row.builtin && BUILTIN_ORDER.includes(row.builtin))
				builtins.push(row);
			else channels.push(row);
		} else if (row.kind === "group") groups.push(row);
		else directs.push(row);
	}
	builtins.sort(
		(a, b) =>
			BUILTIN_ORDER.indexOf(a.builtin as string) -
			BUILTIN_ORDER.indexOf(b.builtin as string),
	);
	return { channels: [...builtins, ...channels], groups, directs };
}

/** Most recent activity first; id breaks ties so the order is stable. */
function byActivity(a: Conversation, b: Conversation): number {
	const delta = Date.parse(b.last_message_at) - Date.parse(a.last_message_at);
	if (delta !== 0 && !Number.isNaN(delta)) return delta;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The live DM between the reader and one PERSON, if it exists.
 *
 * HUMAN members only: an agent member carries its OWNER's account id, so without
 * the kind check a DM with Ben's chief of staff would open from Ben's row. When
 * the reader's own id is known they must be a member too. The most recently
 * active match wins.
 */
export function dmWithPerson(
	conversations: readonly Conversation[],
	accountId: string,
	selfAccountId: string | null,
): Conversation | null {
	const hits = conversations.filter((conversation) => {
		if (conversation.kind !== "dm" || conversation.status === "archived")
			return false;
		const humans = conversation.members.filter(
			(member) => member.kind === "human" && member.state !== "removed",
		);
		if (conversation.members.some((member) => member.kind === "agent"))
			return false;
		const hasTarget = humans.some((member) => member.account_id === accountId);
		const hasSelf =
			selfAccountId === null ||
			humans.some((member) => member.account_id === selfAccountId);
		return hasTarget && hasSelf;
	});
	return [...hits].sort(byActivity)[0] ?? null;
}

/**
 * The live DM between the reader and one person's AGENT, if it exists. Matched
 * on the agent member's owner account id: the participant view withholds other
 * members' endpoint ids, and a person has exactly one chief of staff per org.
 */
export function dmWithAgent(
	conversations: readonly Conversation[],
	ownerAccountId: string,
): Conversation | null {
	const hits = conversations.filter(
		(conversation) =>
			conversation.kind === "dm" &&
			conversation.status !== "archived" &&
			conversation.members.some(
				(member) =>
					member.kind === "agent" &&
					member.account_id === ownerAccountId &&
					member.state !== "removed",
			),
	);
	return [...hits].sort(byActivity)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* People and chiefs of staff                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How one People row behaves.
 *
 * `self` is shown as "you" and is not a control. `unavailable` is a person
 * whose bridge is off: visible (the reader sees who could be reachable) but
 * dimmed and inert, with the reason. `paused` is still OPENABLE: a paused bridge
 * keeps its history. An enabled bit beside `none`/`disabled` is inconsistent and
 * fails closed.
 */
export type PersonRowState = "self" | "openable" | "paused" | "unavailable";

export function personRowState(
	member: Pick<
		DirectoryMember,
		"account_id" | "bridge_enabled" | "bridge_state"
	>,
	selfAccountId: string | null,
): PersonRowState {
	if (selfAccountId && member.account_id === selfAccountId) return "self";
	const reachable =
		member.bridge_enabled &&
		(member.bridge_state === "active" || member.bridge_state === "paused");
	if (!reachable) return "unavailable";
	return member.bridge_state === "paused" ? "paused" : "openable";
}

/** The sentence a dimmed People row carries, by its state. */
export function personReason(state: PersonRowState): string | null {
	if (state === "unavailable") return "Hasn’t turned on Team Bridge yet";
	if (state === "paused") return "Paused";
	return null;
}

export function personLabel(
	member: Pick<DirectoryMember, "account_id" | "display_label">,
): string {
	return displayLabel(member.display_label, "Former member");
}

export type ChiefOfStaff = {
	person: DirectoryMember;
	endpointId: string;
	agentName: string;
	paused: boolean;
	/** "{agent} ({person})", the desktop's `chief.label`. */
	label: string;
};

/**
 * Every OTHER person's chief of staff whose agent is enrolled and not disabled.
 * The reader's own is excluded: talking to your own agent is the chat surface's
 * job. Only present when the hub publishes the directory `agent` object (the CoS
 * directory slice); an older hub yields an empty section, which the screen says.
 */
export function chiefsOfStaff(
	people: readonly DirectoryMember[],
	selfAccountId: string | null,
): ChiefOfStaff[] {
	const chiefs: ChiefOfStaff[] = [];
	for (const person of people) {
		if (selfAccountId && person.account_id === selfAccountId) continue;
		const agent = person.agent;
		if (!agent || agent.state === "disabled") continue;
		const agentName = agent.name.trim() || "Chief of staff";
		chiefs.push({
			person,
			endpointId: agent.endpoint_id,
			agentName,
			paused: agent.state === "paused",
			label: `${agentName} (${personLabel(person)})`,
		});
	}
	return chiefs;
}

/**
 * The name to paint for a message sender. The directory is the LIVE name, so it
 * wins over the label stored at add time. An agent is "{agent} ({person})".
 */
export function senderLabel(
	sender: Message["sender"],
	people: readonly DirectoryMember[],
): string {
	const person = people.find((row) => row.account_id === sender.account_id);
	const personName = person ? personLabel(person) : null;
	if (sender.kind === "human") {
		return personName ?? displayLabel(sender.display_label, "Former member");
	}
	const agentName =
		person?.agent?.name.trim() || displayLabel(sender.display_label, "Agent");
	return personName ? `${agentName} (${personName})` : agentName;
}

/* -------------------------------------------------------------------------- */
/* Targets: what a tapped row opens                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the thread screen is about. A person or chief-of-staff row whose DM does
 * not exist yet is a DRAFT target: the thread opens empty with the composer, and
 * the conversation is created on FIRST SEND (the desktop's rule), so opening a
 * row never leaves an empty DM behind.
 */
export type Target =
	| { kind: "conversation"; tenantId: string; conversationId: string }
	| {
			kind: "person";
			tenantId: string;
			accountId: string;
			label: string;
	  }
	| {
			kind: "agent";
			tenantId: string;
			ownerAccountId: string;
			endpointId: string;
			label: string;
	  };

/** The create body for a draft's first send. */
export function draftCreateInput(
	target: Exclude<Target, { kind: "conversation" }>,
): { kind: "dm"; agentCapable: boolean; members: MemberInput[] } {
	if (target.kind === "person") {
		return {
			kind: "dm",
			agentCapable: false,
			members: [
				{
					account_id: target.accountId,
					kind: "human",
					display_label: target.label.slice(0, 64),
				},
			],
		};
	}
	return {
		kind: "dm",
		agentCapable: true,
		members: [
			{
				account_id: target.ownerAccountId,
				kind: "agent",
				endpoint_id: target.endpointId,
				display_label: target.label.slice(0, 64),
			},
		],
	};
}

/* -------------------------------------------------------------------------- */
/* Thread rows                                                                */
/* -------------------------------------------------------------------------- */

export type ThreadItem =
	| { type: "day"; key: string; label: string }
	| { type: "message"; key: string; message: Message; continuation: boolean };

/** Slack's run window: a same-sender follow-up within it skips the header. */
export const RUN_WINDOW_MS = 5 * 60_000;

const dayKey = (date: Date): string =>
	`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** The day divider's words: Today, Yesterday, or a dated label. */
export function dayLabel(date: Date, now: Date, locale?: string): string {
	const today = dayKey(now);
	const yesterday = dayKey(
		new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
	);
	const key = dayKey(date);
	if (key === today) return "Today";
	if (key === yesterday) return "Yesterday";
	const sameYear = date.getFullYear() === now.getFullYear();
	return date.toLocaleDateString(locale, {
		weekday: "long",
		month: "long",
		day: "numeric",
		...(sameYear ? {} : { year: "numeric" }),
	});
}

/** Oldest first, by seq (the hub's order of record), id as a tiebreak. */
export function chronological(messages: readonly Message[]): Message[] {
	return [...messages].sort(
		(a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
}

/**
 * The thread as rows: a divider per calendar day, and same-sender runs.
 *
 * A message CONTINUES a run when the previous row is the same sender (same
 * account AND kind: a person and their own agent are different speakers), on
 * the same day, within five minutes. An unparseable time never continues a run
 * and gets no divider, so a bad timestamp cannot glue two speakers together.
 */
export function threadItems(
	messages: readonly Message[],
	now: Date,
	locale?: string,
): ThreadItem[] {
	const items: ThreadItem[] = [];
	let previous: Message | null = null;
	let previousDay: string | null = null;
	for (const message of chronological(messages)) {
		const at = new Date(message.created_at);
		const valid = !Number.isNaN(at.getTime());
		const day = valid ? dayKey(at) : null;
		if (day !== null && day !== previousDay) {
			items.push({
				type: "day",
				key: `day:${day}`,
				label: dayLabel(at, now, locale),
			});
		}
		const continuation =
			previous !== null &&
			valid &&
			day === previousDay &&
			previous.sender.account_id === message.sender.account_id &&
			previous.sender.kind === message.sender.kind &&
			at.getTime() - Date.parse(previous.created_at) < RUN_WINDOW_MS;
		items.push({ type: "message", key: message.id, message, continuation });
		previous = message;
		if (day !== null) previousDay = day;
	}
	return items;
}

/**
 * Merge a page into what the thread already holds: deduplicated by id (a
 * refresh overlaps the tail; an optimistic send is replaced by its stored
 * twin), oldest first.
 */
export function mergeMessages(
	held: readonly Message[],
	incoming: readonly Message[],
): Message[] {
	const byId = new Map<string, Message>();
	for (const message of held) byId.set(message.id, message);
	for (const message of incoming) byId.set(message.id, message);
	return chronological([...byId.values()]);
}

/** The time a message row shows: hour and minute, the reader's locale. */
export function messageTime(iso: string, locale?: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return "";
	return at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** A short relative stamp for a list row ("now", "5m", "3h", "2d", or a date). */
export function rowStamp(iso: string, now: Date, locale?: string): string {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return "";
	const minutes = Math.floor((now.getTime() - at) / 60_000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	return new Date(at).toLocaleDateString(locale, {
		month: "short",
		day: "numeric",
	});
}

/**
 * A client ref for one send: unique per attempt the READER makes, reused on an
 * automatic retry of that same attempt. The hub dedupes on it, so a dropped
 * response retried with the same ref never posts twice.
 */
export function newClientRef(random: () => number = Math.random): string {
	const part = () =>
		Math.floor(random() * 0x1_0000_0000)
			.toString(16)
			.padStart(8, "0");
	return `m-${Date.now().toString(36)}-${part()}${part()}`;
}
