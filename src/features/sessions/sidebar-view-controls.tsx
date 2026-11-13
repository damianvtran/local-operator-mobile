import { Pressable, Switch, Text, View } from "react-native";

import {
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

/**
 * The drawer's view options, drawn once for two places: the compact sheet the
 * drawer's sliders icon opens (`scope: "sheet"` — order, grouping, ended), and
 * the Settings section (`scope: "settings"` — every option the phone has,
 * including the clock and the per-section switches). One component so the two
 * cannot drift in labels, order or behaviour; only the ids differ, because a
 * docked drawer and Settings can share a screen and an id is declared once.
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
		showEnded: CONTROL.sidebarViewShowEnded,
	},
	settings: {
		order: CONTROL.settingsSidebarOrder,
		activeFirst: CONTROL.settingsSidebarOrderActiveFirst,
		recent: CONTROL.settingsSidebarOrderRecent,
		group: CONTROL.settingsSidebarGroup,
		section: CONTROL.settingsSidebarGroupSection,
		flat: CONTROL.settingsSidebarGroupFlat,
		showEnded: CONTROL.settingsSidebarShowEnded,
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
 */
const SwitchRow = ({
	label,
	hint,
	value,
	onChange,
	testID,
}: {
	label: string;
	hint?: string;
	value: boolean;
	onChange: (next: boolean) => void;
	testID: string;
}) => {
	const accent = useTokenColor("accent");
	const track = useTokenColor("border-control");
	return (
		<Pressable
			accessibilityRole={ROLE.switch}
			accessibilityLabel={label}
			accessibilityHint={hint}
			accessibilityState={{ checked: value }}
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
				<Text className="text-body text-ink">{label}</Text>
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
					onValueChange={onChange}
					trackColor={{ true: accent, false: track }}
				/>
			</View>
		</Pressable>
	);
};

export const SidebarViewControls = ({
	view,
	onChange,
	scope,
}: {
	view: SidebarView;
	onChange: (next: SidebarView) => void;
	scope: "sheet" | "settings";
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
					value={view.groupBy}
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
