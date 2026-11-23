/**
 * A community's home: its channels and DMs, entry points to Browse and
 * Requests, and the join / re-accept prompts (RFC v2.4 §5.3).
 *
 * Reads go straight to the community deployment with the phone's own Radient
 * sign-in, so this works with every computer asleep. While mounted, the screen
 * holds the community's events long-poll (`watch`), which refreshes the lists
 * from content-free invalidations; leaving stops it.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronsUpDown, Hash, Inbox, Search, User } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { communityEnabled } from "@/community/flag";
import { guidelinesStep, pendingApprovals } from "@/community/model";
import { useCommunity, useCommunityState } from "@/community/provider";
import { OrgSwitcherSheet } from "@/features/team-bridge/org-switcher-sheet";
import { t } from "@/i18n";
import {
	CONTROL,
	communityChannelRowId,
	communityDmRowId,
	SCREEN,
	SURFACE,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Banner } from "@/ui/components/banner";
import { Button } from "@/ui/components/button";
import { IconButton } from "@/ui/components/icon-button";
import { Skeleton } from "@/ui/components/skeleton";
import { JoinSheet } from "./join-sheet";
import {
	CommunityFrame,
	CommunityRow,
	LoadFailure,
	SectionLabel,
	UnreadPill,
} from "./parts";

export function communityPath(communityId: string, ...rest: string[]): string {
	return `/community/${[communityId, ...rest].map(encodeURIComponent).join("/")}`;
}

export default function CommunityHomeScreen() {
	const { communityId = "" } = useLocalSearchParams<{ communityId: string }>();
	return <HomeFrame communityId={communityId} />;
}

function HomeFrame({ communityId }: { communityId: string }) {
	const router = useRouter();
	const { actions } = useCommunity();
	const name = useCommunityState(
		(s) => s.bootstraps[communityId]?.data?.community.name,
	);
	const [switching, setSwitching] = useState(false);
	/* Being in a community IS being in its scope (Amendment A §3), however the
	 * reader arrived: the switcher's one check lands on this row, and the next
	 * Team Bridge open this session lands here until they switch back. */
	useEffect(() => {
		if (communityEnabled()) actions.select({ kind: "community", communityId });
	}, [actions, communityId]);
	return (
		<CommunityFrame
			title={name ?? t("mobile.community.directory.title")}
			headerAction={
				<IconButton
					accessibilityLabel={t("mobile.community.home.switch")}
					icon={({ color, size }) => (
						<ChevronsUpDown color={color} size={size} />
					)}
					onPress={() => setSwitching(true)}
					testID={CONTROL.communityHomeSwitcher}
				/>
			}
			headerDetail={
				name ? (
					<Text className="text-meta text-ink-dim">
						{t("mobile.community.switcher.public")}
					</Text>
				) : undefined
			}
			testID={SCREEN.communityHome}
		>
			<HomeBody communityId={communityId} />
			{/* The same sheet as the Team Bridge list's (R1-3): it shows this
			 *  community checked, and a private pick leaves for that org's list. */}
			<OrgSwitcherSheet
				visible={switching}
				onClose={() => setSwitching(false)}
				onPrivatePicked={() =>
					router.dismissTo(
						"/team-bridge" as Parameters<typeof router.dismissTo>[0],
					)
				}
			/>
		</CommunityFrame>
	);
}

