import { EMPTY, SCREEN } from "@/ui/a11y";
import { EmptyState, Screen } from "@/ui/components";

/**
 * A custom tunnel URL plus the relay password (docs/ux/flows.md F-3). The form
 * needs the custom-route connection profile, so this route is the shell only.
 */
export default function CustomRoute() {
	return (
		<Screen title="Custom route" testID={SCREEN.customRoute}>
			<EmptyState
				headline="Point the app at a tunnel URL."
				next="You will need the relay password that `lop mobile serve` printed."
				testID={EMPTY.customRoute}
			/>
		</Screen>
	);
}
