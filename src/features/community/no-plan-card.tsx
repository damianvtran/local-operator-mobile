/**
 * "Join the Local Operator Community" on the no-Team-plan screen (RFC v2.4
 * §5.1; frame M4).
 *
 * ALWAYS OFFERED, NEVER COMMERCIAL. The RFC keeps the free community join on
 * every no-plan path, and billing state never disables it. This card is the
 * only community affordance on that screen; the private plan copy above it is
 * unchanged, including the native rule that the phone shows NO purchase or
 * trial affordance (store companion-app rules; see `gate.tsx`). So the "trial
 * hold" on a phone is the existing one: no trial button natively, and the
 * community join regardless.
 *
 * Which community: the first one this account joined (then the button opens
 * it), else the first featured one. With neither — the deployment is dark, or
 * the read failed — nothing is drawn: a join button that can only 404 would be
 * a promise the server cannot keep.
 */
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { communityEnabled } from "@/community/flag";
import { useCommunity, useCommunityState } from "@/community/provider";
import { t } from "@/i18n";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { Card } from "@/ui/components/card";
import { JoinSheet } from "./join-sheet";

export function CommunityNoPlanCard() {
	const router = useRouter();
	const { actions } = useCommunity();
	const enabled = communityEnabled();
	const list = useCommunityState((s) => s.communities);
	const [joining, setJoining] = useState(false);
	useEffect(() => {
		if (enabled && list.state === "idle") void actions.loadCommunities();
	}, [enabled, list.state, actions]);
	if (!enabled) return null;
	const joined = list.data.joined[0];
	const target = joined ?? list.data.featured[0];
	if (!target) return null;
	const open = () => {
		actions.select({ kind: "community", communityId: target.id });
		router.push(`/community/${encodeURIComponent(target.id)}` as never);
	};
	return (
		<Card testID={SURFACE.communityNoPlanCard}>
			<View className="gap-3">
				<Text className="text-label font-semibold text-ink">
					{t("mobile.community.no_plan.title")}
				</Text>
				<Text className="text-body text-ink-muted">
					{t("mobile.community.no_plan.body")}
				</Text>
				<Button
					label={
						joined
							? t("mobile.community.no_plan.open")
							: t("mobile.community.no_plan.join")
					}
					variant="outline"
					onPress={() => (joined ? open() : setJoining(true))}
					testID={CONTROL.communityNoPlanJoin}
				/>
				<Text className="text-meta text-ink-dim">
					{t("mobile.community.no_plan.free")}
				</Text>
			</View>
			<JoinSheet
				communityId={target.id}
				visible={joining}
				onClose={() => setJoining(false)}
				onJoined={open}
			/>
		</Card>
	);
}
