/**
 * Wire fixtures for the Team Bridge tests, shaped exactly as the hub's Go
 * structs serialize them (agent-server `internal/responses/bridge_conversation.go`,
 * `bridge.go`, origin/main 321a7be). Placeholder ids only, never a real account.
 */

import type {
	Conversation,
	DirectoryMember,
	Message,
	Status,
} from "../contract";

export const SELF = "acct_self_0001";
export const ADA = "acct_ada_0002";
export const BEN = "acct_ben_0003";
export const CY = "acct_cy_0004";
export const TENANT = "ten_0123456789abcdef";
export const OTHER_TENANT = "ten_fedcba9876543210";

export const status = (overrides: Partial<Status> = {}): Status => ({
	api_version: "1",
	available: true,
	tenants: [
		{
			tenant_id: TENANT,
			tenant_name: "Example Org",
			eligible: true,
			endpoint: { id: "bep_self", label: "Aida", state: "active" },
		},
	],
	...overrides,
});

export const conversation = (
	overrides: Partial<Conversation> = {},
): Conversation => ({
	id: "bcv_channel_general",
	tenant_id: TENANT,
	kind: "channel",
	name: "general",
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: SELF,
	last_message_at: "2026-10-21T15:00:00Z",
	latest_seq: 4,
	members: [
		{
			account_id: SELF,
			kind: "human",
			display_label: "Sam",
			role: "owner",
			state: "active",
			notify: "all",
		},
		{
			account_id: ADA,
			kind: "human",
			display_label: "Ada",
			role: "member",
			state: "active",
		},
	],
	member_count: 2,
	member: true,
	discoverable: false,
	last_read_seq: 2,
	unread_count: 2,
	muted: false,
	notify: "all",
	...overrides,
});

export const dm = (
	other: string,
	label: string,
	overrides: Partial<Conversation> = {},
): Conversation =>
	conversation({
		id: `bcv_dm_${other}`,
		kind: "dm",
		name: undefined,
		visibility: "private",
		agent_capable: false,
		members: [
			{
				account_id: SELF,
				kind: "human",
				display_label: "Sam",
				role: "owner",
				state: "active",
			},
			{
				account_id: other,
				kind: "human",
				display_label: label,
				role: "member",
				state: "active",
			},
		],
		...overrides,
	});

export const agentDm = (
	owner: string,
	label: string,
	overrides: Partial<Conversation> = {},
): Conversation =>
	conversation({
		id: `bcv_dm_agent_${owner}`,
		kind: "dm",
		name: undefined,
		visibility: "private",
		agent_capable: true,
		members: [
			{
				account_id: SELF,
				kind: "human",
				display_label: "Sam",
				role: "owner",
				state: "active",
			},
			{
				account_id: owner,
				kind: "agent",
				display_label: label,
				role: "member",
				state: "active",
			},
		],
		...overrides,
	});

export const person = (
	accountId: string,
	label: string,
	overrides: Partial<DirectoryMember> = {},
): DirectoryMember => ({
	account_id: accountId,
	display_label: label,
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	...overrides,
});

export const message = (
	seq: number,
	sender: string,
	createdAt: string,
	overrides: Partial<Message> = {},
): Message => ({
	id: `bcm_${seq}`,
	conversation_id: "bcv_channel_general",
	seq,
	sender: { account_id: sender, kind: "human", display_label: sender },
	body: `message ${seq}`,
	origin: "human",
	created_at: createdAt,
	...overrides,
});

/** The served consent pair (`responses.BridgeConsent`); the text is a placeholder, never the real legal copy. */
export const CONSENT_V2 = {
	version: "bridge_consent_v2",
	text: "Example consent text, line one.\nLine two: shown exactly as served.",
	accepted_versions: ["bridge_consent_v1", "bridge_consent_v2"],
};

/** `GET /settings` for an active endpoint, with the given consent provenance. */
export const settings = (
	via: string,
	overrides: {
		state?: string;
		version?: string;
		current?: boolean;
	} = {},
) => ({
	endpoint: {
		id: "bep_self",
		state: overrides.state ?? "active",
		consent: {
			version: overrides.version ?? "bridge_consent_v2",
			consented_via: via,
			current: overrides.current ?? true,
		},
	},
});
