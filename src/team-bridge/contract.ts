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

/** Human-read delivery projection from BridgeConversationDeliveryStateView.
 * Unlike other additive hub objects, this privacy boundary strips unknown fields:
 * screening internals must never reach annotation consumers through passthrough.
 * The hub already applied owner/sender disclosure policy, including agent-origin
 * messages read by a human recipient owner; do not reconstruct that ACL here. */
const deliveryStateEntrySchema = z
	.object({
		endpoint_id: id,
		// Erased or unavailable identities can legitimately have empty labels. The
		// renderer owns their localized fallback, never a raw endpoint-ID fallback.
		recipient_label: z.string(),
		recipient_owner_label: z.string(),
		state: z.enum(["delivered", "held", "refused"]),
		hold_class: z
			.enum(["screening_unavailable", "awaiting_review", "delivery_pending"])
			.optional()
			.catch(undefined),
		refusal_class: z
			.enum([
				"manipulation",
				"personal_info",
				"abusive",
				"unsafe_content",
				"out_of_scope",
			])
			.optional()
			.catch(undefined),
	})
	.transform((entry) => {
		// Future optional classes degrade to a generic annotation. Remove the keys
		// rather than retaining unknown enum values or inventing a screening cause.
		if (entry.state !== "held" || entry.hold_class === undefined)
			delete entry.hold_class;
		if (entry.state !== "refused" || entry.refusal_class === undefined)
			delete entry.refusal_class;
		return entry;
	});
export type DeliveryState = z.infer<typeof deliveryStateEntrySchema>;

const deliveryStatesSchema = z.preprocess((input) => {
	if (!Array.isArray(input)) return undefined;
	const entries: DeliveryState[] = [];
	for (const candidate of input) {
		const parsed = deliveryStateEntrySchema.safeParse(candidate);
		if (parsed.success) entries.push(parsed.data);
	}
	// Malformed REQUIRED entry fields omit only that entry. An optional
	// annotation cannot make otherwise valid history unavailable to its reader.
	return entries;
}, z.array(deliveryStateEntrySchema).optional());

/**
 * The image types the hub stores and serves (`attachments.mime_types`). PNG and
 * JPEG only: the hub sniffs the bytes and refuses everything else with 415, so
 * the phone converts before it uploads and never offers another type.
 */
export const ATTACHMENT_MIME_TYPES = ["image/png", "image/jpeg"] as const;

/**
 * One image descriptor on a message (`attachments[]`, the hub's message view).
 *
 * METADATA ONLY. A descriptor never carries a URL or bytes: the image is read
 * through the bearer-authenticated byte route for THIS message
 * (`client.attachmentBytes`), so possessing a descriptor grants nothing.
 *
 * `state` is optional because a bound, readable image is the default the hub
 * may omit. `expired` is the retention sweeper's tombstone (bytes purged after
 * the conversation-content horizon, the descriptor kept so the row can say so);
 * any other value is a state this build does not know and renders as
 * "unavailable" rather than trying to fetch.
 */
export const attachmentDescriptorSchema = z.looseObject({
	id,
	mime: z.string().optional(),
	size: z.number().int().nonnegative().optional(),
	width: z.number().int().nonnegative().optional(),
	height: z.number().int().nonnegative().optional(),
	state: z.string().optional(),
});
export type AttachmentDescriptor = z.infer<typeof attachmentDescriptorSchema>;

export const messageSchema = z
	.looseObject({
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
		/*
		 * Additive (image attachments). PER-ROW TOLERANCE: one descriptor this build
		 * cannot read becomes `null` (rendered as an unavailable image) instead of
		 * failing the whole history page, and a non-array value is dropped. A message
		 * from a server without attachments simply has none.
		 */
		attachments: z
			.array(attachmentDescriptorSchema.nullable().catch(null))
			.optional()
			.catch(undefined),
		delivery_states: deliveryStatesSchema,
	})
	.transform((message) => {
		// A malformed non-array projection is absence, not an authorized empty
		// attestation. Zod parses a fresh object; the caller's wire input is intact.
		if (message.delivery_states === undefined) delete message.delivery_states;
		return message;
	});
