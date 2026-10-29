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
});
