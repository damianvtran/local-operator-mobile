import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-constants", () => ({
	default: { expoConfig: { version: "0.0.0" } },
}));
vi.mock("@/notifications/install-id", () => ({
	ensureInstallRecord: async () => ({ v: 1, install_id: "inst-1" }),
}));

import { foregroundBehaviour, quietWhileWatching } from "@/team-bridge/push";
import {
	TEAM_BRIDGE_PUSH_TYPE,
	teamBridgePushFromData,
	teamBridgePushFromResponse,
	teamBridgeThreadPath,
} from "@/team-bridge/push-payload";

/** The exact `data` object the hub's composer sends (agent-server push slice). */
const wire = {
	v: 1,
	type: TEAM_BRIDGE_PUSH_TYPE,
	tenant_id: "ten_0123456789abcdef",
	conversation_id: "bcv_dm_ada",
	message_id: "bcm_7",
	seq: 7,
};

describe("team bridge push payload", () => {
	it("parses the hub's data object into a destination", () => {
		expect(teamBridgePushFromData(wire)).toEqual({
			tenantId: wire.tenant_id,
			conversationId: wire.conversation_id,
			messageId: "bcm_7",
			seq: 7,
		});
	});

	it("parses the Android form: expo re-parses the FCM `body` JSON string, or hands the string through", () => {
		expect(teamBridgePushFromData(JSON.stringify(wire))?.conversationId).toBe(
			"bcv_dm_ada",
		);
		expect(teamBridgePushFromData({ ...wire, v: "1", seq: "7" })?.seq).toBe(7);
	});

	it("reads it out of a full expo response, the cold-start shape", () => {
		const response = { notification: { request: { content: { data: wire } } } };
		expect(teamBridgePushFromResponse(response)?.tenantId).toBe(wire.tenant_id);
	});

	it("refuses every other push type and every malformed shape", () => {
		expect(teamBridgePushFromData({ ...wire, type: "completion" })).toBeNull();
		expect(teamBridgePushFromData({ ...wire, v: 2 })).toBeNull();
		expect(teamBridgePushFromData({ ...wire, conversation_id: "" })).toBeNull();
		expect(
			teamBridgePushFromData({ ...wire, conversation_id: ".." }),
		).toBeNull();
		expect(
			teamBridgePushFromData({ ...wire, tenant_id: "../../etc" }),
		).toBeNull();
		expect(teamBridgePushFromData("not json")).toBeNull();
		expect(teamBridgePushFromData(null)).toBeNull();
		expect(teamBridgePushFromData([wire])).toBeNull();
		expect(
			teamBridgePushFromResponse({ notification: { request: {} } }),
		).toBeNull();
	});

	it("an odd seq is dropped, not fatal: the tap still opens the thread", () => {
		expect(teamBridgePushFromData({ ...wire, seq: -1 })).toMatchObject({
			seq: null,
			conversationId: "bcv_dm_ada",
		});
	});

	it("routes a tap to the thread, encoding the ids", () => {
		expect(
			teamBridgeThreadPath({ tenantId: "t 1", conversationId: "c/2" }),
		).toBe("/team-bridge/t%201/c%2F2");
	});
});

describe("foreground presentation", () => {
	const push = teamBridgePushFromData(wire);
	const here = {
		tenantId: wire.tenant_id,
		conversationId: wire.conversation_id,
	};

	it("stays quiet only for the thread on screen", () => {
		expect(quietWhileWatching(push, here)).toBe(true);
		expect(quietWhileWatching(push, { ...here, conversationId: "other" })).toBe(
			false,
		);
		expect(quietWhileWatching(push, null)).toBe(false);
	});

	it("shows a teammate's message on another thread, never sets the icon badge", () => {
		expect(foregroundBehaviour(push, null)).toEqual({
			shouldShowBanner: true,
			shouldShowList: true,
			shouldPlaySound: true,
			shouldSetBadge: false,
		});
		expect(foregroundBehaviour(push, here).shouldShowBanner).toBe(false);
	});

	it("keeps expo's no-handler default (nothing shown) for every push that is not Team Bridge", () => {
		expect(foregroundBehaviour(null, null)).toEqual({
			shouldShowBanner: false,
			shouldShowList: false,
			shouldPlaySound: false,
			shouldSetBadge: false,
		});
	});
});
