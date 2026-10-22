/**
 * The Team Bridge wire shapes, as the Radient hub publishes them.
 *
 * SOURCE OF TRUTH. These schemas mirror the Go response structs in the
 * agent-server repository (`internal/responses/bridge_conversation.go` and
 * `internal/responses/bridge.go`, read at origin/main 321a7be on 2026-10-21) and
 * the desktop client's own parse (`local-operator-ui`
 * `src/shared/team-bridge-contract.ts`, branch `feat/tb-direct-dm`). The mobile
 * app is the third consumer of a shape it does not produce, so it parses rather
 * than casts, for two reasons the desktop states the same way:
 *
 * - An unfamiliar REQUIRED field fails closed. The screen shows its error state
 *   instead of rendering `undefined`.
 * - An ADDITIVE field survives (`looseObject`), which is the hub's own contract
 *   rule. Sibling lanes are adding threads (`thread_root_id`), reactions,
 *   built-in channels (`builtin`) and the directory's chief-of-staff object
 *   (`agent`). Every one of those is optional here, so a server older OR newer
 *   than this build still parses.
 *
 * WHY NOT THE RELAY CONTRACT. Team Bridge lives on the hub, not on the
 * operator's machine, so these reads go straight to `api.radienthq.com` with the
 * Radient OAuth token. They work with the laptop closed. That is also why this
 * module sits beside `src/contracts/` rather than in it: that directory is the
 * relay's vocabulary, generated against the Local Operator daemon.
 */

import { z } from "zod";

const id = z.string().min(1).max(128);

/** `{msg, result}`, the hub's success envelope (`internal/responses/responses.go`). */
export const hubEnvelopeSchema = z.looseObject({
	msg: z.string().optional(),
	result: z.unknown(),
});

/**
 * The hub's error body: `{error, code?, details?}` (`cmd/server/main.go`
 * `httpErrorResponse`). `code` is the stable machine key every client switches
 * on, and `error` is a content-free sentence written to be read.
 */
export const hubErrorSchema = z.looseObject({
	error: z.string().optional(),
	code: z.string().optional(),
	details: z.record(z.string(), z.unknown()).optional(),
});

/**
 * How loudly one conversation may notify its reader (the hub's
 * `BridgeConversationNotify`). `mention` interrupts only when this person is
 * mentioned by a structured mention. `mute` never interrupts. The legacy
 * `muted` boolean rides beside it so both eras of the server parse alike.
 */
export const notifySchema = z.enum(["all", "mention", "mute"]);
export type Notify = z.infer<typeof notifySchema>;

export const participantSchema = z.looseObject({
	account_id: id,
	kind: z.enum(["human", "agent"]),
	/*
	 * The hub keeps a participant row with an EMPTY label once the account behind
	 * it was erased (account deletion re-keys and blanks it). `min(1)` would fail
	 * the whole conversation over one departed member, so the renderer supplies
	 * the fallback instead.
	 */
	display_label: z.string().max(256),
	role: z.string().min(1).max(32),
	state: z.enum(["invited", "active", "left", "removed"]),
	joined_seq: z.number().int().nonnegative().optional(),
	notify: notifySchema.optional(),
});
export type Participant = z.infer<typeof participantSchema>;

