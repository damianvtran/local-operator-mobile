import { type Block, parseMarkdown } from "@/features/session/markdown";

type Checkpoint = { offset: number; count: number };

export type MarkdownFrame = {
	text: string;
	blocks: Block[];
	checkpoint: Checkpoint | null;
};

export function parseMarkdownFrame(
	text: string,
	streaming: boolean,
	previous: MarkdownFrame | null,
): MarkdownFrame {
	if (previous?.text === text) return previous;
	const append = previous !== null && text.startsWith(previous.text);
	const stable = append ? previous.checkpoint : null;
	const offset = stable?.offset ?? 0;
	const count = stable?.count ?? 0;
	let checkpoint = stable;
	// The parser certifies the boundary, rather than the caller guessing at two
	// newlines (which may still be in a code fence). Any rewrite parses normally.
	const tail = parseMarkdown(
		text.slice(offset),
		streaming
			? (next, blocks) => {
					checkpoint = { offset: offset + next, count: count + blocks };
				}
			: undefined,
	);
	return {
		text,
		checkpoint,
		blocks:
			stable && previous ? [...previous.blocks.slice(0, count), ...tail] : tail,
	};
}
