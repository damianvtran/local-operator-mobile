/**
 * The `$skill` list: a non-modal tray docked directly above the session
 * composer's field while a `$name` token is being typed.
 *
 * WHY A TRAY AND NOT A SHEET. The slash sheet works because a slash command is
 * a complete act. A skill name is typed INSIDE a sentence: a sheet would take
 * focus out of the field, drop the keyboard mid-word and hand the rest of the
 * draft to a filter. So — like the Team Bridge `@`-mention strip
 * (`team-bridge/mentions/mention-strip.tsx`) — this is an ordinary in-flow child
 * that rides the composer's own keyboard lift, and the list scrolls with
 * `keyboardShouldPersistTaps="handled"`: without it the first tap on a row only
 * dismisses the keyboard.
 *
 * It lives in the composer card's extras band (above the field), so the
 * composer's geometry budget already accounts for its height; its own cap is
 * three and a half rows, the half row being the cue that more are below, so it
 * never covers the transcript on a short phone with the keyboard up.
 *
 * WHAT A ROW SHOWS (the relay web tray's): `$name`, the skill's one-line
 * description (already cut to 160 characters by the relay) and a `hidden` tag
 * for a skill whose `hide` frontmatter suppresses automatic selection — the
 * picker still offers it, because being TYPED is exactly the case `hide` leaves
 * open. `$name` is a Latin technical token and keeps left-to-right under an RTL
 * layout.
 *
 * The rows are a pure projection of what `skillView` matched: no fetch, no
 * state.
 */
import { Pressable, ScrollView, Text, View } from "react-native";
import type { SkillEntry } from "@/contracts";
import { t } from "@/i18n";
import { ROLE, SURFACE, skillTrayRowId } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

/** At most three and a half rows before the tray scrolls. */
export const SKILL_TRAY_MAX_PT = Math.round(TOUCH_FLOOR * 3.5);

export type SkillTrayProps = {
	/** The matched rows, already filtered and ordered by the hook. */
	rows: readonly SkillEntry[];
	/** Replace the token with this skill. Focus never left the field. */
	onPick: (name: string) => void;
	/** A row's press began / ended without landing (see `useSkills.hold`). */
	onHold?: () => void;
	onRelease?: () => void;
};

export function SkillRow({
	row,
	onPick,
	onHold,
	onRelease,
}: {
	row: SkillEntry;
	onPick: SkillTrayProps["onPick"];
	onHold?: () => void;
	onRelease?: () => void;
}) {
	const hidden = t("relay.skills.tray.hidden");
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={
				row.hidden ? `$${row.name}, ${hidden}` : `$${row.name}`
			}
			accessibilityHint={row.description}
			testID={skillTrayRowId(row.name)}
			onPressIn={onHold}
			onPressOut={onRelease}
			onPress={() => onPick(row.name)}
			style={{ minHeight: TOUCH_FLOOR }}
		>
			{({ pressed }) => (
				<View
					className={cx(
						"flex-1 flex-row items-center gap-2 ps-3 pe-3",
						pressed && "bg-row-hover",
					)}
					style={{ minHeight: TOUCH_FLOOR }}
				>
					<Text
						className="shrink-0 text-mono-sm text-ink"
						style={{ writingDirection: "ltr" }}
					>
						${row.name}
					</Text>
					{row.hidden ? (
						<Text className="shrink-0 rounded-full bg-elevated px-2 text-meta text-ink-dim">
							{hidden}
						</Text>
					) : null}
					<Text
						numberOfLines={1}
						className="min-w-0 flex-1 text-body-sm text-ink-muted"
					>
						{row.description}
					</Text>
				</View>
			)}
		</Pressable>
	);
}

export function SkillTray({ rows, onPick, onHold, onRelease }: SkillTrayProps) {
	if (rows.length === 0) return null;
	return (
		<View
			testID={SURFACE.skillTray}
			accessibilityLabel={t("relay.skills.tray.label")}
			className="mb-2 overflow-hidden rounded-md border border-hairline bg-surface"
		>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				nestedScrollEnabled
				style={{ maxHeight: SKILL_TRAY_MAX_PT }}
				contentContainerClassName="py-1"
			>
				{rows.map((row) => (
					<SkillRow
						key={row.name}
						row={row}
						onPick={onPick}
						onHold={onHold}
						onRelease={onRelease}
					/>
				))}
			</ScrollView>
		</View>
	);
}
