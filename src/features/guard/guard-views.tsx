import { Linking, Text, View } from "react-native";

import { t } from "@/i18n";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Sheet } from "@/ui/components/sheet";
import type { GuardController } from "./guard-controller";
import {
	allDescribable,
	consentView,
	type GuardConsentCard,
	type GuardOrg,
	type GuardOutcome,
	indicatorFor,
	listLabels,
	type NonTeamView,
	orderedScopes,
	orgActions,
	outcomeLine,
	revokeBody,
	scopeLabel,
} from "./guard-model";
import { useGuardState } from "./use-guard";

/** The sentence under a write. A polite live region: it reports a result the
 *  reader just caused, and must not steal focus (RFC §5.2.3). */
export const GuardOutcomeAlert = ({
	outcome,
}: {
	outcome: Exclude<GuardOutcome, null>;
}) => {
	const line = outcomeLine(outcome);
	return (
		<View testID={SURFACE.guardOutcome} accessibilityLiveRegion="polite">
			<Alert severity={line.tone}>{line.text}</Alert>
		</View>
	);
};

/**
 * The consent card (RFC §5.2.3, §15.4' C4), drawn from the host's card read.
 *
 * Presentation safety, by construction: the non-sharing answer is listed FIRST
 * and nothing is pre-selected; closing the sheet (back, scrim, "Decide later")
 * is "Decide later" and sends nothing; and the controller ignores an answer in
 * the first 500 ms after the card renders. The sheet is opened only by the
 * member pressing "Review", never by arrival, so a prompt can't interrupt a
 * turn or take focus.
 */
export const GuardConsentSheet = ({
	controller,
}: {
	controller: GuardController;
}) => {
	const { consent } = useGuardState(controller);
	const open = consent.phase === "open" || consent.phase === "answering";
	const card: GuardConsentCard | null = open ? consent.card : null;
	const answering = consent.phase === "answering";
	const view = card === null ? null : consentView(card);
	const describable = card === null || allDescribable(card.asked_scopes);
	return (
		<Sheet
			visible={open && view !== null}
			onClose={controller.closeConsent}
			title={view?.title ?? ""}
			titleLines={2}
			testID={SURFACE.guardConsentSheet}
			footer={
				view === null ? undefined : view.answerable ? (
					<View className="gap-2">
						<Button
							testID={CONTROL.guardConsentDontShare}
							label={view.declineLabel}
							variant="outline"
							disabled={answering}
							onPress={() => void controller.decline()}
						/>
						<Button
							testID={CONTROL.guardConsentLater}
							label={view.laterLabel}
							variant="quiet"
							disabled={answering}
							onPress={controller.closeConsent}
						/>
						<Button
							testID={CONTROL.guardConsentShare}
							label={view.shareLabel}
							variant="outline"
							disabled={answering}
							onPress={() => void controller.share()}
						/>
					</View>
				) : (
					<Button
						testID={CONTROL.guardConsentLater}
						label={view.laterLabel}
						variant="quiet"
						onPress={controller.closeConsent}
					/>
				)
			}
		>
			{view === null ? null : (
				<View className="gap-3 py-2">
					{view.reasonLine !== null ? (
						<Text className="text-body text-ink">{view.reasonLine}</Text>
					) : null}
					<Text className="text-label text-ink">{view.wouldSend}</Text>
					<View className="gap-2">
						{view.scopeLines.map((line) => (
							<Text key={line} className="text-body-sm text-ink">
								{`• ${line}`}
							</Text>
						))}
					</View>
					<Text className="text-body-sm text-ink-muted">{view.neverSent}</Text>
					<Text className="text-body-sm text-ink-muted">{view.visibility}</Text>
					<Text className="text-body-sm text-ink-muted">{view.background}</Text>
					{!view.answerable ? (
						<Alert severity="info">
							{t(
								describable
									? "mobile.guard.consent_not_signable"
									: "mobile.guard.consent_needs_update",
							)}
						</Alert>
					) : null}
				</View>
			)}
		</Sheet>
	);
};

/** The stop-sharing confirm (§15.4' C2). A Sheet rather than the generic Dialog:
 *  C2's cancel is "Keep sharing", and the Dialog's is fixed to "Cancel". */
