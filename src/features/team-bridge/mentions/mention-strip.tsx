/**
 * The @-mention suggestion strip: a full-width list docked directly above the
 * Team Bridge composer field while an `@query` is being typed.
 *
 * WHY DOCKED, NOT A POPOVER OR A SHEET. Slack's and Discord's phone apps put
 * suggestions in a band above the keyboard. A popover anchored to the caret is
 * impractical on a phone: React Native exposes no caret coordinates, the screen
 * is narrow, and it would cover the words being typed. A `Sheet` or `Modal`
 * takes focus away from the field (the keyboard drops), and a native modal does
 * not inherit the root's text direction (`ui/direction.tsx`). So the strip is an
 * ordinary in-flow child of `BridgeComposerDock`: it rides the dock's keyboard
 * lift, and it pushes nothing over the newest message.
 *
 * KEYBOARD STAYS UP. The list scrolls with `keyboardShouldPersistTaps="handled"`;
 * without it the first tap on a row only dismisses the keyboard.
 *
 * The rows are a pure projection of `MentionView` (`mention-state.ts`): no
 * fetch, no state. Avatars go through the cached `ProfileSubjectAvatar` path,
 * because endpoint photos draw from the same rate-limited hub bucket as the
 * directory.
 */
import { useEffect } from "react";
import {
	AccessibilityInfo,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";
import { t } from "@/i18n";
import { ROLE, SURFACE, teamBridgeMentionId } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";
import { ProfileSubjectAvatar, UnknownSenderAvatar } from "../profile-card";
import type { MentionCandidateRow } from "./candidates";
import type { MentionSection } from "./matcher";
import type { MentionView } from "./mention-state";
import type { MentionNotice as MentionNoticeState } from "./use-mentions";

/**
 * A row: a 32 pt avatar in a 48 pt band. 48, not the platform floor (44 on
 * iOS): rows sit flush with no gap between them, so a taller band is what keeps
 * a thumb from landing on the neighbour, and a fixed pitch keeps the 4.5-row
 * cap the same height on both platforms.
 */
export const MENTION_ROW_PT = 48;
/**
 * At most four and a half rows before the strip scrolls. The half row is the
 * cue that more are below; any taller and the strip would leave a short phone
 * with the keyboard up almost no transcript at all.
 */
export const MENTION_STRIP_MAX_PT = Math.round(MENTION_ROW_PT * 4.5);

/**
 * Two headings, not desktop's four: on a phone "people" and "agents" read at a
 * glance from the avatar and the role line, and the order (people before
 * agents) already carries the grouping. Shown only when both halves have rows.
 */
type Group = { id: "members" | "org"; rows: MentionCandidateRow[] };

export function mentionGroups(sections: readonly MentionSection[]): Group[] {
	const members: MentionCandidateRow[] = [];
	const org: MentionCandidateRow[] = [];
	for (const section of sections)
		(section.id.startsWith("member") ? members : org).push(
			...(section.rows as MentionCandidateRow[]),
		);
	return [
		{ id: "members" as const, rows: members },
		{ id: "org" as const, rows: org },
	].filter((group) => group.rows.length > 0);
}

const rowKey = (row: MentionCandidateRow) => `${row.kind}:${row.accountId}`;

export function MentionRow({
	row,
	onPick,
}: {
	row: MentionCandidateRow;
	onPick: (row: MentionCandidateRow) => void;
}) {
	const secondary = row.bridgeOff
		? t("mobile.team_bridge.list.person_unavailable")
		: row.secondary;
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={t("mobile.team_bridge.mentions.row_label", {
				name: row.label,
			})}
			accessibilityHint={secondary}
			testID={teamBridgeMentionId(rowKey(row))}
			onPress={() => onPick(row)}
			style={{ minHeight: MENTION_ROW_PT }}
		>
			{({ pressed }) => (
				<View
					className={cx(
						"flex-1 flex-row items-center gap-3 ps-3 pe-3 py-1",
						pressed && "bg-row-hover",
					)}
					style={{ minHeight: MENTION_ROW_PT }}
				>
					{row.profile ? (
						<ProfileSubjectAvatar
							subject={{ person: row.profile, agent: row.kind === "agent" }}
							size="sm"
						/>
					) : (
						<UnknownSenderAvatar kind={row.kind} size="sm" />
					)}
					<View className="min-w-0 flex-1">
						<Text
							numberOfLines={1}
							className={cx(
								"text-body-sm font-medium",
								row.bridgeOff ? "text-ink-muted" : "text-ink",
							)}
						>
							{row.label}
						</Text>
						{secondary ? (
							<Text numberOfLines={1} className="text-meta text-ink-muted">
								{secondary}
							</Text>
						) : null}
					</View>
				</View>
			)}
		</Pressable>
	);
}

