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
			<Card inList>
				<View className="gap-1" role={ROLE.status}>
					<Text
						className="text-label font-semibold text-ink"
						accessibilityRole={ROLE.header}
					>
						{copy("mobile.team_bridge.default_on.title")}
					</Text>
					<Text className="text-body-sm text-ink-muted">
						{copy("mobile.team_bridge.default_on.body")}
					</Text>
				</View>
				{/* Bound each action to the card: wrapping the row alone still lets a
				 * long localized/200% label keep its unbounded intrinsic width. */}
				<View className="mt-2 flex-row flex-wrap items-center gap-1.5">
					<View className="max-w-full shrink">
						<Button
							label={copy("mobile.team_bridge.default_on.turn_off")}
							variant="outline"
							size="sm"
							loading={busy}
							testID={CONTROL.teamBridgeNoticeTurnOff}
							onPress={onTurnOff}
						/>
					</View>
					<View className="max-w-full shrink">
						<Button
							label={
								expanded
									? copy("mobile.team_bridge.default_on.hide")
									: copy("mobile.team_bridge.default_on.read_more")
							}
							variant="quiet"
							size="sm"
							testID={CONTROL.teamBridgeNoticeRead}
							onPress={() => setExpanded((open) => !open)}
						/>
					</View>
					<View className="max-w-full shrink">
						<Button
							label={copy("mobile.team_bridge.default_on.dismiss")}
							variant="quiet"
							size="sm"
							accessibilityLabel={copy(
								"mobile.team_bridge.default_on.dismiss_label",
							)}
							accessibilityHint={copy(
								"mobile.team_bridge.default_on.dismiss_hint",
							)}
							disabled={busy}
							testID={CONTROL.teamBridgeNoticeDismiss}
							onPress={onDismiss}
						/>
					</View>
				</View>
				{/* Controls precede unbounded served text so opting out stays reachable. */}
				{(expanded || failed) && (
					<View className="mt-2 gap-2">
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
				)}
			</Card>
		</View>
	);
}
