// biome-ignore-all lint/suspicious/noArrayIndexKey: every list in this file is regenerated from the same source on each render (a parsed string, a diff, a todo phase), so position IS the identity — the case React's own key docs exempt. A content-derived key would be recomputed every frame to produce the same value.
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { TranscriptEntry } from "@/contracts";
import {
	diffCounts,
	diffLineTone,
	hasToolDetails,
	toolDetailBlocks,
	toolElapsed,
	toolGlyph,
} from "@/features/session/projection";
import { ROLE } from "@/ui/a11y";
import { cx } from "@/ui/variants";

/**
 * The tool row: ONE line per action, everything else one tap away
 * (`docs/design/components.md` § 15).
 *
 * The long-output bound is the load-bearing part. `args`, `diff` and `output` are
 * each capped and scrollable, and the expansion as a whole is capped too — an
 * unbounded output block renders its full height and fills the screen with a
 * sunken ground, and a diff block that scrolls horizontally is a gesture the
 * reader has no cue to perform, so the diff WRAPS and the whole expansion is what
 * scrolls.
 *
 * The args block is dropped for the tools whose args ARE their diff
 * (`write`/`edit`/`apply_patch`/`patch`): showing both says the same thing twice
 * and pushes the diff — the part the reader wants — below the fold.
 */
export type ToolRowProps = {
	entry: TranscriptEntry;
	testID?: string;
};

const DIFF_TONE_CLASS = {
	added: "text-success",
	removed: "text-danger",
	hunk: "text-info",
	plain: "text-ink-muted",
} as const;

const DiffBlock = ({ lines }: { lines: string[] }) => (
	// `whitespace-pre-wrap` plus per-line block text: the wrap is what makes this
	// readable on a phone, and the tint comes from the diff roles rather than from
	// a colour chosen here.
	<View className="max-h-64 overflow-hidden rounded-sm bg-sunken p-2">
		<ScrollView>
			<Text className="whitespace-pre-wrap font-mono text-mono-sm">
				{lines.map((line, index) => (
					<Text
						key={index}
						className={cx("block", DIFF_TONE_CLASS[diffLineTone(line)])}
					>
						{line}
					</Text>
				))}
			</Text>
		</ScrollView>
	</View>
);

const TextBlock = ({ lines, tone }: { lines: string[]; tone: string }) => (
	<View className="max-h-48 overflow-hidden rounded-sm bg-sunken p-2">
		<ScrollView>
			<Text className={cx("whitespace-pre-wrap font-mono text-mono-sm", tone)}>
				{lines.join("\n")}
			</Text>
		</ScrollView>
	</View>
);

export const ToolRow = ({ entry, testID }: ToolRowProps) => {
	/**
	 * `user_run` is tracked as an OVERRIDE, not as initial state.
	 *
	 * A bang-mode row (`! cmd`) opens expanded, matching the TUI: the reader typed
	 * this command themselves and is waiting to read its output. But a live bang row
	 * is mounted while still running and only learns `user_run` when its result
	 * settles, and a `useState` initializer runs once at mount — seeding it there
	 * would leave the live card shut. `null` means "the reader has not touched this
	 * row", and only then does `user_run` decide.
	 */
	const [override, setOverride] = useState<boolean | null>(null);
	const open = override ?? entry.details.user_run === true;
	const tone = toolGlyph(entry.tool_state);
	const counts = diffCounts(entry);
	const elapsed = toolElapsed(entry);
	const details = hasToolDetails(entry);
	const blocks = toolDetailBlocks(entry);
	/* A queued call keeps the raised background of a live row — it is announced and
	 * may still execute — but it does NOT pulse: the pulse is the "work is
	 * happening" signal, and nothing is happening while it waits behind a sibling. */
	const queued = entry.tool_state === "queued";

	return (
		<View
			className={cx(
				"rounded-sm px-2",
				(entry.tool_state === "running" ||
					queued ||
					entry.tool_state === "composing") &&
					"bg-elevated",
				entry.tool_state === "failed" && "bg-danger-wash",
			)}
			testID={testID}
		>
			<Pressable
				accessibilityRole={details ? ROLE.button : ROLE.text}
				accessibilityLabel={`${entry.tool_name} ${entry.tool_state}${entry.summary ? `, ${entry.summary}` : ""}`}
				accessibilityState={details ? { expanded: open } : undefined}
				disabled={!details}
				onPress={() => details && setOverride(!open)}
			>
				<View className="min-h-11 flex-row items-center gap-1.5">
					<Text
						className={cx(
							"w-4 text-center font-mono text-mono-sm",
							tone.inkClass,
						)}
						aria-hidden
					>
						{tone.glyph}
					</Text>
					{/* The NAME yields before the summary does, so the clock is the last
					    thing lost rather than the first: a truncated name is visibly
					    truncated, while a clipped duration is a shorter string that is
					    still a valid duration and so looks correct. */}
					<Text
						className="min-w-0 shrink truncate font-mono text-mono-sm text-ink-muted"
						numberOfLines={1}
					>
						{entry.tool_name}
					</Text>
					<Text
						className="min-w-0 flex-1 text-body-sm text-ink-dim"
						numberOfLines={1}
					>
						{entry.summary}
					</Text>
					{/* Suppressed entirely when both counts are zero — `+0 −0` is noise
					    dressed as a measurement. */}
					{counts !== null ? (
						<Text className="shrink-0 font-mono text-mono-sm">
							{counts.added > 0 ? (
								<Text className="text-success">+{counts.added}</Text>
							) : null}
							{counts.added > 0 && counts.removed > 0 ? " " : null}
							{counts.removed > 0 ? (
								<Text className="text-danger">−{counts.removed}</Text>
							) : null}
						</Text>
					) : null}
					{elapsed !== null ? (
						<Text className="shrink-0 font-mono text-mono-sm text-ink-dim tabular-nums">
							{elapsed}
						</Text>
					) : null}
					{details ? (
						<Text className="shrink-0 text-ink-dim" aria-hidden>
							{open ? "▾" : "▸"}
						</Text>
					) : null}
				</View>
			</Pressable>
			{open && details ? (
				<View className="flex flex-col gap-1.5 pb-1 pl-6">
					{entry.intent ? (
						<Text className="text-body-sm text-ink-muted">{entry.intent}</Text>
					) : null}
					{entry.error ? (
						<Text className="text-body-sm text-danger">{entry.error}</Text>
					) : null}
					{blocks.showArgs && blocks.args.length > 0 ? (
						<TextBlock lines={blocks.args} tone="text-ink-muted" />
					) : null}
					{blocks.diff.length > 0 ? <DiffBlock lines={blocks.diff} /> : null}
					{blocks.output.length > 0 ? (
						<TextBlock lines={blocks.output} tone="text-ink-muted" />
					) : null}
					{/* An interrupted call keeps its partial output and says so: a row that
					    silently looks finished misreports what the tool did. */}
					{entry.tool_state === "interrupted" ? (
						<Text className="text-meta text-warning">
							Interrupted — the output above is partial.
						</Text>
					) : null}
				</View>
			) : null}
		</View>
	);
};
