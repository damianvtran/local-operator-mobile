import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";

import { CONTROL, EMPTY, SCREEN } from "@/ui/a11y";
import { EmptyState, IconButton, Screen } from "@/ui/components";

/**
 * A subagent's own view (docs/ux/flows.md F-7), reached from a row in the parent
 * transcript. The nested route is `/session/<id>/agent/<jobId>` so the drill-in
 * keeps its parent in the path and Back is unambiguous. The shell does not read
 * `id`/`jobId` yet; the subagent stream does, when there is a transcript to load.
 */
export default function Subagent() {
	const router = useRouter();
	return (
		<Screen
			title="Subagent"
			testID={SCREEN.subagent}
			headerLeading={
				<IconButton
					accessibilityLabel="Back"
					testID={CONTROL.subagentBack}
					onPress={() => router.back()}
					icon={({ color, size }) => <ArrowLeft color={color} size={size} />}
				/>
			}
		>
			<EmptyState
				headline="No transcript for this subagent yet."
				next="It appears here once the session is streaming."
				testID={EMPTY.subagent}
			/>
		</Screen>
	);
}
