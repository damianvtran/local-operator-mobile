import { useGlobalSearchParams, usePathname } from "expo-router";
import {
	AtSign,
	BellOff,
	Check,
	ChevronsUpDown,
	Hash,
	Lock,
	Users,
} from "lucide-react-native";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import {
	Pressable,
	RefreshControl,
	ScrollView,
	Text,
	View,
} from "react-native";
import { countLabel } from "@/features/notifications/notifications-model";
import { t } from "@/i18n";
import { activeBridgeRoute } from "@/team-bridge/active-route";
import type { Conversation } from "@/team-bridge/contract";
import * as model from "@/team-bridge/model";
import { dmSubject, type ProfileSubject } from "@/team-bridge/profile";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import {
	state as a11yState,
	CONTROL,
	ROLE,
	SCREEN,
	SURFACE,
	teamBridgeChiefId,
	teamBridgeConversationId,
	teamBridgeOrganizationId,
	teamBridgePersonId,
	teamBridgeProfileOpenId,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { initialsOf } from "@/ui/components/avatar";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Sheet } from "@/ui/components/sheet";
import { Skeleton } from "@/ui/components/skeleton";
import { TOUCH_FLOOR } from "@/ui/layout";
import { CONTROL_DISABLED_INK, cx } from "@/ui/variants";
import { DefaultOnNoticeBanner } from "./default-on-notice-banner";
import { BridgeBack, BridgeGate } from "./gate";
import {
	PersonAvatar,
	ProfileAvatarButton,
	ProfileSheet,
	useOpenTarget,
} from "./profile-card";
import { BridgeThreadTitle } from "./thread-chrome";

/**
 * Leading glyph for a non-person conversation row, matching Desktop's
 * `ConversationRailRow` (`team-bridge-rail.tsx`): `#` (or `Lock` when private)
 * for channels, `Users` for groups, `AtSign` for unrepresented DMs.
 * Never a 44×44 uppercase-initial `PersonAvatar` circle (`"GE"`, `"HU"`).
 */
function ConversationKindGlyph({
	conversation,
	emphasized,
	disabled,
}: {
	conversation: Conversation;
	emphasized: boolean;
	disabled: boolean;
}) {
	const color = useTokenColor(
		disabled ? "ink-dim" : emphasized ? "accent" : "ink-muted",
	);
	const Icon =
		conversation.kind === "group"
			? Users
			: conversation.kind === "dm"
				? AtSign
				: conversation.visibility === "private"
					? Lock
					: Hash;
	return (
		<View
			className="w-8 items-center justify-center"
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			aria-hidden
		>
			<Icon size={18} color={color} />
		</View>
	);
}

/**
 * The surface the directory is drawn on. The route screen sits on the canvas;
 * the workspace drawer and the docked split pane sit on `bg-elevated`. The
 * pair matters because the row fills are measured AGAINST the ground: dark
 * `row-selected` (#372f24) and `row-hover` (#302d29) are ~1.0:1 on the
 * elevated #322d22, so on that ground a selected or pressed row painted
 * nothing at all (QA Q1-1). A context rather than a prop, because every
 * `BridgeRow` in a directory shares its ground and the rows are built several
 * helpers deep.
 */
type DirectoryGround = "canvas" | "raised";
const DirectoryGroundContext = createContext<DirectoryGround>("canvas");

/**
 * Selection fill: the accent wash, on either ground. It stays distinct where
 * `row-selected` vanished (dark #16281d on #322d22, light #e7f1e8 on #fefdfa),
 * and it is never the only channel — the label also turns accent + semibold
 * and the kind glyph turns accent (`variants.ts` row rule: "selection is
 * never colour alone").
 */
const ROW_SELECTED_FILL = "bg-accent-wash";
/** Pressed fill per ground: `row-hover` reads on the canvas, but on the dark
 *  elevated panel it is a 1.045:1 step, so there the press sinks instead. */
const rowPressedFill = (ground: DirectoryGround) =>
	ground === "raised" ? "bg-row-hover dark:bg-sunken" : "bg-row-hover";
/** Selected label ink: the segmented/chip selected pair (`variants.ts`). */
const ROW_SELECTED_INK = "text-accent-active dark:text-accent-hover";

