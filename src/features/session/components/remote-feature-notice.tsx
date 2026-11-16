import { Text, View } from "react-native";
import { t } from "@/i18n";
import { SURFACE } from "@/ui/a11y";

/** v1 exposes retained DocumentContent, not owner-cwd-dependent supplements.
 * Explain the missing Highlights/generated-file controls rather than presenting
 * actions whose bytes are neither retained nor authorized by this protocol. */
export function RemoteFeatureNotice({ remote }: { remote: boolean }) {
	if (!remote) return null;
	return (
		<View className="px-4 py-2" testID={SURFACE.remoteRetainedOnlyNotice}>
			<Text className="text-body-sm text-ink-muted">
				{t("mobile.remote_sessions.retained_only")}
			</Text>
		</View>
	);
}