export type Message = z.infer<typeof messageSchema>;

/**
 * `POST /conversations/:cid/attachments` answer: `{attachment: {...}}`. The
 * fields the composer needs are the id (sent as `attachment_ids`) and the
 * dimensions (the chip's aspect); `sha256`/`expires_at` are tolerated, never
 * shown or logged.
 */
export const uploadedAttachmentSchema = z
	.looseObject({
		attachment: attachmentDescriptorSchema.extend({
			mime: z.enum(ATTACHMENT_MIME_TYPES),
			size: z.number().int().nonnegative(),
		}),
	})
	.transform((v) => v.attachment);
export type UploadedAttachment = z.infer<typeof uploadedAttachmentSchema>;

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

/** Only the hub-owned, hash-pinned endpoint route is an avatar identity. */
export const ENDPOINT_AVATAR_PATH =
	/^\/v1\/messaging\/endpoints\/([A-Za-z0-9_-]{1,128})\/avatar\?v=([0-9a-f]{16})$/;

/**
 * A person's chief of staff, when the directory publishes one. Malformed photo
 * enrichment costs only the photo, not the agent row or its owner's People row.
 */
export const directoryAgentSchema = z.looseObject({
	endpoint_id: id,
	name: z.string().max(128),
	state: z.string().min(1).max(32),
	// Endpoint-owned enrichment is optional. A corrupt photo must not remove a
	// valid chief-of-staff row or let it borrow the owner's account identity.
	avatar: z
		.object({
			hash: z.string().regex(/^[0-9a-f]{16}$/),
			updated_at: z.string().datetime({ offset: true }),
		})
		.optional()
		.catch(undefined),
	// Preserve invalid-present as null: erasing it to undefined would confuse a
	// rejected URL with an absent optional URL and admit a metadata-only fetch.
	avatar_url: z
		.string()
		.regex(ENDPOINT_AVATAR_PATH)
		.nullable()
		.optional()
		.catch(null),
});
export type DirectoryAgent = z.infer<typeof directoryAgentSchema>;

export const personBridgeStateSchema = z.enum([
	"active",
	"paused",
	"disabled",
	"none",
]);

/**
 * A person's public presentation, carried on each directory row so a profile
 * card needs no second read (agent-server `docs/ACCOUNT-PROFILE.md` §7,
 * `responses.AccountProfileResponse`, read at origin/main d057d57e on
 * 2026-10-26). The server already cleaned and bounded every value; the bounds
 * here only keep a misbehaving hub from painting a paragraph into a title.
 *
 * DELIBERATELY `z.object`, NOT `looseObject`. The card renders an allow-list,
 * and stripping unknown keys at the parse makes that structural. The hub sends
 * `pronouns`, and this app does not show pronouns anywhere (an explicit
 * product decision): leaving the key out of this schema means no screen can
 * reach it by accident.
 *
 * Every field `.catch`es on its own, so one out-of-bounds value costs that
 * field, never the person's row. Missing fields stay missing, never `""`, so
 * absent data renders as absent rather than as an empty line.
 */
export const accountProfileSchema = z.object({
	display_name: z.string().max(256).optional().catch(undefined),
	title: z.string().max(320).optional().catch(undefined),
	description: z.string().max(2000).optional().catch(undefined),
	timezone: z.string().max(64).optional().catch(undefined),
	avatar: z
		.looseObject({ hash: z.string().regex(/^[0-9a-f]{16}$/) })
		.optional()
		.catch(undefined),
});
export type AccountProfile = z.infer<typeof accountProfileSchema>;

/*
 * The hub's relative, hash-pinned avatar path
 * (`/v1/accounts/<id>/avatar?v=<16 hex>`). Only the transport-safe id
 * alphabet is admitted: the path is rebuilt from the parts by the client, and
 * an escaped slash or dot segment must never widen what the phone requests.
 */
export const AVATAR_PATH =
	/^\/v1\/accounts\/([A-Za-z0-9_-]{1,128})\/avatar\?v=([0-9a-f]{16})$/;