export function BridgeRow({
	label,
	detail,
	conversation,
	selected = false,
	disabled,
	onPress,
	testID,
	profile,
}: {
	label: string;
	detail?: string | null;
	conversation?: Conversation | null;
	selected?: boolean;
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
	const mutedColor = useTokenColor(disabled ? "ink-dim" : "ink-muted");
	const emphasized = Boolean(!disabled && (selected || unread?.loud));
	if (profile)
		return (
			/* Semantic disabled ink (`CONTROL_DISABLED_INK` on the text), never
			 * `opacity-50` (`docs/design/components.md` §31: opacity fades the
			 * ground and breaks contrast). `ProfileAvatarButton` owns its own
			 * `TOUCH_FLOOR` box beside the row's link. */
			<View
				className={cx(
					"mx-2 flex-row items-center gap-1 rounded-sm ps-1 pe-3",
					selected && !disabled && ROW_SELECTED_FILL,
				)}
				style={{ minHeight: TOUCH_FLOOR }}
			>
				<ProfileAvatarButton
					subject={profile.subject}
					label={label}
					size="sm"
					onOpen={profile.onOpen}
					testID={profile.testID}
				/>
				<BridgeRowLink
					label={label}
					detail={detail}
					unread={unread}
					muted={!!muted}
					mutedColor={mutedColor}
					selected={selected}
					disabled={disabled}
					onPress={onPress}
					testID={testID}
					baseClassName="min-w-0 flex-1 flex-row items-center gap-2.5 rounded-sm ps-1 py-1.5"
					/* On RN web a `Pressable` sizes to its content unless the flex
					 *  share is on the Pressable itself (`segmented.tsx`): with it only
					 *  on the inner View, People/Chiefs rows shrank to their label,
					 *  clipped long names past the panel edge and left the unread pill
					 *  floating mid-row (design D1-1). */
					pressableClassName="min-w-0 flex-1"
					allowHoverFill={!selected}
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
			selected={selected}
			disabled={disabled}
			onPress={onPress}
			testID={testID}
			baseClassName="mx-2 flex-row items-center gap-2.5 rounded-sm px-2.5 py-1.5"
			allowHoverFill
			leading={
				conversation ? (
					<ConversationKindGlyph
						conversation={conversation}
						emphasized={emphasized}
						disabled={!!disabled}
					/>
				) : (
					<PersonAvatar member={null} label={label} size="sm" />
				)
			}
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
	selected,
	disabled,
	onPress,
	testID,
	baseClassName,
	pressableClassName,
	allowHoverFill,
	leading,
}: {
	label: string;
	detail?: string | null;
	unread: ReturnType<typeof model.rowUnread> | null;
	muted: boolean;
	mutedColor: string;
	selected: boolean;
	disabled?: boolean;
	onPress: () => void;
	testID: string;
	baseClassName: string;
	/** Flex share for the Pressable itself, when the row sits beside another
	 *  control (the profile avatar) and must fill the remaining width. */
	pressableClassName?: string;
	allowHoverFill: boolean;
	leading?: ReactNode;
}) {
	const ground = useContext(DirectoryGroundContext);
	/* `unread.loud` (not `unread.count`): a muted conversation keeps a quiet
	 * count pill without bolding its row label (`model.rowUnread`). */
	const bold = Boolean(!disabled && (selected || unread?.loud));
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
			accessibilityState={a11yState({
				disabled: !!disabled,
				selected: selected || undefined,
			})}
			aria-current={selected ? "page" : undefined}
			disabled={disabled}
			onPress={onPress}
			testID={testID}
			className={pressableClassName}
			style={{ minHeight: TOUCH_FLOOR }}
		>
			{({ pressed }) => (
				<View
					className={cx(
						"flex-1",
						baseClassName,
						allowHoverFill &&
							!disabled &&
							(selected
								? ROW_SELECTED_FILL
								: pressed
									? rowPressedFill(ground)
									: "bg-transparent"),
						!allowHoverFill && !disabled && pressed && rowPressedFill(ground),
					)}
				>
					{leading}
					<View className="min-w-0 flex-1 justify-center">
						<Text
							className={cx(
								"text-body-sm",
								disabled
									? CONTROL_DISABLED_INK
									: selected
										? ROW_SELECTED_INK
										: "text-ink",
								bold ? "font-semibold" : "font-normal",
							)}
							numberOfLines={1}
						>
							{label}
						</Text>
						{detail ? (
							<Text
								className={cx(
									"text-meta",
									disabled ? CONTROL_DISABLED_INK : "text-ink-dim",
								)}
								numberOfLines={1}
							>
								{detail}
							</Text>
						) : null}
					</View>
					{muted && (
						<View
							accessibilityElementsHidden
							importantForAccessibility="no-hide-descendants"
						>
							<BellOff size={15} color={mutedColor} />
						</View>
					)}
					{!!unread?.count && (
						<View
							className={cx(
								"rounded-full px-2 py-0.5",
								unread.loud ? "bg-accent" : "bg-sunken",
							)}
						>
							<Text
								className={cx(
									"text-mono-label tabular-nums",
									unread.loud ? "text-on-accent" : "text-ink-muted",
								)}
							>
								{countLabel(unread.count)}
							</Text>
						</View>
					)}
				</View>
			)}
		</Pressable>
	);
}

