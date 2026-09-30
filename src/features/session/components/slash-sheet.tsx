import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import type { SlashCommand } from "@/contracts";
import { argumentHint, filterCommands } from "@/features/session/slash";
import { CONTROL, ROLE, SURFACE, slashCommandID, state } from "@/ui/a11y";
import { Sheet } from "@/ui/components";

/**
 * The slash-command sheet (`docs/ux/flows.md` F-6.8, `components.md` § 8's sheet).
 *
 * The `arguments` field decides what a tap DOES, and that decision lives in
 * `slash.ts` (`tapFillsOnly`) rather than here, because it has changed underneath
 * the UI once already: the backend moved `/goal` and `/loop` from `none` to
 * `optional`, and their taps silently went from "run it" to "wait for text". A
 * sheet that decided for itself would have needed editing to survive a remote
 * field change.
 *
 * The catalogue is rendered in the relay's order when the filter is empty — the
 * relay ranks its own commands, and re-sorting an unsearched list throws away an
 * answer the server already gave.
 */
export type SlashSheetProps = {
	visible: boolean;
	onClose: () => void;
	commands: SlashCommand[];
	/** The token after `/` in the composer, which seeds the filter. */
	query: string;
	loading?: boolean;
	/** `submit` runs the command immediately; otherwise the fill waits for text. */
	/** The command the reader tapped. The caller derives both the draft effect and
	 *  the request from it (`slashTap`/`slashTapRequest`), never from the draft — the
	 *  ref still holds the pre-tap text at that moment. */
	onPick: (command: SlashCommand) => void;
	/** A command is in flight: every row is disabled until it settles, because a
	 *  second tap on the same row is a second POST — the sheet closes on the first
	 *  success, but the tap that lands in the same frame is still delivered. */
	busy?: boolean;
};

export const SlashSheet = ({
	visible,
	onClose,
	commands,
	query,
	loading = false,
	onPick,
	busy = false,
}: SlashSheetProps) => {
	const [filter, setFilter] = useState(query);
	// Re-seeded whenever the sheet opens or the composer's token changes, so the sheet
	// always filters by what is in the composer: a filter left over from the previous
	// command would hide the one the reader is typing now. An effect rather than a
	// render-time assignment, because the assignment form mutates state from the
	// render path and re-runs on every parent render.
	useEffect(() => {
		if (!visible) return;
		setFilter(query);
	}, [query, visible]);
	const rows = useMemo(
		() => filterCommands(commands, filter),
		[commands, filter],
	);

	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title="commands"
			testID={SURFACE.slashSheet}
		>
			<TextInput
				className="mx-2 mb-1 min-h-11 rounded-sm border border-control bg-surface px-3 text-body text-ink"
				value={filter}
				onChangeText={setFilter}
				placeholder="filter commands"
				// A phone keyboard would otherwise capitalise and autocorrect a command
				// name into something the relay does not have.
				autoCapitalize="none"
				autoCorrect={false}
				style={{ fontSize: 16 }}
				testID={CONTROL.slashFilter}
				accessibilityLabel="Filter commands"
			/>
			<ScrollView className="max-h-72">
				{rows.map(({ command }) => {
					const hint = argumentHint(command);
					return (
						<Pressable
							key={command.name}
							accessibilityRole={ROLE.button}
							accessibilityLabel={`/${command.name}, ${command.description}`}
							accessibilityState={state({ disabled: busy })}
							disabled={busy}
							onPress={() => {
								onPick(command);
								onClose();
							}}
							testID={slashCommandID(command.name)}
						>
							<View className="min-h-11 flex-row items-center gap-2 px-3">
								<Text className="shrink-0 font-mono text-mono-sm text-ink">
									/{command.name}
									{hint !== null ? (
										<Text className="text-ink-dim">{hint}</Text>
									) : null}
								</Text>
								<Text
									className="min-w-0 flex-1 text-body-sm text-ink-dim"
									numberOfLines={1}
								>
									{command.description}
								</Text>
							</View>
						</Pressable>
					);
				})}
				{loading ? (
					<Text className="px-3 py-2 text-body-sm text-ink-dim">loading…</Text>
				) : rows.length === 0 ? (
					<Text className="px-3 py-2 text-body-sm text-ink-dim">
						no matching commands
					</Text>
				) : null}
			</ScrollView>
		</Sheet>
	);
};
