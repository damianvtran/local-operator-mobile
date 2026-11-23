/**
 * The community API's wire shapes, as this client reads them.
 *
 * SOURCE OF TRUTH. `docs/community-api.yaml` in radient-ml/agent-server
 * (OpenAPI 3, hand-authored, every operation marked `x-status`). This file
 * mirrors only the operations the phone calls, and only the fields it renders
 * or sends; every object is `looseObject` so a field the server adds later
 * parses rather than failing the screen. Enums the client BRANCHES on (refusal
 * categories, submission states, request states) are strict on purpose: an
 * unknown refusal category must not be rendered as a guessed label, so the
 * parse fails and the composer shows the generic "not posted" outcome instead.
 *
 * NO ENVELOPE. Unlike `/v1/messaging` (`{msg, result}`), the community
 * deployment answers bare JSON and errors as `{message, code?, ...}`. Keeping
 * the two contracts in separate modules is deliberate: RFC §7.2 says the
 * community client shares no state with the private Bridge client, and
 * separate schemas mean a change to one can never silently retype the other.
 */

import { z } from "zod";

const id = z.string().min(1);
const dateTime = z.string();

export const communitySchema = z.looseObject({
	id,
	slug: z.string(),
	name: z.string(),
	avatar_asset_id: z.string().optional(),
	state: z.enum(["active", "read_only"]),
});
export type Community = z.infer<typeof communitySchema>;

export const communityListSchema = z.looseObject({
	joined: z.array(communitySchema),
	featured: z.array(communitySchema),
});
export type CommunityList = z.infer<typeof communityListSchema>;

export const guidelinesSchema = z.looseObject({
	version: z.string().min(1),
	text: z.string(),
});
export type Guidelines = z.infer<typeof guidelinesSchema>;

export const membershipSchema = z.looseObject({
	status: z.literal("active"),
	guidelines_version: z.string(),
	accepted_at: dateTime,
});
export type Membership = z.infer<typeof membershipSchema>;

export const bootstrapSchema = z.looseObject({
	community_id: id,
	community: communitySchema,
	guidelines: guidelinesSchema,
	membership: membershipSchema.nullable(),
});
export type Bootstrap = z.infer<typeof bootstrapSchema>;

const nextCursor = z.string().nullable();

export const channelSchema = z.looseObject({
	id,
	name: z.string(),
	purpose: z.string().optional(),
	visibility: z.enum(["public", "private"]),
	posting: z.enum(["everyone", "staff"]).optional(),
	locked: z.boolean().optional(),
	archived: z.boolean().optional(),
	member: z.boolean().optional(),
	unread: z.number().int().min(0).optional(),
	channel_admin: z.boolean().optional(),
});
export type Channel = z.infer<typeof channelSchema>;

export const channelPageSchema = z.looseObject({
	items: z.array(channelSchema),
	next_cursor: nextCursor,
});
export type ChannelPage = z.infer<typeof channelPageSchema>;

export const roleSchema = z.enum([
	"member",
	"moderator",
	"community_admin",
	"staff",
]);
export type CommunityRole = z.infer<typeof roleSchema>;

export const profileSchema = z.looseObject({
	public_id: id,
	display_name: z.string(),
	title: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	avatar_asset_id: z.string().nullable().optional(),
	role: roleSchema.optional(),
	joined_month: z.string().optional(),
});
export type Profile = z.infer<typeof profileSchema>;

export const profilePageSchema = z.looseObject({
	items: z.array(profileSchema),
	next_cursor: nextCursor,
});
export type ProfilePage = z.infer<typeof profilePageSchema>;

export const authorSchema = z.looseObject({
	kind: z.enum(["human", "agent", "system", "former_member", "deleted"]),
	public_id: z.string().nullable().optional(),
	display_name: z.string(),
	agent_handle: z.string().nullable().optional(),
});
export type Author = z.infer<typeof authorSchema>;

export const messageSchema = z.looseObject({
	id,
	conversation_id: id,
	seq: z.number().int(),
	revision: z.number().int().optional(),
	author: authorSchema,
	text: z.string().optional(),
	asset_ids: z.array(z.string()).optional(),
	thread_root_id: z.string().nullable().optional(),
	reply_count: z.number().int().optional(),
	edited: z.boolean().optional(),
	deleted: z.boolean().optional(),
	created_at: dateTime,
});
export type CommunityMessage = z.infer<typeof messageSchema>;

export const messagePageSchema = z.looseObject({
	items: z.array(messageSchema),
	next_cursor: nextCursor,
});
export type MessagePage = z.infer<typeof messagePageSchema>;

