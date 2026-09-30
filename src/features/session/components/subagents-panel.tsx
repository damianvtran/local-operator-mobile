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

	return (
		<View className="border-t border-hairline" testID={testID}>
			<Pressable
				accessibilityRole={ROLE.button}
				accessibilityLabel={`Subagents, ${subagents.running} of ${subagents.total} running`}
				accessibilityState={state({ expanded: open })}
				onPress={onToggle}
				testID={CONTROL.subagentsDisclosure}
			>
				<View className="min-h-11 flex-row items-center gap-2 px-4">
					<Text className="text-mono-sm text-ink-dim">subagents</Text>
					{/* `running` counts RUNNING children only. The header used to print
					    running + queued as "N running" beside a separate "M queued", so
					    one queued child was counted twice (the 390 pt frame read
					    "2/6 running · 1 queued" against a roster with ONE running). */}
					<Text className="text-mono-sm text-ink-muted">
						{subagents.running}/{subagents.total} running
					</Text>
					{queued > 0 ? (
						<Text className="text-meta text-ink-dim">{queued} queued</Text>
					) : null}
					{subagents.failed > 0 ? (
						<Text className="text-meta text-danger">
							{subagents.failed} failed
						</Text>
					) : null}
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
