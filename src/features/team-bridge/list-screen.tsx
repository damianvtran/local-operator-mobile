import { BellOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
	Pressable,
	RefreshControl,
	ScrollView,
	Text,
	View,
} from "react-native";
import type { Conversation } from "@/team-bridge/contract";
import * as model from "@/team-bridge/model";
import { dmSubject, type ProfileSubject } from "@/team-bridge/profile";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import {
	CONTROL,
	SCREEN,
	SURFACE,
	teamBridgeChiefId,
	teamBridgeConversationId,
	teamBridgeOrganizationId,
	teamBridgePersonId,
	teamBridgeProfileOpenId,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";
import { Sheet } from "@/ui/components/sheet";
import { BridgeBack, BridgeGate } from "./gate";
import {
	PersonAvatar,
	ProfileAvatarButton,
	ProfileSheet,
	useOpenTarget,
} from "./profile-card";

export function BridgeRow({
	label,
	detail,
	conversation,
	disabled,
	onPress,
	testID,
	profile,
}: {
	label: string;
	detail?: string | null;
	conversation?: Conversation | null;
	disabled?: boolean;
	onPress: () => void;
	testID: string;
	/**
	 * The person this row is about. Their photo replaces the initials, and the
	 * photo becomes its own "view profile" control BESIDE the row's link (a
	 * control nested in a link is one merged element to a screen reader). It
	 * stays pressable on a dimmed row: who someone is does not depend on
	 * whether they turned Team Bridge on.
	 */
	profile?: {
		subject: ProfileSubject;
		onOpen: (subject: ProfileSubject) => void;
		testID: string;
	};
}) {
	const unread = conversation ? model.rowUnread(conversation) : null;
	const muted = conversation && model.showsMutedGlyph(conversation);
	const mutedColor = useTokenColor("ink-muted");
	if (profile)
		return (
			<View
				className={`min-h-14 flex-row items-center gap-3 rounded-sm px-4 ${disabled ? "opacity-50" : ""}`}
			>
				<ProfileAvatarButton
					subject={profile.subject}
					label={label}
					onOpen={profile.onOpen}
					testID={profile.testID}
				/>
				<BridgeRowLink
					label={label}
					detail={detail}
					unread={unread}
					muted={!!muted}
					mutedColor={mutedColor}
					disabled={disabled}
					onPress={onPress}
					testID={testID}
					className="min-h-14 min-w-0 flex-1 flex-row items-center gap-3 py-3"
				/>
			</View>
		);
	return (
		<BridgeRowLink
			label={label}
			detail={detail}
			unread={unread}
			muted={!!muted}
			mutedColor={mutedColor}
			disabled={disabled}
			onPress={onPress}
			testID={testID}
			className={`min-h-14 flex-row items-center gap-3 rounded-sm px-4 py-3 ${disabled ? "opacity-50" : ""}`}
			leading={<PersonAvatar member={null} label={label} />}
		/>
	);
}

/** The row's one link: label, reason, quiet glyph and unread count. */
function BridgeRowLink({
	label,
	detail,
	unread,
	muted,
	mutedColor,
	disabled,
	onPress,
	testID,
	className,
	leading,
}: {
	label: string;
	detail?: string | null;
	unread: ReturnType<typeof model.rowUnread> | null;
	muted: boolean;
	mutedColor: string;
	disabled?: boolean;
	onPress: () => void;
	testID: string;
	className: string;
	leading?: React.ReactNode;
}) {
	return (
		<Pressable
			accessibilityRole="link"
			accessibilityLabel={[
				label,
				detail,
				unread?.count ? `${unread.count} unread` : null,
				muted ? "Notifications quiet" : null,
			]
				.filter(Boolean)
				.join(", ")}
			accessibilityState={{ disabled: !!disabled }}
			disabled={disabled}
			onPress={onPress}
			testID={testID}
			className={className}
		>
			{leading}
			<View className="min-w-0 flex-1">
				<Text
					className={`text-body text-ink ${unread?.count ? "font-semibold" : ""}`}
				>
					{label}
				</Text>
				{detail && <Text className="text-meta text-ink-muted">{detail}</Text>}
			</View>
			{muted && (
				<View
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
				>
					<BellOff size={16} color={mutedColor} />
				</View>
			)}
			{!!unread?.count && (
				<Text
					className={
						unread.loud
							? "rounded-full bg-accent px-2 py-1 text-meta text-on-accent"
							: "text-meta text-ink-muted"
					}
				>
					{unread.count}
				</Text>
			)}
		</Pressable>
	);
}

function ListContent() {
	const { actions } = useTeamBridge();
	const state = useTeamBridgeState((s) => s);
	const open = useOpenTarget();
	const [switching, setSwitching] = useState(false);
	const [profile, setProfile] = useState<ProfileSubject | null>(null);
	const tenantId = state.selectedTenantId;
	const org = tenantId ? state.orgs[tenantId] : undefined;
	const selected = state.organizations.find((o) => o.tenantId === tenantId);
	useEffect(() => {
		if (tenantId) void actions.loadOrganization(tenantId);
	}, [actions, tenantId]);
	const conversations = org?.conversations ?? [];
	const people = org?.people ?? [];
	const sections = model.sections(conversations);
	const chiefs = model.chiefsOfStaff(people, state.selfAccountId);
	const represented = new Set<string>();
	for (const person of people) {
		const dm = model.dmWithPerson(
			conversations,
			person.account_id,
			state.selfAccountId,
		);
		if (dm) represented.add(dm.id);
	}
	for (const chief of chiefs) {
		const dm = model.dmWithAgent(conversations, chief.person.account_id);
		if (dm) represented.add(dm.id);
	}
	const existing = (conversation: Conversation) =>
		open({
			kind: "conversation",
			tenantId: conversation.tenant_id,
			conversationId: conversation.id,
		});
	const conversationRows = (rows: Conversation[], empty: string) =>
		rows.length ? (
			rows.map((c) => {
				const subject = dmSubject(c, people, state.selfAccountId);
				return (
					<BridgeRow
						key={c.id}
						label={
							model.conversationTitle(c, state.selfAccountId) ?? "Conversation"
						}
						conversation={c}
						detail={model.isPreview(c) ? "Preview · Join to read" : null}
						onPress={() => existing(c)}
						testID={teamBridgeConversationId(c.id)}
						profile={
							subject
								? {
										subject,
										onOpen: setProfile,
										testID: teamBridgeProfileOpenId(c.id),
									}
								: undefined
						}
					/>
				);
			})
		) : empty ? (
			<Text className="px-4 py-3 text-body text-ink-muted">{empty}</Text>
		) : null;
	const heading = (text: string) => (
		<Text
			accessibilityRole="header"
			className="px-4 pt-6 pb-2 text-title text-ink"
		>
			{text}
		</Text>
	);
	const retry = () => {
		if (tenantId) void actions.loadOrganization(tenantId);
	};
	return (
		<Screen
			title="Team Bridge"
			headerLeading={<BridgeBack />}
			scroll={false}
			testID={SCREEN.teamBridgeList}
		>
			<View className="px-4 py-2">
				<Button
					label={`${selected?.name ?? "Choose organization"}${selected?.readOnly ? " · Read only" : ""}`}
					variant="outline"
					testID={CONTROL.teamBridgeOrgSwitcher}
					onPress={() => setSwitching(true)}
				/>
			</View>
			<ScrollView
				testID={SURFACE.teamBridgeSections}
				contentContainerClassName="pb-8"
				refreshControl={
					<RefreshControl
						refreshing={
							org?.conversationsState === "loading" ||
							org?.peopleState === "loading"
						}
						onRefresh={retry}
					/>
				}
			>
				{!tenantId && (
					<Text className="px-4 py-6 text-body text-ink-muted">
						No organizations are available.
					</Text>
				)}
				{tenantId && (
					<>
						{(!org ||
							org.conversationsState === "idle" ||
							org.conversationsState === "loading") &&
							!conversations.length && (
								<Text
									className="px-4 py-4 text-body text-ink-muted"
									testID={SURFACE.teamBridgeConversationsLoading}
								>
									Loading conversations…
								</Text>
							)}
						{org?.conversationsState === "error" && (
							<View className="gap-2 px-4">
								<Text accessibilityRole="alert" className="text-body text-ink">
									{org.conversationsError?.message ??
										"Conversations could not load."}
								</Text>
								<Button
									label="Retry conversations"
									testID={CONTROL.teamBridgeConversationsRetry}
									onPress={retry}
								/>
							</View>
						)}
						{heading("Channels")}
						{conversationRows(
							sections.channels,
							org?.conversationsState === "ready" ? "No channels yet." : "",
						)}
						{heading("Groups")}
						{conversationRows(
							sections.groups,
							org?.conversationsState === "ready" ? "No groups yet." : "",
						)}
						{heading("People")}
						{org?.peopleState === "loading" && !people.length && (
							<Text className="px-4 py-3 text-body text-ink-muted">
								Loading people…
							</Text>
						)}
						{org?.peopleState === "error" && (
							<View className="gap-2 px-4">
								<Text accessibilityRole="alert" className="text-body text-ink">
									The people directory could not load. Try again to load your
									organization’s people.
								</Text>
								<Button
									label="Retry people"
									testID={CONTROL.teamBridgePeopleRetry}
									onPress={retry}
								/>
							</View>
						)}
						{!people.length && org?.peopleState === "ready" && (
							<Text className="px-4 py-3 text-body text-ink-muted">
								No people in this organization.
							</Text>
						)}
						{people.map((person) => {
							const rowState = model.personRowState(
								person,
								state.selfAccountId,
							);
							const dm = model.dmWithPerson(
								conversations,
								person.account_id,
								state.selfAccountId,
							);
							const label = model.personLabel(person);
							return (
								<BridgeRow
									key={person.account_id}
									label={label}
									detail={
										rowState === "self" ? "you" : model.personReason(rowState)
									}
									conversation={dm}
									disabled={rowState === "unavailable" || rowState === "self"}
									testID={teamBridgePersonId(person.account_id)}
									profile={{
										subject: { person, agent: false },
										onOpen: setProfile,
										testID: teamBridgeProfileOpenId(person.account_id),
									}}
									onPress={() =>
										dm
											? existing(dm)
											: open({
													kind: "person",
													tenantId,
													accountId: person.account_id,
													label,
												})
									}
								/>
							);
						})}
						{org?.peopleIncomplete && (
							<Text className="px-4 py-3 text-body text-ink-muted">
								The directory is incomplete. Pull to refresh for the latest
								people.
							</Text>
						)}
						{heading("Chiefs of staff")}
						{!chiefs.length && org?.peopleState === "ready" && (
							<Text className="px-4 py-3 text-body text-ink-muted">
								No chiefs of staff are available.
							</Text>
						)}
						{chiefs.map((chief) => {
							const dm = model.dmWithAgent(
								conversations,
								chief.person.account_id,
							);
							return (
								<BridgeRow
									key={chief.endpointId}
									label={chief.label}
									detail={chief.paused ? "Paused" : "Chief of staff"}
									conversation={dm}
									testID={teamBridgeChiefId(chief.endpointId)}
									profile={{
										subject: { person: chief.person, agent: true },
										onOpen: setProfile,
										testID: teamBridgeProfileOpenId(chief.endpointId),
									}}
									onPress={() =>
										dm
											? existing(dm)
											: open({
													kind: "agent",
													tenantId,
													ownerAccountId: chief.person.account_id,
													endpointId: chief.endpointId,
													label: chief.label,
												})
									}
								/>
							);
						})}
						{sections.directs.some((c) => !represented.has(c.id)) && (
							<>
								{heading("Other direct messages")}
								{conversationRows(
									sections.directs.filter((c) => !represented.has(c.id)),
									"",
								)}
							</>
						)}
					</>
				)}
			</ScrollView>
			{tenantId && (
				<ProfileSheet
					subject={profile}
					tenantId={tenantId}
					onClose={() => setProfile(null)}
				/>
			)}
			<Sheet
				visible={switching}
				onClose={() => setSwitching(false)}
				title="Organization"
				testID={SURFACE.teamBridgeOrganizations}
			>
				<View className="gap-2 p-4">
					{state.organizations.map((o) => (
						<Button
							key={o.tenantId}
							variant="outline"
							label={`${o.name}${o.readOnly ? " · Read only" : ""}${o.unread ? ` · ${o.unread} unread` : ""}`}
							testID={teamBridgeOrganizationId(o.tenantId)}
							onPress={() => {
								actions.selectOrganization(o.tenantId);
								setSwitching(false);
							}}
						/>
					))}
				</View>
			</Sheet>
		</Screen>
	);
}

export default function TeamBridgeListScreen() {
	return (
		<BridgeGate>
			<ListContent />
		</BridgeGate>
	);
}
