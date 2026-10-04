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

	it("passes an id that is dot segments through", () => {
		/* `.` and `..` are the one path shape decoding can smuggle past the `/`
		 * check — a router normalising them would climb out of the segment the
		 * rewrite claims — so the guard reads the DECODED id (`%2e%2e` reaches it
		 * as `..`). `...` is not a dot segment, but an id of only dots is no
		 * session id, and one predicate covers the class. */
		const passthrough = [
			"localoperator://s/..",
			"localoperator://s/.",
			"localoperator://s/...",
			"localoperator://s/%2e%2e",
		];
		for (const path of passthrough) {
			expect(nativeIntentFor(path)).toEqual({ path, sessionId: null });
		}
	});

	it("never throws on a malformed escape or an unencodable id", () => {
		/* A lone `%` is not a decodable id, and an unpaired surrogate decodes but
		 * has no UTF-8 spelling to re-encode (the encode is the second half of the
		 * same operation); the honest answer to both is the original string, not a
		 * crash at cold start. */
		const passthrough = [
			"localoperator://s/%",
			"localoperator://s/\uD800",
			"localoperator://s/a\uDC00b",
		];
		for (const path of passthrough) {
			expect(nativeIntentFor(path)).toEqual({ path, sessionId: null });
		}
	});
});
