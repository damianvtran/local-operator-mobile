import { useRouter } from "expo-router";
import { Check } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { t } from "@/i18n";
import { chooseTheme, type ThemeMode } from "@/state/theme-preference";
import { CONTROL, REGION, ROLE, SCREEN, state, themeCardId } from "@/ui/a11y";
import { useTheme, useTokenColor } from "@/ui/appearance";
import { maxColumnWidth } from "@/ui/column";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Segmented } from "@/ui/components/segmented";
import { LAYOUT, type ThemeEntry, themeEntry } from "@/ui/tokens.gen";
import {
	isSelectedTheme,
	type PickerSection,
	pickerColumns,
	pickerSections,
} from "./theme-picker-model";

/**
 * Settings → Appearance → Theme: every theme the app ships, chosen per side
 * (decision record `mobile-design-direction.md` § 5, "Picker UX").
 *
 * Top to bottom: the mode (System / Light / Dark), a caption naming the pair,
 * a search field, then a Dark and a Light grid — the side being looked at
 * first. A tap applies at once, to the whole app including this screen; there
 * is no confirm step, because the screen itself IS the preview.
 *
 * The cards paint with the palette's OWN values (`entry.colors`), never with
 * the active theme's classes: a card is a picture of a theme that is not
 * showing. That is the one place in the app where colour comes from data
 * rather than a role class, and it is confined to the preview drawing.
 */

/** The card's preview height and gap, in pt: ~72 pt of drawing plus the name
 *  line keeps 59 cards at ≈ 3.3k pt of scroll in two columns (record § 5). */
const PREVIEW_HEIGHT = 72;
const GRID_GAP = 12;

