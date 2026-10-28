import { ChevronDown, ChevronsUpDown } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { RouteProfile } from "@/connection";
import type { SavedComputer } from "@/connection/saved-computers";
import {
	type ComputerEntry,
	computerEntry,
	ENTRY_DOT_TOKEN,
	ENTRY_HEALTH_GLYPH,
	entryHealthWord,
	headerChipShowsChevron,
} from "@/features/auth/computer-entry";
import { useComputerSwitcher } from "@/features/auth/computer-switcher-sheet";
import { useConnectionState } from "@/features/auth/connection-provider";
import {
	readSavedComputers,
	readStoredRadientAccount,
} from "@/features/auth/tunnel-storage";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { middleFit, sansTextWidthDp } from "@/ui/components/list-row-meta";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";
import { TYPE_STEPS } from "@/ui/tokens.gen";

/**
 * The switcher's two navigation entry points — the Home header chip and the
 * drawer footer's workspace row. Why both exist, and what they say, is decided in
 * `computer-entry.ts`; this file only paints it and calls the ONE sheet's
 * `open()`. Neither renders a list of its own.
 */

/** The entry state from the store, read the way every other surface reads it. */
export function useComputerEntry(): ComputerEntry {
	const computers = useConnectionState((state) => state.discoveredComputers);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const route = useConnectionState((state) => state.route);
	const phase = useConnectionState((state) => state.phase);
	const surface = useConnectionState((state) => state.surface);
	const computerId = useConnectionState((state) => state.computerId);
	const hidden = useConnectionState((state) => state.hiddenTunnelIds);
	const [registry, setRegistry] = useState<{
		saved: SavedComputer[];
		account: string | null;
		route: RouteProfile | null;
	}>({ saved: [], account: null, route: null });
	// Scope snapshots to the route before rendering, and fence late reads. A health
	// transition on the SAME route retains its label while refreshing metadata;
	// clearing it on every re-mint would flash the raw address over the saved name.
	// The sheet uses the same account-scoped switcherSections selector.
	// biome-ignore lint/correctness/useExhaustiveDependencies: route, phase, id and hidden are registry invalidation triggers.
	useEffect(() => {
		let live = true;
		void Promise.all([readSavedComputers(), readStoredRadientAccount()]).then(
			([saved, account]) => {
				if (live) setRegistry({ saved, account, route });
			},
		);
		return () => {
			live = false;
		};
	}, [route, phase, computerId, hidden]);
	return computerEntry({
		computers,
		tunnelId,
		route,
		phase,
		surface,
		saved: registry.route === route ? registry.saved : [],
		computerId,
		radientAccount: registry.route === route ? registry.account : null,
	});
}

/** Decoration for assistive technology: the health WORD is in the control's
 * accessible name. Sighted readers also get a distinct shape (U-03). */
const HealthGlyph = ({ entry }: { entry: ComputerEntry }) => {
	const colour = useTokenColor(
		entry.kind === "computer" ? ENTRY_DOT_TOKEN[entry.health.kind] : "ink-dim",
	);
	// U-03 deliberately rejects an accessible name as a visible carrier. Distinct
	// glyphs preserve the compact header while keeping status legible without hue.
	return (
		<Text
			aria-hidden
			style={{
				color: colour,
				width: 12,
				fontSize: 12,
				lineHeight: 16,
				textAlign: "center",
				flexShrink: 0,
			}}
		>
			{entry.kind === "computer" ? ENTRY_HEALTH_GLYPH[entry.health.kind] : ""}
		</Text>
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
			onPress={() => open()}
			testID={testID}
			className="min-w-0 flex-1 flex-row items-center gap-2 rounded-full border border-panel-edge"
			style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
		>
			{entry.kind === "computer" ? <HealthGlyph entry={entry} /> : null}
			{/* The slot must stretch independently of its painted string: measuring
			 * the Text feeds its ellipsis back into the next layout and shrinks it. */}
			<View
				className="min-w-0 flex-1"
				onLayout={(event) => setNameWidth(event.nativeEvent.layout.width)}
			>
				<Text className="text-mono-sm text-ink-muted" numberOfLines={1}>
					{nameWidth > 0 ? middleFit(label, nameWidth, effectiveScale) : label}
				</Text>
			</View>
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
 * never shrinks, so a long name gives way first. The name uses Figtree Medium:
 * that is the shipped face the shared sans advance table was measured from,
 * scaled from its meta size to body-sm rather than charged the mono advance.
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
				open({ returnFocusTestID: CONTROL.computersButton });
			}}
			testID={testID}
			className="w-full flex-row items-center gap-2 rounded-md border border-panel-edge bg-surface px-3"
			style={{ minHeight: TOUCH_FLOOR }}
		>
			{entry.kind === "computer" ? <HealthGlyph entry={entry} /> : null}
			{/* The slot must stretch independently of its painted string: measuring
			 * the Text feeds its ellipsis back into the next layout and shrinks it. */}
			<View
				className="min-w-0 flex-1"
				onLayout={(event) => setNameWidth(event.nativeEvent.layout.width)}
			>
				<Text className="text-body-sm font-medium text-ink" numberOfLines={1}>
					{nameWidth > 0
						? middleFit(label, nameWidth, effectiveScale, (text, scale) =>
								sansTextWidthDp(
									text,
									(scale * TYPE_STEPS["body-sm"].size) / TYPE_STEPS.meta.size,
								),
							)
						: label}
				</Text>
			</View>
			{entry.kind === "computer" ? (
				<Text className="shrink-0 text-meta text-ink-muted">
					{`· ${entryHealthWord(entry.health)}`}
				</Text>
			) : null}

			<ChevronsUpDown size={16} strokeWidth={2} color={ink} aria-hidden />
		</Pressable>
	);
}
