/**
 * The Team Bridge push payload, parsed into the one destination a tap opens.
 *
 * WHY A SECOND PAYLOAD TYPE, AND NOT THE RELAY ONE. ADR 0006 §3.2's payload is
 * versioned (`v`) and typed (`type`), and a new `type` is its additive path. The
 * relay's `completion` push names an opaque per-computer conversation handle that
 * only a live relay can resolve, so its tap waits for a computer. A Team Bridge
 * message lives on the Radient HUB: its tap needs no computer at all. It opens
 * `/team-bridge/<tenant>/<conversation>` directly, laptop closed or not.
 *
 * THE WIRE (agent-server push slice). The data object is `{v: 1, type:
 * "team_bridge_message", tenant_id, conversation_id, message_id, seq}`. It carries
 * ids only: the banner's sender/subtitle/preview are the OS alert, and nothing in
 * `data` names a person or carries a body. expo-notifications hands the app
 * `request.content.data` from the APNs top-level `body` object on iOS and from
 * the FCM `body` JSON string on Android (`dataString`, re-parsed by expo's JS
 * layer). Both arrive here as the same object.
 *
 * PURE, so every OS shape is a Node test: a missing `data`, a string where an
 * object belongs, an unknown version, an empty id. Each lands on `null`, never a
 * half-built route. An unknown future `v` is refused rather than guessed at.
 */

export const TEAM_BRIDGE_PUSH_TYPE = "team_bridge_message";

export interface TeamBridgePush {
	tenantId: string;
	conversationId: string;
	messageId: string | null;
	seq: number | null;
}

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const DOTS = /^\.+$/;

const idOf = (value: unknown): string | null =>
	typeof value === "string" && ID.test(value) && !DOTS.test(value)
		? value
		: null;

/** The payload object, from either shape expo can hand over. */
function dataObject(data: unknown): Record<string, unknown> | null {
	if (typeof data === "string") {
		try {
			return dataObject(JSON.parse(data));
		} catch {
			return null;
		}
	}
	if (data === null || typeof data !== "object" || Array.isArray(data))
		return null;
	return data as Record<string, unknown>;
}

export function teamBridgePushFromData(data: unknown): TeamBridgePush | null {
	const record = dataObject(data);
	if (record === null) return null;
	if (record.type !== TEAM_BRIDGE_PUSH_TYPE) return null;
	const version = typeof record.v === "string" ? Number(record.v) : record.v;
	if (version !== 1) return null;
	const tenantId = idOf(record.tenant_id);
	const conversationId = idOf(record.conversation_id);
	if (tenantId === null || conversationId === null) return null;
	const seqRaw =
		typeof record.seq === "string" ? Number(record.seq) : record.seq;
	return {
		tenantId,
		conversationId,
		messageId: idOf(record.message_id),
		seq:
			typeof seqRaw === "number" && Number.isInteger(seqRaw) && seqRaw >= 0
				? seqRaw
				: null,
	};
}

/** The same read from a full expo-notifications response (or a received notification). */
export function teamBridgePushFromResponse(
	response: unknown,
): TeamBridgePush | null {
	const notification =
		response !== null && typeof response === "object"
			? ((response as Record<string, unknown>).notification ?? response)
			: null;
	if (notification === null || typeof notification !== "object") return null;
	const request = (notification as Record<string, unknown>).request;
	if (request === null || typeof request !== "object") return null;
	const content = (request as Record<string, unknown>).content;
	if (content === null || typeof content !== "object") return null;
	return teamBridgePushFromData((content as Record<string, unknown>).data);
}

/** The route a tap opens. */
export const teamBridgeThreadPath = (push: {
	tenantId: string;
	conversationId: string;
}): string =>
	`/team-bridge/${encodeURIComponent(push.tenantId)}/${encodeURIComponent(push.conversationId)}`;
