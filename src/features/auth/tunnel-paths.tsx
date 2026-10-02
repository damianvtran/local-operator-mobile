import { Text, View } from "react-native";

import { CONTROL, ROLE } from "@/ui/a11y";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Card } from "@/ui/components/card";
import { SectionHeader } from "@/ui/components/section-header";

/**
 * The two ways to reach a computer, named on the screen where the choice is made.
 *
 * **Why the self-hosted path is a first-class choice and not a fallback.** The app
 * works with no Radient account at all; presenting that only as a hidden "custom
 * URL" field was the app keeping a documented capability to itself. So the choice
 * is stated, in order, with the honest cost of each:
 *
 *  - **Radient is first and recommended**, because it needs nothing configured and
 *    hands back a private, authenticated URL — the reader's real alternative is
 *    "configure a tunnel yourself", and they should know what that costs them.
 *  - **The own-tunnel path is second**, described as what it is: the advanced path
 *    for a computer you expose yourself, with no account anywhere in it.
 *
 * The Radient half is `children` rather than a copy of the setup steps: there is
 * one implementation of the Radient flow (`computers.tsx`'s `SetupComputer`), and
 * this component only decides what the reader reads before they meet it.
 */
export const TunnelPaths = ({
	children,
	onOwnTunnel,
}: {
	children: React.ReactNode;
	onOwnTunnel: () => void;
}) => (
	<View className="gap-4">
		<Card testID={CONTROL.radientPath}>
			<View className="gap-3">
				{/* `flex-wrap`: the title and the badge scale independently, and at 200 %
				 *  on a 320 pt phone they do not fit on one line — unwrapped, the row ran
				 *  to 390 px (`U-06`). */}
				<View className="flex-row flex-wrap items-center gap-2">
					<Text className="text-title text-ink" accessibilityRole={ROLE.header}>
						Connect with Radient
					</Text>
					{/* `neutral` because the tone vocabulary is the tokens' own
					 *  (`variants.ts`: neutral/success/warning/danger) and "recommended" is
					 *  not a status — the word carries it, not a colour invented here. */}
					<Badge label="Recommended" />
				</View>
				<Text className="text-body-sm text-ink-muted">
					Needs a Radient account. Radient runs the tunnel for you and gives you
					a private, authenticated URL, so there is nothing to configure on this
					phone and no relay password to keep.
				</Text>
				{children}
			</View>
		</Card>

		<Card testID={CONTROL.ownTunnelPath}>
			<View className="gap-3">
				<SectionHeader label="Set up your own tunnel" />
				<Text className="text-body-sm text-ink-muted">
					The advanced path: you publish your computer yourself, through a
					tunnel you run, and paste its address here. No Radient account is
					needed at any point, and you keep the password.
				</Text>
				<Button
					label="Use my own tunnel"
					onPress={onOwnTunnel}
					variant="outline"
					testID={CONTROL.ownTunnelPathAction}
				/>
			</View>
		</Card>
	</View>
);
