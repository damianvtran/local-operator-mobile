/**
 * Requests: incoming DM requests and agent-post approval stubs (RFC v2.4 §5.7,
 * §5.9; frames M3, M6).
 *
 * DM REQUESTS. Accept opens nothing by itself (the conversation appears in the
 * home's Direct messages once the server records it); Decline tells the sender
 * nothing beyond "not accepted"; Block blocks the PERSON and then declines.
 *
 * AGENT APPROVALS ARE CONTENT-FREE ON A PHONE. The community server never
 * holds an unmoderated agent draft, so a stub carries only the channel and the
 * expiry (frame M6). With no remote access the phone's choices are "Review on
 * your computer" (keeps it waiting — nothing is sent) and "Don't post" (answers
 * decline from the phone). Approving needs the draft, which lives on the
 * computer; the remote-access variant (M6b) loads it through the relay and is
 * not part of this direct client.
 */
import { useLocalSearchParams } from "expo-router";
import { Bot, Laptop } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type {
	AgentApproval,
	CommunityRequest,
	Profile,
} from "@/community/contract";
import { pendingApprovals } from "@/community/model";
import { useCommunity, useCommunityState } from "@/community/provider";
import { t } from "@/i18n";
import {
	CONTROL,
	communityApprovalId,
	communityRequestId,
	ROLE,
	SCREEN,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Card } from "@/ui/components/card";
import { Segmented } from "@/ui/components/segmented";
import { Skeleton } from "@/ui/components/skeleton";
import { TOUCH_FLOOR } from "@/ui/layout";
import { communityPath } from "./home-screen";
import { errorSentence, expirySentence } from "./labels";
import { MemberAvatar } from "./member-avatar";
import { CommunityFrame, LoadFailure } from "./parts";
import { ProfileSheet } from "./profile-sheet";

type Mode = "dm" | "approvals";

export default function CommunityRequestsScreen() {
	const { communityId = "" } = useLocalSearchParams<{ communityId: string }>();
	return (
		<CommunityFrame
			title={t("mobile.community.requests.title")}
			fallback={communityPath(communityId)}
			testID={SCREEN.communityRequests}
		>
			<Requests communityId={communityId} />
		</CommunityFrame>
	);
}

function Requests({ communityId }: { communityId: string }) {
	const { actions } = useCommunity();
	const [mode, setMode] = useState<Mode>("dm");
	const requests = useCommunityState((s) => s.requests[communityId]);
	const approvals = useCommunityState((s) => s.approvals[communityId]);
	useEffect(() => {
		void actions.loadRequests(communityId);
		void actions.loadApprovals(communityId);
		/* Another device answering an approval reaches here as approval_changed. */
		return actions.watch(communityId);
	}, [actions, communityId]);
	const incoming =
		requests?.data.filter(
			(r) => r.direction === "incoming" && r.state === "pending",
		) ?? [];
	const stubs = pendingApprovals(approvals?.data ?? [], Date.now());
	const loaded = mode === "dm" ? requests : approvals;
	const [profile, setProfile] = useState<Profile | null>(null);
	const [profileError, setProfileError] = useState<string | null>(null);
	const openProfile = async (publicId: string) => {
		setProfileError(null);
		const result = await actions.profile(communityId, publicId);
		if (result && "public_id" in result) setProfile(result);
		else setProfileError(errorSentence(result, "read"));
	};
	return (
		<View className="gap-3 px-4 pb-6 pt-3">
			<ProfileSheet
				communityId={communityId}
				profile={profile}
				onClose={() => setProfile(null)}
			/>
			{profileError ? (
				<Text accessibilityRole={ROLE.alert} className="text-meta text-danger">
					{profileError}
				</Text>
			) : null}
			<Segmented<Mode>
				label={t("mobile.community.requests.mode")}
				options={[
					{
						value: "dm",
						label: t("mobile.community.requests.dm"),
						testID: CONTROL.communityRequestsDm,
					},
					{
						value: "approvals",
						label: t("mobile.community.requests.approvals"),
						testID: CONTROL.communityRequestsApprovals,
					},
				]}
				value={mode}
				onChange={setMode}
				testID={CONTROL.communityRequestsMode}
			/>
			{loaded?.state === "error" && !loaded.data.length ? (
				<LoadFailure
					error={loaded.error}
					onRetry={() =>
						void (mode === "dm"
							? actions.loadRequests(communityId)
							: actions.loadApprovals(communityId))
					}
				/>
			) : !loaded || (loaded.state === "loading" && !loaded.data.length) ? (
				<Skeleton lines={3} />
			) : mode === "dm" ? (
				incoming.length ? (
					incoming.map((request) => (
						<RequestCard
							key={request.id}
							communityId={communityId}
							request={request}
							onProfile={(id) => void openProfile(id)}
						/>
					))
				) : (
					<Text className="text-body-sm text-ink-dim">
						{t("mobile.community.requests.dm_empty")}
					</Text>
				)
			) : stubs.length ? (
				stubs.map((approval) => (
					<ApprovalCard
						key={approval.approval_id}
						communityId={communityId}
						approval={approval}
					/>
				))
			) : (
				<Text className="text-body-sm text-ink-dim">
					{t("mobile.community.approvals.empty")}
				</Text>
			)}
		</View>
	);
}

