/**
 * "Browse communities…": the communities this account joined, then the
 * featured ones it can join (Amendment A §1–2). Draft and hidden communities
 * never reach the phone (the server filters them), and a community is joined
 * only through the guidelines sheet's explicit agreement.
 */
import { useRouter } from "expo-router";
import { Globe } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
	useCommunity,
	useCommunityRows,
	useCommunityState,
} from "@/community/provider";
import { t } from "@/i18n";
import { communityFeaturedId, communityRowId, SCREEN } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Skeleton } from "@/ui/components/skeleton";
import { communityPath } from "./home-screen";
import { JoinSheet } from "./join-sheet";
import {
	CommunityFrame,
	CommunityRow,
	LoadFailure,
	SectionLabel,
	UnreadPill,
} from "./parts";

export default function CommunityDirectoryScreen() {
	return (
		<CommunityFrame
			title={t("mobile.community.directory.title")}
			testID={SCREEN.communityDirectory}
		>
			<Directory />
		</CommunityFrame>
	);
}

function Directory() {
	const router = useRouter();
	const { actions } = useCommunity();
	const list = useCommunityState((s) => s.communities);
	const rows = useCommunityRows();
	const [joining, setJoining] = useState<string | null>(null);
	const ink = useTokenColor("ink-dim");
	useEffect(() => {
		void actions.loadCommunities();
	}, [actions]);
	const open = (communityId: string) => {
		actions.select({ kind: "community", communityId });
		router.push(communityPath(communityId) as never);
	};
	if (
		list.state === "error" &&
		!list.data.joined.length &&
		!list.data.featured.length
	)
		return (
			<LoadFailure
				error={list.error}
				onRetry={() => void actions.loadCommunities()}
			/>
		);
	if (
		list.state !== "ready" &&
		!list.data.joined.length &&
		!list.data.featured.length
	)
		return (
			<View
				accessible
				accessibilityLabel={t("mobile.community.common.loading")}
				className="px-4 py-4"
			>
				<Skeleton lines={3} />
			</View>
		);
	return (
		<View className="pb-6">
			{rows.length ? (
				<>
					<SectionLabel label={t("mobile.community.directory.joined")} />
					{rows.map((row) => (
						<CommunityRow
							key={row.communityId}
							label={row.name}
							detail={
								row.readOnly ? t("mobile.community.directory.read_only") : null
							}
							accessibilityLabel={t("mobile.community.switcher.row_label", {
								name: row.name,
								count: row.unread,
							})}
							leading={<Globe size={18} color={ink} />}
							trailing={<UnreadPill count={row.unread} />}
							onPress={() => open(row.communityId)}
							testID={communityRowId(row.communityId)}
						/>
					))}
				</>
			) : null}
			<SectionLabel label={t("mobile.community.directory.featured")} />
			{list.data.featured.length ? (
				list.data.featured.map((community) => (
					<CommunityRow
						key={community.id}
						label={community.name}
						leading={<Globe size={18} color={ink} />}
						trailing={
							<Text className="text-meta font-semibold text-accent">
								{t("mobile.community.browse.join")}
							</Text>
						}
						onPress={() => setJoining(community.id)}
						testID={communityFeaturedId(community.id)}
					/>
				))
			) : (
				<Text className="px-4 py-1.5 text-body-sm text-ink-dim">
					{t("mobile.community.directory.empty")}
				</Text>
			)}
			{joining ? (
				<JoinSheet
					communityId={joining}
					visible
					onClose={() => setJoining(null)}
					onJoined={() => open(joining)}
				/>
			) : null}
		</View>
	);
}
