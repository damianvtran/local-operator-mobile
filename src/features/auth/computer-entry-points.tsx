import { ChevronDown, ChevronsUpDown } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Path, Svg } from "react-native-svg";
import type { RouteProfile } from "@/connection";
import type { SavedComputer } from "@/connection/saved-computers";
import {
	type ComputerEntry,
	computerEntry,
	ENTRY_DOT_TOKEN,
	entryHealthWord,
	headerChipShowsChevron,
} from "@/features/auth/computer-entry";
import { useComputerSwitcher } from "@/features/auth/computer-switcher-sheet";
import { useConnectionState } from "@/features/auth/connection-provider";
import {
	ENTRY_HEALTH_MARK,
	type EntryHealthMark,
	MARK_BOX,
	MARK_STROKE,
	MARK_VIEW_BOX,
	scaledMarkBox,
	scaledMarkSize,
} from "@/features/auth/entry-health-marks";
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
	//
	// WHY `phase` IS IN THE DEPENDENCY LIST, since it re-reads secure storage each
	// time (review round 2, nit). It is not a refresh for its own sake: the guard
	// below renders the saved list only while `registry.route === route` is the SAME
	// object, and a re-mint REBUILDS that object, so without a read on the phase
	// that follows it the snapshot would stop matching and the chip would fall back
	// to the raw address mid-connect — the exact flash this comment warns about, and
	// the one QA would see as a label change during connect. Two reads per connect
	// on a body press is the price; `readSavedComputers` is one keychain read plus a
	// JSON parse, and the alternative (caching a signature) re-reads anyway to learn
	// the signature has not changed.
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

/**
 * The mark's TYPE SIZE and SLOT at a text scale — one function, because the chip
 * and the drawer row must not disagree about a status mark's geometry.
 *
 * The mark follows the text it sits beside: it was pinned at a fixed 12 pt in a
 * 12 × 16 box while the name doubled, so at 200 % the status mark was half the
 * name's step and the drawer row's health WORD — `text-meta`, a chrome step
 * capped at 1.5x — barely moved (design round 2, D9). `meta` is the step both
 * take at 100 %; the cap is deliberately not applied here, because this is
 * status content rather than chrome.
 */
const markGeometry = (scale: number) => {
	const fontSize = scaledMarkSize(
		TYPE_STEPS.meta.size,
		scale,
		Platform.OS === "web",
	);
	return {
		fontSize,
		box: {
			width: scaledMarkBox(MARK_BOX.width, scale),
			height: scaledMarkBox(MARK_BOX.height, scale),
		},
	};
};

/**
 * The visible status mark: a glyph the shipped face covers, or paths drawn here.
 *
 * Decoration for assistive technology: the health WORD is in the control's
 * accessible name, and sighted readers get a distinct shape (U-03). Which kinds
 * are drawn and why is in `entry-health-marks.ts` — the short version is that
 * Figtree ships the Latin subset, and ✓ ↪ Ⅱ are not in it.
 */
const HealthMark = ({
	entry,
	fontSize,
	box,
}: {
	entry: ComputerEntry;
	fontSize: number;
	box: { width: number; height: number };
}) => {
	const colour = useTokenColor(
		entry.kind === "computer" ? ENTRY_DOT_TOKEN[entry.health.kind] : "ink-dim",
	);
	const mark: EntryHealthMark | null =
		entry.kind === "computer" ? ENTRY_HEALTH_MARK[entry.health.kind] : null;
	if (mark === null) return null;
	// U-03 deliberately rejects an accessible name as a visible carrier: the mark
	// itself has to differ in shape, not only in hue.
	if (mark.form === "text")
		return (
			<Text
				aria-hidden
				style={{
					color: colour,
					width: box.width,
					height: box.height,
					fontSize,
					lineHeight: box.height,
					textAlign: "center",
					flexShrink: 0,
				}}
			>
				{mark.glyph}
			</Text>
		);
	/* A drawn mark's carrier is the SHAPE: the audit's probe counts an `svg` child
	 * as an image carrier, so the hue here is never the only signal. */
	return (
		<View
			aria-hidden
			style={{
				width: box.width,
				height: box.height,
				alignItems: "center",
				justifyContent: "center",
				flexShrink: 0,
			}}
		>
			<Svg
				width={box.width}
				height={box.height}
				viewBox={`0 0 ${MARK_VIEW_BOX} ${MARK_VIEW_BOX}`}
			>
				{mark.paths.map((d) => (
					<Path
						key={d}
						d={d}
						stroke={colour}
						strokeWidth={MARK_STROKE}
						strokeLinecap="round"
						strokeLinejoin="round"
						fill="none"
					/>
				))}
			</Svg>
		</View>
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
	const geometry = markGeometry(effectiveScale);
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={entry.accessibilityLabel}
			onPress={() => open()}
			testID={testID}
			/* `border-control`, not `panel-edge`: in the LIGHT palette `panel-edge` IS
			 *  `hairline` (#dad5cb), measured 1.25:1 on the canvas — no capsule at all.
			 *  At 200 % the chevron is dropped, so this edge is the only affordance the
			 *  chip has (D8). `border-control` is the kit's own control-edge pair (the
			 *  role `input` and `Button` outline already use): 3.42:1 light on canvas,
			 *  3.65:1 on `surface`; 3.93:1 and 3.58:1 dark. */
			className="min-w-0 flex-1 flex-row items-center gap-2 rounded-full border border-border-control"
			style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
		>
			<HealthMark entry={entry} {...geometry} />
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
	const geometry = markGeometry(effectiveScale);
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={entry.accessibilityLabel}
			onPress={() => {
				onNavigate?.();
				open({ returnFocusTestID: CONTROL.computersButton });
			}}
			testID={testID}
			/* The same control edge as the chip: one deliberate affordance pair for
			 *  both entry points, and in the light palette the old `panel-edge` was
			 *  `hairline` — 1.18:1 on this row's `surface` fill (D8). `border-control`
			 *  measures 3.65:1 here. */
			className="w-full flex-row items-center gap-2 rounded-md border border-border-control bg-surface px-3"
			style={{ minHeight: TOUCH_FLOOR }}
		>
			<HealthMark entry={entry} {...geometry} />
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
				<Text
					/* `text-meta` for the step's line box and weight, with the size taken
					 *  from `markGeometry`: `meta` is a CHROME step, capped at 1.5x, so the
					 *  word a low-vision reader needs stopped scaling while the name doubled
					 *  (D9). The cap is about chrome labels, not status content. */
					className="shrink-0 text-meta text-ink-muted"
					style={{ fontSize: geometry.fontSize }}
				>
					{`· ${entryHealthWord(entry.health)}`}
				</Text>
			) : null}

			<ChevronsUpDown size={16} strokeWidth={2} color={ink} aria-hidden />
		</Pressable>
	);
}
