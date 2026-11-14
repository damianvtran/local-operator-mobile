import { t } from "@/i18n";

/**
 * Settings' account title: the signed-in identity the live route admitted with
 * (`ConnectionSnapshot.accountLabel`, an email or display name — never a token),
 * or the "Not signed in with Radient" fallback when there is none.
 *
 * A plain function, not inline JSX, so `connection-provider.test.ts` can drive
 * the same expression the screen renders from a real route admission: Node
 * cannot import Settings' styling stack. The label itself is set at the source —
 * `routeAdmission` reads the Radient grant's `account_label` — never special-cased
 * here (PR #261 design round 2: every Radient user was shown the fallback).
 */
export const settingsAccountTitle = (accountLabel: string | null): string =>
	accountLabel ?? t("mobile.settings.account.not_signed_in");

/**
 * What Settings' account avatar takes its initials FROM: the label, but only the
 * local part of an email.
 *
 * Why (PR #262 design D1): `initialsOf` splits on `@` and `.` as word breaks, so
 * an email label gave the second initial to the mail provider —
 * `damian@gominerva.com` → "DG", every Gmail user "?G". The local part keeps the
 * mark about the person (`qa` → "QA", `first.last` → "FL", `damian` → "DA") and
 * display names pass through unchanged ("Damian Tran" → "DT"). An address with
 * nothing before the `@` keeps the whole label rather than an empty mark.
 */
export const settingsAccountInitialsSource = (accountLabel: string): string => {
	const at = accountLabel.indexOf("@");
	return at > 0 ? accountLabel.slice(0, at) : accountLabel;
};
