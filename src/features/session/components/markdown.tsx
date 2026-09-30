// biome-ignore-all lint/suspicious/noArrayIndexKey: every list in this file is regenerated from the same source on each render (a parsed string, a diff, a todo phase), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import {
	Pressable,
	ScrollView,
	Text,
	type TextStyle,
	View,
} from "react-native";

import { CONTROL, ROLE } from "@/ui/a11y";
import { cx, TOUCH_FLOOR } from "@/ui/variants";

/**
 * Assistant markdown, rendered without a markdown library.
 *
 * The dependency rule for this app is that the design system is the only styling
 * layer and every value comes from the token system; a general markdown renderer
 * brings its own HTML-ish view tree and its own type sizes, which is a second
 * styling layer beside the kit. So the subset the transcript actually receives is
 * parsed here — fenced code, ATX headings, list items, blockquotes, paragraphs,
 * and inline code/bold/italic — and everything else is passed through as text.
 *
 * Passing unknown syntax through VERBATIM is the important half. A renderer that
 * drops what it does not understand silently shortens the model's answer, and the
 * reader has no way to know a line is missing. So an unrecognised construct
 * becomes a paragraph of its own source, which is ugly and honest.
 *
 * The assistant's turn has **no bubble** (`docs/design/components.md` § 14): a
 * bubble separates a thing from other things, and the answer is the page.
 */

export type Block =
	| { kind: "code"; language: string; lines: string[] }
	| { kind: "heading"; level: number; text: string }
	| { kind: "list"; ordered: boolean; items: string[] }
	| { kind: "quote"; text: string }
	| { kind: "paragraph"; text: string };

