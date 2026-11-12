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

const isObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const parsedObject = (text: string): Record<string, unknown> | null => {
	try {
		const parsed: unknown = JSON.parse(text);
		return isObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

/**
 * The ADR 0006 §3.2 data object, from every envelope the OS can hand it over in.
 *
 * WHERE IT LIVES ON THE WIRE (ADR 0006 §3.2, amendment 2026-11-12). The cloud
 * puts the data object under the TOP-LEVEL `body` key, not `data`, because that
 * is the only key expo-notifications 57 reads custom data from: on iOS
 * `NotificationRecords.swift:331` returns `userInfo["body"]` as
 * `request.content.data` for a remote notification, and on Android
 * `RemoteMessageSerializer.java:45` / `NotificationData.kt:22` read the FCM
 * data key `body` as a JSON string. A sender that used `data` would reach the
 * app as `{}`.
 *
 * The shapes, in the order they are tried:
 *  - a JSON string (Android `dataString`, or an FCM `body` read raw) → parsed;
 *  - a record with `body`: the background task's raw payload (iOS hands the
 *    task `userInfo` minus `aps`, so `body` is the object; Android hands the FCM
 *    data map, so `body` is a JSON string) → that `body`;
 *  - a record with `dataString` and no usable `body` → the parsed string;
 *  - otherwise the record itself, which is what `content.data` already is once
 *    expo has unwrapped `body` (taps, received listeners) and what an older
 *    sender's `data` looks like — the fallback.
 * A §3.2 object never has a `body` or `dataString` key of its own, so unwrapping
 * cannot mistake a real payload for an envelope. Anything else is `null`.
 */
export function pushDataObject(raw: unknown): Record<string, unknown> | null {
	if (typeof raw === "string") return parsedObject(raw);
	if (!isObject(raw)) return null;
	const body = raw.body;
	if (isObject(body)) return body;
	if (typeof body === "string") {
		const parsed = parsedObject(body);
		if (parsed !== null) return parsed;
	}
	if (typeof raw.dataString === "string") {
		const parsed = parsedObject(raw.dataString);
		if (parsed !== null) return parsed;
	}
	return raw;
}

/** The payload half the app reads, from either shape an OS response can carry:
 *  expo-notifications' `notification.request.content.data`, or a bare `data`
 *  object (what the web/test hook and a directly-driven payload look like). */
export function conversationPushFromData(
	data: unknown,
): ConversationPush | null {
	const record = pushDataObject(data);
	if (record === null) return null;
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

/** The silent attention push (ADR 0006 §3.2's attention form), as the app reads it. */
export interface AttentionPush {
	/** `computer` — the opaque handle whose unread count this push reports. */
	computer: string;
	/** §1.1's count at composition time; `null` when absent or malformed. */
	count: number | null;
}

/**
 * Parse an attention push from any envelope `pushDataObject` accepts. Only `v: 1`
 * with `type: "attention"` and a non-empty `computer` is one; everything else is
 * `null`, so a completion or a Team Bridge push never drives the background clear.
 */
export function attentionPushFromData(raw: unknown): AttentionPush | null {
	const record = pushDataObject(raw);
	if (record === null || record.type !== "attention") return null;
	// FCM data values are strings on the wire; the APNs body keeps numbers.
	const version = typeof record.v === "string" ? Number(record.v) : record.v;
	if (version !== 1) return null;
	const computer = record.computer;
	if (typeof computer !== "string" || computer.length === 0) return null;
	const countRaw =
		typeof record.count === "string" && record.count.trim() !== ""
			? Number(record.count)
			: record.count;
	return {
		computer,
		count:
			typeof countRaw === "number" &&
			Number.isInteger(countRaw) &&
			countRaw >= 0
				? countRaw
				: null,
	};
}
