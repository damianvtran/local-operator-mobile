import { describe, expect, it } from "vitest";

import {
	ACK_MAX_BACKOFF_MS,
	type AckGates,
	mayAcknowledge,
	retryDelayMs,
	settlesCompletion,
} from "@/features/session/completion-ack";

/**
 * The transitions the web client learned the hard way, stated once here so the
 * hook only has plumbing left: every gate that must stop an attempt, the
 * cadence that bounds a refusal storm, and the settlement check that refuses to
 * latch on a resolved call.
 */
describe("mayAcknowledge", () => {
	const open: AckGates = {
		appActive: true,
		focused: true,
		blocked: false,
		anchorVisible: true,
		completionComplete: true,
		streaming: false,
		unseen: true,
		hasToken: true,
		hasAnchor: true,
		sameConversation: true,
		hasClient: true,
	};

	it("fires only when every gate holds", () => {
		expect(mayAcknowledge(open)).toBe(true);
	});

	it.each([
		["appActive", { appActive: false }],
		["focused", { focused: false }],
		["blocked", { blocked: true }],
		["anchorVisible", { anchorVisible: false }],
		["completionComplete", { completionComplete: false }],
		["streaming", { streaming: true }],
		["unseen", { unseen: false }],
		["hasToken", { hasToken: false }],
		["hasAnchor", { hasAnchor: false }],
		["sameConversation", { sameConversation: false }],
		["hasClient", { hasClient: false }],
	] as const)("is refused when %s does not hold", (_name, override) => {
		expect(mayAcknowledge({ ...open, ...override })).toBe(false);
	});
});

describe("retryDelayMs", () => {
	it("is flat below the backoff threshold", () => {
		expect(retryDelayMs(0)).toBe(0);
		expect(retryDelayMs(1)).toBe(0);
		expect(retryDelayMs(2)).toBe(0);
	});

	it("back off once the threshold is crossed, doubling to the ceiling", () => {
		// 3 refusals ⇒ 1 s, then 2 s, 4 s, … capped at one minute.
		expect(retryDelayMs(3)).toBe(1_000);
		expect(retryDelayMs(4)).toBe(2_000);
		expect(retryDelayMs(5)).toBe(4_000);
		expect(retryDelayMs(30)).toBe(ACK_MAX_BACKOFF_MS);
	});
});

describe("settlesCompletion", () => {
	const expected = { conversationId: "session/abc", token: "token-a" };

	it("requires all three fields to agree — and `unseen` false", () => {
		expect(
			settlesCompletion(
				{
					conversation_id: "session/abc",
					completion_token: "token-a",
					unseen: false,
				},
				expected,
			),
		).toBe(true);
	});

	it.each([
		[
			"a 200 that still says unseen",
			{
				conversation_id: "session/abc",
				completion_token: "token-a",
				unseen: true,
			},
		],
		[
			"an answer about another conversation",
			{
				conversation_id: "session/other",
				completion_token: "token-a",
				unseen: false,
			},
		],
		[
			"an answer about another token",
			{
				conversation_id: "session/abc",
				completion_token: "token-b",
				unseen: false,
			},
		],
		[
			"an answer with no token at all",
			{ conversation_id: "session/abc", completion_token: null, unseen: false },
		],
	] as const)("refuses to settle on %s", (_name, answer) => {
		expect(settlesCompletion(answer, expected)).toBe(false);
	});
});
