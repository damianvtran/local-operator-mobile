import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COLOR_ROLES } from "@/ui/tokens.gen";

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
/* Integration of #233 with #235: the user prompt's one-line condensed preview
 * is gone (every prompt takes the Show-more clamp), so the mode is never
 * disabled there; the pin is the same route without `disabled={clamp}`. */
const USER_BUBBLE =
	/<SelectableMessage\s+text=\{entry\.text\}\s+textClassName=\{userTextClass\}\s+onEnter=\{expand\}\s*>\s*<SelectableLeafText/;
const DIFF_BLOCK = /const DiffBlock = /;
const TEXT_BLOCK = /const TextBlock = /;
const OUTPUT_WELL =
	/<SelectableMessage text=\{joined\}[^>]*>\s*<SelectableLeafText/;
const MARKDOWN = /export const Markdown = /;
const ANSWER_WRAPPER = /<SelectableMessage\s+text=\{plainText\}/;
const ANSWER_CLOSE = "</SelectableMessage>";
const MARKDOWN_BLOCK = /const MarkdownBlock = /;
const MARKDOWN_BLOCK_USE = /<MarkdownBlock\b/;
const BLOCK_BODY = /const BlockBody = /;
const STREAM_BLOCK_BODY =
	/<StreamBlock\b[^>]*>\s*<BlockBody\b[^>]*\/>\s*<\/StreamBlock>/;
