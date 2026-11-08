import { describe, expect, it } from "vitest";
import {
	CONTROL,
	IDENTIFIER_FAMILIES,
	isKnownIdentifier,
	SCREEN,
	SURFACE,
	teamBridgeChiefId,
	teamBridgeConversationId,
	teamBridgeGateId,
	teamBridgeMessageId,
	teamBridgeNotifyId,
	teamBridgeOrganizationId,
	teamBridgePersonId,
} from "@/ui/a11y";

/** Existing capture selectors must survive centralization; recognition alone
 * would also pass after an accidental rename of both builder and family. */
describe("Team Bridge identifier stability", () => {
	it.each([
		[teamBridgeGateId, "checking", "team-bridge-gate-"],
		[
			teamBridgeConversationId,
			"conversation-example",
			"team-bridge-conversation-",
		],
		[teamBridgePersonId, "account-example", "team-bridge-person-"],
		[teamBridgeChiefId, "endpoint-example", "team-bridge-chief-"],
		[teamBridgeOrganizationId, "tenant-example", "team-bridge-org-"],
		[teamBridgeMessageId, "message-example", "team-bridge-message-"],
		[teamBridgeNotifyId, "mention", "team-bridge-notify-"],
	] as const)("registers and preserves %s", (build, value, prefix) => {
		expect(IDENTIFIER_FAMILIES).toContain(prefix);
		expect(build(value)).toBe(`${prefix}${value}`);
		expect(isKnownIdentifier(build(value))).toBe(true);
		expect(isKnownIdentifier(prefix)).toBe(false);
	});
	it("preserves screen, navigation and composer selectors", () => {
		expect(SCREEN.teamBridgeList).toBe("team-bridge-list");
		expect(SCREEN.teamBridgeThread).toBe("team-bridge-thread");
		expect(CONTROL.teamBridgeNavigation).toBe("team-bridge-navigation");
		expect(CONTROL.teamBridgeMessageInput).toBe("team-bridge-message-input");
		expect(SURFACE.teamBridgeComposer).toBe("team-bridge-composer");
	});
});
