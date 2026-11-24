/**
 * A member's card (frame M9) and the report flow (RFC §6.4).
 *
 * ONLY APPROVED PROFILE FIELDS. The card renders exactly what the server's
 * `Profile` carries: the member chose which Radient fields to show and each was
 * moderated before it is served. Email and organizations are never part of the
 * shape, so they cannot leak from here. The avatar is `MemberAvatar`, the same
 * mark every author line and People row shows (its header says why it is not
 * a photo yet).
 *
 * NOT HERE YET (design review round 1, D8): frame M9's Mute and "Request agent
 * contact". Both are follow-ups to this PR, recorded in its remediation reply.
 *
 * Message sends a DM REQUEST, not a message (RFC §5.7): the other person
 * accepts before anything can be sent, so the sheet says the request was sent
 * rather than opening a conversation that does not exist yet.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { type CommunityError, isCommunityError } from "@/community/client";
import type {
	Profile,
	RefusalCategory,
	ReportTargetKind,
} from "@/community/contract";
import { joinedMonthLabel } from "@/community/model";
import { useCommunity } from "@/community/provider";
import { useLocaleFrame } from "@/features/auth/connection-provider";
import { activeLocale, t } from "@/i18n";
import { CONTROL, communityReportCategoryId, ROLE, SURFACE } from "@/ui/a11y";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Sheet } from "@/ui/components/sheet";
import { Textarea } from "@/ui/components/textarea";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";
import { categoryLabel, errorSentence, roleLabel } from "./labels";
import { MemberAvatar } from "./member-avatar";
import { ConsentTick } from "./parts";

export function ProfileSheet({
	communityId,
	profile,
	onClose,
}: {
	communityId: string;
	profile: Profile | null;
	onClose: () => void;
}) {
	const { actions } = useCommunity();
	const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
		null,
	);
	const [busy, setBusy] = useState<"message" | "block" | null>(null);
	const [reporting, setReporting] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the subject id is a TRIGGER to clear the previous member's notice, not a read.
	useEffect(() => {
		setNotice(null);
		setReporting(false);
	}, [profile?.public_id]);
	const run = async (
		kind: "message" | "block",
		action: () => Promise<CommunityError | null>,
		ok: string,
	) => {
		setBusy(kind);
		const failure = await action();
		setBusy(null);
		setNotice(
			failure
				? { text: errorSentence(failure), error: true }
				: { text: ok, error: false },
		);
	};
	const badge = roleLabel(profile?.role);
	/* "Joined {month}" in the APP language, never raw `YYYY-MM` (R1-7). */
	useLocaleFrame();
	const locale = activeLocale();
	return (
		<>
			<Sheet
				visible={profile !== null && !reporting}
				onClose={onClose}
				title={t("mobile.community.profile.title")}
				testID={SURFACE.communityProfileSheet}
			>
				{profile ? (
					<View className="gap-3 pb-3">
						<View className="flex-row items-center gap-3">
							<MemberAvatar name={profile.display_name} size="lg" />
							<View className="min-w-0 flex-1 gap-0.5">
								<Text
									className="text-label font-semibold text-ink"
									numberOfLines={2}
								>
									{profile.display_name}
								</Text>
								{profile.title ? (
									<Text className="text-body-sm text-ink-muted">
										{profile.title}
									</Text>
								) : null}
							</View>
						</View>
						{badge || profile.joined_month ? (
							<View className="flex-row flex-wrap items-center gap-2">
								{badge ? <Badge label={badge} tone="info" /> : null}
								{profile.joined_month ? (
									<Text className="text-meta text-ink-dim">
										{t("mobile.community.profile.joined", {
											month: joinedMonthLabel(profile.joined_month, locale),
										})}
									</Text>
								) : null}
							</View>
						) : null}
						{profile.description ? (
							<Text className="text-body-sm text-ink">
								{profile.description}
							</Text>
						) : null}
						<Button
							label={t("mobile.community.profile.message")}
							loading={busy === "message"}
							onPress={() =>
								void run(
									"message",
									() => actions.requestDm(communityId, profile.public_id),
									t("mobile.community.profile.message_sent"),
								)
							}
							testID={CONTROL.communityProfileMessage}
						/>
						<View className="flex-row gap-2">
							<View className="flex-1">
								<Button
									label={t("mobile.community.profile.block")}
									variant="outline"
									loading={busy === "block"}
									onPress={() =>
										void run(
											"block",
											() => actions.block(communityId, profile.public_id),
											t("mobile.community.profile.blocked"),
										)
									}
									testID={CONTROL.communityProfileBlock}
								/>
							</View>
							<View className="flex-1">
								<Button
									label={t("mobile.community.profile.report")}
									variant="outline"
									onPress={() => setReporting(true)}
									testID={CONTROL.communityProfileReport}
								/>
							</View>
						</View>
						{notice ? (
							<Text
								accessibilityRole={notice.error ? ROLE.alert : undefined}
								className={cx(
									"text-body-sm",
									notice.error ? "text-danger" : "text-ink-muted",
								)}
							>
								{notice.text}
							</Text>
						) : null}
					</View>
				) : null}
			</Sheet>
			<ReportSheet
				communityId={communityId}
				target={
					reporting && profile
						? { kind: "profile", id: profile.public_id }
						: null
				}
				onClose={() => setReporting(false)}
			/>
		</>
	);
}

/** The contract's cap on a report note (`ReportCreate.note` maxLength). */
const REPORT_NOTE_MAX_CHARS = 1000;

const CATEGORIES: readonly RefusalCategory[] = [
	"unsafe_or_illegal",
	"harassment_or_abuse",
	"spam_or_promotion",
	"private_information",
];

