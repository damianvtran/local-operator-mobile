import { describe, expect, it } from "vitest";

import { keyShapeError } from "./key-shape.ts";

/**
 * The rule the catalogue's shape is held to. The two legal forms are exercised
 * against the real namespaces' idioms (flat in `mobile.account_routing`, grouped
 * in `mobile.schedules`), so the rule cannot drift away from the catalogue it
 * governs.
 */
describe("keyShapeError", () => {
	const ns = "mobile.schedules";

	it("accepts the flat and the grouped form", () => {
		expect(keyShapeError(ns, "mobile.schedules.title")).toBeUndefined();
		expect(keyShapeError(ns, "mobile.schedules.count.wakes")).toBeUndefined();
	});

	it("rejects a key from another namespace", () => {
		expect(keyShapeError(ns, "mobile.home.title")).toContain("namespace");
	});

	it("rejects an empty remainder", () => {
		expect(keyShapeError(ns, "mobile.schedules.")).toContain("segment");
		expect(keyShapeError(ns, "mobile.schedules")).toContain("namespace");
	});

	it("rejects more than one group and non lower_snake_case segments", () => {
		expect(keyShapeError(ns, "mobile.schedules.a.b.c")).toContain("segments");
		expect(keyShapeError(ns, "mobile.schedules.Title")).toContain("segment");
		expect(keyShapeError(ns, "mobile.schedules.a..b")).toContain("segment");
	});

	/**
	 * The mirrored relay catalogue is exempt from the group limit because its
	 * keys must stay identical to the core's (see key-shape.ts's header). The
	 * exception is deliberately narrow: it is the namespace's prefix that earns
	 * it, so a deep key in an ordinary namespace still fails, and every other
	 * rule still applies to the mirrored files.
	 */
	describe("mirrored relay namespaces", () => {
		const mirrored = "relay.chrome";

		it("allows the core's deeper shape", () => {
			expect(
				keyShapeError(mirrored, "relay.chrome.session.subtitle.not_answering"),
			).toBeUndefined();
			expect(
				keyShapeError(mirrored, "relay.chrome.session.subtitle.ended"),
			).toBeUndefined();
		});

		it("still enforces the prefix and the segment syntax", () => {
			expect(keyShapeError(mirrored, "mobile.home.title")).toContain(
				"namespace",
			);
			expect(
				keyShapeError(mirrored, "relay.chrome.session.Subtitle.not_answering"),
			).toContain("segment");
			expect(keyShapeError(mirrored, "relay.chrome.")).toContain("segment");
		});

		it("does not leak the exemption into an ordinary namespace", () => {
			expect(keyShapeError("relay", "relay.a.b.c.d")).toBeUndefined();
			expect(keyShapeError(ns, "mobile.schedules.a.b.c")).toContain("segments");
		});
	});
});
