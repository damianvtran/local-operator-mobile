/** Web-fixture presentation only. Mount AFTER ConnectionProvider's subtree so
 * text-scale subscriptions exist before their one initial notification. The
 * app's routes/components, language source and private writers stay unchanged.
 */
import { useEffect, useMemo } from "react";
import { configStore } from "@/features/auth/connection-provider";
import { useUiStore } from "@/state/ui-store";
import { teamBridgeFixture } from "@/testing/team-bridge-fixture";
import { installFixturePresentation } from "@/testing/team-bridge-presentation-state";
import { useTextScale } from "@/ui/text-scale-provider";

export function TeamBridgeFixturePresentation() {
	const fixture = useMemo(() => teamBridgeFixture(), []);
	// Keep the subscribing hooks behind a component boundary, not merely an
	// early return inside their effect. Normal exports must mount no fixture
	// text-scale subscriber at all, even when a URL supplies forged controls.
	return fixture ? <FixturePresentation fixture={fixture} /> : null;
}

function FixturePresentation({
	fixture,
}: {
	fixture: NonNullable<ReturnType<typeof teamBridgeFixture>>;
}) {
	const { setPreference } = useTextScale();
	useEffect(() => {
		return installFixturePresentation(
			fixture,
			configStore,
			setPreference,
			(theme) => useUiStore.getState().setThemeMode(theme),
		);
	}, [fixture, setPreference]);
	return null;
}
