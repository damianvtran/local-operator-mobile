import { Pressable, ScrollView, Text, View } from "react-native";

import type { SubagentProjection } from "@/features/session/projection";
import { CONTROL, ROLE, SURFACE, state } from "@/ui/a11y";
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
	testID,
}: SubagentsPanelProps) => {
	if (subagents.empty) return null;
	const queued = subagents.queued;
	/* The summary names EVERY state the roster can hold, because the reader
	 * reconciles it against the rows below: `1/6 running · 1 queued · 1 failed`
	 * under six rows accounts for three of them, and the arithmetic then reads as a
	 * bug in the panel (design round 1, D3). Only non-zero clauses appear — `0
	 * parked` is noise — and the row WRAPS rather than clipping, so a full roster on
	 * a 320 pt phone costs a second line instead of losing a count.
	 *
	 * Order is what a reader acts on: activity, then what is waiting on them, then
	 * the ends. The failure count keeps the danger ink § 17 protects, and NO clause
	 * is dimmed — § 17 spells the summary row as "never dimmed", and `ink-dim` is
	 * dim, which is why the neutral clauses moved up to `ink-muted`. */
	const clauses = [
		{
			key: "running",
			text: `${subagents.running} running`,
			inkClass: "text-ink-muted",
		},
		{ key: "queued", text: `${queued} queued`, inkClass: "text-ink-muted" },
		{
			key: "parked",
			text: `${subagents.parked} parked`,
			inkClass: "text-warning",
		},
		{
			key: "failed",
			text: `${subagents.failed} failed`,
			inkClass: "text-danger",
		},
		{
			key: "completed",
			text: `${subagents.completed} done`,
			inkClass: "text-ink-muted",
		},
		{
			key: "cancelled",
			text: `${subagents.cancelled} cancelled`,
			inkClass: "text-ink-muted",
		},
	].filter((clause) => !clause.text.startsWith("0 "));

	return (
		<View className="border-t border-hairline" testID={testID}>
			<Pressable
				accessibilityRole={ROLE.button}
				accessibilityLabel={`Subagents, ${subagents.total} agents, ${clauses
					.map((clause) => clause.text)
					.join(", ")}`}
				accessibilityState={state({ expanded: open })}
				onPress={onToggle}
				testID={CONTROL.subagentsDisclosure}
			>
				<View className="min-h-11 flex-row flex-wrap items-center gap-2 px-4 py-1">
					<Text className="text-mono-sm text-ink-dim">subagents</Text>
					<Text className="text-mono-sm text-ink-muted">
						{subagents.total} agents
					</Text>
					{clauses.map((clause) => (
						<Text key={clause.key} className={`text-meta ${clause.inkClass}`}>
							{clause.text}
						</Text>
					))}
					<View className="flex-1" />
					<Text className="text-ink-dim" aria-hidden>
						{open ? "▾" : "▸"}
					</Text>
				</View>
			</Pressable>
			{open ? (
				<ScrollView className="max-h-64" testID={SURFACE.subagentsBody}>
					{subagents.rows.map((row) => (
						<Pressable
							key={row.jobId}
							accessibilityRole={ROLE.button}
							accessibilityLabel={`${row.label}, ${row.status}`}
							onPress={() => onOpenAgent(row.jobId)}
							testID={row.testID}
						>
							<View
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
		</View>
	);
};
