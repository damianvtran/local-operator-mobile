import { ChevronDown, ChevronsUpDown } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
	type ComputerEntry,
	computerEntry,
	ENTRY_DOT_TOKEN,
	entryHealthWord,
	headerChipShowsChevron,
} from "@/features/auth/computer-entry";
import { useComputerSwitcher } from "@/features/auth/computer-switcher-sheet";
import { useConnectionState } from "@/features/auth/connection-provider";
import { ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { middleFit } from "@/ui/components/list-row-meta";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";

/**
 * The switcher's two navigation entry points — the Home header chip and the
 * drawer footer's workspace row. Why both exist, and what they say, is decided in
 * `computer-entry.ts`; this file only paints it and calls the ONE sheet's
 * `open()`. Neither renders a list of its own.
 */

/** The entry state from the store, read the way every other surface reads it. */
function useComputerEntry(): ComputerEntry {
	const computers = useConnectionState((state) => state.computers);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const route = useConnectionState((state) => state.route);
	const phase = useConnectionState((state) => state.phase);
	const surface = useConnectionState((state) => state.surface);
	return computerEntry({ computers, tunnelId, route, phase, surface });
}

/** Decoration: the health WORD is always in the control's accessible name, and on
 *  the drawer row it is painted too — never colour alone (U-03). */
const HealthDot = ({ entry }: { entry: ComputerEntry }) => {
	const colour = useTokenColor(
		entry.kind === "computer" ? ENTRY_DOT_TOKEN[entry.health.kind] : "ink-dim",
	);
	return (
		<View
			className="h-2 w-2 shrink-0 rounded-full"
			style={{ backgroundColor: colour }}
			aria-hidden
		/>
	);
};

/**
 * The Home header's chip: `● Mac mini ▾`, or "Choose a computer".
 *
 * It replaced the "… — choose a computer" text label in the same slot and keeps
 * that label's two constraints (`header-fit.ts`, design round 9, D24):
 *  - The floor on BOTH axes. Beside the bell at 320 pt / 200 % text the flex row
 *    shrinks this control first, and without a width floor it measured 36.4 pt.
 *  - ONE pre-fitted line (`middleFit`), never a wrap: the header's height is fixed
 *    and a wrapped name broke a host inside its port (design D3).
 * At the same type step the bell drops its count pill, the chip drops its chevron
 * (`headerChipShowsChevron`), so the width goes to the name.
 */
export function HeaderComputerChip({ testID }: { testID: string }) {
	const entry = useComputerEntry();
	const { open } = useComputerSwitcher();
	const { effectiveScale } = useTextScale();
	const [nameWidth, setNameWidth] = useState(0);
	const ink = useTokenColor("ink-dim");
	const label = entry.kind === "computer" ? entry.name : entry.label;
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={entry.accessibilityLabel}
			onPress={open}
			testID={testID}
			className="min-w-0 flex-1 flex-row items-center gap-1.5"
			style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
		>
			{entry.kind === "computer" ? <HealthDot entry={entry} /> : null}
			<Text
				className="text-mono-sm text-ink-muted"
				numberOfLines={1}
				onLayout={(event) =>
					setNameWidth(Math.floor(event.nativeEvent.layout.width))
				}
				style={{ flexShrink: 1 }}
			>
				{nameWidth > 0 ? middleFit(label, nameWidth, effectiveScale) : label}
			</Text>
			{headerChipShowsChevron(effectiveScale) ? (
				<ChevronDown size={14} strokeWidth={2.5} color={ink} aria-hidden />
			) : null}
		</Pressable>
	);
}

/**
 * The drawer footer's workspace row: `● Mac mini · Online ⇅`.
 *
 * This is the "bottom of the navigation" the operator asked for: the app has no
 * tab bar, so the drawer's footer is where navigation ends, and the workspace
 * row is where a Slack-shaped app puts "which one am I in". It replaced the plain
 * "Computers" route button in the same slot; managing computers stays reachable
 * from the sheet ("Add a computer") and from Settings.
 *
 * The health WORD is painted here, not only spoken: the drawer has the width the
 * header does not. The name pre-fits to one line like the header's, and the word
 * never shrinks, so a long name gives way first.
 */
export function DrawerComputerRow({
	testID,
	onNavigate,
}: {
	testID: string;
	/** Closes the drawer first, as every footer route does, so the sheet rises
	 *  over Home rather than over a closing overlay. */
	onNavigate?: () => void;
}) {
	const entry = useComputerEntry();
	const { open } = useComputerSwitcher();
	const { effectiveScale } = useTextScale();
	const [nameWidth, setNameWidth] = useState(0);
	const ink = useTokenColor("ink-dim");
	const label = entry.kind === "computer" ? entry.name : entry.label;
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={entry.accessibilityLabel}
			onPress={() => {
				onNavigate?.();
				open();
			}}
			testID={testID}
			className="w-full flex-row items-center gap-2 rounded-md border border-hairline bg-surface px-3"
			style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
		>
			{entry.kind === "computer" ? <HealthDot entry={entry} /> : null}
			<Text
				className="text-body-sm text-ink"
				numberOfLines={1}
				onLayout={(event) =>
					setNameWidth(Math.floor(event.nativeEvent.layout.width))
				}
				style={{ flexShrink: 1 }}
			>
				{nameWidth > 0 ? middleFit(label, nameWidth, effectiveScale) : label}
			</Text>
			{entry.kind === "computer" ? (
				<Text className="shrink-0 text-meta text-ink-muted">
					{`· ${entryHealthWord(entry.health)}`}
				</Text>
			) : null}
			<View className="flex-1" />
			<ChevronsUpDown size={16} strokeWidth={2} color={ink} aria-hidden />
		</Pressable>
	);
}
