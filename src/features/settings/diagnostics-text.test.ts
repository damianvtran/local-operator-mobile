import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reasonCodeOf } from "@/features/auth/stream-health-reason";
import { RelayError } from "@/relay/errors";
import {
	diagnosticsReasonValue,
	diagnosticsText,
	REDACT_MAX_CHARS,
	redact,
} from "./diagnostics-text";

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

/* PR #328 review round 1, R1: the attach handoff's trail rides Copy
 *  diagnostics, because a TestFlight build has no other log a reader can send. */
describe("Copy diagnostics carries the attach handoff trail", () => {
	const base = {
		route: null,
		computerName: null,
		stream: "live",
		lastError: null,
		version: "1.2.3",
		platform: "ios",
	} as const;
	it("as one line when there is a trail", () => {
		expect(
			diagnosticsText({
				...base,
				attachHandoff: "onDismiss 14ms, fallback 1000ms, late onDismiss 1180ms",
			})
				.split("\n")
				.at(-1),
		).toBe(
			"Attach handoff: onDismiss 14ms, fallback 1000ms, late onDismiss 1180ms",
		);
	});
	it("and not at all when there is none", () => {
		expect(diagnosticsText({ ...base, attachHandoff: null })).not.toContain(
			"Attach handoff",
		);
	});
	it("from the handoff's own trail, read when the reader copies", () => {
		const settings = readFileSync(
			new URL("./settings.tsx", import.meta.url),
			"utf8",
		);
		expect(settings).toContain("attachHandoff: attachHandoffDiagnostics(),");
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

/* PR #261 round 2: the shapes reviewer R2-3 and QA Q8 seeded through Copy
 *  diagnostics that still survived whole, the cost bound (R2-4) and the JWT
 *  anchor (R2-5). Values are assembled at run time, as above. */
/** The marker a redacted line keeps, so it still says something was removed. */
const REDACTION_MARK = /\[redacted\]|\[email\]/;

describe("Copy diagnostics redaction, round 2", () => {
	const tok = ["Tk", "9r", "ZW4", "tc2Vj", "cmV0", "LXZh", "bHVl"].join("");
	const b64 = (text: string) => Buffer.from(text).toString("base64");
	/* Standard base64 with `=` padding, and a segment carrying `+` and `/`. */
	const paddedJwt = [
		b64('{"alg":"HS256"}'),
		b64('{"sub":"x"}'),
		b64("sig\u00fb\u00ef"),
	].join(".");
	const standardJwt = [b64('{"alg":"HS256"}'), "ab+cd/ef", "gh+/ij"].join(".");
	const cases: Array<[string, string, string]> = [
		["JSON password (R2-3, Q8)", `{"password":"${tok}"}`, tok],
		[
			"JSON access_token with a space (R2-3, Q8)",
			`{"access_token": "${tok}"}`,
			tok,
		],
		["JSON cookie (R2-3)", `{"cookie":"foo=${tok}"}`, tok],
		["JSON client_secret", `{"client_secret":"${tok}"}`, tok],
		["URL-encoded token= (R2-3, Q8)", `token%3D${tok}`, tok],
		[
			"URL-encoded Authorization: Bearer (R2-3)",
			`Authorization%3A%20Bearer%20${tok}`,
			tok,
		],
		["URL-encoded email (R2-3, Q8)", "sherman.qa%40example.com", "sherman.qa"],
		["URL-encoded macOS home (R2-3, Q8)", "%2FUsers%2Fsherman%2Fx", "sherman"],
		["URL-encoded Linux home", "%2Fhome%2Fsherman%2Fx", "sherman"],
		[
			"padded JWT (R2-3, Q8)",
			`reason ${paddedJwt} end`,
			paddedJwt.split(".")[1] ?? "?",
		],
		["standard-base64 JWT (Q8)", `reason ${standardJwt} end`, "gh+/ij"],
	];
	it.each(cases)("%s", (_name, seeded, secret) => {
		expect(paddedJwt).toContain("=");
		const text = diagnosticsText({
			route: null,
			computerName: null,
			stream: "live",
			lastError: `gateway-refused 503 ${seeded}`,
			version: "1.2.3",
			platform: "web",
		});
		expect(text).not.toContain(secret);
		expect(text).toMatch(REDACTION_MARK);
	});

	it("R2-5: a host or word that merely starts with ey keeps its name", () => {
		for (const value of [
			"https://eyrie.example.com",
			"eyes.are.blue",
			"gateway-refused 503 server_unavailable",
		])
			expect(redact(value)).toBe(value);
	});

	it("R2-4: 40k characters of hostile input redact in under 50 ms each", () => {
		const hostile = [
			"a.".repeat(20_000),
			"abcdefgh-".repeat(4_445),
			"?a".repeat(20_000),
			"a@".repeat(20_000),
			"%41".repeat(13_334),
			`${"x".repeat(39_990)}@example.com`,
		];
		/* Warm the regexes once so the first case does not pay compilation. */
		redact("warm-up");
		for (const value of hostile) {
			const started = performance.now();
			const out = redact(value);
			const elapsed = performance.now() - started;
			expect(elapsed).toBeLessThan(50);
			expect(out.length).toBeLessThan(REDACT_MAX_CHARS + 100);
			expect(out.endsWith("…[truncated]")).toBe(true);
		}
	});

	it("a value at the cap is redacted whole, with no truncation mark", () => {
		const value = `password=${tok} ${"x".repeat(REDACT_MAX_CHARS - 40)}`;
		expect(value.length).toBeLessThanOrEqual(REDACT_MAX_CHARS);
		const out = redact(value);
		expect(out).not.toContain(tok);
		expect(out).not.toContain("[truncated]");
	});
});

/* The PR #258 Reason row met PR #261's redaction in the merge of main (round 6):
 *  the code is identifier-shaped by construction, so a URL or host cannot reach
 *  the row, but an opaque identifier-shaped run can, and the row is selectable. */
describe("Diagnostics Reason row goes through the same redaction", () => {
	/* Fabricated at run time: lowercase hex-like, starts with a letter, 61
	 *  characters, so it passes `reasonCodeOf`'s identifier shape. */
	const opaque = `a${"0f".repeat(30)}`;

	it("a URL, host or bearer on the wire never becomes the shown code", () => {
		const error = new RelayError("rejected", "x", {
			reasonRaw: "https://relay.example.com/x?token=abc",
			code: "my-mac.local",
			serverError: `Bearer ${opaque}`,
		});
		expect(diagnosticsReasonValue(reasonCodeOf(error))).toBe(
			"reason: rejected",
		);
	});

	it("an identifier-shaped opaque token that passes the shape is redacted", () => {
		const code = reasonCodeOf(
			new RelayError("rejected", "x", { serverError: opaque }),
		);
		/* The negative control: the shape alone lets it through. */
		expect(code).toBe(opaque);
		const shown = diagnosticsReasonValue(code);
		expect(shown).not.toContain(opaque);
		expect(shown).toBe("reason: [redacted]");
	});

	it("leaves every ordinary code as it is", () => {
		for (const code of [
			"stream_stalled",
			"control_plane_unreachable",
			"operator_authority_required",
			"relay_unreachable",
			"computer-offline",
			"rate-limit_2",
		])
			expect(diagnosticsReasonValue(code)).toBe(`reason: ${code}`);
	});

	it("Settings renders the row through it, with no raw template left", () => {
		const settings = readFileSync(
			fileURLToPath(new URL("./settings.tsx", import.meta.url)),
			"utf8",
		);
		expect(settings).toContain("diagnosticsReasonValue(code)");
		expect(settings).not.toMatch(/`reason: \$\{/);
	});
});

/* The Last error row's `value` expression, from its label to the row's close. */
const LAST_ERROR_ROW =
	/label=\{t\("mobile\.settings\.diagnostics\.last_error"\)\}([\s\S]*?)\/>/;
/* The pre-fix shape: the summary rendered as it came. */
const RAW_SUMMARY = /\?\s*diagnosticError\.summary/;

/* PR #261 QA O1, carried in by PR #262: the on-screen "Last error" row showed
 *  `diagnosticError.summary` raw while Copy diagnostics redacted the same value.
 *  The summary is "kind status reason" and the reason is the relay's or the
 *  gateway's own words, so a token can ride in it. Settings cannot be imported
 *  in Node (its styling stack), so — as for the Reason row above — the screen
 *  half is pinned over the source and the value half driven through the same
 *  `redact` the row now calls, on summaries built by the real `RelayError`. */
describe("Diagnostics Last error row goes through the same redaction", () => {
	const SETTINGS = readFileSync(
		fileURLToPath(new URL("./settings.tsx", import.meta.url)),
		"utf8",
	);
	/* What the row renders for an error, as the screen composes it. */
	const shown = (error: RelayError) => redact(error.summary);
	/* Fabricated at run time: 61 lowercase hex characters. */
	const HEX_61 = `a${"0f".repeat(30)}`;
	const URL_TOKEN = `tok${"Z".repeat(20)}`;
	const BEARER_TOKEN = `bear${"Y".repeat(20)}`;

	it("Settings renders the row's error through `redact`, never raw", () => {
		const row = LAST_ERROR_ROW.exec(SETTINGS)?.[1];
		expect(row).toBeDefined();
		expect(row).toContain("? redact(diagnosticError.summary)");
		expect(row).not.toMatch(RAW_SUMMARY);
	});

	it("a URL token, a Bearer token and a 61-character hex run are redacted on screen", () => {
		const cases: Array<[RelayError, string]> = [
			[
				new RelayError("rejected", "x", {
					status: 401,
					reasonRaw: `https://relay.example.com/v1/x?token=${URL_TOKEN}`,
				}),
				URL_TOKEN,
			],
			[
				new RelayError("rejected", "x", {
					status: 401,
					reasonRaw: `Bearer ${BEARER_TOKEN}`,
				}),
				BEARER_TOKEN,
			],
			[
				new RelayError("gateway-refused", "x", {
					status: 503,
					reasonRaw: HEX_61,
				}),
				HEX_61,
			],
		];
		for (const [error, secret] of cases) {
			/* The negative control: the raw summary carries it. */
			expect(error.summary).toContain(secret);
			expect(shown(error)).not.toContain(secret);
			expect(shown(error)).toContain("[redacted]");
			/* And the screen now agrees with what Copy diagnostics copies. */
			expect(
				diagnosticsText({
					route: null,
					computerName: null,
					stream: "degraded",
					lastError: error.summary,
					version: "1.2.3",
					platform: "ios",
				}),
			).toContain(`Last error: ${shown(error)}`);
		}
	});

	it("leaves an ordinary error summary as it is", () => {
		for (const error of [
			new RelayError("gateway-refused", "x", {
				status: 503,
				reasonRaw: "server_unavailable",
			}),
			new RelayError("transport", "x", {
				transportCause: "refused",
			}),
			new RelayError("computer-offline", "x", { status: 503 }),
		])
			expect(shown(error)).toBe(error.summary);
	});
});
