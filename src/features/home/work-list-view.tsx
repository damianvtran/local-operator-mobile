import { ChevronRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { SessionSummary } from "@/contracts";
import { avatarRefOf } from "@/features/agent-avatar/agent-avatar";
import {
	useListState,
	useLocaleFrame,
} from "@/features/auth/connection-provider";
import {
	type WorkListSection,
	type WorkListSlot,
	workRowShape,
} from "@/features/home/work-list";
import { countLabel } from "@/features/notifications/notifications-model";
import { unreadBadgeCount } from "@/features/sessions/session-projection";
import { SessionRow } from "@/features/sessions/session-row";
import type { SidebarBasis } from "@/features/sessions/sidebar-view";
import { useWorkspaceDrawer } from "@/features/sessions/workspace-drawer-context";
import { t } from "@/i18n";
import { ROLE, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Badge } from "@/ui/components/badge";
import { SectionHeader } from "@/ui/components/section-header";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";
import { CONTROL_HEIGHTS } from "@/ui/tokens.gen";
import { cx } from "@/ui/variants";

/**
 * The work list's body: what the home paints in the band's bottom, above the
 * composer, when `workListSlot` says `list` or `try`.
 *
 * REUSE, NOT A SECOND ROW. The conversation rows are the drawer's `SessionRow`
 * (avatar, title, folder, approval/question word, spinner, unread dot, subagent
 * count), so one conversation reads the same in both places. A running row
 * passes `section="running"` for the drawer's own reason: "running" already is
 * its time. The rows carry their own 16 pt gutter (the drawer's list has no
 * padding), so the container pulls out by the screen's 16 pt and the text lands
 * on the hero's rail.
 *
 * NO LONG PRESS. The drawer's menu (pin, tag, move) is state of the
 * conversations pane, which Home does not own; a row here opens its
 * conversation and says nothing about a menu it cannot show.
 */
export type WorkListViewProps = {
	slot: Exclude<WorkListSlot, { kind: "none" }>;
	/** A TRY row's tap: the words go to the composer, as the suggestions' did. */
	onPick: (text: string) => void;
	onOpenSession: (session: SessionSummary) => void;
	homeDirectory?: string | null;
	basis?: SidebarBasis;
	/** The first row's measured height, for the splash's yield estimate. */
	onRowHeight?: (height: number) => void;
};

/** A full-width list row for the footer and the TRY rows: label at the start,
 *  an optional trailing slot, a chevron that says "this goes somewhere". */
const LinkRow = ({
	label,
	accessibilityLabel,
	onPress,
	trailing,
	testID,
}: {
	label: string;
	accessibilityLabel?: string;
	/** `returnFocus` puts the screen reader back on this row when the drawer
	 *  the footer opens closes again, as the header's menu button does. */
	onPress: (returnFocus: () => void) => void;
	trailing?: ReactNode;
	testID: string;
}) => {
	const chevronInk = useTokenColor("ink-dim");
	const trigger = useRef<View | null>(null);
	return (
		<Pressable
			ref={trigger}
			accessibilityRole={ROLE.button}
			accessibilityLabel={accessibilityLabel}
			onPress={() => onPress(() => trigger.current?.focus())}
			testID={testID}
			style={{ minHeight: TOUCH_FLOOR }}
		>
			{({ pressed }) => (
				<View
					className={cx(
						"min-h-11 flex-row items-center gap-2 px-4",
						pressed && "bg-elevated",
					)}
				>
					<Text
						className={cx(
							"min-w-0 flex-1 text-body",
							pressed ? "text-ink" : "text-ink-muted",
						)}
						numberOfLines={2}
					>
						{label}
					</Text>
					{trailing}
					<ChevronRight
						size={CONTROL_HEIGHTS.md.icon}
						color={chevronInk}
						aria-hidden
					/>
				</View>
			)}
		</Pressable>
	);
};

export const WorkListView = ({
	slot,
	onPick,
	onOpenSession,
	homeDirectory,
	basis = "active",
	onRowHeight,
}: WorkListViewProps) => {
	// A late language frame must repaint the headers and the footer.
	useLocaleFrame();
	const { effectiveScale } = useTextScale();
	const drawer = useWorkspaceDrawer();
	const unread = useListState((state) => state.unread);
	const newCount = unreadBadgeCount(unread);
	// The pane's own minute clock, so a recent row's "2h" ages without a frame.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);

	if (slot.kind === "try") {
		return (
			<View className="-mx-4" testID={SURFACE.homeWorkList}>
				<View className="px-4">
					<SectionHeader label={t("mobile.home.work.try")} />
				</View>
				{slot.rows.map((label) => (
					<LinkRow
						key={label}
						label={label}
						onPress={() => onPick(label)}
						testID={SURFACE.homeWorkRow}
					/>
				))}
			</View>
		);
	}

	const { needsYou, running, recent } = slot.list;
	const all = [...needsYou, ...running, ...recent];
	// One shared left edge when any row draws a picture (the drawer's rule).
	const reserveLeading = all.some((session) => avatarRefOf(session) !== null);
	const firstId = all[0]?.session_id;
	const shape = (section: WorkListSection) =>
		workRowShape(effectiveScale, section);
	const rows = (list: SessionSummary[], section: WorkListSection) =>
		list.map((session) => (
			<View
				key={session.session_id}
				testID={SURFACE.homeWorkRow}
				onLayout={
					session.session_id === firstId && onRowHeight
						? (event) => onRowHeight(Math.ceil(event.nativeEvent.layout.height))
						: undefined
				}
			>
				<SessionRow
					session={session}
					section={section}
					selected={false}
					now={now}
					basis={basis}
					reserveLeading={reserveLeading}
					homeDirectory={homeDirectory}
					tagsAssignable={false}
					onActivate={onOpenSession}
					titleLines={shape(section).titleLines}
					showFolder={shape(section).showFolder}
				/>
			</View>
		));
	const section = (
		label: string,
		list: SessionSummary[],
		key: WorkListSection,
	) =>
		list.length > 0 ? (
			<View key={key}>
				<View className="px-4">
					<SectionHeader label={label} />
				</View>
				{rows(list, key)}
			</View>
		) : null;
	const allLabel =
		newCount !== null && newCount > 0
			? t("mobile.home.work.all_conversations_new", { count: newCount })
			: undefined;
	return (
		<View className="-mx-4" testID={SURFACE.homeWorkList}>
			{section(t("mobile.home.work.needs_you"), needsYou, "needs-you")}
			{section(t("mobile.sidebar.section.running"), running, "running")}
			{section(t("mobile.home.work.recent"), recent, "recent")}
			<LinkRow
				label={t("mobile.home.work.all_conversations")}
				accessibilityLabel={allLabel}
				/* The header's own button opens Agents; without `mode` the footer
				 *  would reopen whichever pane the drawer last showed (Team Bridge). */
				onPress={(returnFocus) => drawer.open({ returnFocus, mode: "agents" })}
				testID={SURFACE.homeWorkAll}
				trailing={
					newCount !== null && newCount > 0 ? (
						<Badge
							label={countLabel(newCount)}
							tone="danger"
							mono
							scale={effectiveScale}
						/>
					) : null
				}
			/>
		</View>
	);
};
