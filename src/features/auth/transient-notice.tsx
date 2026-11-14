import { useConnection } from "@/features/auth/connection-provider";
import { t } from "@/i18n";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { useComposedDir } from "@/ui/direction";

/**
 * The non-blocking notice for a failure the list stream is RETRYING and the
 * computer named (PR #261 Q3): a relay `503` with `server_unavailable`, or a
 * `wait_network` / `wait_radient` / `wait_reconnect` / `check_status` kind.
 *
 * Why a notice and not the refusal surface: the stream comes back by itself
 * on these (a backoff to 15 s, `reconnectDelay`), so blocking the screen would
 * take the reader's transcript away for a wait. But silence was worse — Home
 * showed a green check and the switcher "Online" while the computer was
 * saying "I can't reach Radient". So: the cause's own sentence, and Retry,
 * which reopens the stream now instead of waiting out the backoff. Renders
 * nothing when there is nothing to say.
 */
export const TransientNotice = () => {
	const { transient, retryTransient } = useConnection();
	/* The title often opens with the computer's Latin name; on an RTL page the
	 *  body states the page's base rather than `dir="auto"`'s guess. */
	const composedDir = useComposedDir();
	if (!transient) return null;
	return (
		<Alert
			severity="warning"
			title={transient.title}
			testID={SURFACE.transientNotice}
			bodyDir={composedDir}
			action={{
				label: t("mobile.refusal.action.retry"),
				onPress: retryTransient,
				testID: CONTROL.transientRetry,
			}}
		>
			{transient.body ?? ""}
		</Alert>
	);
};
