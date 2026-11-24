import { describe, expect, it } from "vitest";
import { listRefreshing } from "./list-refreshing";

describe("conversations pane refresh spinner (PR #327 review m1)", () => {
	it("does not spin over a live route whose attempt is still held by admission", () => {
		expect(listRefreshing({ busy: true, connected: true })).toBe(false);
	});
	it("spins while an attempt is in flight with no live route yet", () => {
		expect(listRefreshing({ busy: true, connected: false })).toBe(true);
	});
	it("stays idle once the attempt has returned", () => {
		expect(listRefreshing({ busy: false, connected: true })).toBe(false);
		expect(listRefreshing({ busy: false, connected: false })).toBe(false);
	});
});