const CODE_BLOCK_USE = /case "code": \{\s*const listing = \(\s*<CodeBlock\b/;
const CODE_BLOCK_MEMO = /const CodeBlock = memo\(\s*CodeBlockView\b/;
const CODE_BLOCK_VIEW = /function CodeBlockView\(/;
const FORWARDS_HOLD = /onLongPress=\{enter\}/;
/* A Bridge thread body hands its long-press to the row's actions sheet
 *  (`HostSelection`, spec PR a): "Select text" lives in that sheet. */
const THREAD_BODY = /<Markdown text=\{message\.body\} host=\{host\} \/>/;
const BRIDGE_CARD_BODY = /<Markdown text=\{bridgeMessage\} \/>/;
const TEXT_CLASS_PROP = /textClassName=\{([^}]+)\}/g;
const STRING_LITERAL = /^"([^"]*)"$/;
const TERNARY = /^[\w.!]+\s*\?\s*("[^"]*")\s*:\s*("[^"]*")$/;
const CX_CALL = /^cx\(([\s\S]*)\)$/;
const IDENTIFIER = /^\w+$/;
/** A text colour utility over a palette role, e.g. `text-ink`, `text-ink-muted`. */
const TEXT_COLOUR = new RegExp(
	`(?:^|\\s)text-(?:${COLOR_ROLES.join("|")})(?:\\s|$)`,
);
const ON_SCROLL_BEGIN =
	/onScrollBeginDrag = useCallback\(\(\) => \{[\s\S]*?\}, \[/;
const THREAD_SCROLL_BEGIN = /onScrollBeginDrag=\{\(\) => \{[\s\S]*?\}\}/;
const ON_LIST_TOUCH_START = /const onListTouchStart = \(\) => \{[\s\S]*?\};/;

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

function assertAssistantSelection(markdown: string) {
	const answer = component(markdown, MARKDOWN);
	const open = answer.search(ANSWER_WRAPPER);
	const close = answer.indexOf(ANSWER_CLOSE, open);
	expect(open, "answer selection surface is missing").toBeGreaterThanOrEqual(0);
	expect(close, "answer selection surface is not closed").toBeGreaterThan(open);
	expect(
		answer.slice(open, close),
		"MarkdownBlock is outside selection",
	).toMatch(MARKDOWN_BLOCK_USE);
	expect(component(markdown, MARKDOWN_BLOCK)).toMatch(STREAM_BLOCK_BODY);
	expect(component(markdown, BLOCK_BODY)).toMatch(CODE_BLOCK_USE);
	expect(markdown).toMatch(CODE_BLOCK_MEMO);
	// The code copy Pressable is the deepest responder under a hold. It must
	// route the hold back to the selection surface that owns the Markdown.
	expect(
		component(markdown, CODE_BLOCK_VIEW),
		"code hold is not forwarded",
	).toMatch(FORWARDS_HOLD);
}

describe("every message surface routes through SelectableMessage", () => {
	it("the user bubble selects its own prompt, inside the Show-more clamp", () => {
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
		assertAssistantSelection(code("./markdown.tsx"));
	});

	it("rejects detached Markdown blocks and dropped code hold wiring", () => {
		const markdown = code("./markdown.tsx");
		const detached = markdown
			.replace(ANSWER_CLOSE, "")
			.replace(MARKDOWN_BLOCK_USE, `${ANSWER_CLOSE}<MarkdownBlock`);
		expect(() => assertAssistantSelection(detached)).toThrow(
			"MarkdownBlock is outside selection",
		);
		const unforwarded = markdown.replace(FORWARDS_HOLD, "");
		expect(() => assertAssistantSelection(unforwarded)).toThrow(
			"code hold is not forwarded",
		);
	});

	it("Team Bridge bodies (thread messages and the bridge card) render through Markdown", () => {
		expect(code("../../team-bridge/thread-screen.tsx")).toMatch(THREAD_BODY);
		expect(code("./tool-row.tsx")).toMatch(BRIDGE_CARD_BODY);
	});
});

/**
 * Every class a `SelectableMessage` hands to the iOS selection `TextInput`
 * resolved to its literal alternatives: a string, a ternary of strings, a
 * `cx(...)` of those, a file-level `const`, or a component prop resolved from
 * its call sites' literals (`tone="text-ink-muted"`).
 */
const resolveClasses = (expression: string, source: string): string[] => {
	const expr = expression.trim();
	const literal = expr.match(STRING_LITERAL);
	if (literal) return [literal[1] as string];
	const ternary = expr.match(TERNARY);
	if (ternary) {
		return [ternary[1], ternary[2]].flatMap((branch) =>
			resolveClasses(branch as string, source),
		);
	}
	const call = expr.match(CX_CALL);
	if (call) {
		return (call[1] as string)
			.split(",")
			.map((arg) => resolveClasses(arg, source))
			.reduce<string[]>(
				(acc, options) =>
					acc.flatMap((prefix) => options.map((o) => `${prefix} ${o}`.trim())),
				[""],
			);
	}
	if (IDENTIFIER.test(expr)) {
		// A component prop first (its call sites' literals, `tone="…"`): a
		// same-named local elsewhere in the file must not stand in for it.
		const props = [...source.matchAll(new RegExp(`\\b${expr}="([^"]*)"`, "g"))];
		if (props.length > 0) return props.map((p) => p[1] as string);
		const definition = source.match(
			new RegExp(`const ${expr} =\\s*([\\s\\S]*?);\\n`),
		);
		expect(definition, `no definition or call site for ${expr}`).not.toBeNull();
		return resolveClasses(definition?.[1] as string, source);
	}
	throw new Error(`unresolvable textClassName expression: ${expr}`);
};

/* PR #233 design R1, D2: RN iOS defaults `TextInput` text to black
 *  (`TextAttributes.cpp` `foregroundColor = blackColor()`), and the selection
 *  view drops the rendered body's nested colour spans — so a body whose
 *  `textClassName` names no colour goes black-on-dark the moment it is
 *  long-pressed (the diff did: 1.10–1.27:1 on `sunken`). */
describe("every selection view carries an ink colour", () => {
	it("each textClassName handed to SelectableMessage resolves to a text colour", () => {
		const files = ["./markdown.tsx", "./tool-row.tsx", "./transcript-row.tsx"];
		let sites = 0;
		for (const file of files) {
			const source = code(file);
			for (const match of source.matchAll(TEXT_CLASS_PROP)) {
				sites += 1;
				for (const classes of resolveClasses(match[1] as string, source)) {
					expect(classes, `${file}: textClassName={${match[1]}}`).toMatch(
						TEXT_COLOUR,
					);
				}
			}
		}
		// answer, user bubble, diff well, text well: none can drop out unseen.
		expect(sites).toBeGreaterThanOrEqual(4);
	});
});

/* PR #233 design R1, D3: a scroll must NOT end the mode (the reader scrolls to
 *  reach a long message's far handle); a tap outside still does, decided on
 *  lift. Both lists wire the same four touch/scroll calls. */
describe("the lists end the mode on a tap outside, never on a scroll", () => {
	it("the transcript list", () => {
		const list = code("./transcript-list.tsx");
		const begin = list.match(ON_SCROLL_BEGIN)?.[0] ?? "";
		expect(begin).toContain("textSelectionContainerScroll()");
		expect(begin).not.toContain("exitTextSelection");
		expect(list).not.toContain("exitTextSelection");
		for (const prop of [
			"onTouchStart={onListTouchStart}",
			"onTouchEnd={textSelectionContainerTouchEnd}",
			"onTouchCancel={textSelectionContainerTouchCancel}",
		]) {
			expect(list).toContain(prop);
		}
		// PR #397 R11: the list's touch start is a wrapper shared with the
		// inline charts' tap-outside rule (X7); it must still start the
		// selection's tap-outside check, so pin the wrapper's body too.
		const wrapper = list.match(ON_LIST_TOUCH_START)?.[0] ?? "";
		expect(wrapper).toContain("textSelectionContainerTouch()");
		expect(wrapper).toContain("inlineChartsContainerTouch()");
	});

	it("the Team Bridge thread", () => {
		const thread = code("../../team-bridge/thread-screen.tsx");
		const begin = thread.match(THREAD_SCROLL_BEGIN)?.[0] ?? "";
		expect(begin).toContain("textSelectionContainerScroll()");
		expect(begin).toContain("viewport.current?.handlers.onScrollBeginDrag()");
		expect(thread).not.toContain("exitTextSelection");
		for (const prop of [
			"onTouchStart={textSelectionContainerTouch}",
			"onTouchEnd={textSelectionContainerTouchEnd}",
			"onTouchCancel={textSelectionContainerTouchCancel}",
		]) {
			expect(thread).toContain(prop);
		}
	});
});