/** The four sender-facing refusal categories (RFC §6.2, canon "Refusal categories"). */
export const refusalCategorySchema = z.enum([
	"unsafe_or_illegal",
	"harassment_or_abuse",
	"spam_or_promotion",
	"private_information",
]);
export type RefusalCategory = z.infer<typeof refusalCategorySchema>;

export const refusalSchema = z.looseObject({
	status: z.literal("refused"),
	category: refusalCategorySchema,
	reference: z.string().regex(/^MOD-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
});
export type Refusal = z.infer<typeof refusalSchema>;

export const submissionOutcomeSchema = z.looseObject({
	idempotency_key: z.string(),
	state: z.enum(["checking", "published", "refused", "cancelled", "expired"]),
	message_id: z.string().nullable().optional(),
	refusal: refusalSchema.nullable().optional(),
});
export type SubmissionOutcome = z.infer<typeof submissionOutcomeSchema>;

export const counterpartSchema = z.looseObject({
	public_id: id,
	display_name: z.string(),
	title: z.string().nullable().optional(),
	role: roleSchema,
});
export type Counterpart = z.infer<typeof counterpartSchema>;

export const requestSchema = z.looseObject({
	id,
	kind: z.enum(["dm", "contact"]),
	direction: z.enum(["incoming", "outgoing"]),
	state: z.enum([
		"pending",
		"accepted",
		"not_accepted",
		"expired",
		"cancelled",
	]),
	counterpart: counterpartSchema.optional(),
	conversation_id: z.string().nullable().optional(),
	created_at: dateTime,
	expires_at: dateTime,
});
export type CommunityRequest = z.infer<typeof requestSchema>;

export const requestPageSchema = z.looseObject({
	items: z.array(requestSchema),
	next_cursor: nextCursor,
});

export const directConversationPageSchema = z.looseObject({
	items: z.array(
		z.looseObject({
			conversation_id: id,
			counterpart: counterpartSchema,
			unread: z.number().int().min(0),
			closed: z.boolean(),
		}),
	),
});
export type DirectConversation = z.infer<
	typeof directConversationPageSchema
>["items"][number];

/**
 * A content-free approval stub (RFC §5.9, frames M6/M6b). There is no draft
 * text field on the wire BY DESIGN: the community server never holds an
 * unmoderated agent draft, so the phone can only say which channel and when it
 * expires.
 */
export const agentApprovalSchema = z.looseObject({
	approval_id: id,
	target_kind: z.enum(["channel", "contact"]),
	channel_id: z.string(),
	state: z.enum(["pending", "approved", "declined", "expired", "used"]),
	/* The server sends `null` until someone answers (seen against the
	 * community-mode server: `"answered_surface":null`), so null must parse. */
	answered_surface: z
		.enum(["desktop", "mobile", "terminal", "web"])
		.nullable()
		.optional(),
	created_at: dateTime,
	expires_at: dateTime,
	answered_at: z.string().nullable().optional(),
});
export type AgentApproval = z.infer<typeof agentApprovalSchema>;

export const agentApprovalPageSchema = z.looseObject({
	items: z.array(agentApprovalSchema),
	next_cursor: nextCursor,
});

export const unreadCountsSchema = z.looseObject({
	conversation_id: z.string(),
	unread: z.number().int().min(0),
});

export const channelMembershipSchema = z.looseObject({
	channel_id: z.string(),
	state: z.enum(["member", "oversight"]),
});

/**
 * Content-free invalidations. An unknown `type` is DROPPED (`catch`) rather
 * than failing the batch: the server may add kinds, and a poller that died on
 * a new kind would stop refreshing everything else.
 */
export const eventBatchSchema = z.looseObject({
	events: z.array(
		z.looseObject({
			type: z.string(),
			conversation_id: z.string().optional(),
		}),
	),
	next: z.string(),
});
export type EventBatch = z.infer<typeof eventBatchSchema>;

export const caseReceiptSchema = z.looseObject({
	case_reference: z.string(),
	state: z.literal("submitted"),
});

/** Every refusal body: `{message}` plus whichever coded fields its status uses. */
export const errorBodySchema = z.looseObject({
	message: z.string().optional(),
	code: z.string().optional(),
	retry_after: z.number().int().optional().nullable(),
	scope: z.string().optional(),
	guidelines_version: z.string().optional(),
	reference: z.string().optional(),
	status: z.string().optional(),
	category: z.string().optional(),
});

export type ReportTargetKind = "message" | "profile" | "channel" | "dm";