function HomeBody({ communityId }: { communityId: string }) {
	const router = useRouter();
	const { actions } = useCommunity();
	const boot = useCommunityState((s) => s.bootstraps[communityId]);
	const channels = useCommunityState((s) => s.channels[communityId]);
	const directs = useCommunityState((s) => s.directs[communityId]);
	const requests = useCommunityState((s) => s.requests[communityId]);
	const approvals = useCommunityState((s) => s.approvals[communityId]);
	const [joining, setJoining] = useState(false);
	const ink = useTokenColor("ink-dim");
	const step = boot?.data ? guidelinesStep(boot.data) : null;
	const member = step === "none" || step === "reaccept";
	useEffect(() => {
		void actions.loadBootstrap(communityId);
	}, [actions, communityId]);
	useEffect(() => {
		if (!member) return;
		void actions.loadChannels(communityId);
		void actions.loadDirects(communityId);
		void actions.loadRequests(communityId);
		void actions.loadApprovals(communityId);
		return actions.watch(communityId);
	}, [actions, communityId, member]);
	if (!boot || (boot.state === "loading" && !boot.data))
		return (
			<View
				accessible
				accessibilityLabel={t("mobile.community.common.loading")}
				className="px-4 py-4"
			>
				<Skeleton lines={4} />
			</View>
		);
	if (!boot.data)
		return (
			<LoadFailure
				error={boot.error}
				onRetry={() => void actions.loadBootstrap(communityId)}
			/>
		);
	const pendingCount =
		(requests?.data.filter(
			(r) => r.direction === "incoming" && r.state === "pending",
		).length ?? 0) + pendingApprovals(approvals?.data ?? [], Date.now()).length;
	const go = (...rest: string[]) =>
		router.push(communityPath(communityId, ...rest) as never);
	return (
		<View className="pb-6">
			{step === "reaccept" ? (
				<View className="px-4 pt-3">
					<Banner
						tone="warning"
						message={t("mobile.community.home.reaccept_banner")}
						action={{
							label: t("mobile.community.home.reaccept"),
							onPress: () => setJoining(true),
							testID: CONTROL.communityReaccept,
						}}
						testID={SURFACE.communityReacceptBanner}
					/>
				</View>
			) : null}
			{step === "join" || step === "closed" ? (
				<View className="gap-3 px-4 py-4">
					<Text className="text-body text-ink">
						{step === "join"
							? t("mobile.community.home.not_member")
							: t("mobile.community.home.closed")}
					</Text>
					{step === "join" ? (
						<Button
							label={t("mobile.community.home.join")}
							onPress={() => setJoining(true)}
							testID={CONTROL.communityJoinOpen}
						/>
					) : null}
				</View>
			) : (
				<>
					<View className="flex-row gap-2 px-4 pt-3">
						<View className="flex-1">
							<Button
								label={t("mobile.community.home.browse")}
								variant="outline"
								size="sm"
								leadingIcon={(p) => <Search {...p} />}
								onPress={() => go("browse")}
								testID={CONTROL.communityBrowseOpen}
							/>
						</View>
						<View className="flex-1">
							<Button
								label={
									pendingCount
										? t("mobile.community.home.requests_count", {
												count: pendingCount,
											})
										: t("mobile.community.home.requests")
								}
								variant="outline"
								size="sm"
								leadingIcon={(p) => <Inbox {...p} />}
								onPress={() => go("requests")}
								testID={CONTROL.communityRequestsOpen}
							/>
						</View>
					</View>
					<SectionLabel label={t("mobile.community.home.channels")} />
					{channels?.state === "error" && !channels.data.length ? (
						<LoadFailure
							error={channels.error}
							onRetry={() => void actions.loadChannels(communityId)}
						/>
					) : !channels ||
						(channels.state === "loading" && !channels.data.length) ? (
						<View className="px-4 py-2">
							<Skeleton lines={3} />
						</View>
					) : channels.data.length ? (
						channels.data.map((channel) => (
							<CommunityRow
								key={channel.id}
								label={channel.name}
								accessibilityLabel={t("mobile.community.home.channel_label", {
									name: channel.name,
									count: channel.unread ?? 0,
								})}
								bold={Boolean(channel.unread)}
								leading={<Hash size={18} color={ink} />}
								trailing={<UnreadPill count={channel.unread ?? 0} />}
								onPress={() => go("c", channel.id)}
								testID={communityChannelRowId(channel.id)}
							/>
						))
					) : (
						<Text className="px-4 py-1.5 text-body-sm text-ink-dim">
							{t("mobile.community.home.channels_empty")}
						</Text>
					)}
					<SectionLabel label={t("mobile.community.home.direct")} />
					{directs?.data.length ? (
						directs.data.map((direct) => (
							<CommunityRow
								key={direct.conversation_id}
								label={direct.counterpart.display_name}
								accessibilityLabel={t("mobile.community.home.direct_label", {
									name: direct.counterpart.display_name,
									count: direct.unread,
								})}
								bold={Boolean(direct.unread)}
								leading={<User size={18} color={ink} />}
								trailing={<UnreadPill count={direct.unread} />}
								onPress={() => go("c", direct.conversation_id)}
								testID={communityDmRowId(direct.conversation_id)}
							/>
						))
					) : directs?.state === "ready" ? (
						<Text className="px-4 py-1.5 text-body-sm text-ink-dim">
							{t("mobile.community.home.direct_empty")}
						</Text>
					) : null}
				</>
			)}
			<JoinSheet
				communityId={communityId}
				visible={joining}
				onClose={() => setJoining(false)}
			/>
		</View>
	);
}
