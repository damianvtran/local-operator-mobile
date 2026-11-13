import { describe, expect, it } from "vitest";

import {
	attentionPushFromData,
	conversationPushFromData,
	conversationPushFromResponse,
	pushDataObject,
} from "@/notifications/payload";

/**
 * The tap payload's parse, at the edges.
 *
 * The rule under test: only a real handle becomes a destination, everything
 * else is `null` — a half-built push (a missing handle, a handle typed as a
 * number by some intermediary) must not reach the resolver as a destination,
 * because the resolver's behaviour on a bad handle is a request for a
 * conversation that cannot exist.
 */

describe("conversationPushFromData", () => {
	it("reads the two fields the app consumes", () => {
		expect(
			conversationPushFromData({
				v: 1,
				type: "completion",
				computer: "cmp-3f9a",
				conversation: "cv-71aa",
				completion_token: "tok",
				kind: "completed",
				emit_id: 4,
				count: 1,
			}),
		).toEqual({ conversation: "cv-71aa", computer: "cmp-3f9a" });
	});

	it("carries a missing computer as null, never a guess", () => {
		expect(conversationPushFromData({ conversation: "cv-1" })).toEqual({
			conversation: "cv-1",
			computer: null,
		});
		expect(
			conversationPushFromData({ conversation: "cv-1", computer: "" }),
		).toEqual({ conversation: "cv-1", computer: null });
		expect(
			conversationPushFromData({ conversation: "cv-1", computer: 42 }),
		).toEqual({ conversation: "cv-1", computer: null });
	});

	it.each([
		["no data", undefined],
		["null", null],
		["a string", "cv-1"],
		["no conversation", { computer: "cmp-1" }],
		["an empty conversation", { conversation: "" }],
		["a numeric conversation", { conversation: 7 }],
	])("reads null for %s", (_label, data) => {
		expect(conversationPushFromData(data)).toBeNull();
	});

	it("ignores fields it does not consume — a newer payload must not break a tap", () => {
		expect(
			conversationPushFromData({
				conversation: "cv-1",
				something_new: { nested: true },
			}),
		).toEqual({ conversation: "cv-1", computer: null });
	});
});

describe("conversationPushFromResponse", () => {
	it("walks the expo response shape", () => {
		expect(
			conversationPushFromResponse({
				actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
				notification: {
					request: {
						content: {
							data: { conversation: "cv-9", computer: "cmp-2" },
						},
					},
				},
			}),
		).toEqual({ conversation: "cv-9", computer: "cmp-2" });
	});

	it.each([
		["no response", undefined],
		["an empty object", {}],
		["no notification", { actionIdentifier: "x" }],
		["no request", { notification: {} }],
		["no content", { notification: { request: {} } }],
		["no data", { notification: { request: { content: {} } } }],
	])("reads null for %s", (_label, response) => {
		expect(conversationPushFromResponse(response)).toBeNull();
	});
});

/**
 * Where the §3.2 object sits on the wire (ADR 0006 amendment 2026-11-12): the
 * cloud puts it under the top-level `body` key, because expo-notifications 57 on
 * iOS reads a remote notification's `content.data` from `userInfo["body"]`
 * (NotificationRecords.swift:331) and nothing else. These pin the read order —
 * `body` first, then `dataString`, then the record itself (the old `data` shape).
 */
describe("pushDataObject", () => {
	const object = {
		v: 1,
		type: "completion",
		computer: "cmp-1",
		conversation: "cv-1",
	};

	it("reads an iOS background-task envelope's `body` object", () => {
		expect(pushDataObject({ body: object, dataString: "{}" })).toEqual(object);
	});

	it("reads an Android FCM `body` JSON string", () => {
		expect(pushDataObject({ body: JSON.stringify(object) })).toEqual(object);
	});

	it("falls back to `dataString` when `body` is unusable", () => {
		expect(
			pushDataObject({ body: "not json", dataString: JSON.stringify(object) }),
		).toEqual(object);
	});

	it("falls back to the record itself (already-unwrapped content.data, or a legacy `data` sender)", () => {
		expect(pushDataObject(object)).toEqual(object);
	});

	it("parses a bare JSON string and refuses non-objects", () => {
		expect(pushDataObject(JSON.stringify(object))).toEqual(object);
		expect(pushDataObject("[1]")).toBeNull();
		expect(pushDataObject(null)).toBeNull();
		expect(pushDataObject(7)).toBeNull();
	});

	it("lets conversationPushFromData read through a `body` envelope", () => {
		expect(conversationPushFromData({ body: object })).toEqual({
			conversation: "cv-1",
			computer: "cmp-1",
		});
	});
});

describe("attentionPushFromData", () => {
	it("reads the attention form with a numeric or FCM-string count", () => {
		expect(
			attentionPushFromData({
				body: { v: 1, type: "attention", computer: "c", count: 0 },
			}),
		).toEqual({ computer: "c", count: 0 });
		expect(
			attentionPushFromData({
				body: JSON.stringify({
					v: "1",
					type: "attention",
					computer: "c",
					count: "3",
				}),
			}),
		).toEqual({ computer: "c", count: 3 });
	});

	it("carries a malformed count as null", () => {
		expect(
			attentionPushFromData({
				v: 1,
				type: "attention",
				computer: "c",
				count: -1,
			}),
		).toEqual({ computer: "c", count: null });
		expect(
			attentionPushFromData({ v: 1, type: "attention", computer: "c" }),
		).toEqual({ computer: "c", count: null });
	});

	it("refuses other types, versions and a missing computer", () => {
		expect(
			attentionPushFromData({ v: 1, type: "completion", computer: "c" }),
		).toBeNull();
		expect(
			attentionPushFromData({ v: 2, type: "attention", computer: "c" }),
		).toBeNull();
		expect(
			attentionPushFromData({ v: 1, type: "attention", computer: "" }),
		).toBeNull();
	});
});