function RequestCard({
	communityId,
	request,
	onProfile,
}: {
	communityId: string;
	request: CommunityRequest;
	onProfile: (publicId: string) => void;
}) {
	const { actions } = useCommunity();
	const [busy, setBusy] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const answer = async (choice: "accept" | "decline" | "block") => {
		setBusy(choice);
		setFailure(null);
		const error = await actions.answerRequest(communityId, request, choice);
		setBusy(null);
		if (error) setFailure(errorSentence(error));
	};
	const name = request.counterpart?.display_name ?? "";
	const title = request.counterpart?.title;
	const publicId = request.counterpart?.public_id;
	/* The recipient decides on the sender's COMMUNITY profile (RFC §5.7), so
	 * the card leads with who they are — avatar, name, title — and a tap opens
	 * the full card (review round 1, R1-9). */
	const who = (
		<View className="flex-row items-center gap-3">
			<MemberAvatar name={name} size="sm" />
			<View className="min-w-0 flex-1">
				<Text className="text-body text-ink">
					{t("mobile.community.requests.dm_body", { name })}
				</Text>
				{title ? (
					<Text className="text-meta text-ink-muted" numberOfLines={2}>
						{title}
					</Text>
				) : null}
			</View>
		</View>
	);
	return (
		<Card inList>
			<View className="gap-2">
				{publicId ? (
					<Pressable
						accessibilityRole={ROLE.button}
						accessibilityHint={t("mobile.community.conversation.view_profile", {
							name,
						})}
						onPress={() => onProfile(publicId)}
						testID={communityRequestId(request.id, "profile")}
						style={{ minHeight: TOUCH_FLOOR }}
						className="justify-center"
					>
						{who}
					</Pressable>
				) : (
					who
				)}
				<Text className="text-meta text-ink-dim">
					{expirySentence("request", request.expires_at, Date.now())}
				</Text>
				<View className="flex-row flex-wrap gap-2">
					<Button
						label={t("mobile.community.requests.accept")}
						size="sm"
						loading={busy === "accept"}
						onPress={() => void answer("accept")}
						testID={communityRequestId(request.id, "accept")}
					/>
					<Button
						label={t("mobile.community.requests.decline")}
						variant="outline"
						size="sm"
						loading={busy === "decline"}
						onPress={() => void answer("decline")}
						testID={communityRequestId(request.id, "decline")}
					/>
					<Button
						label={t("mobile.community.requests.block")}
						variant="danger"
						size="sm"
						loading={busy === "block"}
						onPress={() => void answer("block")}
						testID={communityRequestId(request.id, "block")}
					/>
				</View>
				{failure ? (
					<Text
						accessibilityRole={ROLE.alert}
						className="text-body-sm text-danger"
					>
						{failure}
					</Text>
				) : null}
			</View>
		</Card>
	);
}

function ApprovalCard({
	communityId,
	approval,
}: {
	communityId: string;
	approval: AgentApproval;
}) {
	const { actions } = useCommunity();
	const channel = useCommunityState((s) =>
		s.channels[communityId]?.data.find((c) => c.id === approval.channel_id),
	);
	const [waiting, setWaiting] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const warn = useTokenColor("ink-muted");
	const decline = async () => {
		setBusy(true);
		setFailure(null);
		const error = await actions.declineApproval(
			communityId,
			approval.approval_id,
		);
		setBusy(false);
		if (error) setFailure(t("mobile.community.approvals.failed"));
	};
	return (
		<Card inList>
			<View className="gap-3">
				<View className="flex-row items-center justify-between gap-2">
					<View className="flex-row items-center gap-1">
						<Bot size={14} color={warn} aria-hidden />
						<Badge label={t("mobile.community.approvals.agent")} />
					</View>
					<Text className="text-meta text-ink-muted">
						{expirySentence("approval", approval.expires_at, Date.now())}
					</Text>
				</View>
				<Text
					accessibilityRole={ROLE.header}
					className="text-label font-semibold text-ink"
				>
					{channel
						? t("mobile.community.approvals.title", { channel: channel.name })
						: t("mobile.community.approvals.title_unknown")}
				</Text>
				<View className="flex-row gap-3 rounded-sm border border-hairline px-3 py-3">
					<Laptop size={18} color={warn} aria-hidden />
					<View className="min-w-0 flex-1 gap-1">
						<Text className="text-body-sm text-ink">
							{t("mobile.community.approvals.stays")}
						</Text>
						<Text className="text-meta text-ink-muted">
							{t("mobile.community.approvals.open_computer")}
						</Text>
					</View>
				</View>
				<Button
					label={t("mobile.community.approvals.review")}
					onPress={() => setWaiting(true)}
					testID={communityApprovalId(approval.approval_id, "review")}
				/>
				<Button
					label={t("mobile.community.approvals.decline")}
					variant="outline"
					loading={busy}
					onPress={() => void decline()}
					testID={communityApprovalId(approval.approval_id, "decline")}
				/>
				<Text className="text-meta text-ink-dim">
					{waiting
						? t("mobile.community.approvals.waiting")
						: t("mobile.community.approvals.review_note")}
				</Text>
				{failure ? (
					<Text
						accessibilityRole={ROLE.alert}
						className="text-body-sm text-danger"
					>
						{failure}
					</Text>
				) : null}
			</View>
		</Card>
	);
}
