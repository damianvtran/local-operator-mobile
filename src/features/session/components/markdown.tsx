// biome-ignore-all lint/suspicious/noArrayIndexKey: every list in this file is regenerated from the same source on each render (a parsed string, a diff, a todo phase), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Pressable,
	ScrollView,
	Text,
	type TextStyle,
	View,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import {
	type InlineSpan,
	parseInline,
	parseMarkdown,
	TABLE_CELL_PADDING_X_PT,
	tablePricing,
} from "@/features/session/markdown";
import { forcedTableScroll } from "@/features/session/table-scroll-hook";
import { CONTROL, ROLE, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";
import { cx } from "@/ui/variants";

/**
 * Assistant markdown, rendered without a markdown library.
 *
 * The dependency rule for this app is that the design system is the only styling
 * layer and every value comes from the token system; a general markdown renderer
 * brings its own HTML-ish view tree and its own type sizes, which is a second
 * styling layer beside the kit. So the subset the transcript actually receives is
 * parsed in `markdown.ts` (fenced code, ATX headings, list items, blockquotes,
 * tables, paragraphs, and inline code/bold/italic) and everything else is passed
 * through as text — the grammar lives beside this file rather than in it so the
 * state marker and the parser's own tests can read it without a React Native host.
 *
 * Passing unknown syntax through VERBATIM is the important half. A renderer that
 * drops what it does not understand silently shortens the model's answer, and the
 * reader has no way to know a line is missing. So an unrecognised construct
 * becomes a paragraph of its own source, which is ugly and honest.
 *
 * The assistant's turn has **no bubble** (`docs/design/components.md` § 14): a
 * bubble separates a thing from other things, and the answer is the page.
 */

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

/* ------------------------------------------------------------------- tables */

/**
 * The markdown table (`docs/ux` § the table block; design pass
 * `fix/hero-tables-strips` §1.3–§1.6).
 *
 * React Native has neither CSS auto table layout nor min-content, so the column
 * widths are PRICED from the parsed strings (`tablePricing`, one constant pinned
 * by a test) rather than measured: the scroll child is a row with
 * `minWidth: naturalWidth`, each cell carries `flexBasis`/`minWidth: minW(c)` and
 * `flexGrow: share(c)`, and the `ScrollView`'s content container carries
 * `minWidth: "100%"` — so a table that fits stretches to the column and
 * distributes its slack, and one that does not scrolls rather than squeezing any
 * column below its longest word.
 */

/** The rail every band in the session column sits on (`space.gutters.phone`), in
 *  pt. The table's scroll viewport bleeds PAST it by exactly this much — to the
 *  screen's right edge — so an overflowing table is cut mid-cell at the edge,
 *  which is the primary "this continues" cue (`§1.6`). */
const TABLE_RAIL_PT = 16;

/** The static fade band's width, in pt (`§1.6`): transparent at the content
 *  side, `canvas` at the edge. A cue, not a mask. */
const TABLE_FADE_PT = 24;

/**
 * Gradient ids must be unique per instance: two tables can share one document,
 * and `url(#…)` resolves to the first id in it. A module counter (not a value
 * derived from content) because the id must be stable across the re-renders a
 * streaming frame causes — a recomputed id would drop the fill mid-scroll.
 */
let fadeSeq = 0;

const TableFade = ({
	side,
	colour,
}: {
	side: "left" | "right";
	colour: string;
}) => {
	const id = useRef("");
	if (id.current === "") {
		fadeSeq += 1;
		id.current = `md-table-fade-${fadeSeq}`;
	}
	return (
		<View
			// The cue is machine-readable (U-40 addresses it by name) but must not
			// eat the gesture: a drag that starts on the fade still scrolls the table.
			pointerEvents="none"
			aria-hidden
			testID={SURFACE.mdTableScrollCue}
			style={{
				position: "absolute",
				top: 0,
				bottom: 0,
				width: TABLE_FADE_PT,
				right: side === "right" ? 0 : undefined,
				left: side === "left" ? 0 : undefined,
			}}
		>
			<Svg width="100%" height="100%">
				<Defs>
					{/* Drawn to the `canvas` ROLE, in both themes, because that is the
					    ground the table sits on: a constant gradient, unaffected by
					    reduced motion and costing nothing per frame. */}
					<LinearGradient id={id.current} x1="0%" y1="0%" x2="100%" y2="0%">
						{[
							<Stop
								key="near"
								offset="0"
								stopColor={colour}
								stopOpacity={side === "right" ? 0 : 1}
							/>,
							<Stop
								key="far"
								offset="1"
								stopColor={colour}
								stopOpacity={side === "right" ? 1 : 0}
							/>,
						]}
					</LinearGradient>
				</Defs>
				<Rect width="100%" height="100%" fill={`url(#${id.current})`} />
			</Svg>
		</View>
	);
};

const Table = ({ header, rows }: { header: string[]; rows: string[][] }) => {
	const { effectiveScale } = useTextScale();
	const canvas = useTokenColor("canvas");
	/* Priced from the parsed strings — no measurement, no layout pass: this
	 * renderer is on the streaming path and re-runs on every frame. */
	const pricing = useMemo(
		() => tablePricing(header, rows, effectiveScale),
		[header, rows, effectiveScale],
	);

	const [viewportWidth, setViewportWidth] = useState(0);
	const [contentWidth, setContentWidth] = useState(0);
	const [scrollX, setScrollX] = useState(0);
	const scrollRef = useRef<ScrollView>(null);
	/** The `lo-md-scroll=end` viewer has run for this table (it runs once). */
	const scrolledToEnd = useRef(false);

	/* The two booleans §1.6 names, from the layout the table actually got. A
	 * table that fits draws no fade and does not bleed — a cue on a table that
	 * does not scroll is the false affordance the anti-pattern exists to
	 * prevent, inverted. */
	const overflowing = contentWidth > viewportWidth + 0.5;
	const forced = useMemo(() => forcedTableScroll(), []);

	const onLayout = useCallback(
		(event: import("react-native").LayoutChangeEvent) => {
			setViewportWidth(event.nativeEvent.layout.width);
		},
		[],
	);
	const onContentSizeChange = useCallback((width: number) => {
		setContentWidth(width);
	}, []);
	const onScroll = useCallback(
		(
			event: import("react-native").NativeSyntheticEvent<
				import("react-native").NativeScrollEvent
			>,
		) => {
			const x = event.nativeEvent.contentOffset.x;
			// The scroll path runs at frame rate; only a real move reaches state.
			setScrollX((current) => (Math.abs(current - x) < 0.5 ? current : x));
		},
		[],
	);

	/* The web-only viewer (`table-scroll-hook.ts`): a capture cell that asks for
	 * the table's END, which no wire action can produce. It waits for the measured
	 * overflow because scrolling a table that fits is a no-op with a cue bug
	 * attached — nothing to scroll, and the mirror fade would be a lie. */
	useEffect(() => {
		if (forced !== "end" || scrolledToEnd.current || !overflowing) return;
		scrolledToEnd.current = true;
		scrollRef.current?.scrollToEnd({ animated: false });
	}, [forced, overflowing]);

	const atEnd = overflowing && scrollX >= contentWidth - viewportWidth - 1;
	const showRight = overflowing && !atEnd;
	const showLeft = scrollX > 0.5;

	const cellStyle = (column: number) => {
		// `box-sizing: border-box` (React Native's own default) means the cell's
		// box must carry its padding and separator, or the priced text width would
		// be eaten by the chrome and the longest word would break.
		const box =
			(pricing.minWidths[column] ?? 0) +
			2 * TABLE_CELL_PADDING_X_PT +
			(column > 0 ? 1 : 0);
		return {
			flexBasis: box,
			flexGrow: pricing.shares[column] ?? 1,
			flexShrink: 0,
			minWidth: box,
		};
	};
	const renderCell = (cell: string, column: number, head: boolean) => (
		<View
			key={column}
			testID={SURFACE.mdTableCell}
			style={cellStyle(column)}
			className={cx("px-3 py-2", column > 0 && "border-l border-hairline")}
		>
			<Inline
				text={cell}
				base={
					head ? "text-body-sm font-medium text-ink" : "text-body-sm text-ink"
				}
			/>
		</View>
	);

	return (
		<View
			testID={SURFACE.mdTable}
			style={overflowing ? { marginRight: -TABLE_RAIL_PT } : undefined}
		>
			{/* The frame: 1pt `border-control`, because on a phone the grid is what
			    makes a row-and-column read as rows and columns, and a hairline is
			    measured as a wash (1.25:1), not an edge. */}
			<View className="overflow-hidden rounded-sm border border-control">
				<ScrollView
					ref={scrollRef}
					testID={SURFACE.mdTableScroll}
					horizontal
					// The cue is the fade, so the platform's own transient indicator
					// has nothing to add; the Android glow would compete with it.
					showsHorizontalScrollIndicator={false}
					overScrollMode="never"
					// Android: the outer container is a FlatList, and without this the
					// table does not pan. iOS: a vertical drag must not become a table
					// drag — the pair is what keeps both axes behaving.
					nestedScrollEnabled
					directionalLockEnabled
					onLayout={onLayout}
					onContentSizeChange={onContentSizeChange}
					onScroll={onScroll}
					scrollEventThrottle={16}
					contentContainerStyle={{ minWidth: "100%" }}
				>
					<View style={{ minWidth: pricing.naturalWidth }}>
						<View
							testID={SURFACE.mdTableHead}
							className="flex-row border-b border-control bg-sunken"
						>
							{header.map((cell, column) => renderCell(cell, column, true))}
						</View>
						{rows.map((row, rowIndex) => (
							<View
								key={rowIndex}
								testID={SURFACE.mdTableRow}
								className={cx(
									"flex-row",
									rowIndex > 0 && "border-t border-hairline",
								)}
							>
								{row.map((cell, column) => renderCell(cell, column, false))}
							</View>
						))}
					</View>
				</ScrollView>
			</View>
			{showRight ? <TableFade side="right" colour={canvas} /> : null}
			{showLeft ? <TableFade side="left" colour={canvas} /> : null}
		</View>
	);
};

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
		/* ONE gap container, and every block carries no outer margin of its own
		 * (`components.md` §22, "the container owns the gap"). Before this an
		 * answer's only separation was each block's own line-box leading: a code
		 * well met the next paragraph with ≈6 pt of half-leading and two
		 * paragraphs met at 0 pt, so nine different separations were all the same
		 * value. The gap is the `between-components` tier, desktop parity. */
		<View className="gap-3">
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
									HEADING_CLASS[block.level] ?? "text-body-lg text-ink",
								)}
							>
								{block.text}
							</Text>
						);
					case "list":
						return (
							<View key={index} className="gap-1">
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
					case "table":
						return (
							<Table key={index} header={block.header} rows={block.rows} />
						);
					default:
						return <Inline key={index} text={block.text} />;
				}
			})}
		</View>
	);
};
