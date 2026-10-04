import { useState } from "react";

import { Pressable, ScrollView, Text, View } from "react-native";
import { rosterBody } from "@/features/session/panels";
import type { SubagentProjection } from "@/features/session/projection";
import { CONTROL, ROLE, SURFACE, state } from "@/ui/a11y";
import { useTextScale } from "@/ui/text-scale-provider";
import { cx } from "@/ui/variants";

/**
 * The subagent roster (`docs/design/components.md` § 17).
 *
 * The header's summary row is **never dimmed**: a roster's failure count is the
 * one thing on this panel that must stay legible while the panel is quiet, and
 * dimming it is how a failed child goes unnoticed.
 *
 * Nesting is carried by INDENTATION, not by a card inside a card — a card inside a
 * card inside a panel on a 390-wide screen leaves about 300 pt of text. The depth
 * comes from `SubagentRowView.depth`, capped at four steps so a deep chain cannot
 * squeeze the label off a 320 px screen.
 */
export type SubagentsPanelProps = {
	subagents: SubagentProjection;
	open: boolean;
	onToggle: () => void;
	/** Tapping a child opens its own route. */
	onOpenAgent: (jobId: string) => void;
	/** The viewport the panel is inside, so its roster body is bounded by a SHARE of
	 *  the screen rather than by a constant (design round 2, D11/D12). */
	viewportHeight: number;
	testID: string;
};

/** The deepest indentation the layout can afford. Beyond this a chain is a
 *  diagnostic, not a tree the reader is following by eye. */
const MAX_DEPTH_INDENT = 4;

/** One padding role per depth, from the spacing scale rather than from a computed
 *  pixel value: a raw `paddingLeft` would be the one geometry value in this file
 *  outside the token system, and the kit's rule is that spacing goes through the
 *  generated roles (`docs/design/components.md` § 22). The steps are 12 pt apart,
 *  which is the smallest separation that still reads as a hierarchy on a phone. */
const DEPTH_INDENT_CLASSES = [
	"pl-4",
	"pl-7",
	"pl-10",
	"pl-13",
	"pl-16",
] as const;

const indentClass = (depth: number): string =>
	DEPTH_INDENT_CLASSES[Math.min(depth, MAX_DEPTH_INDENT)] ?? "pl-4";

