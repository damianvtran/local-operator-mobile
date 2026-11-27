import { useState } from "react";
import { Text, View } from "react-native";

import { useLocaleFrame } from "@/features/auth/connection-provider";
import type { GuardController } from "@/features/guard/guard-controller";
import { nonTeamView } from "@/features/guard/guard-model";
import {
	GuardConsentSheet,
	GuardNonTeamCardView,
	GuardOrgCard,
	GuardOutcomeAlert,
	GuardRevokeSheet,
} from "@/features/guard/guard-views";
import {
	useGuardAvailability,
	useGuardController,
	useGuardState,
} from "@/features/guard/use-guard";
import { t } from "@/i18n";
import type { RelayEndpoints } from "@/relay";
import { CONTROL, REGION, SURFACE } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { Divider } from "@/ui/components/divider";
import { SectionHeader } from "@/ui/components/section-header";

/**
 * Settings → Radient Guard (RFC v0.9 §5.3, §14', slice M1).
 *
 * The phone's host-level entry for Guard, deliberately OUTSIDE `session/[id]`: a
 * consent request is a decision about a computer, not about a turn, so it never
 * appears in a conversation and never interrupts one. The section shows what the
 * HOST says (status, what is shared, which computer), offers "Stop sharing" and
 * "Share again" only where the host's own predicates allow them, and carries the
 * non-Team card.
 *
 * It can stop and review but never start: "Share" is answered on the consent
 * card, relayed to the host, which signs. Console can stop but never start; the
 * phone is the same.
 *
 * Calm states, not errors: an older computer (no `features.guard`) gets one
 * sentence and ZERO Guard requests; a read that fails says so without implying
 * anything is shared or not; a non-Team account gets the card and makes no call
 * beyond the host's local status read and the card's trial length.
 */
export const GuardBody = ({ controller }: { controller: GuardController }) => {
	const state = useGuardState(controller);
	const [confirmTenant, setConfirmTenant] = useState<string | null>(null);
	const { read } = state;
	if (read.kind === "loading")
		return (
			<Text className="text-body-sm text-ink-muted">
				{t("mobile.guard.loading")}
			</Text>
		);
	if (read.kind === "unsupported")
		return (
			<Text
				className="text-body-sm text-ink-muted"
				testID={SURFACE.guardUnsupported}
			>
				{t("mobile.guard.host_old")}
			</Text>
		);
	if (read.kind === "error")
		return (
			<View className="gap-2">
				<Text className="text-body-sm text-ink-muted">
					{t("mobile.guard.load_error")}
				</Text>
				<Button
					testID={CONTROL.guardRetry}
					label={t("mobile.common.try_again")}
					variant="outline"
					size="sm"
					onPress={() => void controller.reload()}
				/>
			</View>
		);
	const { status, card } = read;
	const confirmOrg =
		status.orgs.find((org) => org.tenant === confirmTenant) ?? null;
	return (
		<View className="gap-3">
			{status.mode === "non_team" ? (
				(() => {
					const view = nonTeamView(status, card);
					return view === null ? null : <GuardNonTeamCardView view={view} />;
				})()
			) : status.mode === "unavailable" ? (
				<Text className="text-body-sm text-ink-muted">
					{t("mobile.guard.screen_unavailable")}
				</Text>
			) : status.orgs.length === 0 ? (
				<Text className="text-body-sm text-ink-muted">
					{t("mobile.guard.screen_none")}
				</Text>
			) : (
				<>
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.guard.intro")}
					</Text>
					{status.this_computer !== "" ? (
						<Text className="text-body-sm text-ink-muted">
							{t("mobile.guard.computer_line", {
								computer: status.this_computer,
							})}
						</Text>
					) : null}
					{status.orgs.map((org) => (
						<GuardOrgCard
							key={org.tenant}
							org={org}
							busy={state.busy !== null}
							onReview={() => void controller.openConsent(org.tenant)}
							onStop={() => setConfirmTenant(org.tenant)}
							onShareAgain={() => void controller.shareAgain(org.tenant)}
						/>
					))}
					{status.orgs.some((org) => org.can_revoke) ? (
						<Text className="text-body-sm text-ink-muted">
							{t("mobile.guard.computers_note")}
						</Text>
					) : null}
				</>
			)}
			{state.outcome !== null ? (
				<GuardOutcomeAlert outcome={state.outcome} />
			) : null}
			<GuardConsentSheet controller={controller} />
			<GuardRevokeSheet
				org={confirmOrg}
				backupDays={status.backup_days}
				busy={state.busy !== null}
				onCancel={() => setConfirmTenant(null)}
				onConfirm={() => {
					const tenant = confirmTenant;
					setConfirmTenant(null);
					if (tenant !== null) void controller.revoke(tenant);
				}}
			/>
		</View>
	);
};

/** Wrapper so a section with nothing to say leaves no header (and no divider)
 *  behind: a non-Team MEMBER sees nothing at all (§14'). */
const Frame = ({ children }: { children: React.ReactNode }) => (
	<>
		<View className="gap-2" testID={REGION.settingsGuard}>
			<SectionHeader label={t("mobile.guard.screen_title")} />
			{children}
		</View>
		<Divider />
	</>
);

const GuardEditor = ({ client }: { client: RelayEndpoints }) => {
	const controller = useGuardController(client);
	const read = useGuardState(controller).read;
	if (
		read.kind === "ready" &&
		read.status.mode === "non_team" &&
		nonTeamView(read.status, read.card) === null
	)
		return null;
	return (
		<Frame>
			<GuardBody controller={controller} />
		</Frame>
	);
};

export const GuardSection = () => {
	// Subscription only: a language frame re-renders the section so its `t()`
	// reads follow the switch (the account-routing section's rule).
	useLocaleFrame();
	const availability = useGuardAvailability();
	if (availability.kind === "unknown") return null;
	if (availability.kind === "ready")
		return <GuardEditor client={availability.client} />;
	return (
		<Frame>
			<Text
				className="text-body-sm text-ink-muted"
				testID={
					availability.kind === "unsupported"
						? SURFACE.guardUnsupported
						: undefined
				}
			>
				{t(
					availability.kind === "offline"
						? "mobile.guard.disconnected"
						: availability.kind === "degraded"
							? "mobile.guard.reconnecting"
							: "mobile.guard.host_old",
				)}
			</Text>
		</Frame>
	);
};
