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
