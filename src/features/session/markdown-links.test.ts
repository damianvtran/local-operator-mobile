import { describe, expect, it, vi } from "vitest";
import { openMarkdownLink, safeMarkdownHref } from "./markdown-links";

describe("untrusted markdown URL activation", () => {
	it.each([
		"https://www.reuters.com/world/",
		"http://example.com/a_(b)",
		"HTTPS://example.com/path?q=a%20b",
	])("opens the exact safe destination %s", async (href) => {
		const open = vi.fn(async () => undefined);
		expect(safeMarkdownHref(href)).toBe(href);
		expect(await openMarkdownLink(href, open)).toBe(true);
		expect(open).toHaveBeenCalledExactlyOnceWith(href);
	});
	it.each([
		"mailto:hello@example.com",
		"javascript:alert(1)",
		"JaVaScRiPt:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"file:///etc/passwd",
		"intent://example",
		"vbscript:run()",
		"//example.com",
		"/relative",
		"https://",
		" javaScript:alert(1)",
		"java\nscript:alert(1)",
		"https://example.com/\u0000",
		"https://user:password@example.com",
		"javascript&#58;alert(1)",
	])("does not dispatch unsafe or incomplete %s", async (href) => {
		const open = vi.fn(async () => undefined);
		expect(safeMarkdownHref(href)).toBeNull();
		expect(await openMarkdownLink(href, open)).toBe(false);
		expect(open).not.toHaveBeenCalled();
	});
	it("contains failed OS handoffs", async () => {
		expect(
			await openMarkdownLink("https://example.com", async () => {
				throw new Error("unavailable");
			}),
		).toBe(false);
	});
});
