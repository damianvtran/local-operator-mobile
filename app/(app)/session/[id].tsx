import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";

import { CONTROL, EMPTY, SCREEN } from "@/ui/a11y";
import { EmptyState, IconButton, Screen } from "@/ui/components";

/**
 * A session: transcript, composer, and the cards pinned above it. The projection
 * store and the transcript renderer are the session stream's; this route proves
 * the navigation shape. It does not read `id` yet: the session stream reads it
 * with `useLocalSearchParams` when there is a projection to look up.
 */
export default function Session() {
	const router = useRouter();
	return (
		<Screen
			title="Session"
			testID={SCREEN.session}
			headerLeading={
				<IconButton
					accessibilityLabel="Back"
					testID={CONTROL.sessionBack}
					onPress={() => router.back()}
					icon={({ color, size }) => <ArrowLeft color={color} size={size} />}
				/>
			}
		>
			<EmptyState
				headline="This session is not connected yet."
				next="Open it from the session list once a computer is connected."
				testID={EMPTY.session}
			/>
		</Screen>
	);
}
