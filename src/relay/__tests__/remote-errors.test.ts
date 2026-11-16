import { describe, expect, it } from "vitest";
import { relayErrorFromResponse } from "../errors";
import { isRemoteFailureResponse } from "../remote-errors";

const facts = (status: number, code: string, remote = true) => ({
	status,
	header: () => null,
	body: { error: code, code, remote },
});

describe("remote owner failures are not phone logout", () => {
	it.each([
		[503, "remote_owner_unresolved"],
		[503, "remote_unreachable"],
		[409, "remote_unsupported"],
		[403, "remote_forbidden"],
		[404, "remote_session_missing"],
		[409, "remote_cursor_missing"],
		[409, "remote_command_ambiguous"],
	])(
		"classifies %s %s without auth recovery or automatic replay",
		(status, code) => {
			const error = relayErrorFromResponse(
				facts(status as number, code as string),
			);
			expect(error.kind).toBe("rejected");
			expect(error.surface).toBe("none");
			expect(error.retry).toBe("never");
			expect(error.displayableMessage).not.toContain("remote_");
			expect(error.code).toBe(code);
			expect(error.envelope).toBe(
				code === "remote_command_ambiguous" ? "keep" : "clear",
			);
		},
	);
	it("requires the marker AND known code/status; a genuine 401 remains authentication", () => {
		expect(isRemoteFailureResponse(503, { code: "remote_unreachable" })).toBe(
			false,
		);
		expect(
			isRemoteFailureResponse(401, { code: "remote_forbidden", remote: true }),
		).toBe(false);
		expect(
			isRemoteFailureResponse(403, { code: "future_code", remote: true }),
		).toBe(false);
		expect(
			relayErrorFromResponse(facts(403, "remote_forbidden", false)).kind,
		).toBe("origin-refused");
		expect(relayErrorFromResponse(facts(401, "remote_forbidden")).kind).toBe(
			"relay-unauthorized",
		);
	});
});