/**
 * What a report targets. A DM message carries the revision the reporter read:
 * the server copies exactly that revision into the case (RFC §6.4).
 */
export type ReportTarget =
	| { kind: Exclude<ReportTargetKind, "dm">; id: string }
	| { kind: "dm"; id: string; revision: number };

/**
 * Report a message, profile, channel or DM message to Radient Trust & Safety.
 *
 * ONE SHEET = ONE IDEMPOTENCY KEY (review round 1, R1-1). The key is minted on
 * the first submit and reused by every later submit of the same report: a
 * submit whose answer was lost may already have opened a case, and a fresh key
 * would open a second. A new target is a new report and a new key.
 *
 * A DM MESSAGE NEEDS CONSENT. The reporter must tick that the message goes to
 * Radient Trust & Safety (and never to community moderators) before Submit is
 * enabled; the body then carries `dm_consent: true` and the revision on screen.
 * If the sender edited it meanwhile the server answers 409 `revision_changed`
 * and stores nothing: the sheet asks the reporter to re-read, the caller
 * refreshes the history, and the consent is cleared because it was given for
 * text that is no longer there. A re-consented report is a new report with a
 * new key.
 */
export function ReportSheet({
	communityId,
	target,
	onClose,
	onRevisionChanged,
}: {
	communityId: string;
	target: ReportTarget | null;
	onClose: () => void;
	/** `dm` only: re-read the history so the sheet shows the current revision. */
	onRevisionChanged?: () => void;
}) {
	const { actions } = useCommunity();
	const [category, setCategory] = useState<RefusalCategory | null>(null);
	const [note, setNote] = useState("");
	const [consent, setConsent] = useState(false);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<{ text: string; error: boolean } | null>(
		null,
	);
	const key = useRef<string | null>(null);
	const dm = target?.kind === "dm";
	const revision = target?.kind === "dm" ? target.revision : null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: the target is a TRIGGER to start a fresh report, not a read.
	useEffect(() => {
		setCategory(null);
		setNote("");
		setConsent(false);
		setResult(null);
		key.current = null;
	}, [target?.kind, target?.id]);
	/* Consent is to ONE revision: a newer one on screen needs a new tick. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is a TRIGGER.
	useEffect(() => {
		setConsent(false);
	}, [revision]);
	const sent = result !== null && !result.error;
	const ready = Boolean(category) && (!dm || consent);
	const submit = async () => {
		if (!target || !category || busy || sent || (dm && !consent)) return;
		setBusy(true);
		key.current ??= await actions.reportKey();
		const outcome = await actions.report(communityId, {
			targetKind: target.kind,
			targetId: target.id,
			category,
			note,
			...(target.kind === "dm"
				? { dmConsent: true, revision: target.revision }
				: {}),
			idempotencyKey: key.current,
		});
		setBusy(false);
		if (outcome && !isCommunityError(outcome)) {
			setResult({
				text: t("mobile.community.report.sent", {
					reference: outcome.reference,
				}),
				error: false,
			});
			return;
		}
		if (outcome?.kind === "conflict" && outcome.code === "revision_changed") {
			/* Nothing was stored under this key; the re-consented report is new. */
			key.current = null;
			setConsent(false);
			onRevisionChanged?.();
			setResult({
				text: t("mobile.community.report.revision_changed"),
				error: true,
			});
			return;
		}
		setResult({ text: t("mobile.community.report.failed"), error: true });
	};
	return (
		<Sheet
			visible={target !== null}
			onClose={onClose}
			title={t("mobile.community.report.title")}
			testID={SURFACE.communityReportSheet}
		>
			<View className="gap-3 pb-3">
				<View
					accessibilityRole={ROLE.radiogroup}
					accessibilityLabel={t("mobile.community.report.category")}
					className="gap-1"
				>
					{CATEGORIES.map((value) => {
						const chosen = value === category;
						return (
							<Pressable
								key={value}
								accessibilityRole={ROLE.radio}
								accessibilityState={{ checked: chosen, disabled: sent }}
								disabled={sent}
								onPress={() => setCategory(value)}
								testID={communityReportCategoryId(value)}
								style={{ minHeight: TOUCH_FLOOR }}
							>
								<View
									className={cx(
										"flex-1 flex-row items-center gap-3 rounded-sm px-3 py-2",
										chosen ? "bg-row-selected" : "bg-transparent",
									)}
								>
									<View
										aria-hidden
										className={cx(
											"h-4 w-4 rounded-full border",
											chosen
												? "border-accent bg-accent"
												: "border-border-control",
										)}
									/>
									<Text className="text-body text-ink">
										{categoryLabel(value)}
									</Text>
								</View>
							</Pressable>
						);
					})}
				</View>
				<Textarea
					label={t("mobile.community.report.note")}
					value={note}
					onChangeText={setNote}
					disabled={sent}
					maxLength={REPORT_NOTE_MAX_CHARS}
					testID={CONTROL.communityReportNote}
				/>
				{dm ? (
					<ConsentTick
						checked={consent}
						label={t("mobile.community.report.dm_consent")}
						onToggle={() => setConsent((value) => !value)}
						disabled={sent}
						testID={CONTROL.communityReportConsent}
					/>
				) : null}
				<Button
					label={t("mobile.community.report.submit")}
					disabled={!ready || sent}
					loading={busy}
					onPress={() => void submit()}
					testID={CONTROL.communityReportSubmit}
				/>
				{result ? (
					<Text
						accessibilityRole={result.error ? ROLE.alert : undefined}
						className={cx(
							"text-body-sm",
							result.error ? "text-danger" : "text-ink-muted",
						)}
					>
						{result.text}
					</Text>
				) : null}
			</View>
		</Sheet>
	);
}
