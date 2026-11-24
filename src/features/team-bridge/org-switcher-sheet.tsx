/**
 * The organization switcher sheet: private Team orgs, then (flag on) the
 * Communities group (RFC v2.4 Amendment A §2; frame M8).
 *
 * WHY IT IS ITS OWN COMPONENT. It used to live inline in the Team Bridge list.
 * Amendment A §3 makes a community a SCOPE the reader is in ("lasts until you
 * switch back"), and the phone shows a community on its own route, so the
 * switcher has to be reachable from inside a community too, both to show which
 * scope is checked and to switch back (review round 1, R1-3). One component
 * keeps the two entry points from drifting.
 *
 * ONE CHECK. The scope is the community store's session selection when that is
 * a community, else the Team Bridge store's selected org. Exactly one row is
 * checked, in either group, never one in each.
 *
 * ONE COLUMN (design review round 1, D4). Both groups use `SectionHeader`, the
 * same row inset, a 24 pt leading tile, and a trailing column holding the unread
 * pill and then the check, so headings, tiles, names and pills line up.
 */
import { Pressable, Text, View } from "react-native";
import { communityEnabled } from "@/community/flag";
import { useCommunity, useCommunityState } from "@/community/provider";
import { SwitcherTrailing } from "@/features/community/parts";
import { CommunitySwitcherGroup } from "@/features/community/switcher-group";
import { t } from "@/i18n";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import {
	state as a11yState,
	ROLE,
	SURFACE,
	teamBridgeOrganizationId,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { initialsOf } from "@/ui/components/avatar";
import { SectionHeader } from "@/ui/components/section-header";
import { Sheet } from "@/ui/components/sheet";
import { useComposedDir } from "@/ui/direction";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

export function OrgSwitcherSheet({
	visible,
	onClose,
	onPrivatePicked,
}: {
	visible: boolean;
	onClose: () => void;
	/** After a private org is picked: e.g. leave a community for the list. */
	onPrivatePicked?: () => void;
}) {
	const { actions } = useTeamBridge();
	const community = useCommunity();
	const organizations = useTeamBridgeState((s) => s.organizations);
	const tenantId = useTeamBridgeState((s) => s.selectedTenantId);
	const session = useCommunityState((s) => s.session);
	const inCommunity = session?.kind === "community";
	const checkColor = useTokenColor("accent");
	const composedDir = useComposedDir();
	/* See `SectionHeader`: `dir` is a react-native-web prop RN's TextProps lack. */
	const labelDir: object = composedDir;
	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			title={t("mobile.team_bridge.list.organization")}
			testID={SURFACE.teamBridgeOrganizations}
		>
			{/* `Sheet` already provides `px-4` on its scroll content; no inner `p-4`
			 *  so options sit flush with the sheet header's 16 pt margin. */}
			<View className="gap-1 pb-2">
				{/* Amendment A §2: private organizations and communities are two
				 *  groups; the heading only appears when the second one does, and
				 *  only over rows: a community-only reader saw "ORGANIZATIONS" over
				 *  nothing, which reads as a failed load (design round 2, D12). */}
				{communityEnabled() && organizations.length > 0 ? (
					<SectionHeader label={t("mobile.community.switcher.organizations")} />
				) : null}
				{organizations.map((o) => {
					const active = !inCommunity && o.tenantId === tenantId;
					const optionLabel = t("mobile.team_bridge.list.organization_label", {
						name: o.name,
						readOnly: o.readOnly ? "yes" : "no",
						count: o.unread ?? 0,
					});
					return (
						<Pressable
							key={o.tenantId}
							accessibilityRole={ROLE.button}
							accessibilityLabel={optionLabel}
							accessibilityState={a11yState({ selected: active })}
							testID={teamBridgeOrganizationId(o.tenantId)}
							onPress={() => {
								actions.selectOrganization(o.tenantId);
								/* Amendment A §3: picking a private org IS switching back. */
								community.actions.select({
									kind: "private",
									tenantId: o.tenantId,
								});
								onClose();
								onPrivatePicked?.();
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
									{/* The count moved to the pill (D4); the spoken label keeps it. */}
									<Text
										{...labelDir}
										className={cx(
											"min-w-0 flex-1 text-body",
											active ? "font-semibold text-ink" : "text-ink",
										)}
									>
										{t("mobile.team_bridge.list.organization_label", {
											name: o.name,
											readOnly: o.readOnly ? "yes" : "no",
											count: 0,
										})}
									</Text>
									<SwitcherTrailing
										unread={o.unread ?? 0}
										checked={active}
										checkColor={checkColor}
									/>
								</View>
							)}
						</Pressable>
					);
				})}
			</View>
			<CommunitySwitcherGroup
				selectedCommunityId={inCommunity ? session.communityId : null}
				onPicked={onClose}
			/>
		</Sheet>
	);
}
