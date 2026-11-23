import { Platform, Pressable, Switch, Text, View } from "react-native";

import {
	drawnGroupBy,
	SIDEBAR_SECTIONS,
	type SidebarBasis,
	type SidebarGroupBy,
	type SidebarOrderBy,
	type SidebarSectionKey,
	type SidebarView,
	toggleSidebarSection,
} from "@/features/sessions/sidebar-view";
import { t } from "@/i18n";
import { CONTROL, ROLE, sidebarSectionSwitchId } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Segmented } from "@/ui/components/segmented";
import { TOUCH_FLOOR } from "@/ui/layout";
import { switchGeometry, switchRoles } from "@/ui/variants";

/**
 * The drawer's view options, drawn once for two places: the compact sheet the
 * drawer's sliders icon opens (`scope: "sheet"` — order, grouping, ended,
 * tags), and the Settings section (`scope: "settings"` — every option the phone
 * has, including the clock and the per-section switches). One component so the two
 * cannot drift in labels, order or behaviour; only the ids differ, because a
 * docked drawer and Settings can share a screen and an id is declared once.
 *
 * THE TAG CONTROLS ARE GATED ON THE RELAY (`tagsAvailable`, from
 * `canAssignSessionTags`): an older relay has no tag routes, so both the Tag
 * grouping and the Show tags switch would be controls that change nothing the
 * reader can see. A stored `tag` still shows as its drawn answer —
 * `drawnGroupBy` — while the stored value survives in the store for the next
 * capable relay.
 *
 * Labels are the desktop's own words (`ui.chat.sidebar_view.*`), mirrored into
 * `mobile.sidebar.*`, so a reader who knows one surface reads the other.
 */

export const SIDEBAR_SECTION_LABEL = {
	pinned: "mobile.sidebar.section.pinned",
	running: "mobile.sidebar.section.running",
	today: "mobile.sidebar.section.today",
	week: "mobile.sidebar.section.week",
	older: "mobile.sidebar.section.older",
} as const satisfies Record<SidebarSectionKey, string>;

const IDS = {
	sheet: {
		order: CONTROL.sidebarViewOrder,
		activeFirst: CONTROL.sidebarViewOrderActiveFirst,
		recent: CONTROL.sidebarViewOrderRecent,
		group: CONTROL.sidebarViewGroup,
		section: CONTROL.sidebarViewGroupSection,
		flat: CONTROL.sidebarViewGroupFlat,
		tag: CONTROL.sidebarViewGroupTag,
		showEnded: CONTROL.sidebarViewShowEnded,
		showTags: CONTROL.sidebarViewShowTags,
	},
	settings: {
		order: CONTROL.settingsSidebarOrder,
		activeFirst: CONTROL.settingsSidebarOrderActiveFirst,
		recent: CONTROL.settingsSidebarOrderRecent,
		group: CONTROL.settingsSidebarGroup,
		section: CONTROL.settingsSidebarGroupSection,
		flat: CONTROL.settingsSidebarGroupFlat,
		tag: CONTROL.settingsSidebarGroupTag,
		showEnded: CONTROL.settingsSidebarShowEnded,
		showTags: CONTROL.settingsSidebarShowTags,
	},
} as const;

/** The group's visible label. Hidden from assistive tech, which hears the same
 *  words as the control's own name (the Settings screen's D15 pattern). */
const GroupLabel = ({ label }: { label: string }) => (
	<Text aria-hidden className="text-label text-ink-muted">
		{label}
	</Text>
);

/**
 * One switch row. The ROW is the control (role `switch`, a TOUCH_FLOOR target,
 * the label as its name); the platform `Switch` inside is its picture, kept out
 * of the accessibility tree and out of hit-testing so a press anywhere on the
 * row toggles exactly once and a screen reader hears one control, not two.
 *
 * Exported for Settings → Notifications' preference switches, so the app has
 * one switch row rather than two. `disabled` (a preference this computer
 * cannot honour yet) steps the label to `ink-dim`, announces it, and presses do nothing.
 */
