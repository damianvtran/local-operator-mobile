import { describe, expect, it } from "vitest";
import { diagnosticsText, redact } from "./diagnostics-text";

/**
 * "Copy diagnostics" leaves the app (clipboard → chat with a helper), so the
 * text must name the route, stream, last error, version, tunnel and computer —
 * and never a credential, whatever a future field drags in.
 */
/* Fabricated values, assembled at run time so the source holds no literal
 *  that looks like a real credential. */
const FAKE_JWT = [
	"eyJ",
	"hbGciOiJub25lIn0",
	".",
	"eyJzdWIiOiJmYWtlIn0",
	".",
	"c2ln",
].join("");
const FAKE_TOKEN = `fake${"Q".repeat(60)}`;
const FAKE_PASSWORD = ["hunter", "2", "-relay-", "pw"].join("");
const FAKE_COOKIE = `lo_session=${"c".repeat(12)}`;
const SECRETS = [FAKE_PASSWORD, FAKE_TOKEN, FAKE_COOKIE, FAKE_JWT];

describe("Copy diagnostics", () => {
	it("carries everything a helper compares, for a Radient route", () => {
		const text = diagnosticsText({
			route: {
				mode: "radient",
				hostname: "0123456789abcdef0123456789abcdef-lop.example.com",
				tunnelId: "0123456789abcdef0123456789abcdef",
			},
			computerName: "Studio Mac",
			stream: "degraded",
			lastError: "computer-offline 503",
			version: "1.2.3",
			platform: "ios",
		});
		expect(text).toBe(
			[
				"App: Local Operator mobile 1.2.3 (ios)",
				"Route: Radient tunnel",
				"Tunnel id: 0123456789abcdef0123456789abcdef",
				"Tunnel host: 0123456789abcdef0123456789abcdef-lop.example.com",
				"Computer: Studio Mac",
				"Stream: degraded",
				"Last error: computer-offline 503",
			].join("\n"),
		);
	});

	it("never carries a token, cookie or password, even when a field holds one", () => {
		const text = diagnosticsText({
			route: {
				mode: "custom",
				baseUrl: [
					"https://user:",
					FAKE_PASSWORD,
					"@relay.example.com/path?token=",
					FAKE_TOKEN,
					"#frag",
				].join(""),
			},
			computerName: `Mac password=${SECRETS[0]}`,
			stream: "live",
			lastError: [
				"rejected 401 Bearer ",
				FAKE_JWT,
				" cookie: ",
				FAKE_COOKIE,
			].join(""),
			version: "1.2.3",
			platform: "web",
		});
		for (const secret of SECRETS) expect(text).not.toContain(secret);
		expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
		expect(text).toContain("Address: https://relay.example.com");
		expect(text).toContain("Last error: rejected 401 Bearer [redacted]");
	});

	it("leaves a plain value and a 32-hex tunnel id alone", () => {
		expect(redact("0123456789abcdef0123456789abcdef")).toBe(
			"0123456789abcdef0123456789abcdef",
		);
		expect(redact("computer-offline 503")).toBe("computer-offline 503");
	});
});
