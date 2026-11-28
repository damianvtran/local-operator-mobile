import { View } from "react-native";
import { pendingPrompts, promptReasonLine } from "@/features/guard/guard-model";
import { GuardText } from "@/features/guard/guard-text";
import {
	GuardConsentSheet,
	GuardOutcomeAlert,
} from "@/features/guard/guard-views";
import {
	useGuardAvailability,
	useGuardController,
	useGuardState,
} from "@/features/guard/use-guard";
import { t } from "@/i18n";
import type { RelayEndpoints } from "@/relay";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { SectionHeader } from "@/ui/components/section-header";
import { useComposedDir } from "@/ui/direction";

/**
 * The inbox's Radient Guard item (RFC v0.9 §5.2.3, slice M1).
 *
 * A pending Guard consent request is a host-level fact about a COMPUTER, so it
 * lives here, in the notifications inbox, and in Settings → Radient Guard — never
 * in `session/[id]`, where it could interrupt or look like part of a turn.
 *
 * It is NOT a notification-store item: that store is what the relay's push
 * pipeline reads, and Guard sends no push (RFC §5.2.3). This row is drawn from
 * the host's Guard status read, so it adds nothing to the unread count, the app
 * badge or any notification category. It appears only while the host says a
 * request is waiting, never takes focus when it arrives, and opens the card only
 * when the member presses "Review".
 *
 * A failed read draws nothing: the inbox must not grow an error band for a
 * secondary item; Settings → Radient Guard is where a read failure is stated.
 */
const GuardInboxBody = ({ client }: { client: RelayEndpoints }) => {
	const controller = useGuardController(client, { readCard: false });
	const state = useGuardState(controller);
	const composedDir = useComposedDir();
	const pending =
		state.read.kind === "ready" ? pendingPrompts(state.read.status) : [];
	if (pending.length === 0 && state.outcome === null) return null;
	return (
		<View className="gap-2 px-4 pt-3" testID={SURFACE.guardInboxRow}>
			<SectionHeader
				label={t("mobile.guard.screen_title")}
				labelDir={composedDir}
			/>
			{/* ABOVE the request, not below it (UX U7): "{org} changed this request.
			 *  Check the new one below" must point down at the new card, and an
			 *  outcome under the request it refers to pointed at nothing. */}
			{state.outcome !== null ? (
				<GuardOutcomeAlert outcome={state.outcome} />
			) : null}
			{pending.map((org) => {
				const prompt = org.prompt;
				if (prompt === null) return null;
				const reason = promptReasonLine(
					prompt.reason,
					org.org,
					prompt.asked_scopes.filter((scope) => scope !== ""),
				);
				return (
					<View key={org.tenant} className="gap-2 rounded-md bg-elevated p-3">
						<GuardText className="text-label text-ink">
							{t("mobile.guard.prompt_title", { org: org.org })}
						</GuardText>
						{reason !== null ? (
							<GuardText className="text-body-sm text-ink-muted">
								{reason}
							</GuardText>
						) : null}
						{prompt.approval_id !== null ? (
							<View className="items-start">
								<Button
									testID={CONTROL.guardReview}
									label={t("mobile.guard.review")}
									variant="outline"
									size="sm"
									disabled={state.busy !== null}
									onPress={() => void controller.openConsent(org.tenant)}
								/>
							</View>
						) : null}
					</View>
				);
			})}
			<GuardConsentSheet controller={controller} />
		</View>
	);
};

export const GuardInboxItem = () => {
	const availability = useGuardAvailability();
	// Older host, offline, or not yet known: no Guard request is made and nothing
	// is drawn. (A non-Team account's host answers a local status with no orgs.)
	if (availability.kind !== "ready") return null;
	return <GuardInboxBody client={availability.client} />;
};
