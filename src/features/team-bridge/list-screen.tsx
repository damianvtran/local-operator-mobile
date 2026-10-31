import { useRouter } from "expo-router";
import { BellOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
	Pressable,
	RefreshControl,
	ScrollView,
	Text,
	View,
} from "react-native";
import { t } from "@/i18n";
import type { Conversation } from "@/team-bridge/contract";
import * as model from "@/team-bridge/model";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import {
	CONTROL,
	SCREEN,
	SURFACE,
	teamBridgeChiefId,
	teamBridgeConversationId,
	teamBridgeOrganizationId,
	teamBridgePersonId,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Avatar, initialsOf } from "@/ui/components/avatar";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";
import { Sheet } from "@/ui/components/sheet";
import { BridgeBack, BridgeGate } from "./gate";

export function BridgeRow({
	label,
	detail,
	conversation,
	disabled,
	onPress,
	testID,
}: {
	label: string;
	detail?: string | null;
	conversation?: Conversation | null;
	disabled?: boolean;
	onPress: () => void;
	testID: string;
}) {
	const unread = conversation ? model.rowUnread(conversation) : null;
	const muted = conversation && model.showsMutedGlyph(conversation);
	const mutedColor = useTokenColor("ink-muted");
	return (
		<Pressable
			accessibilityRole="link"
			accessibilityLabel={[
				label,
				detail,
				unread?.count
					? t("mobile.team_bridge.unread", { count: unread.count })
					: null,
				muted ? t("mobile.team_bridge.list.quiet") : null,
			]
				.filter(Boolean)
				.join(", ")}
			accessibilityState={{ disabled: !!disabled }}
			disabled={disabled}
			onPress={onPress}
			testID={testID}
			className={`min-h-14 flex-row items-center gap-3 rounded-sm px-4 py-3 ${disabled ? "opacity-50" : ""}`}
		>
			<Avatar initials={initialsOf(label)} />
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
	const router = useRouter();
	const [switching, setSwitching] = useState(false);
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
	const open = (target: model.Target) => {
		const params =
			target.kind === "conversation"
				? { tenantId: target.tenantId, conversationId: target.conversationId }
				: { ...target, conversationId: "new" };
		router.push({
			pathname: "/team-bridge/[tenantId]/[conversationId]",
			params,
		});
	};
	const existing = (conversation: Conversation) =>
		open({
			kind: "conversation",
			tenantId: conversation.tenant_id,
			conversationId: conversation.id,
		});
	/* Translate presentation here, not protocol/model values. Whole organization
	 * labels and unread counts let each locale own order and plural grammar. */
	const conversationRows = (rows: Conversation[], empty: string) =>
		rows.length ? (
			rows.map((c) => (
				<BridgeRow
					key={c.id}
					label={
						model.conversationTitle(c, state.selfAccountId) ??
						t("mobile.team_bridge.conversation")
					}
					conversation={c}
					detail={
						model.isPreview(c) ? t("mobile.team_bridge.list.preview") : null
					}
					onPress={() => existing(c)}
					testID={teamBridgeConversationId(c.id)}
				/>
			))
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
			title={t("mobile.team_bridge.title")}
			headerLeading={<BridgeBack />}
			scroll={false}
			testID={SCREEN.teamBridgeList}
		>
			<View className="px-4 py-2">
				<Button
					label={t("mobile.team_bridge.list.organization_selected", {
						name: selected?.name ?? t("mobile.team_bridge.list.choose"),
						readOnly: selected?.readOnly ? "yes" : "no",
					})}
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
						{t("mobile.team_bridge.list.organizations_empty")}
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
									{t("mobile.team_bridge.list.conversations_loading")}
								</Text>
							)}
						{org?.conversationsState === "error" && (
							<View className="gap-2 px-4">
								<Text accessibilityRole="alert" className="text-body text-ink">
									{org.conversationsError?.message ??
										t("mobile.team_bridge.list.conversations_error")}
								</Text>
								<Button
									label={t("mobile.team_bridge.list.conversations_retry")}
									testID={CONTROL.teamBridgeConversationsRetry}
									onPress={retry}
								/>
							</View>
						)}
						{heading(t("mobile.team_bridge.list.channels"))}
						{conversationRows(
							sections.channels,
							org?.conversationsState === "ready"
								? t("mobile.team_bridge.list.channels_empty")
								: "",
						)}
						{heading(t("mobile.team_bridge.list.groups"))}
						{conversationRows(
							sections.groups,
							org?.conversationsState === "ready"
								? t("mobile.team_bridge.list.groups_empty")
								: "",
						)}
						{heading(t("mobile.team_bridge.list.people"))}
						{org?.peopleState === "loading" && !people.length && (
							<Text className="px-4 py-3 text-body text-ink-muted">
								{t("mobile.team_bridge.list.people_loading")}
							</Text>
						)}
						{org?.peopleState === "error" && (
							<View className="gap-2 px-4">
								<Text accessibilityRole="alert" className="text-body text-ink">
									{t("mobile.team_bridge.list.people_error")}
								</Text>
								<Button
									label={t("mobile.team_bridge.list.people_retry")}
									testID={CONTROL.teamBridgePeopleRetry}
									onPress={retry}
								/>
							</View>
						)}
						{!people.length && org?.peopleState === "ready" && (
							<Text className="px-4 py-3 text-body text-ink-muted">
								{t("mobile.team_bridge.list.people_empty")}
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
										rowState === "self"
											? t("mobile.team_bridge.list.self")
											: rowState === "unavailable"
												? t("mobile.team_bridge.list.person_unavailable")
												: rowState === "paused"
													? t("mobile.team_bridge.list.paused")
													: null
									}
									conversation={dm}
									disabled={rowState === "unavailable" || rowState === "self"}
									testID={teamBridgePersonId(person.account_id)}
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
								{t("mobile.team_bridge.list.directory_incomplete")}
							</Text>
						)}
						{heading(t("mobile.team_bridge.list.chiefs"))}
						{!chiefs.length && org?.peopleState === "ready" && (
							<Text className="px-4 py-3 text-body text-ink-muted">
								{t("mobile.team_bridge.list.chiefs_empty")}
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
									detail={
										chief.paused
											? t("mobile.team_bridge.list.paused")
											: t("mobile.team_bridge.list.chief_role")
									}
									conversation={dm}
									testID={teamBridgeChiefId(chief.endpointId)}
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
								{heading(t("mobile.team_bridge.list.other_direct"))}
								{conversationRows(
									sections.directs.filter((c) => !represented.has(c.id)),
									"",
								)}
							</>
						)}
					</>
				)}
			</ScrollView>
			<Sheet
				visible={switching}
				onClose={() => setSwitching(false)}
				title={t("mobile.team_bridge.list.organization")}
				testID={SURFACE.teamBridgeOrganizations}
			>
				<View className="gap-2 p-4">
					{state.organizations.map((o) => (
						<Button
							key={o.tenantId}
							variant="outline"
							label={t("mobile.team_bridge.list.organization_label", {
								name: o.name,
								readOnly: o.readOnly ? "yes" : "no",
								count: o.unread ?? 0,
							})}
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