export const conversationSchema = z.looseObject({
	id,
	tenant_id: id,
	kind: z.enum(["dm", "group", "channel"]),
	name: z.string().optional(),
	topic: z.string().optional(),
	visibility: z.enum(["private", "tenant"]),
	agent_capable: z.boolean(),
	status: z.enum(["open", "archived"]),
	created_by: z.string(),
	last_message_at: z.string(),
	latest_seq: z.number().int().nonnegative(),
	members: z.array(participantSchema),
	member_count: z.number().int().nonnegative().optional(),
	/*
	 * `member` absent means "this server cannot say", never "not a member". Only
	 * an explicit `discoverable: true` beside an explicit `member: false` is a
	 * preview row (the desktop's `isPreviewConversation` rule, kept identical).
	 */
	member: z.boolean().optional(),
	discoverable: z.boolean().optional(),
	last_read_seq: z.number().int().nonnegative(),
	unread_count: z.number().int().nonnegative(),
	muted: z.boolean(),
	notify: notifySchema.optional(),
	/** The built-in channels slice (`humans` / `agents`). Not on main yet. */
	builtin: z.string().optional(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationListSchema = z.looseObject({
	conversations: z.array(conversationSchema),
	next_cursor: z.string().optional(),
	has_more: z.boolean().optional(),
});
export type ConversationList = z.infer<typeof conversationListSchema>;

export const messageSchema = z.looseObject({
	id,
	conversation_id: id,
	seq: z.number().int().nonnegative(),
	sender: z.looseObject({
		account_id: z.string(),
		kind: z.enum(["human", "agent"]),
		display_label: z.string().max(256),
	}),
	/*
	 * Nullable on the wire. A human member's history carries the body, and an
	 * agent member's carries `null` until that agent admitted the message. This
	 * app always reads as the human, but "no body" is still a state the row
	 * renders, never a crash.
	 */
	body: z.string().nullable(),
	body_hash: z.string().optional(),
	origin: z.enum(["human", "agent", "system"]),
	agent_label: z.string().optional(),
	created_at: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

export const messagePageSchema = z.looseObject({
	messages: z.array(messageSchema),
	next_before_seq: z.number().int().nonnegative().optional(),
	has_more: z.boolean().optional(),
});
export type MessagePage = z.infer<typeof messagePageSchema>;

export const readStateSchema = z.looseObject({
	conversation_id: id,
	last_read_seq: z.number().int().nonnegative(),
	unread_count: z.number().int().nonnegative(),
	muted: z.boolean(),
	notify: notifySchema.optional(),
});
export type ReadState = z.infer<typeof readStateSchema>;

/** `GET /unread?scope=account`: the one aggregate the badge spends. */
export const accountUnreadSchema = z.looseObject({
	total: z.number().int().nonnegative(),
	organizations: z
		.array(
			z.looseObject({
				tenant_id: id,
				tenant_name: z.string(),
				unread: z.number().int().nonnegative(),
				eligible: z.boolean(),
			}),
		)
		.optional(),
});
export type AccountUnread = z.infer<typeof accountUnreadSchema>;

/**
 * A person's chief of staff, when the directory publishes one (the CoS
 * directory slice, not on main yet). A malformed agent object costs the person
 * their chief-of-staff row, never their People row.
 */
export const directoryAgentSchema = z.looseObject({
	endpoint_id: id,
	name: z.string().max(128),
	state: z.string().min(1).max(32),
});
export type DirectoryAgent = z.infer<typeof directoryAgentSchema>;

export const personBridgeStateSchema = z.enum([
	"active",
	"paused",
	"disabled",
	"none",
]);

export const directoryMemberSchema = z.looseObject({
	account_id: id,
	display_label: z.string(),
	role: z.string().min(1).max(32),
	bridge_enabled: z.boolean(),
	bridge_state: personBridgeStateSchema,
	agent: directoryAgentSchema.optional().catch(undefined),
});
export type DirectoryMember = z.infer<typeof directoryMemberSchema>;

/**
 * Salvage one directory row that failed the strict parse.
 *
 * PER-ROW TOLERANCE, the desktop's rule: one future role or state value must
 * not blank every colleague. A row with a stable account id is kept in the
 * inert state (`none`). Only a row with no usable id is dropped, and the count
 * of dropped rows is surfaced so the section can say it is incomplete.
 */
function salvageDirectoryMember(row: unknown): DirectoryMember | null {
	if (row === null || typeof row !== "object") return null;
	const candidate = row as Record<string, unknown>;
	const accountId = candidate.account_id;
	if (typeof accountId !== "string" || accountId.length === 0) return null;
	const agent = directoryAgentSchema.safeParse(candidate.agent);
	const state = personBridgeStateSchema.safeParse(candidate.bridge_state);
	return {
		account_id: accountId,
		display_label:
			typeof candidate.display_label === "string"
				? candidate.display_label
				: "",
		role:
			typeof candidate.role === "string" && candidate.role.length > 0
				? candidate.role
				: "member",
		bridge_enabled: candidate.bridge_enabled === true,
		bridge_state: state.success ? state.data : "none",
		...(agent.success ? { agent: agent.data } : {}),
	};
}

export const directorySchema = z
	.looseObject({ members: z.array(z.unknown()) })
	.transform((payload) => {
		const members: DirectoryMember[] = [];
		let unavailableCount = 0;
		for (const row of payload.members) {
			const parsed = directoryMemberSchema.safeParse(row);
			if (parsed.success) {
				members.push(parsed.data);
				continue;
			}
			const salvaged = salvageDirectoryMember(row);
			if (salvaged) members.push(salvaged);
			else unavailableCount += 1;
		}
		return { members, unavailable_count: unavailableCount };
	});
export type Directory = z.infer<typeof directorySchema>;

/**
 * `GET /v1/messaging/status` (`responses.BridgeStatusResponse`).
 *
 * The phone reads only what its gate needs: the contract version, whether any
 * organization is eligible, and the per-org rows (name, eligibility, the
 * caller's endpoint). The served consent and screening texts are a desktop
 * concern (enrolment happens on the computer) and are deliberately not read.
 */
export const statusTenantSchema = z.looseObject({
	tenant_id: id,
	tenant_name: z.string(),
	eligible: z.boolean(),
	endpoint: z
		.looseObject({ id: z.string(), label: z.string(), state: z.string() })
		.nullable()
		.optional(),
});
export type StatusTenant = z.infer<typeof statusTenantSchema>;

export const statusSchema = z.looseObject({
	/*
	 * A decimal STRING on the wire (`bridge.APIVersion = "1"`). Accepting a number
	 * too costs nothing, and the eligibility ladder compares the value exactly.
	 */
	api_version: z.union([z.string(), z.number()]),
	available: z.boolean(),
	tenants: z.array(statusTenantSchema),
});
export type Status = z.infer<typeof statusSchema>;

/** `PUT /v1/messaging/push/devices` (agent-server, this release's push slice). */
export const pushDeviceSchema = z.looseObject({
	device_id: z.string().min(1),
	platform: z.enum(["ios", "android"]),
});
export type PushDevice = z.infer<typeof pushDeviceSchema>;

/** One member as a create request states it (the wire is snake_case). */
export type MemberInput = {
	account_id: string;
	kind: "human" | "agent";
	endpoint_id?: string;
	display_label: string;
};