export const GuardRevokeSheet = ({
	org,
	backupDays,
	busy,
	onConfirm,
	onCancel,
}: {
	org: GuardOrg | null;
	backupDays: number | null;
	busy: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) => (
	<Sheet
		visible={org !== null}
		onClose={onCancel}
		title={org === null ? "" : t("mobile.guard.revoke_title", { org: org.org })}
		titleLines={2}
		testID={SURFACE.guardRevokeSheet}
		footer={
			<View className="gap-2">
				<Button
					testID={CONTROL.guardStopConfirm}
					label={t("mobile.guard.button_stop_sharing")}
					variant="danger"
					disabled={busy}
					onPress={onConfirm}
				/>
				<Button
					testID={CONTROL.guardStopKeep}
					label={t("mobile.guard.button_keep_sharing")}
					variant="quiet"
					disabled={busy}
					onPress={onCancel}
				/>
			</View>
		}
	>
		{org === null ? null : (
			<View className="gap-3 py-2">
				<Text className="text-body text-ink">
					{revokeBody(org, backupDays)}
				</Text>
				<Text className="text-body-sm text-ink-muted">
					{t("mobile.guard.revoke_retained")}
				</Text>
				<Text className="text-body-sm text-ink-muted">
					{t("mobile.guard.revoke_totals")}
				</Text>
			</View>
		)}
	</Sheet>
);

/** One org's status: the host's indicator sentence, what is shared, the
 *  computer, and only the actions the host's own predicates allow. */
export const GuardOrgCard = ({
	org,
	busy,
	onReview,
	onStop,
	onShareAgain,
}: {
	org: GuardOrg;
	busy: boolean;
	onReview: () => void;
	onStop: () => void;
	onShareAgain: () => void;
}) => {
	const actions = orgActions(org);
	const shared = orderedScopes(org.scopes_shared);
	// A request is answerable from the phone only when the host filed a card for
	// it; otherwise the member answers in the terminal and the phone offers no
	// answer (the org still reads as waiting).
	const reviewable = org.prompt?.approval_id != null;
	return (
		<View className="gap-2 rounded-md bg-elevated p-3">
			<Text className="text-label text-ink">{indicatorFor(org)}</Text>
			{shared.length > 0 ? (
				<View className="gap-1">
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.guard.shared_heading", { org: org.org })}
					</Text>
					<Text className="text-body-sm text-ink">
						{listLabels(shared.map(scopeLabel))}
					</Text>
				</View>
			) : null}
			{actions.length > 0 ? (
				<View className="flex-row flex-wrap gap-2 pt-1">
					{actions.includes("review") && reviewable ? (
						<Button
							testID={CONTROL.guardReview}
							label={t("mobile.guard.review")}
							variant="outline"
							size="sm"
							disabled={busy}
							onPress={onReview}
						/>
					) : null}
					{actions.includes("stop") ? (
						<Button
							testID={CONTROL.guardStop}
							label={t("mobile.guard.button_stop_sharing")}
							variant="outline"
							size="sm"
							disabled={busy}
							onPress={onStop}
						/>
					) : null}
					{actions.includes("share_again") ? (
						<Button
							testID={CONTROL.guardShareAgain}
							label={t("mobile.guard.button_share_again")}
							variant="outline"
							size="sm"
							disabled={busy}
							onPress={onShareAgain}
						/>
					) : null}
				</View>
			) : null}
		</View>
	);
};

/** The §14' non-Team card. Pure presentation: `nonTeamView` decided what shows. */
export const GuardNonTeamCardView = ({ view }: { view: NonTeamView }) => (
	<View
		className="gap-2 rounded-md bg-elevated p-3"
		testID={SURFACE.guardNonTeamCard}
	>
		<Text className="text-label text-ink">{view.title}</Text>
		<Text className="text-body-sm text-ink-muted">{view.body}</Text>
		{view.cta === "ask_owner" ? (
			<Text className="text-body-sm text-ink">
				{t("mobile.guard.card_ask_owner")}
			</Text>
		) : view.ctaLabel !== null && view.url !== null ? (
			<View className="items-start">
				<Button
					testID={CONTROL.guardNonTeamCta}
					label={view.ctaLabel}
					variant="outline"
					size="sm"
					onPress={() => {
						const url = view.url;
						if (url !== null) void Linking.openURL(url).catch(() => undefined);
					}}
				/>
			</View>
		) : null}
		<Text className="text-body-sm text-ink-muted">{view.footer}</Text>
	</View>
);
