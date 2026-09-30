import { SCREEN } from "@/ui/a11y";
import { EmptyState, Screen } from "@/ui/components";

/**
 * The computer picker (docs/ux/flows.md F-4). Empty until the discovery call in
 * `src/connection/discovery.ts` exists — which is why the second line names the
 * command that makes a computer appear rather than apologising.
 */
export default function Computers() {
	return (
		<Screen title="Computers" testID={SCREEN.computers}>
			<EmptyState
				headline="No computers yet."
				next="Run `lop mobile serve` on the computer you want to control."
				testID="computers-empty"
			/>
		</Screen>
	);
}