export const directoryMemberSchema = z.looseObject({
	account_id: id,
	display_label: z.string(),
	role: z.string().min(1).max(32),
	bridge_enabled: z.boolean(),
	bridge_state: personBridgeStateSchema,
	agent: directoryAgentSchema.optional().catch(undefined),
	/*
	 * Both OPTIONAL and both `.catch`: a hub older than the profile slice sends
	 * neither, and a malformed value costs the photo or the card details, never
	 * the person's row. Participants do not carry these: the conversation
	 * views whitelist them out server-side, so the directory is the one source.
	 */
	profile: accountProfileSchema.optional().catch(undefined),
	avatar_url: z.string().regex(AVATAR_PATH).optional().catch(undefined),
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
	const profile = accountProfileSchema.safeParse(candidate.profile);
	const avatarUrl = z
		.string()
		.regex(AVATAR_PATH)
		.safeParse(candidate.avatar_url);
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
		...(profile.success ? { profile: profile.data } : {}),
		...(avatarUrl.success ? { avatar_url: avatarUrl.data } : {}),
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
 * The phone reads what its gate needs: the contract version, whether any
 * organization is eligible, and the per-org rows (name, eligibility, the
 * caller's endpoint). It also reads the served `consent` {version, text}, for ONE
 * reason: the default-on notice (`./model` `defaultOnNotice`) must show the text
 * the member was enrolled under, verbatim, and the hub serves it only here. The
 * phone never renders that text as an Enable dialog and never echoes it back:
 * enrolment is the desktop runtime's (`POST /v1/messaging/enrollment`). The
 * screening and guidance texts stay a desktop concern and are not read.
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

/**
 * The hub's attachments capability (`status.attachments`), present only when
 * the server has an attachment store wired. ABSENT means "this server cannot
 * take images": an older hub would answer `attachment_ids` with 400 (strict
 * DTO), so the composer offers no attach affordance at all rather than a
 * control that fails on send. A malformed block degrades to absent.
 */
export const attachmentsCapabilitySchema = z.looseObject({
	enabled: z.boolean(),
	max_count: z.number().int().positive().optional(),
	max_bytes: z.number().int().positive().optional(),
	max_pixels: z.number().int().positive().optional(),
	mime_types: z.array(z.string()).optional(),
});
export type AttachmentsCapability = z.infer<typeof attachmentsCapabilitySchema>;
/**
 * The served consent pair (`responses.BridgeConsent`). `.catch(undefined)` on the
 * field below makes a malformed consent block mean "no notice", never a failed
 * gate: the notice is additive and must not take Team Bridge down with it.
 */
export const statusConsentSchema = z.looseObject({
	version: z.string().min(1),
	text: z.string().min(1),
	accepted_versions: z.array(z.string()).optional(),
});
export type StatusConsent = z.infer<typeof statusConsentSchema>;

export const statusSchema = z.looseObject({
	/*
	 * A decimal STRING on the wire (`bridge.APIVersion = "1"`). Accepting a number
	 * too costs nothing, and the eligibility ladder compares the value exactly.
	 */
	api_version: z.union([z.string(), z.number()]),
	available: z.boolean(),
	tenants: z.array(statusTenantSchema),
	attachments: attachmentsCapabilitySchema.optional().catch(undefined),
	/** Eligible callers only; absent otherwise ("absent means absent"). */
	consent: statusConsentSchema.optional().catch(undefined),
});
export type Status = z.infer<typeof statusSchema>;

/**
 * `GET`/`PUT /v1/messaging/settings` (`responses.BridgeSettingsResponse`).
 *
 * Every field is optional and `consented_via` is a plain string. The hub's enum
 * is `dialog | settings | default_on` today and has grown before, so an unknown
 * provenance must parse (and simply never match `default_on`) rather than fail
 * the read. The opt-out PUT does not parse this schema: its 2xx alone confirms
 * the mutation, independently of the optional response body.
 */
export const settingsSchema = z.looseObject({
	endpoint: z
		.looseObject({
			id: z.string().optional(),
			state: z.string().optional(),
			consent: z
				.looseObject({
					version: z.string().optional(),
					consented_via: z.string().optional(),
					current: z.boolean().optional(),
				})
				.nullable()
				.optional(),
		})
		.nullable()
		.optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

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
