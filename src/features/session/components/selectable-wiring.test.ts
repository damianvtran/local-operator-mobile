import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Call-site wiring for drag-to-select (PR #233 QA round 1 lead): the component
 * contract is pinned in `selectable-message.test.tsx`, but nothing pinned that
 * each message surface actually renders through it — only a web check did.
 *
 * Source-level on purpose, like `tool-row.test.ts`: these rows reach `uniwind`,
 * which the Node test environment cannot render. The assistant answer and the
 * code block render for real in `markdown.test.tsx`; here each surface is
 * pinned to the one line that routes it into `SelectableMessage`.
 */
/* Every pattern hoisted (biome `useTopLevelRegex`). */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;
const NEXT_DECLARATION = /\n(?:export )?(?:const|function) [A-Z]/;
const USER_BUBBLE =
	/<SelectableMessage\s+text=\{entry\.text\}\s+textClassName=\{userTextClass\}\s+disabled=\{clamp\}\s*>\s*<SelectableLeafText/;
const DIFF_BLOCK = /const DiffBlock = /;
const TEXT_BLOCK = /const TextBlock = /;
const OUTPUT_WELL =
	/<SelectableMessage text=\{joined\}[^>]*>\s*<SelectableLeafText/;
const MARKDOWN = /export const Markdown = /;
const ANSWER_WRAPPER = /<SelectableMessage text=\{plainText\}/;
const CODE_BLOCK_USE = /<CodeBlock\b/;
const CODE_BLOCK_MEMO = /const CodeBlock = memo\(\s*CodeBlockView\b/;
const CODE_BLOCK_VIEW = /function CodeBlockView\(/;
const FORWARDS_HOLD = /onLongPress=\{enter\}/;
const THREAD_BODY = /<Markdown text=\{message\.body\} \/>/;
const BRIDGE_CARD_BODY = /<Markdown text=\{bridgeMessage\} \/>/;

const read = (relative: string): string =>
	readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Comments are stripped so a commented-out call site cannot pass. */
const code = (relative: string): string =>
	read(relative).replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");

/** The JSX between a component's declaration and the next top-level one. */
const component = (source: string, name: RegExp): string => {
	const start = source.search(name);
	expect(start, `declaration ${name} not found`).toBeGreaterThanOrEqual(0);
	const rest = source.slice(start);
	const next = rest.slice(1).search(NEXT_DECLARATION);
	return next < 0 ? rest : rest.slice(0, next + 1);
};

describe("every message surface routes through SelectableMessage", () => {
	it("the user bubble selects its own prompt, with no mode for a clamped preview", () => {
		const row = code("./transcript-row.tsx");
		expect(row).toMatch(USER_BUBBLE);
	});

	it("both tool output wells (diff and text) wrap a selectable leaf", () => {
		const row = code("./tool-row.tsx");
		for (const name of [DIFF_BLOCK, TEXT_BLOCK]) {
			const body = component(row, name);
			expect(body).toMatch(OUTPUT_WELL);
		}
	});

	it("an assistant answer, and so its code blocks, render inside one SelectableMessage", () => {
		const markdown = code("./markdown.tsx");
		const answer = component(markdown, MARKDOWN);
		expect(answer).toMatch(ANSWER_WRAPPER);
		expect(answer).toMatch(CODE_BLOCK_USE);
		expect(markdown).toMatch(CODE_BLOCK_MEMO);
		// The code block's copy Pressable is the deepest responder under a hold,
		// so it must forward the long-press into the message's mode.
		const block = component(markdown, CODE_BLOCK_VIEW);
		expect(block).toMatch(FORWARDS_HOLD);
	});

	it("Team Bridge bodies (thread messages and the bridge card) render through Markdown", () => {
		expect(code("../../team-bridge/thread-screen.tsx")).toMatch(THREAD_BODY);
		expect(code("./tool-row.tsx")).toMatch(BRIDGE_CARD_BODY);
	});
});