export const SwitchRow = ({
	label,
	hint,
	value,
	onChange,
	testID,
	disabled = false,
	accessibilityHint,
}: {
	label: string;
	hint?: string;
	value: boolean;
	onChange: (next: boolean) => void;
	testID: string;
	disabled?: boolean;
	/** Screen-reader-only hint, for a reason already written on screen nearby
	 *  (a disabled switch's note, PR #264 D6/U9). `hint` would print it a
	 *  second time under the label; this is read only, and wins over `hint`. */
	accessibilityHint?: string;
}) => {
	/* Both states' roles, resolved every render (a hook per colour, in a fixed
	 *  order); the platform decides what the thumb is seen against
	 *  (`switchGeometry`, `SWITCH_ROLES`). */
	const geometry = switchGeometry(Platform.OS);
	const on = switchRoles(geometry, true, disabled);
	const off = switchRoles(geometry, false, disabled);
	const onTrack = useTokenColor(on.track);
	const onThumb = useTokenColor(on.thumb);
	const offTrack = useTokenColor(off.track);
	const offThumb = useTokenColor(off.thumb);
	/* react-native-web reads the ON thumb from `activeThumbColor` and ignores
	 *  `thumbColor` while on, so without it its teal default returns. Not a
	 *  React Native prop, hence widened to `object` (the `dir` pattern). */
	const webThumb: object = { activeThumbColor: onThumb };
	return (
		<Pressable
			accessibilityRole={ROLE.switch}
			accessibilityLabel={label}
			accessibilityHint={accessibilityHint ?? hint}
			accessibilityState={{ checked: value, disabled }}
			disabled={disabled}
			aria-disabled={disabled}
			// react-native-web does not read `accessibilityState`, so on the web the
			// switch had no on/off for a screen reader (QA round 1, Q1). Written
			// alongside the native state, as `Segmented` does for its radios.
			aria-checked={value}
			onPress={() => onChange(!value)}
			testID={testID}
			className="flex-row items-center gap-3"
			style={{ minHeight: TOUCH_FLOOR }}
		>
			<View className="min-w-0 flex-1 gap-1">
				{/* Disabled is a colour step, never an opacity (variants.ts § 0). */}
				<Text
					className={disabled ? "text-body text-ink-dim" : "text-body text-ink"}
				>
					{label}
				</Text>
				{hint ? (
					<Text className="text-body-sm text-ink-dim">{hint}</Text>
				) : null}
			</View>
			<View
				pointerEvents="none"
				importantForAccessibility="no-hide-descendants"
				accessibilityElementsHidden
			>
				<Switch
					value={value}
					disabled={disabled}
					onValueChange={onChange}
					trackColor={{ true: onTrack, false: offTrack }}
					thumbColor={value ? onThumb : offThumb}
					// iOS fills the off track from this, not from `trackColor.false`.
					ios_backgroundColor={offTrack}
					{...webThumb}
				/>
			</View>
		</Pressable>
	);
};

export const SidebarViewControls = ({
	view,
	onChange,
	scope,
	tagsAvailable,
}: {
	view: SidebarView;
	onChange: (next: SidebarView) => void;
	scope: "sheet" | "settings";
	/** `session_tags.available`: draws the tag controls, and decides what a
	 *  stored `tag` grouping shows as selected. */
	tagsAvailable: boolean;
}) => {
	const ids = IDS[scope];
	const full = scope === "settings";
	return (
		<View className="gap-4">
			<View className="gap-2">
				<GroupLabel label={t("mobile.sidebar.order_by")} />
				<Segmented<SidebarOrderBy>
					testID={ids.order}
					label={t("mobile.sidebar.order_by")}
					value={view.orderBy}
					onChange={(orderBy) => onChange({ ...view, orderBy })}
					options={[
						{
							value: "active-first",
							label: t("mobile.sidebar.order.active_first"),
							testID: ids.activeFirst,
						},
						{
							value: "recent",
							label: t("mobile.sidebar.order.most_recent"),
							testID: ids.recent,
						},
					]}
				/>
			</View>
			<View className="gap-2">
				<GroupLabel label={t("mobile.sidebar.group_by")} />
				<Segmented<SidebarGroupBy>
					testID={ids.group}
					label={t("mobile.sidebar.group_by")}
					value={drawnGroupBy(view, tagsAvailable)}
					onChange={(groupBy) => onChange({ ...view, groupBy })}
					options={[
						{
							value: "section",
							label: t("mobile.sidebar.group.time_section"),
							testID: ids.section,
						},
						{
							value: "flat",
							label: t("mobile.sidebar.group.one_list"),
							testID: ids.flat,
						},
						...(tagsAvailable
							? [
									{
										value: "tag" as const,
										label: t("mobile.sidebar.group.tag"),
										testID: ids.tag,
									},
								]
							: []),
					]}
				/>
			</View>
			{full ? (
				<View className="gap-2">
					<GroupLabel label={t("mobile.sidebar.time_basis")} />
					<Segmented<SidebarBasis>
						testID={CONTROL.settingsSidebarBasis}
						label={t("mobile.sidebar.time_basis")}
						value={view.basis}
						onChange={(basis) => onChange({ ...view, basis })}
						options={[
							{
								value: "active",
								label: t("mobile.sidebar.basis.last_active"),
								testID: CONTROL.settingsSidebarBasisActive,
							},
							{
								value: "created",
								label: t("mobile.sidebar.basis.created"),
								testID: CONTROL.settingsSidebarBasisCreated,
							},
						]}
					/>
					<Text className="text-body-sm text-ink-dim">
						{t("mobile.sidebar.clock_hint")}
					</Text>
				</View>
			) : null}
			<SwitchRow
				label={t("mobile.sidebar.show_ended")}
				hint={full ? t("mobile.sidebar.show_ended_hint") : undefined}
				value={view.showEnded}
				onChange={(showEnded) => onChange({ ...view, showEnded })}
				testID={ids.showEnded}
			/>
			{tagsAvailable ? (
				<SwitchRow
					label={t("mobile.sidebar.show_tags")}
					hint={full ? t("mobile.sidebar.show_tags_hint") : undefined}
					value={view.showTags}
					onChange={(showTags) => onChange({ ...view, showTags })}
					testID={ids.showTags}
				/>
			) : null}
			{full ? (
				<View className="gap-1">
					<GroupLabel label={t("mobile.sidebar.sections")} />
					{SIDEBAR_SECTIONS.map((key) => (
						<SwitchRow
							key={key}
							label={t(SIDEBAR_SECTION_LABEL[key])}
							value={!view.hidden.includes(key)}
							onChange={() => onChange(toggleSidebarSection(view, key))}
							testID={sidebarSectionSwitchId(key)}
						/>
					))}
				</View>
			) : null}
		</View>
	);
};
