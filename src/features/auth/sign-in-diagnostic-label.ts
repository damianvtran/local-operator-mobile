import { t } from "@/i18n";

// The stored trail remains stable technical identifiers for support. Translate
// only at presentation time so changing locale also updates an open disclosure.
const LABELS = {
	idle: "mobile.signin.stage_idle",
	starting: "mobile.signin.stage_starting",
	"waiting-for-browser": "mobile.signin.stage_browser",
	exchanging: "mobile.signin.stage_exchanging",
	cancelled: "mobile.signin.stage_cancelled",
	unavailable: "mobile.signin.stage_unavailable",
	retiring: "mobile.signin.stage_retiring",
	persisting: "mobile.signin.stage_persisting",
	discovering: "mobile.signin.stage_discovering",
	"signed-in": "mobile.signin.stage_signed_in",
	failed: "mobile.signin.stage_failed",
} as const;
export function signInDiagnosticLabel(stage: string): string {
	return t(LABELS[stage as keyof typeof LABELS] ?? LABELS.failed);
}
