/**
 * A notification response's payload, parsed into the one destination the app
 * acts on.
 *
 * The push payload ADR 0006 §3.2 freezes carries `{v, type, computer,
 * conversation, completion_token, kind, emit_id, count}` — but the app consumes
 * exactly two of those fields (`conversation`, and `computer` when present) and
 * the resolver's own vocabulary has carried them since #35
 * (`features/deep-links/pending.ts` `ConversationPush`). This module is the
 * seam between "whatever the OS handed us" and that type, and it is PURE so the
 * edges are testable without a device: the shapes here are exactly the ones an
 * OS payload can take (missing `data`, a string where an object belongs, an
 * empty handle), and every one of them must land on `null` rather than a
 * half-built destination.
 *
 * Nothing here reads `completion_token` or `kind`: they are the payload's own
 * business (the ack flow reads them off the wire, not off a notification), and
 * parsing fields nobody consumes would be inventing a second reader for them.
 * A field this app does not know is ignored, deliberately — the payload is
 * versioned (`v`), and a newer sender adding a field must not break the tap.
 */

import type { ConversationPush } from "@/features/deep-links/pending";

/** The payload half the app reads, from either shape an OS response can carry:
 *  expo-notifications' `notification.request.content.data`, or a bare `data`
 *  object (what the web/test hook and a directly-driven payload look like). */
export function conversationPushFromData(
	data: unknown,
): ConversationPush | null {
	if (data === null || typeof data !== "object") return null;
	const record = data as Record<string, unknown>;
	const conversation = record.conversation;
	if (typeof conversation !== "string" || conversation.length === 0) {
		return null;
	}
	const computer = record.computer;
	return {
		conversation,
		computer:
			typeof computer === "string" && computer.length > 0 ? computer : null,
	};
}

/**
 * The same read, from a full expo-notifications response object
 * (`getLastNotificationResponseAsync()` / the response listener's argument).
 *
 * Duck-typed rather than typed against expo-notifications: this module is
 * imported by tests and by the Settings surface on the web target, and pulling
 * the native module in for a type would make both depend on a runtime neither
 * has. The traversal mirrors the documented shape
 * (`response.notification.request.content.data`); anything missing along the
 * way is `null`, which the caller treats as "not a tap this app can honour".
 */
export function conversationPushFromResponse(
	response: unknown,
): ConversationPush | null {
	if (response === null || typeof response !== "object") return null;
	const notification = (response as Record<string, unknown>).notification;
	if (notification === null || typeof notification !== "object") return null;
	const request = (notification as Record<string, unknown>).request;
	if (request === null || typeof request !== "object") return null;
	const content = (request as Record<string, unknown>).content;
	if (content === null || typeof content !== "object") return null;
	return conversationPushFromData((content as Record<string, unknown>).data);
}
