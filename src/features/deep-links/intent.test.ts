import { describe, expect, it } from "vitest";

import { nativeIntentFor } from "@/features/deep-links/intent";

/**
 * `redirectSystemPath` is native-only and runs outside app context, so the web
 * harness cannot exercise it end to end — the pure function is the whole
 * testable surface, and it has to be total: every malformed link must come
 * back as a pass-through rather than a throw or a guess.
 */
describe("nativeIntentFor", () => {
	it("rewrites the session link to the app's own route", () => {
		expect(nativeIntentFor("localoperator://s/6714def86197")).toEqual({
			path: "/session/6714def86197",
			sessionId: "6714def86197",
		});
	});

	it("accepts the single-slash spelling and a cased scheme", () => {
		// Some tools normalise `localoperator://s/x` to `localoperator:s/x`, and
		// schemes are case-insensitive; neither spelling is a different link.
		expect(nativeIntentFor("localoperator:s/abc123")).toEqual({
			path: "/session/abc123",
			sessionId: "abc123",
		});
		expect(nativeIntentFor("LocalOperator://s/abc123")).toEqual({
			path: "/session/abc123",
			sessionId: "abc123",
		});
	});

	it("decodes an id and re-escapes it into the route", () => {
		// The id goes into a route by string interpolation; an id that decoded
		// into a path separator must not survive the trip.
		expect(nativeIntentFor("localoperator://s/a%2Bb")).toEqual({
			path: "/session/a%2Bb",
			sessionId: "a+b",
		});
	});

	it("passes every non-link through unchanged", () => {
		const passthrough = [
			"https://example.com/s/6714def86197",
			"localoperator://session/6714def86197",
			"localoperator://s/",
			"localoperator://s/a/b",
			"localoperator://s/a?x=1",
			"localoperator://s/a#frag",
			"myapp://s/1",
			"/s/1",
			"",
			"not a url at all",
		];
		for (const path of passthrough) {
			expect(nativeIntentFor(path)).toEqual({ path, sessionId: null });
		}
	});

	it("never throws on a malformed escape", () => {
		// A lone `%` is not a decodable id; the honest answer is the original
		// string, not a crash at cold start.
		const path = "localoperator://s/%";
		expect(nativeIntentFor(path)).toEqual({ path, sessionId: null });
	});
});