type MentionStripProps = {
	view: MentionView;
	/** The directory has never answered: say why the list is short. */
	directoryMissing: boolean;
	onPick: (row: MentionCandidateRow) => void;
	/** The dock's overlay elevation, as the jump pill takes it. */
	shadow?: object | null;
};

export function MentionStrip(props: MentionStripProps) {
	const count = props.view.flat.length;
	/*
	 * Screen readers hear how many suggestions the query left, on open and on
	 * every change (VoiceOver has no live regions for a plain View; Android's
	 * TalkBack honours this announcement too).
	 */
	useEffect(() => {
		AccessibilityInfo.announceForAccessibility(
			t("mobile.team_bridge.mentions.results_count", { count }),
		);
	}, [count]);
	return <MentionStripView {...props} />;
}

/** The drawing half: hook-free, so a Node test can walk its element tree and
 *  invoke the real `onPress` bindings (the `BridgeComposerFieldView` split). */
export function MentionStripView({
	view,
	directoryMissing,
	onPick,
	shadow,
}: MentionStripProps) {
	const groups = mentionGroups(view.sections);
	const headed = groups.length > 1;
	return (
		<View
			testID={SURFACE.teamBridgeMentionStrip}
			className="mx-1 overflow-hidden rounded-md border border-hairline bg-surface"
			style={shadow ?? undefined}
		>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				nestedScrollEnabled
				style={{ maxHeight: MENTION_STRIP_MAX_PT }}
				contentContainerClassName="py-1"
			>
				{directoryMissing ? (
					<Text
						accessibilityRole="text"
						className="ps-3 pe-3 py-2 text-meta text-ink-muted"
					>
						{t("mobile.team_bridge.mentions.unavailable")}
					</Text>
				) : null}
				{groups.map((group) => (
					<View key={group.id}>
						{headed ? (
							<Text
								accessibilityRole="header"
								className="ps-3 pe-3 pt-2 pb-1 text-meta font-medium text-ink-muted"
							>
								{group.id === "members"
									? t("mobile.team_bridge.mentions.section_members")
									: t("mobile.team_bridge.mentions.section_org")}
							</Text>
						) : null}
						{group.rows.map((row) => (
							<MentionRow key={rowKey(row)} row={row} onPick={onPick} />
						))}
					</View>
				))}
			</ScrollView>
		</View>
	);
}

/** The sentence for a non-notifying pick, by why it cannot notify. */
export function mentionNoticeText(notice: MentionNoticeState): string {
	const name = notice.label;
	switch (notice.reason) {
		case "invited":
			return t("mobile.team_bridge.mentions.invited", { name });
		case "no_endpoint":
			return t("mobile.team_bridge.mentions.no_endpoint", { name });
		default:
			return t("mobile.team_bridge.mentions.not_member", { name });
	}
}

/** The "won't be notified" line under the field after a non-notifying pick. */
export function MentionNotice({
	text,
	onDismiss,
}: {
	text: string;
	onDismiss: () => void;
}) {
	return (
		<View
			testID={SURFACE.teamBridgeMentionNotice}
			className="mx-1 flex-row items-center gap-2"
		>
			<Text
				accessibilityRole="alert"
				className="min-w-0 flex-1 text-meta text-ink-muted"
			>
				{text}
			</Text>
			<Pressable
				accessibilityRole={ROLE.button}
				onPress={onDismiss}
				// Hit slop cannot extend beyond the row on native and isn't applied on web.
				style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
				className="items-center justify-center px-2 py-1"
			>
				<Text className="text-meta font-medium text-accent">
					{t("mobile.team_bridge.mentions.dismiss_notice")}
				</Text>
			</Pressable>
		</View>
	);
}
