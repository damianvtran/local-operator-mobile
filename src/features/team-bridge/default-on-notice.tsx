import { useState } from "react";
import { Text, View } from "react-native";
import type { DefaultOnNotice } from "@/team-bridge/model";
import { CONTROL, ROLE, SURFACE } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { Card } from "@/ui/components/card";
import { defaultOnNoticeCopy as copy } from "./default-on-notice-copy";

/**
 * The one-time "Team Bridge is on for you" notice (consent v2, default-on).
 *
 * Presentation only. A banner in the flow, never a dialog or sheet: the person
 * is on the tab to read messages, and a modal would make a notice about a
 * default into a gate. There is deliberately NO Enable control here or anywhere
 * on this path — the notice reports a state the server already set, and the
 * only mutation it offers is leaving it ("Turn off"). The consent text is shown
 * verbatim and in place.
 *
 * This file stays free of the provider (expo-router, native modules) so a unit
 * test can render it in Node; the connected wrapper lives in
 * `default-on-notice-banner.tsx`.
 */
export function DefaultOnNoticeView({
	notice,
	failed,
	busy,
	defaultExpanded = false,
	onTurnOff,
	onDismiss,
}: {
	notice: DefaultOnNotice;
	failed: boolean;
	busy: boolean;
	/** Test seam: static markup cannot press "Read what this means", so a test opens it. */
	defaultExpanded?: boolean;
	onTurnOff: () => void;
	onDismiss: () => void;
}) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	return (
		<View className="px-4 pt-2" testID={SURFACE.teamBridgeDefaultOnNotice}>
			<Card>
				<View className="gap-3" role={ROLE.status}>
					<Text className="text-title text-ink" accessibilityRole={ROLE.header}>
						{copy("mobile.team_bridge.default_on.title")}
					</Text>
					<Text className="text-body text-ink-muted">
						{copy("mobile.team_bridge.default_on.body")}
					</Text>
					{expanded && (
						<Text
							className="text-body-sm text-ink"
							selectable
							testID={SURFACE.teamBridgeNoticeText}
						>
							{notice.text}
						</Text>
					)}
					{failed && (
						<Text
							className="text-body-sm text-danger"
							accessibilityRole={ROLE.alert}
							testID={SURFACE.teamBridgeNoticeError}
						>
							{copy("mobile.team_bridge.default_on.turn_off_error")}
						</Text>
					)}
				</View>
				<View className="mt-3 flex-row flex-wrap items-center gap-2">
					<Button
						label={copy("mobile.team_bridge.default_on.turn_off")}
						variant="outline"
						loading={busy}
						testID={CONTROL.teamBridgeNoticeTurnOff}
						onPress={onTurnOff}
					/>
					<Button
						label={
							expanded
								? copy("mobile.team_bridge.default_on.hide")
								: copy("mobile.team_bridge.default_on.read_more")
						}
						variant="quiet"
						testID={CONTROL.teamBridgeNoticeRead}
						onPress={() => setExpanded((open) => !open)}
					/>
					<Button
						label={copy("mobile.team_bridge.default_on.dismiss")}
						variant="quiet"
						accessibilityHint={copy(
							"mobile.team_bridge.default_on.dismiss_hint",
						)}
						disabled={busy}
						testID={CONTROL.teamBridgeNoticeDismiss}
						onPress={onDismiss}
					/>
				</View>
			</Card>
		</View>
	);
}
