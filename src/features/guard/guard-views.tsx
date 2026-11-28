import { useEffect, useRef } from "react";
import {
	AccessibilityInfo,
	findNodeHandle,
	Linking,
	Platform,
	View,
} from "react-native";

import { t } from "@/i18n";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Sheet } from "@/ui/components/sheet";
import { useComposedDir } from "@/ui/direction";
import { DURATIONS } from "@/ui/tokens.gen";
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
import { GuardText } from "./guard-text";
import { useGuardState } from "./use-guard";

/** The sentence under a write. A polite live region: it reports a result the
 *  reader just caused, and must not steal focus when a REQUEST arrives (RFC
 *  §5.2.3).
 *
 *  Focus, after the member's OWN act (UX U5, PR #402): Share, Stop sharing and
 *  Share again each unmount the control that was pressed (the row's Review, the
 *  org's Stop), so keyboard focus fell to `<body>` and the next Tab restarted at
 *  the top of the screen. The outcome takes focus instead, but only when focus
 *  was actually lost (web) — a sheet that returns focus to a control that still
 *  exists keeps its own return — after the sheet's exit animation has had its
 *  turn. On a phone the screen reader's cursor moves to the same line. */
export const GuardOutcomeAlert = ({
	outcome,
}: {
	outcome: Exclude<GuardOutcome, null>;
}) => {
	const line = outcomeLine(outcome);
	const composedDir = useComposedDir();
	const ref = useRef<View>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the outcome OBJECT is the trigger — a new result (even with identical text) re-focuses.
	useEffect(() => {
		const timer = setTimeout(() => {
			const node = ref.current;
			if (node === null) return;
			if (Platform.OS === "web") {
				const active = document.activeElement;
				if (active !== null && active !== document.body) return;
				(node as unknown as HTMLElement).focus({ preventScroll: true });
				return;
			}
			const handle = findNodeHandle(node);
			if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
		}, DURATIONS.fast + 40);
		return () => clearTimeout(timer);
	}, [outcome]);
	return (
		<View
			ref={ref}
			focusable
			tabIndex={-1}
			testID={SURFACE.guardOutcome}
			accessibilityLiveRegion="polite"
		>
			<Alert severity={line.tone} bodyDir={composedDir}>
				{line.text}
			</Alert>
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
	/* The heading and the body lines open with a Latin org name or `Guard` in
	 *  Urdu; each states the page's base (see `GuardText`). */
	const composedDir = useComposedDir();
	const approvalId = card?.approval_id ?? null;
	/* The 500 ms debounce counts from when the card is INTERACTIVE: the sheet
	 *  rises over `DURATIONS.slow`, so the stamp is renewed once that is spent
	 *  (security S-1). Keyed on the card, not the phase, so answering does not
	 *  restart it. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `controller` is stable per client; the card id is the trigger.
	useEffect(() => {
		if (approvalId === null) return;
		const timer = setTimeout(controller.consentShown, DURATIONS.slow);
		return () => clearTimeout(timer);
	}, [approvalId]);
	return (
		<Sheet
			titleDir={composedDir}
			visible={open && view !== null}
			onClose={controller.closeConsent}
			title={view?.title ?? ""}
			/* FULL height, three title lines (design D1/D2, UX U3, PR #402). At the
			 *  default 0.6 detent the pinned three-button footer and a two-line title
			 *  left the disclosure a 120 pt window at 320 pt wide — 3.7 to 5.7 bands
			 *  of scrolling while all three answers stayed live — and at 200 % text
			 *  the title ellipsised past the asking organisation. The privacy
			 *  sentences are what the member is consenting to: they get the room, not
			 *  a read-through gate (Share and Don't share stay equal). The third
			 *  title line keeps the org name and the verb visible in Urdu at 320. */
			detent="full"
			titleLines={3}
			closeDisabled={answering}
			testID={SURFACE.guardConsentSheet}
			footer={
				view === null ? undefined : view.answerable ? (
					<View className="gap-2">
						{answering ? (
							/* The existing "Working…" line (core paints it before the
							 *  request too): without it a slow link looked like three
							 *  dead buttons (UX U4). */
							<GuardText
								className="text-body-sm text-ink-muted"
								accessibilityLiveRegion="polite"
							>
								{t("mobile.guard.screen_working")}
							</GuardText>
						) : null}
						<Button
							testID={CONTROL.guardConsentDontShare}
							label={view.declineLabel}
							variant="outline"
							loading={
								consent.phase === "answering" && consent.answer === "decline"
							}
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
							loading={
								consent.phase === "answering" && consent.answer === "share"
							}
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
						<GuardText className="text-body text-ink">
							{view.reasonLine}
						</GuardText>
					) : null}
					<GuardText className="text-label text-ink">
						{view.wouldSend}
					</GuardText>
					<View className="gap-2">
						{view.scopeLines.map((line) => (
							<GuardText key={line} className="text-body-sm text-ink">
								{`• ${line}`}
							</GuardText>
						))}
					</View>
					<GuardText className="text-body-sm text-ink-muted">
						{view.neverSent}
					</GuardText>
					<GuardText className="text-body-sm text-ink-muted">
						{view.visibility}
					</GuardText>
					<GuardText className="text-body-sm text-ink-muted">
						{view.background}
					</GuardText>
					{!view.answerable ? (
						<Alert severity="info" bodyDir={composedDir}>
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
				<GuardText className="text-body text-ink">
					{revokeBody(org, backupDays)}
				</GuardText>
				<GuardText className="text-body-sm text-ink-muted">
					{t("mobile.guard.revoke_retained")}
				</GuardText>
				<GuardText className="text-body-sm text-ink-muted">
					{t("mobile.guard.revoke_totals")}
				</GuardText>
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
	const indicator = indicatorFor(org);
	const nameIt = org.org !== "" && !indicator.includes(org.org);
	/* Each button's accessible name carries the org, so "Share again" is not
	 *  announced three times with nothing to tell the cards apart (UX U6). Joined
	 *  with the existing label and the org's own name: no new catalogue string
	 *  (a bridged phrase is proposed for the copy pass in PR #402). */
	const named = (label: string) =>
		org.org === "" ? label : `${label}, ${org.org}`;
	return (
		<View className="gap-2 rounded-md bg-elevated p-3">
			{/* The org's NAME heads a card whose indicator does not say it (UX U6):
			 *  "Guard: paused, you stopped sharing" names no org, so with several
			 *  orgs the member could not tell which one "Share again" re-asks. It is
			 *  data, not a catalogue string; where the indicator already names the
			 *  org ("Guard: sharing with X") a heading would only repeat it. */}
			{nameIt ? (
				<GuardText accessibilityRole="header" className="text-label text-ink">
					{org.org}
				</GuardText>
			) : null}
			<GuardText className="text-label text-ink">{indicator}</GuardText>
			{shared.length > 0 ? (
				<View className="gap-1">
					<GuardText className="text-body-sm text-ink-muted">
						{t("mobile.guard.shared_heading", { org: org.org })}
					</GuardText>
					<GuardText className="text-body-sm text-ink">
						{listLabels(shared.map(scopeLabel))}
					</GuardText>
				</View>
			) : null}
			{actions.length > 0 ? (
				<View className="flex-row flex-wrap gap-2 pt-1">
					{actions.includes("review") && reviewable ? (
						<Button
							testID={CONTROL.guardReview}
							label={t("mobile.guard.review")}
							accessibilityLabel={named(t("mobile.guard.review"))}
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
							accessibilityLabel={named(t("mobile.guard.button_stop_sharing"))}
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
							accessibilityLabel={named(t("mobile.guard.button_share_again"))}
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
		<GuardText className="text-label text-ink">{view.title}</GuardText>
		<GuardText className="text-body-sm text-ink-muted">{view.body}</GuardText>
		{view.cta === "ask_owner" ? (
			<GuardText className="text-body-sm text-ink">
				{t("mobile.guard.card_ask_owner")}
			</GuardText>
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
		<GuardText className="text-body-sm text-ink-muted">{view.footer}</GuardText>
	</View>
);
