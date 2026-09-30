import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";

import { SCREEN } from "@/ui/a11y";
import { EmptyState, IconButton, Screen } from "@/ui/components";

/**
 * A session: transcript, composer, and the cards pinned above it. The projection
 * store and the transcript renderer are the session stream's; this route proves
 * the navigation shape and the parameter contract (`/session/<id>`).
 */
export default function Session() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const router = useRouter();
	return (
		<Screen
			title="Session"
			testID={SCREEN.session}
			headerLeading={
				<IconButton
					accessibilityLabel="Back"
					onPress={() => router.back()}
					icon={({ color, size }) => <ArrowLeft color={color} size={size} />}
				/>
			}
		>
			<EmptyState
				headline="This session is not connected yet."
				next="Open it from the session list once a computer is connected."
				testID={`session-empty-${id ?? "none"}`}
			/>
		</Screen>
	);
}