const FENCE = /^\s*```\s*([A-Za-z0-9_+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/**
 * Split a document into blocks.
 *
 * Block-level only, in one pass and with no lookahead: the transcript re-renders
 * on every streamed frame, so the parser's cost is paid per frame and a
 * backtracking grammar would be paid for text the reader is already reading.
 */
export const parseMarkdown = (text: string): Block[] => {
	const blocks: Block[] = [];
	const lines = text.split("\n");
	let index = 0;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		const fence = FENCE.exec(line);
		if (fence) {
			const language = fence[1] ?? "";
			const body: string[] = [];
			index += 1;
			while (index < lines.length && !FENCE.test(lines[index] ?? "")) {
				body.push(lines[index] ?? "");
				index += 1;
			}
			// Consume the closing fence when there is one; an unterminated fence is a
			// stream still arriving, so the body so far is the honest render.
			if (index < lines.length) index += 1;
			blocks.push({ kind: "code", language, lines: body });
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			blocks.push({
				kind: "heading",
				level: (heading[1] ?? "#").length,
				text: heading[2] ?? "",
			});
			index += 1;
			continue;
		}
		const quote = QUOTE.exec(line);
		if (quote) {
			const body: string[] = [quote[1] ?? ""];
			index += 1;
			while (index < lines.length && QUOTE.test(lines[index] ?? "")) {
				body.push((QUOTE.exec(lines[index] ?? "") ?? [])[1] ?? "");
				index += 1;
			}
			blocks.push({ kind: "quote", text: body.join("\n") });
			continue;
		}
		const bullet = BULLET.exec(line);
		const ordered = ORDERED.exec(line);
		if (bullet ?? ordered) {
			const isOrdered = ordered !== null && bullet === null;
			const pattern = isOrdered ? ORDERED : BULLET;
			const items: string[] = [];
			while (index < lines.length) {
				const item = pattern.exec(lines[index] ?? "");
				if (!item) break;
				items.push(item[1] ?? "");
				index += 1;
			}
			blocks.push({ kind: "list", ordered: isOrdered, items });
			continue;
		}
		if (line.trim().length === 0) {
			index += 1;
			continue;
		}
		const paragraph: string[] = [line];
		index += 1;
		while (index < lines.length) {
			const next = lines[index] ?? "";
			if (
				next.trim().length === 0 ||
				FENCE.test(next) ||
				HEADING.test(next) ||
				BULLET.test(next) ||
				ORDERED.test(next) ||
				QUOTE.test(next)
			)
				break;
			paragraph.push(next);
			index += 1;
		}
		blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
	}
	return blocks;
};

/* ------------------------------------------------------------------ inline */

export type InlineSpan = {
	text: string;
	code: boolean;
	bold: boolean;
	italic: boolean;
};

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;

/**
 * Split one line into styled spans.
 *
 * A deliberately small grammar, and a fixed point: text that matches nothing is a
 * plain span, so an unmatched `**` renders as itself rather than swallowing the
 * rest of the line — which is what a partial-`**` streamed frame would otherwise
 * do on every frame of a long answer.
 */
export const parseInline = (text: string): InlineSpan[] => {
	const spans: InlineSpan[] = [];
	for (const piece of text.split(INLINE)) {
		if (piece === undefined || piece.length === 0) continue;
		if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 1) {
			spans.push({
				text: piece.slice(1, -1),
				code: true,
				bold: false,
				italic: false,
			});
		} else if (
			piece.startsWith("**") &&
			piece.endsWith("**") &&
			piece.length > 3
		) {
			spans.push({
				text: piece.slice(2, -2),
				code: false,
				bold: true,
				italic: false,
			});
		} else if (
			piece.startsWith("*") &&
			piece.endsWith("*") &&
			piece.length > 2
		) {
			spans.push({
				text: piece.slice(1, -1),
				code: false,
				bold: false,
				italic: true,
			});
		} else {
			spans.push({ text: piece, code: false, bold: false, italic: false });
		}
	}
	return spans;
};

const spanClass = (span: InlineSpan): string =>
	cx(
		span.code && "text-mono-sm text-ink-muted",
		span.bold && "font-medium",
		span.italic && "italic",
	);

const Inline = ({ text, base }: { text: string; base?: string }) => (
	<Text className={cx(base ?? "text-body-lg text-ink")}>
		{parseInline(text).map((span, index) => (
			<Text
				// Index keys are correct here: the spans are regenerated from the same
				// string on every frame, so position IS the identity.
				key={index}
				className={spanClass(span)}
				style={span.italic ? ITALIC : undefined}
			>
				{span.text}
			</Text>
		))}
	</Text>
);

/** React Native has no `<i>`; the text style is the only italic it has, and it is
 *  declared once so the inline parser's `italic` is not a silent no-op. */
const ITALIC: TextStyle = { fontStyle: "italic" };

/* --------------------------------------------------------------- the component */

const CodeBlock = ({
	lines,
	language,
}: {
	lines: string[];
	language: string;
}) => {
	const [copied, setCopied] = useState(false);
	const body = lines.join("\n");
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={`Copy ${language || "code"} block`}
			// The visual is the block itself, whose height follows its content — a
			// one-line block measures 27 pt (QA round 1, Q4), under the 44 pt floor.
			// The kit's rule is "a visually smaller control gets slop, not a smaller
			// target", and slop is what `Button` uses — but react-native-web's
			// `Pressable` does NOT implement `hitSlop` (only the legacy `Touchable`
			// does; measured in `react-native-web/dist/exports/Pressable`), so on the
			// build this app ships today the slop would be inert and the target would
			// stay 27 pt where it can be measured. The spec's other remedy is to pad the
			// box, so the floor is met by the box on both platforms: one rule, no
			// platform branch.
			style={{ minHeight: TOUCH_FLOOR }}
			testID={CONTROL.codeBlockCopy}
			onPress={() => {
				// Copy on tap (`components.md` § 14). The confirmation is local and
				// transient, because a toast for a copy would replace a real message.
				void Clipboard.setStringAsync(body).then(() => setCopied(true));
			}}
		>
			<View className="overflow-hidden rounded-sm border border-hairline bg-sunken">
				{language.length > 0 ? (
					<Text className="border-b border-hairline px-2 py-1 text-meta text-ink-dim">
						{copied ? `${language} · copied` : language}
					</Text>
				) : null}
				{/* Horizontally scrollable, and NOT wrapped: a code line broken mid-token
				    reads as different code. The block itself is what scrolls, so the
				    column never widens (the transcript's own overflow guard). */}
				<ScrollView horizontal showsHorizontalScrollIndicator={false}>
					<Text className="px-2 py-1 font-mono text-mono-sm text-ink-muted">
						{copied && language.length === 0 ? "copied\n" : ""}
						{body}
					</Text>
				</ScrollView>
			</View>
		</Pressable>
	);
};

/** Monotonic, and deliberately BELOW the screen's own `display` title: a heading
 *  inside a message must not outrank the chrome that says which session this is. */
const HEADING_CLASS: Record<number, string> = {
	1: "text-title text-ink",
	2: "text-heading text-ink",
	3: "text-body-lg font-medium text-ink",
};

export const Markdown = ({ text }: { text: string }) => {
	const blocks = parseMarkdown(text);
	return (
		<>
			{blocks.map((block, index) => {
				switch (block.kind) {
					case "code":
						return (
							<CodeBlock
								key={index}
								lines={block.lines}
								language={block.language}
							/>
						);
					case "heading":
						return (
							<Text
								key={index}
								className={cx(
									"pt-1",
									HEADING_CLASS[block.level] ?? "text-body-lg text-ink",
								)}
							>
								{block.text}
							</Text>
						);
					case "list":
						return (
							<View key={index} className="gap-0.5">
								{block.items.map((item, itemIndex) => (
									<View key={itemIndex} className="flex-row gap-2">
										<Text className="text-body-lg text-ink-dim" aria-hidden>
											{block.ordered ? `${itemIndex + 1}.` : "•"}
										</Text>
										<View className="min-w-0 flex-1">
											<Inline text={item} />
										</View>
									</View>
								))}
							</View>
						);
					case "quote":
						return (
							<View key={index} className="border-l-2 border-hairline pl-2">
								<Inline text={block.text} base="text-body-sm text-ink-muted" />
							</View>
						);
					default:
						return <Inline key={index} text={block.text} />;
				}
			})}
		</>
	);
};