export const SubagentsPanel = ({
	subagents,
	open,
	onToggle,
	onOpenAgent,
	viewportHeight,
	testID,
}: SubagentsPanelProps) => {
	/* The first row's rendered height, so the body's cap lands BETWEEN rows. A row
	 * carries a label and usually a metadata line, so its height is content-driven
	 * (44–50 pt) and only a measurement can promise the whole-row cut D12 asks for. */
	const [rowHeight, setRowHeight] = useState<number | null>(null);
	/* The scale the row is laid out at, not a guess at one: the roster's counts take a
	 * line of their own once the label can no longer share it (see the header's note).
	 * 125 % is where 320 pt stops fitting both, measured — at 100 % the row is one line
	 * and its geometry is unchanged. */
	const stacked = useTextScale().effectiveScale > 1.25;
	if (subagents.empty) return null;
	/* The summary's words and counts come from `projectSubagents`, which owns the
	 * one table keyed by every wire status: a status this panel has never heard of
	 * is a typecheck failure there rather than a clause missing here. */
	const body = rosterBody({
		viewportHeight,
		rowCount: subagents.rows.length,
		// Measured, not assumed: the rows are content-driven, so only the rendered
		// height can promise that the cap lands between rows rather than through one.
		// `undefined` before the first layout, where the estimate stands in.
		rowPt: rowHeight ?? undefined,
	});

	return (
		<View className="border-t border-hairline" testID={testID}>
			<Pressable
				accessibilityRole={ROLE.button}
				accessibilityLabel={`Subagents, ${subagents.totalLabel}, ${subagents.clauses
					.map((clause) => `${clause.count} ${clause.word}`)
					.join(", ")}`}
				accessibilityState={state({ expanded: open })}
				onPress={onToggle}
				testID={CONTROL.subagentsDisclosure}
			>
				{/* The label, the roster's own count and the disclosure caret are one
				    non-wrapping group; only the clauses wrap. A caret that floats to the
				    end of the row's SECOND line reads as a second control rather than as
				    this row's disclosure (design round 2, D16).

				    Above 125 % the counts take a line of their own (`w-full`), because on the
				    320 pt floor they cannot share one with the label: `subagents` alone is ~234 pt
				    at 200 %, so a clauses box squeezed beside it collapsed to ONE GLYPH PER LINE
				    (measured 12.7 pt per clause at 320 pt @200 % — design round 4, D29). `min-w-0`
				    bounds the CONTAINER; each clause is `shrink-0`, so it keeps its own width and
				    the container wraps it, rather than a clause being squeezed to fit. */}
				<View
					className={`min-h-11 flex-row items-center gap-2 px-4 py-1${
						stacked ? " flex-wrap" : ""
					}`}
				>
					<View className="min-w-0 flex-row flex-wrap items-center gap-2">
						<Text className="text-mono-sm text-ink-dim">subagents</Text>
						<Text className="text-mono-sm text-ink-muted">
							{subagents.totalLabel}
						</Text>
					</View>
					<View
						className={`min-w-0 flex-row flex-wrap items-center gap-2 ${
							stacked ? "w-full" : "flex-1"
						}`}
					>
						{subagents.clauses.map((clause) => (
							<Text
								key={clause.status}
								className={`shrink-0 text-meta ${clause.inkClass}`}
							>
								{clause.count} {clause.word}
							</Text>
						))}
					</View>
					<Text className="text-meta text-ink-dim" aria-hidden>
						{open ? "▾" : "▸"}
					</Text>
				</View>
			</Pressable>
			{open ? (
				<ScrollView
					// A whole number of rows, capped by a share of the viewport: the fixed
					// 256 pt body pushed the composer off a 568 pt screen (D11) and cut the
					// sixth row into a lone glyph (D12).
					style={{ maxHeight: body.maxHeight }}
					testID={SURFACE.subagentsBody}
				>
					{subagents.rows.map((row, index) => (
						<Pressable
							key={row.jobId}
							accessibilityRole={ROLE.button}
							accessibilityLabel={`${row.label}, ${row.status}`}
							onPress={() => onOpenAgent(row.jobId)}
							testID={row.testID}
						>
							<View
								onLayout={
									index === 0
										? (event) =>
												setRowHeight(
													Math.round(event.nativeEvent.layout.height),
												)
										: undefined
								}
								className={cx(
									"min-h-11 flex-row items-start gap-2 py-1.5 pr-4",
									indentClass(row.depth),
								)}
							>
								<Text
									className={cx("w-5 text-mono-sm", row.inkClass)}
									aria-hidden
								>
									{row.glyph}
								</Text>
								<View className="min-w-0 flex-1">
									<Text className="text-body-sm text-ink" numberOfLines={1}>
										{row.label}
									</Text>
									{row.metadata.length > 0 ? (
										<Text className="text-meta text-ink-dim">
											{row.metadata}
										</Text>
									) : null}
									{/* The running marker `07-subagent-drilldown` asserts by name. It is a
									    sibling of the label rather than a wrapper, so it adds no geometry. */}
									{row.status === "running" ? (
										<View testID={SURFACE.subagentRunning} aria-hidden />
									) : null}
								</View>
								{/* `elapsed === null` renders NOTHING — no clock, not `0s`: a roster with
								    no age for a child must not invent one. */}
								{row.elapsed !== null ? (
									<Text className="shrink-0 text-mono-sm text-ink-dim tabular-nums">
										{row.elapsed}
									</Text>
								) : null}
							</View>
						</Pressable>
					))}
				</ScrollView>
			) : null}
			{/* The cue: a bounded scroller whose last visible row is whole still has to
			    say that more is below, or the reader counts five rows against a summary
			    that promised six. */}
			{open && body.hiddenRows > 0 ? (
				<Text className="px-4 pb-1 text-meta text-ink-dim">
					+{body.hiddenRows} more
				</Text>
			) : null}
		</View>
	);
};
