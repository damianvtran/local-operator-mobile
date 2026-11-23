/**
 * The org switcher's Communities group (RFC v2.4 Amendment A §2; frame M8).
 *
 * Drawn INSIDE the existing Team Bridge switcher sheet, after the private
 * organizations, and never merged with them: a community's unread count is its
 * own row's, and nothing here touches the private store's selection or totals.
 * Picking a community records it as this app session's scope (memory only, so
 * a restart reapplies the opening rule) and opens its home; the row of the
 * session's community carries the sheet's one check (`OrgSwitcherSheet`).
 */
import { useRouter } from "expo-router";
import { ChevronRight, Compass, Globe } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { communityEnabled } from "@/community/flag";
import { communityGroup } from "@/community/model";
import {
	useCommunity,
	useCommunityRows,
	useCommunityState,
} from "@/community/provider";
import { t } from "@/i18n";
import { CONTROL, communityRowId, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Badge } from "@/ui/components/badge";
import { Input } from "@/ui/components/input";
import { SectionHeader } from "@/ui/components/section-header";
import { CommunityRow, SwitcherTrailing } from "./parts";

export function CommunitySwitcherGroup({
	selectedCommunityId,
	onPicked,
}: {
	selectedCommunityId?: string | null;
	onPicked: () => void;
}) {
	const router = useRouter();
	const { actions } = useCommunity();
	const enabled = communityEnabled();
	const listState = useCommunityState((s) => s.communities.state);
	const rows = useCommunityRows();
	const [query, setQuery] = useState("");
	const ink = useTokenColor("ink-dim");
	const check = useTokenColor("accent");
	useEffect(() => {
		if (enabled && listState === "idle") void actions.loadCommunities();
	}, [enabled, listState, actions]);
	const group = communityGroup({ communities: rows, enabled, query });
	if (!group.show) return null;
	const open = (path: string) => {
		onPicked();
		router.push(path as Parameters<typeof router.push>[0]);
	};
	return (
		<View testID={SURFACE.communitySwitcherGroup} className="gap-1 pb-2">
			<View className="mx-0 my-1 h-px bg-hairline" />
			<SectionHeader label={t("mobile.community.switcher.communities")} />
			{group.search ? (
				<View className="px-2">
					<Input
						label={t("mobile.community.switcher.search")}
						value={query}
						onChangeText={setQuery}
						testID={CONTROL.communitySearch}
					/>
				</View>
			) : null}
			{group.rows.map((row) => (
				<CommunityRow
					key={row.communityId}
					label={row.name}
					accessibilityLabel={t("mobile.community.switcher.row_label", {
						name: row.name,
						count: row.unread,
					})}
					selected={row.communityId === selectedCommunityId}
					bold={row.communityId === selectedCommunityId}
					inset="switcher"
					leading={<Globe size={18} color={ink} />}
					trailing={
						<View className="flex-row items-center gap-2">
							<Badge label={t("mobile.community.switcher.public")} hidden />
							<SwitcherTrailing
								unread={row.unread}
								checked={row.communityId === selectedCommunityId}
								checkColor={check}
							/>
						</View>
					}
					onPress={() => {
						actions.select({ kind: "community", communityId: row.communityId });
						open(`/community/${encodeURIComponent(row.communityId)}`);
					}}
					testID={communityRowId(row.communityId)}
				/>
			))}
			<CommunityRow
				label={t("mobile.community.switcher.browse")}
				inset="switcher"
				leading={<Compass size={18} color={ink} />}
				trailing={<ChevronRight size={16} color={ink} aria-hidden />}
				onPress={() => open("/community")}
				testID={CONTROL.communitySwitcherBrowse}
			/>
			<Text className="px-4 pt-1 text-meta text-ink-dim">
				{t("mobile.community.switcher.note")}
			</Text>
		</View>
	);
}
