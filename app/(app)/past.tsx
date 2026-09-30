import { EMPTY, SCREEN } from "@/ui/a11y";
import { EmptyState, Screen } from "@/ui/components";

/**
 * Past sessions and search (docs/ux/flows.md F-8). Lazy history is a paged call
 * into `/api/sessions/{id}/history`, so the list arrives with the relay client.
 */
export default function PastSessions() {
	return (
		<Screen title="Past sessions" testID={SCREEN.past}>
			<EmptyState
				headline="Nothing here yet."
				next="Sessions you have finished appear here, and you can search them."
				testID={EMPTY.past}
			/>
		</Screen>
	);
}
