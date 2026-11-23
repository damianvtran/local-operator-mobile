import { describe, expect, it } from "vitest";
import { parseMarkdown } from "@/features/session/markdown";
import {
	type MarkdownFrame,
	parseMarkdownFrame,
} from "@/features/session/streaming-markdown";

const STREAM = [
	"# A fixed heading\n\n",
	"**Bold** and [link](https://example.com).\n \n",
	"| item | count |\n| --- | --- |\n| one | 1 |\n\n",
	"```sh\nprintf '%s' hello\n\nprintf done\n```\n\n",
	"- first\n  - second\n\n",
	"> quote\n> continuation\n\n",
	"Arabic سلام and a split emoji 👩‍💻 and é.",
].join("");

describe("streaming Markdown checkpoints", () => {
	it("matches a complete parse at every UTF-16 boundary, including incomplete delimiters and graphemes", () => {
		let old: MarkdownFrame | null = null;
		for (let end = 0; end <= STREAM.length; end++) {
			const text = STREAM.slice(0, end);
			old = parseMarkdownFrame(text, true, old);
			const starts: number[] = [];
			expect(old.blocks).toEqual(
				parseMarkdown(text, undefined, (offset) => starts.push(offset)),
			);
			expect(old.starts).toEqual(starts);
		}
	});

	it("does not checkpoint within a fence, reuses complete blocks, and reparses corrections", () => {
		const a = parseMarkdownFrame("fixed\n\n```sh\nhello\n\n", true, null);
		const b = parseMarkdownFrame(
			`${a.text}world\n\x60\x60\x60\n\nfinal`,
			true,
			a,
		);
		expect(a.checkpoint).toEqual({ count: 1, offset: 7 });
		expect(b.blocks[0]).toBe(a.blocks[0]);
		expect(b.blocks).toEqual(parseMarkdown(b.text));
		const final = parseMarkdownFrame(`${b.text} answer`, false, b);
		expect(final.blocks[1]).toBe(b.blocks[1]);
		expect(final.blocks).toEqual(parseMarkdown(final.text));
		const correction = parseMarkdownFrame(
			final.text.replace("fixed", "corrected"),
			true,
			final,
		);
		expect(correction.blocks[0]).not.toBe(final.blocks[0]);
		expect(correction.blocks).toEqual(parseMarkdown(correction.text));
	});
});
