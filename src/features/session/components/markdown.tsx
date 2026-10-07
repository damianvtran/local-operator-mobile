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

	/**
	 * Two derivations, one measured input.
	 *
	 * `columnWidth` is the markdown column's own width, read from a wrapper
	 * that never moves — and that is the whole point. The first version of this
	 * measured the ScrollView's viewport and the priced row against each other
	 * AND let the viewport depend on the measurement (the row bleeds 16pt past
	 * the rail only while it overflows). Measured 2026-10-06 on the shipped web
	 * build: the pair oscillated — the row at the un-bleeded 356pt measured
	 * "fits", then the first paint's zero-width viewport classified it as
	 * overflowing after all, the bleed widened the viewport to 372pt, and the
	 * rendered frames alternated between a cued and an uncued state at the same
	 * scale (the two U-40 failures of the second after-audit). A width that
	 * cannot move is the fix: the column is the same number whether or not the
	 * bleed applies, so the classification is a pure function of it.
	 */
	const [columnWidth, setColumnWidth] = useState(0);
	const [scrollX, setScrollX] = useState(0);
	const [atEnd, setAtEnd] = useState(false);
	const scrollRef = useRef<ScrollView>(null);
	/** The `lo-md-scroll=end` viewer has run for this table (it runs once). */
	const scrolledToEnd = useRef(false);
	/** The `lo-md-scroll=bring` viewer has run for this table (it runs once). */
	const broughtIntoView = useRef(false);

	/* The two booleans §1.6 names. `bleeds`: the priced row is wider than the
	 * column, so the viewport runs to the screen's right edge (the cut edge).
	 * `scrolls`: it is ALSO wider than the bleeded viewport, i.e. there is
	 * content the reader cannot reach without scrolling — only then is the fade
	 * a true statement, and only then does the DOM's own `scrollWidth` exceed
	 * its `clientWidth` (the pair U-40 reads). A table in between (wider than
	 * the column, narrower than the bleeded edge) gets the extra width and no
	 * cue: nothing is cut and nothing scrolls. A table that fits the column
	 * gets neither — a cue on a table that does not scroll is the false
	 * affordance the anti-pattern exists to prevent, inverted. */
	const bleeds = columnWidth > 0 && pricing.naturalWidth > columnWidth + 0.5;
	const scrolls =
		bleeds && pricing.naturalWidth > columnWidth + TABLE_RAIL_PT - 0.5;
	const forced = useMemo(() => forcedTableScroll(), []);

	const onColumnLayout = useCallback(
		(event: import("react-native").LayoutChangeEvent) => {
			setColumnWidth(event.nativeEvent.layout.width);
		},
		[],
	);
	const onScroll = useCallback(
		(
			event: import("react-native").NativeSyntheticEvent<
				import("react-native").NativeScrollEvent
			>,
		) => {
			const { contentOffset, contentSize, layoutMeasurement } =
				event.nativeEvent;
			const x = contentOffset.x;
			// The scroll path runs at frame rate; only a real move reaches state.
			setScrollX((current) => (Math.abs(current - x) < 0.5 ? current : x));
			// "End" comes from the event's own metrics rather than from states
			// that a re-render can move under it: at the end the offset plus the
			// viewport covers the content.
			setAtEnd(
				contentOffset.x + layoutMeasurement.width >= contentSize.width - 1,
			);
		},
		[],
	);

	/* The web-only viewer (`table-scroll-hook.ts`): a capture cell that asks for
	 * the table's END, which no wire action can produce. It waits for the measured
	 * overflow because scrolling a table that fits is a no-op with a cue bug
	 * attached — nothing to scroll, and the mirror fade would be a lie. */
	useEffect(() => {
		if (forced !== "end" || scrolledToEnd.current || !scrolls) return;
		scrolledToEnd.current = true;
		scrollRef.current?.scrollToEnd({ animated: false });
	}, [forced, scrolls]);

	/* The `bring` half of the viewer: the transcript list's own scroll target is
	 * not reachable from this component, so the assertion walks the DOM to the
	 * table's own scrollable ancestor and sets its scrollTop to its maximum —
	 * the bottom the list itself rests at, so the two cannot fight. It
	 * RE-ASSERTS on an interval rather than firing once, and the first capture
	 * is what proved the need: the transcript list runs its own initial
	 * scroll-to-end when its content lays out, which lands AFTER a single
	 * early call and puts the frame back at the bottom (measured — the
	 * one-shot version's 200 % frames were byte-identical to the un-hooked
	 * cell's). The interval runs for twenty seconds and the last assertion
	 * before the capture's settle wins — the 8 s settle plus a cold-profile
	 * boot can otherwise outlast a shorter window. It lives for this
	 * component's MOUNTED window: a table that unmounts and remounts re-arms
	 * it, and a page whose table never mounts gets no assertion at all. Each
	 * table in a message asserts; every assertion targets the last table (the
	 * wide one with the cue), so that is what a `bring` frame shows. */
	useEffect(() => {
		if (forced !== "bring" || broughtIntoView.current) return;
		broughtIntoView.current = true;
		if (typeof document === "undefined") return;
		/* The HOST NODE, read from the DOM rather than through a React ref: a
		 * `View` ref in this tree is not the host element (measured — the scroll
		 * never happened and the frame stayed on the chrome). Every table's
		 * effect targets the LAST table, so the assertion is idempotent and the
		 * wide one (the one with the cue) is what a `bring` frame shows. */
		const assert = () => {
			const nodes = document.querySelectorAll('[data-testid="md-table"]');
			const target = nodes[nodes.length - 1];
			if (!target) return;
			/* Scroll the TRANSCRIPT to its own bottom rather than scrolling this
			 * table into view: the transcript ENDS with the tables, so the bottom
			 * is the same target the list's own scroll-to-end wants — the two
			 * cannot fight — and the last band of the viewport is the tail of the
			 * last table. Measured in the capture's cold-profile context, where
			 * `scrollIntoView` lost the race with the list and the settled frame
			 * kept showing chrome. */
			let node: HTMLElement | null = target.parentElement;
			while (node) {
				const style = getComputedStyle(node);
				if (style.overflowY === "auto" || style.overflowY === "scroll") {
					node.scrollTop = node.scrollHeight;
					break;
				}
				node = node.parentElement;
			}
		};
		/* 150 ms, and measured rather than guessed: the transcript list's own
		 * initial scroll-to-end lands around boot, and a later assertion has to
		 * outlast it — at 400 ms the capture's 3 s settle could photograph the
		 * state before the first assertion that the list did not override. */
		const timer = setInterval(assert, 150);
		/* Twenty seconds, not six: the capture's cold profile boots the session
		 * several seconds in, and at 6 s the interval could retire before the
		 * list's last content update on a loaded machine. The assertion is
		 * idempotent; an early fire is a no-op. */
		const stop = setTimeout(() => clearInterval(timer), 20000);
		return () => {
			clearInterval(timer);
			clearTimeout(stop);
		};
	}, [forced]);

	const showRight = scrolls && !atEnd;
	const showLeft = scrolls && scrollX > 0.5;

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
		// The measuring wrapper: never styled with the bleed, so its width is the
		// markdown column's own and the classification below cannot feed back
		// into the thing it classifies.
		<View onLayout={onColumnLayout}>
			<View
				testID={SURFACE.mdTable}
				style={bleeds ? { marginRight: -TABLE_RAIL_PT } : undefined}
			>
				{/* The frame: 1pt `border-border-control` (the `control` colour role's utility), because on a phone the grid is what
			    makes a row-and-column read as rows and columns, and a hairline is
			    measured as a wash (1.25:1), not an edge. */}
				<View className="overflow-hidden rounded-sm border border-border-control">
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
						onScroll={onScroll}
						scrollEventThrottle={16}
						contentContainerStyle={{ minWidth: "100%" }}
					>
						{/* `flexGrow: 1` is load-bearing on web, measured 2026-10-06: the
				    horizontal ScrollView's content container is a ROW flex box, and a
				    child with only `minWidth` sized to its min-content — the priced row
				    rendered 216pt wide inside a 356pt viewport, so a table that the
				    pricing says FITS never received its slack and its header cells
				    wrapped (`outcome` → `outcom`/`e`, the U-39 failure the first
				    after-capture caught). With the grow the row fills the container and
				    the cells' own `flexGrow: share` distributes the slack as §1.3
				    specifies; when `naturalWidth` exceeds the viewport the min-width
				    still wins and the row scrolls as before. */}
						<View style={{ minWidth: pricing.naturalWidth, flexGrow: 1 }}>
							<View
								testID={SURFACE.mdTableHead}
								className="flex-row border-b border-border-control bg-sunken"
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
