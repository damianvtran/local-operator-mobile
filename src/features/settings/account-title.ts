import { t } from "@/i18n";

/**
 * Settings' account title: the signed-in identity the live route admitted with
 * (`ConnectionSnapshot.accountLabel`, an email or display name — never a token),
 * or the "Not signed in with Radient" fallback when there is none.
 *
 * A plain function, not inline JSX, so `account-title.test.ts` can drive the
 * same expression the screen renders from a real route admission: Node cannot
 * import Settings' styling stack. The label itself is set at the source —
 * `routeAdmission` reads the Radient grant's `account_label` — never special-cased
 * here (PR #261 design round 2: every Radient user was shown the fallback).
 */
export const settingsAccountTitle = (accountLabel: string | null): string =>
	accountLabel ?? t("mobile.settings.account.not_signed_in");
