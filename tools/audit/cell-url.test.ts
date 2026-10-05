import { describe, expect, it } from "vitest";

import { cellUrl } from "./audit";

/**
 * The audit's URL join, pinned.
 *
 * Regression guard for design round 1, D4: a cell whose `path:` already carried a
 * query (`…?lo-dictation=recording`) was joined with an unconditional `?`, so the
 * cell's own parameter became `recording?lo-theme=dark&…` and `lo-dictation` never
 * applied — the audit measured the ordinary composer and reported the cell's name.
 */
describe("cellUrl", () => {
	it("uses `?` when the cell's path carries no query", () => {
		expect(cellUrl("http://127.0.0.1:1", "/session/abc", "lo-theme=dark")).toBe(
			"http://127.0.0.1:1/session/abc?lo-theme=dark",
		);
	});

	it("uses `&` when the cell's path already carries a query", () => {
		expect(
			cellUrl(
				"http://127.0.0.1:1",
				"/session/abc?lo-dictation=recording",
				"lo-theme=dark&lo-text-scale=2",
			),
		).toBe(
			"http://127.0.0.1:1/session/abc?lo-dictation=recording&lo-theme=dark&lo-text-scale=2",
		);
	});

	it("keeps the cell's own parameters readable, not swallowed by the audit's", () => {
		const url = new URL(
			cellUrl(
				"http://127.0.0.1:1",
				"/session/abc?lo-draft=d&lo-dictation=recording",
				"lo-theme=dark",
			),
		);
		expect(url.searchParams.get("lo-dictation")).toBe("recording");
		expect(url.searchParams.get("lo-draft")).toBe("d");
		expect(url.searchParams.get("lo-theme")).toBe("dark");
	});
});
