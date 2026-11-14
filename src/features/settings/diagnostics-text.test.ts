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
				"Tunnel address: 0123456789abcdef0123456789abcdef-lop.example.com",
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

	it("carries what the reader sees and when, with labels matching the screen (U7, U12)", () => {
		const text = diagnosticsText({
			route: {
				mode: "radient",
				hostname: "0123456789abcdef0123456789abcdef-lop.example.com",
				tunnelId: "0123456789abcdef0123456789abcdef",
			},
			computerName: "Studio Mac",
			status: "Not answering",
			cause: "radient-unreachable",
			stream: "degraded",
			lastError: "gateway-refused 503 server_unavailable",
			lastErrorAt: Date.UTC(2026, 10, 14, 2, 3, 4),
			version: "1.2.3",
			platform: "web",
		});
		expect(text.split("\n")).toEqual([
			"App: Local Operator mobile 1.2.3 (web)",
			"Route: Radient tunnel",
			"Tunnel id: 0123456789abcdef0123456789abcdef",
			"Tunnel address: 0123456789abcdef0123456789abcdef-lop.example.com",
			"Computer: Studio Mac",
			"Status: Not answering",
			"Cause: radient-unreachable",
			"Stream: degraded",
			"Last error: gateway-refused 503 server_unavailable",
			"Last error at: 2026-11-14T02:03:04.000Z",
		]);
	});
});

/* PR #261 Q5/R3: every shape round 1 leaked, seeded and read back. Values are
 *  assembled at run time so the source holds no credential-looking literal. */
describe("Copy diagnostics redacts every secret shape", () => {
	const b64 = (text: string) => Buffer.from(text).toString("base64url");
	/* QA's exact cases: a bare JWT with 20/63/39-char segments, and a short JWT
	 *  whose every segment is under 48 characters. */
	const qaJwt = [
		b64('{"alg":"HS256"}'),
		b64(`{"sub":"${"s".repeat(30)}","iat":1700000000}`),
		b64("signature-bytes-for-test"),
	].join(".");
	const shortJwt = [b64('{"a":1}'), b64('{"b":2}'), b64("sig")].join(".");
	const opaque = ["Zk9", "vYmFy", "LXNlY3JldA"].join("");
	const cases: Array<[string, string, string]> = [
		["bare JWT (QA)", `reason ${qaJwt} end`, qaJwt],
		["short JWT (QA)", `reason ${shortJwt} end`, shortJwt],
		[
			"JWT header alone",
			`x ${qaJwt.split(".")[0]}.${qaJwt.split(".")[1]}.`,
			qaJwt.split(".")[1] ?? "?",
		],
		[
			"dotted non-JSON token",
			`t ${"A".repeat(10)}.${"B".repeat(12)}.${"C".repeat(9)}`,
			"B".repeat(12),
		],
		["lowercase bearer", `authorization: bearer ${opaque}`, opaque],
		["BEARER", `BEARER ${opaque}`, opaque],
		["x-auth header", `x-auth: ${opaque}`, opaque],
		["x-api-key header", `X-Api-Key: ${opaque}`, opaque],
		[
			"every cookie pair",
			`Cookie: a=1; lo_sid=${opaque}; __Host-radient-grant=${opaque}2`,
			`${opaque}2`,
		],
		["cookie= form (QA)", `cookie=__Host-radient-grant=${opaque}`, opaque],
		["?t=", `https://h.example.com/p?t=${opaque}`, opaque],
		["&sig=", `https://h.example.com/p?a=1&sig=${opaque}`, opaque],
		[
			"X-Amz-Signature",
			`https://b.example.com/o?X-Amz-Signature=${opaque}`,
			opaque,
		],
		["sessionid", `sessionid=${opaque}`, opaque],
		["vendor query value", `https://h.example.com/?whatever=${opaque}`, opaque],
		["?token= (QA)", `https://cb.example.com/return?token=${opaque}`, opaque],
		["password= (QA)", `password=${opaque}`, opaque],
		["email (QA)", "sherman.qa@example.com", "sherman.qa@example.com"],
		["userinfo", `https://user:${opaque}@relay.example.com`, opaque],
		["macOS home", "/Users/sherman/Library/x", "sherman"],
		["Linux home", "/home/sherman/.config", "sherman"],
	];
	it.each(cases)("%s", (_name, seeded, secret) => {
		const text = diagnosticsText({
			route: null,
			computerName: seeded,
			stream: "live",
			lastError: `rejected 503 ${seeded}`,
			version: "1.2.3",
			platform: "web",
		});
		expect(text).not.toContain(secret);
		/* The marker is there, so the line still says SOMETHING was removed. */
		expect(text).toMatch(/\[redacted\]|\[email\]/);
	});

	it("keeps the facts a helper needs", () => {
		const keep = [
			"0123456789abcdef0123456789abcdef-lop.radienthq.com",
			"gateway-refused 503 server_unavailable",
			"Local Operator mobile 1.2.3",
			"https://h.example.com/p?t=",
		];
		for (const value of keep) expect(redact(value)).toBe(value);
	});
});