/**
 * The organization directory (org switcher, sections, profile and org sheets)
 * WITHOUT a screen around it, so the route screen and the workspace drawer's
 * Team Bridge pane render the one list rather than two that drift (Bridge UI
 * brief §2: reuse the list content, never nest the full route Screen in the
 * drawer's modal). Reads the live Team Bridge store directly; there is no
 * drawer-side copy of it.
 *
 * `onBeforeOpen` runs before a row routes to a thread. The drawer passes its
 * `onNavigate`, which dismisses the panel first so the thread is not opened
 * underneath a still-covering drawer; the route screen passes nothing.
 */
export function BridgeDirectory({
	onBeforeOpen,
	ground = "canvas",
}: {
	onBeforeOpen?: () => void;
	/** The surface the directory is drawn on: `raised` in the drawer and the
	 *  docked pane (`bg-elevated`), `canvas` on the route screen. Drives the
	 *  skeleton pair and the row fills, which are both measured against it. */
	ground?: DirectoryGround;
} = {}) {
	const { actions } = useTeamBridge();
	const state = useTeamBridgeState((s) => s);
	const pathname = usePathname();
	const searchParams = useGlobalSearchParams<{
		kind?: string;
		accountId?: string;
		endpointId?: string;
	}>();
	const activeRoute = activeBridgeRoute(pathname, searchParams);
	const chevronColor = useTokenColor("ink-dim");
	const checkColor = useTokenColor("accent");
	const openTarget = useOpenTarget();
	const open = (target: Parameters<typeof openTarget>[0]) => {
		onBeforeOpen?.();
		openTarget(target);
	};
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
	/* Translate presentation here, not protocol/model values. Whole organization
	 * labels and unread counts let each locale own order and plural grammar. */
	const conversationRows = (rows: Conversation[], empty: string) =>
		rows.length ? (
			rows.map((c) => {
				const subject = dmSubject(c, people, state.selfAccountId);
				const rowSelected =
					activeRoute?.tenantId === c.tenant_id &&
					activeRoute.conversationId === c.id;
				return (
					<BridgeRow
						key={c.id}
						label={
							model.conversationTitle(c, state.selfAccountId) ??
							t("mobile.team_bridge.conversation")
						}
						conversation={c}
						selected={rowSelected}
						detail={
							model.isPreview(c) ? t("mobile.team_bridge.list.preview") : null
						}
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
			<Text className="px-4 py-1.5 text-body-sm text-ink-dim">{empty}</Text>
		) : null;
	const heading = (text: string) => (
		<View className="px-4">
			<SectionHeader label={text} />
		</View>
	);
	const retry = () => {
		if (tenantId) void actions.loadOrganization(tenantId);
	};
	const orgName = selected?.name ?? t("mobile.team_bridge.list.choose");
	const conversationsLoading =
		(!org ||
			org.conversationsState === "idle" ||
			org.conversationsState === "loading") &&
		!conversations.length;
	const multiOrg = state.organizations.length > 1;
	return (
		<DirectoryGroundContext.Provider value={ground}>
			<View className="px-2 py-1">
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel={t(
						"mobile.team_bridge.list.organization_selected",
						{
							name: orgName,
							readOnly: selected?.readOnly ? "yes" : "no",
						},
					)}
					testID={CONTROL.teamBridgeOrgSwitcher}
					onPress={() => setSwitching(true)}
					style={{ minHeight: TOUCH_FLOOR }}
				>
					{({ pressed }) => (
						<View
							className={cx(
								"flex-1 flex-row items-center gap-2.5 rounded-sm px-2 py-1.5",
								pressed ? "bg-row-hover" : "bg-transparent",
							)}
						>
							<View
								className="h-6 w-6 items-center justify-center rounded-sm bg-accent-muted"
								aria-hidden
								accessibilityElementsHidden
								importantForAccessibility="no-hide-descendants"
							>
								<Text className="text-mono-label font-semibold text-accent-active dark:text-accent-hover">
									{initialsOf(orgName).slice(0, 1)}
								</Text>
							</View>
							<Text
								className="min-w-0 flex-1 text-label font-semibold text-ink"
								numberOfLines={1}
							>
								{t("mobile.team_bridge.list.organization_selected", {
									name: orgName,
									readOnly: selected?.readOnly ? "yes" : "no",
								})}
							</Text>
							{multiOrg ? (
								<ChevronsUpDown size={15} color={chevronColor} aria-hidden />
							) : null}
						</View>
					)}
				</Pressable>
			</View>
			<ScrollView
				testID={SURFACE.teamBridgeSections}
				contentContainerClassName="pb-6"
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
				<DefaultOnNoticeBanner tenantId={tenantId} />
				{!tenantId && (
					<Text className="px-4 py-4 text-body-sm text-ink-dim">
						{t("mobile.team_bridge.list.organizations_empty")}
					</Text>
				)}
				{tenantId && (
					<>
						{org?.conversationsState === "error" && (
							<View className="gap-2 px-4 py-2">
								<Text
									accessibilityRole="alert"
									className="text-body-sm text-danger"
								>
									{org.conversationsError?.message ??
										t("mobile.team_bridge.list.conversations_error")}
								</Text>
								<View className="self-start">
									<Button
										label={t("mobile.team_bridge.list.conversations_retry")}
										variant="outline"
										size="sm"
										testID={CONTROL.teamBridgeConversationsRetry}
										onPress={retry}
									/>
								</View>
							</View>
						)}
						{heading(t("mobile.team_bridge.list.channels"))}
						{/* The loading placeholder sits UNDER the first section it
						 *  stands in for, and the Groups header waits for data: a
						 *  skeleton floating above two empty headers read as content
						 *  belonging to neither (UX U1-5). `accessible` makes the
						 *  wrapper one element so its label is what a screen reader
						 *  hears, not three unlabeled bars (R1-6). */}
						{conversationsLoading ? (
							<View
								accessible
								className="px-4 py-3"
								testID={SURFACE.teamBridgeConversationsLoading}
								accessibilityLabel={t(
									"mobile.team_bridge.list.conversations_loading",
								)}
							>
								<Skeleton lines={3} ground={ground} />
							</View>
						) : (
							<>
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
							</>
						)}
						{heading(t("mobile.team_bridge.list.people"))}
						{org?.peopleState === "loading" && !people.length && (
							<View
								accessible
								className="px-4 py-2"
								accessibilityLabel={t("mobile.team_bridge.list.people_loading")}
							>
								<Skeleton lines={2} ground={ground} />
							</View>
						)}
						{org?.peopleState === "error" && (
							<View className="gap-2 px-4 py-2">
								<Text
									accessibilityRole="alert"
									className="text-body-sm text-danger"
								>
									{t("mobile.team_bridge.list.people_error")}
								</Text>
								<View className="self-start">
									<Button
										label={t("mobile.team_bridge.list.people_retry")}
										variant="outline"
										size="sm"
										testID={CONTROL.teamBridgePeopleRetry}
										onPress={retry}
									/>
								</View>
							</View>
						)}
						{!people.length && org?.peopleState === "ready" && (
							<Text className="px-4 py-1.5 text-body-sm text-ink-dim">
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
							const personSelected = Boolean(
								activeRoute?.tenantId === tenantId &&
									((dm && activeRoute.conversationId === dm.id) ||
										(activeRoute.conversationId === "new" &&
											activeRoute.kind === "person" &&
											activeRoute.accountId === person.account_id)),
							);
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
									selected={personSelected}
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
							<Text className="px-4 py-1.5 text-body-sm text-ink-dim">
								{t("mobile.team_bridge.list.directory_incomplete")}
							</Text>
						)}
						{heading(t("mobile.team_bridge.list.chiefs"))}
						{!chiefs.length && org?.peopleState === "ready" && (
							<Text className="px-4 py-1.5 text-body-sm text-ink-dim">
								{t("mobile.team_bridge.list.chiefs_empty")}
							</Text>
						)}
						{chiefs.map((chief) => {
							const dm = model.dmWithAgent(
								conversations,
								chief.person.account_id,
							);
							const chiefSelected = Boolean(
								activeRoute?.tenantId === tenantId &&
									((dm && activeRoute.conversationId === dm.id) ||
										(activeRoute.conversationId === "new" &&
											activeRoute.kind === "agent" &&
											activeRoute.endpointId === chief.endpointId)),
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
									selected={chiefSelected}
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
			{tenantId && (
				<ProfileSheet
					subject={profile}
					tenantId={tenantId}
					onClose={() => setProfile(null)}
					onBeforeOpen={onBeforeOpen}
				/>
			)}
			<Sheet
				visible={switching}
				onClose={() => setSwitching(false)}
				title={t("mobile.team_bridge.list.organization")}
				testID={SURFACE.teamBridgeOrganizations}
			>
				{/* `Sheet` already provides `px-4` on its scroll content; no inner `p-4`
				 *  so options sit flush with the sheet header's 16 pt margin. */}
				<View className="gap-1 pb-2">
					{state.organizations.map((o) => {
						const active = o.tenantId === tenantId;
						const optionLabel = t(
							"mobile.team_bridge.list.organization_label",
							{
								name: o.name,
								readOnly: o.readOnly ? "yes" : "no",
								count: o.unread ?? 0,
							},
						);
						return (
							<Pressable
								key={o.tenantId}
								accessibilityRole={ROLE.button}
								accessibilityLabel={optionLabel}
								accessibilityState={a11yState({ selected: active })}
								testID={teamBridgeOrganizationId(o.tenantId)}
								onPress={() => {
									actions.selectOrganization(o.tenantId);
									setSwitching(false);
								}}
								style={{ minHeight: TOUCH_FLOOR }}
							>
								{({ pressed }) => (
									<View
										className={cx(
											"flex-1 flex-row items-center gap-3 rounded-sm px-3 py-2",
											active
												? "bg-row-selected"
												: pressed
													? "bg-row-hover"
													: "bg-transparent",
										)}
									>
										<View
											className="h-6 w-6 items-center justify-center rounded-sm bg-accent-muted"
											aria-hidden
											accessibilityElementsHidden
											importantForAccessibility="no-hide-descendants"
										>
											<Text className="text-mono-label font-semibold text-accent-active dark:text-accent-hover">
												{initialsOf(o.name).slice(0, 1)}
											</Text>
										</View>
										<Text
											className={cx(
												"min-w-0 flex-1 text-body",
												active ? "font-semibold text-ink" : "text-ink",
											)}
										>
											{optionLabel}
										</Text>
										{active ? (
											<Check size={18} color={checkColor} aria-hidden />
										) : null}
									</View>
								)}
							</Pressable>
						);
					})}
				</View>
			</Sheet>
		</DirectoryGroundContext.Provider>
	);
}

function ListContent() {
	return (
		<Screen
			title={t("mobile.team_bridge.title")}
			titleNode={<BridgeThreadTitle title={t("mobile.team_bridge.title")} />}
			headerLeading={<BridgeBack />}
			scroll={false}
			testID={SCREEN.teamBridgeList}
		>
			<BridgeDirectory />
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
