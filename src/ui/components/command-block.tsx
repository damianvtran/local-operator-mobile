import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Text, View } from "react-native";

import { commandCopyId, ROLE, tunnelCommandCopyId } from "@/ui/a11y";
import { Button } from "@/ui/components/button";

/**
 * One command, ready to copy — the component, not a habit.
 *
 * **Why this is in the design system.** Two screens show commands to run on
 * another machine (the Radient set-up and the own-tunnel path), and each had grown
 * its own copy of this block. The audit caught what a duplicate costs: the
 * hand-rolled version's copy control was a bare `Pressable` around a `Text`, so its
 * target measured **28 x 17 pt against the 44 pt floor** (`U-01`, twelve frames),
 * and its single-line label row ran to **390 px in a 320 px viewport at 200 % text**
 * (`U-06`) — both defects inherited by whichever screen copied it next.
 *
 * So the block owns the three things that are easy to get wrong once:
 *
 *  1. **The copy action is a real target** (`Button`, which carries the 44 pt
 *     floor), not a text run that happens to be pressable.
 *  2. **The label row wraps.** A label and an action side by side are two pieces of
 *     text that scale independently, so at 200 % on a 320 pt phone they may not fit
 *     on one line — wrapping is what keeps both reachable.
 *  3. **The command itself is selectable as well as copyable**, and it wraps: a
 *     reader pasting into a terminal is the fast path, and a copy that silently
 *     failed would otherwise leave them with nothing.
 */

export const CommandBlock = ({
	label,
	command,
	note,
	testID,
}: {
	/** The machine's own name for the step ("Terminal", "Cloudflare"). */
	label: string;
	/** The exact text, copied verbatim. */
	command: string;
	/** One sentence about what it does or what to expect, optional. */
	note?: string;
	testID?: string;
}) => {
	const [copied, setCopied] = useState(false);
	return (
		<View className="gap-2">
			<View className="flex-row flex-wrap items-center justify-between gap-2">
				<Text
					className="text-mono-label uppercase text-ink-dim"
					accessibilityRole={ROLE.header}
				>
					{label}
				</Text>
				<Button
					label={copied ? "Copied" : "Copy"}
					onPress={() => {
						void Clipboard.setStringAsync(command).then(() => setCopied(true));
					}}
					variant="quiet"
					size="sm"
					accessibilityHint={`Copies the ${label} command`}
					testID={tunnelCommandCopyId(label)}
				/>
			</View>
			{note ? <Text className="text-body-sm text-ink-dim">{note}</Text> : null}
			<View className="rounded-sm border border-hairline bg-sunken p-3">
				<Text
					selectable
					className="text-mono-sm text-ink"
					testID={testID ?? commandCopyId(label)}
				>
					{command}
				</Text>
			</View>
		</View>
	);
};
