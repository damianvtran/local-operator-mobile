import { describe, expect, it } from "vitest";

import {
	conversationPushFromData,
	conversationPushFromResponse,
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
