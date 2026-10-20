import { describe, expect, it } from "vitest";
import { composerControls } from "./composer";
import { sameProjectionOwner, sessionContent } from "./session-content";

const owner = {
	revision: 12,
	tunnelId: "synthetic-computer",
	sessionId: "synthetic-session",
};

describe("session content follows frame identity, not admission availability", () => {
	it("keeps received rows on refusal without pretending the client is ready", () => {
		expect(sessionContent("refused", true)).toBe("transcript");
		expect(sessionContent("refused", false)).toBe("recovery");
		expect(sessionContent("ok", false, true)).toBe("recovery");
	});
	it("never revives rows through absent or pending admission", () => {
		expect(sessionContent("no-route", true)).toBe("disconnected");
		expect(sessionContent("pending", false)).toBe("loading");
		expect(sessionContent("ok", false)).toBe("loading");
	});
	it.each([
		{ ...owner, revision: 13 },
		{ ...owner, tunnelId: "another-computer" },
		{ ...owner, sessionId: "another-session" },
	])("invalidates retained eligibility for a different identity %j", (next) => {
		expect(sameProjectionOwner(owner, next)).toBe(false);
		expect(sessionContent("refused", sameProjectionOwner(owner, next))).toBe(
			"recovery",
		);
	});
	it("requires a real locally observed owner, not just a cached projection", () => {
		expect(sameProjectionOwner(null, owner)).toBe(false);
		expect(sameProjectionOwner({ ...owner }, owner)).toBe(true);
	});
});

describe("refused composer admission", () => {
	it("keeps a nonempty draft from enabling send or stop while the client is withdrawn", () => {
		const controls = composerControls({
			connected: false,
			streaming: true,
			hasDraft: true,
			hasImages: false,
			sending: false,
			envelopePending: false,
			ended: false,
		});
		expect(controls.primary.disabled).toBe(true);
		expect(controls.stopVisible).toBe(false);
	});
});