export default function ThemePicker() {
	const router = useRouter();
	const { selection, setSelection, setPreference, theme } = useTheme();
	const [query, setQuery] = useState("");
	const viewport = useWindowDimensions();
	const insets = useSafeAreaInsets();

	/* The record's 320/600 pt breakpoints describe the viewport, not its
	 * padded content: subtracting the gutters first would leave a 600 pt
	 * viewport at two columns. Card WIDTH still follows Screen's actual
	 * capped column, with its horizontal safe areas and px-4 gutters paid,
	 * so the three columns never spill into a landscape display cutout. */
	const safeWidth = viewport.width - insets.left - insets.right;
	const columnWidth =
		Math.min(safeWidth, maxColumnWidth(viewport) ?? safeWidth) -
		2 * LAYOUT.gutter;
	const columns = pickerColumns(viewport.width);
	const cardWidth = Math.floor(
		(columnWidth - GRID_GAP * (columns - 1)) / columns,
	);

	const sections = useMemo(() => pickerSections(query, theme), [query, theme]);
	const lightName = themeEntry(selection.lightTheme, "light").name;
	const darkName = themeEntry(selection.darkTheme, "dark").name;

	const choose = (entry: ThemeEntry) =>
		setSelection(chooseTheme(selection, entry.id, entry.mode));

	return (
		<Screen
			title={t("mobile.settings.theme.title")}
			testID={SCREEN.themePicker}
			headerLeading={
				<Button
					testID={CONTROL.themePickerBack}
					label={t("mobile.common.back")}
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
		>
			<View className="gap-3 pt-2">
				<Segmented<ThemeMode>
					testID={CONTROL.themePickerModeGroup}
					label={t("mobile.settings.theme.mode_label")}
					value={selection.mode}
					onChange={setPreference}
					options={[
						{
							value: "system",
							label: t("mobile.settings.theme.mode_system"),
							testID: CONTROL.themePickerModeSystem,
						},
						{
							value: "light",
							label: t("mobile.settings.theme.mode_light"),
							testID: CONTROL.themePickerModeLight,
						},
						{
							value: "dark",
							label: t("mobile.settings.theme.mode_dark"),
							testID: CONTROL.themePickerModeDark,
						},
					]}
				/>
				<Text
					className="text-body-sm text-ink-dim"
					testID={CONTROL.themePickerCaption}
				>
					{selection.mode === "system"
						? t("mobile.settings.theme.caption_system", {
								light: lightName,
								dark: darkName,
							})
						: t("mobile.settings.theme.caption_forced", {
								name: selection.mode === "light" ? lightName : darkName,
							})}
				</Text>
				<Input
					testID={CONTROL.themePickerSearch}
					label={t("mobile.settings.theme.search_label")}
					placeholder={t("mobile.settings.theme.search_placeholder")}
					value={query}
					onChangeText={setQuery}
					autoCapitalize="none"
					returnKeyType="search"
				/>
				{/* One region for "the search found nothing anywhere", so a flow can
				 *  assert it without knowing which section came first. */}
				{sections.every((section) => section.themes.length === 0) ? (
					<View testID={REGION.themePickerEmpty} />
				) : null}
				{sections.map((section) => (
					<ThemeSection
						key={section.mode}
						section={section}
						columns={columns}
						cardWidth={cardWidth}
						selection={selection}
						onChoose={choose}
					/>
				))}
			</View>
		</Screen>
	);
}

const ThemeSection = ({
	section,
	columns,
	cardWidth,
	selection,
	onChoose,
}: {
	section: PickerSection;
	columns: number;
	cardWidth: number;
	selection: ReturnType<typeof useTheme>["selection"];
	onChoose: (entry: ThemeEntry) => void;
}) => (
	<View
		className="gap-3"
		testID={
			section.mode === "dark" ? REGION.themePickerDark : REGION.themePickerLight
		}
	>
		<SectionHeader
			label={
				section.mode === "dark"
					? t("mobile.settings.theme.section_dark", {
							count: section.themes.length,
						})
					: t("mobile.settings.theme.section_light", {
							count: section.themes.length,
						})
			}
		/>
		{section.themes.length === 0 ? (
			<Text className="text-body-sm text-ink-dim">
				{t("mobile.settings.theme.no_match")}
			</Text>
		) : (
			/* Rows of `columns` cards rather than a wrapping row: `flex-wrap` with
			 *  `gap` leaves the last row's cards at their own width, but RTL and
			 *  200 % text both reflow a wrap unpredictably, and a fixed row keeps
			 *  every card the same width (and every name truncation the same). */
			<View className="gap-3">
				{chunk(section.themes, columns).map((row) => (
					<View
						key={row[0]?.id ?? "empty"}
						className="flex-row"
						style={{ gap: GRID_GAP }}
					>
						{row.map((entry) => (
							<ThemeCard
								key={entry.id}
								entry={entry}
								width={cardWidth}
								selected={isSelectedTheme(entry, selection)}
								onPress={() => onChoose(entry)}
							/>
						))}
					</View>
				))}
			</View>
		)}
	</View>
);

const chunk = <T,>(items: readonly T[], size: number): T[][] => {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
};

/**
 * One theme: a miniature of the app in that palette, with the name below.
 *
 * The drawing, in the palette's own values: the `canvas` ground, a `surface`
 * bar (a card), two ink lines at `ink` / `ink-muted`, an `accent` dot, and an
 * `elevated` pill along the bottom (the composer) — the five roles that
 * distinguish one theme from another at a glance.
 *
 * Selected: a 2 pt ring in the ACTIVE theme's accent (it is chrome around the
 * card, so it belongs to the screen, not to the card's palette) plus a ✓ and
 * `accessibilityState.selected` — colour is never the only signal.
 */
const ThemeCard = ({
	entry,
	width,
	selected,
	onPress,
}: {
	entry: ThemeEntry;
	width: number;
	selected: boolean;
	onPress: () => void;
}) => {
	const ring = useTokenColor("accent");
	const onRing = useTokenColor("on-accent");
	const c = entry.colors;
	const label = t(
		entry.mode === "dark"
			? selected
				? "mobile.settings.theme.card_dark_selected"
				: "mobile.settings.theme.card_dark"
			: selected
				? "mobile.settings.theme.card_light_selected"
				: "mobile.settings.theme.card_light",
		{ name: entry.name },
	);
	return (
		<Pressable
			testID={themeCardId(entry.id)}
			accessibilityRole={ROLE.radio}
			accessibilityLabel={label}
			accessibilityState={state({ selected })}
			aria-checked={selected}
			onPress={onPress}
			style={{ width }}
			className="gap-1.5"
		>
			{({ pressed }) => (
				<>
					<View
						className="overflow-hidden rounded-md"
						style={{
							height: PREVIEW_HEIGHT,
							backgroundColor: c.canvas,
							/* The ring is drawn as a border on every card, transparent when
							 *  unselected, so selecting never shifts the drawing by 2 pt. A
							 *  hairline-in-the-palette edge stays underneath for the cards
							 *  whose canvas matches the screen's own ground. */
							borderWidth: 2,
							borderColor: selected ? ring : c.hairline,
							opacity: pressed ? 0.85 : 1,
						}}
					>
						<View className="flex-1 gap-1.5 p-2">
							<View
								className="flex-row items-center gap-1.5 rounded-sm px-1.5 py-1"
								style={{ backgroundColor: c.surface }}
							>
								<View
									className="h-2 w-2 rounded-full"
									style={{ backgroundColor: c.accent }}
								/>
								<View
									className="h-1.5 flex-1 rounded-full"
									style={{ backgroundColor: c.ink }}
								/>
							</View>
							<View
								className="h-1.5 w-3/4 rounded-full"
								style={{ backgroundColor: c["ink-muted"] }}
							/>
							<View
								className="mt-auto h-3.5 flex-row items-center justify-end rounded-full px-1"
								style={{ backgroundColor: c.elevated }}
							>
								<View
									className="h-2.5 w-2.5 rounded-full"
									style={{ backgroundColor: c.accent }}
								/>
							</View>
						</View>
						{selected ? (
							<View
								className="absolute end-1 top-1 h-5 w-5 items-center justify-center rounded-full"
								style={{ backgroundColor: ring }}
								testID={CONTROL.themePickerCheck}
							>
								<Check size={14} color={onRing} strokeWidth={3} />
							</View>
						) : null}
					</View>
					<Text
						className={`text-body-sm ${selected ? "font-semibold text-ink" : "text-ink-muted"}`}
						numberOfLines={1}
					>
						{entry.name}
					</Text>
				</>
			)}
		</Pressable>
	);
};
