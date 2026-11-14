import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Text, View } from "react-native";

import { t } from "@/i18n";
import {
	deviceNudgeRecords,
	type NudgeWatch,
	watchNudge,
} from "@/notifications/denied-nudge";
import { readAvailability } from "@/notifications/native";
import { CONTROL } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { Card } from "@/ui/components/card";

/**
 * "Notifications are off · Turn on": the gentle nudge for a DENIED permission,
 * at the top of the drawer's session list. Self-contained — the pane renders
 * `<NotificationsOffRow />` and nothing else — so the list's own layout is not
 * touched. Every rule (native + denied only, 14-day snooze, three dismissals
 * at most, foreground re-read) lives in `notifications/denied-nudge.ts`.
 *
 * Presentation is the in-list notice card the Team Bridge default-on notice
 * uses (`Card inList`, small buttons), never a banner — the design kit's
 * Banner deliberately has no dismiss and is for a page's own failure — and
 * never a sheet: this is a nudge, not a gate.
 */
export const NotificationsOffRow = () => {
	const [visible, setVisible] = useState(false);
	const watch = useRef<NudgeWatch | null>(null);
	useEffect(() => {
		const current = watchNudge(
			{
				platform: Platform.OS,
				readAvailability,
				records: deviceNudgeRecords,
				now: () => Date.now(),
				openSettings: () => Linking.openSettings(),
				onForeground: (listener) => {
					const subscription = AppState.addEventListener("change", (state) => {
						if (state === "active") listener();
					});
					return () => subscription.remove();
				},
			},
			setVisible,
		);
		watch.current = current;
		return () => {
			current.stop();
			if (watch.current === current) watch.current = null;
		};
	}, []);
	if (!visible) return null;
	return (
		<View className="px-4 pt-2" testID={CONTROL.notificationsOffRow}>
			<Card inList>
				<View className="flex-row flex-wrap items-center gap-1.5">
					<Text className="min-w-0 flex-1 text-body-sm text-ink-muted">
						{t("mobile.notifications.off_nudge.message")}
					</Text>
					<View className="max-w-full shrink">
						<Button
							label={t("mobile.notifications.off_nudge.turn_on")}
							variant="outline"
							size="sm"
							testID={CONTROL.notificationsOffTurnOn}
							onPress={() =>
								void watch.current?.turnOn().catch(() => undefined)
							}
						/>
					</View>
					<View className="max-w-full shrink">
						<Button
							label={t("mobile.notifications.off_nudge.dismiss")}
							variant="quiet"
							size="sm"
							testID={CONTROL.notificationsOffDismiss}
							onPress={() => void watch.current?.dismiss()}
						/>
					</View>
				</View>
			</Card>
		</View>
	);
};
