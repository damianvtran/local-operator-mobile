import { useEffect, useSyncExternalStore } from "react";
import { Platform, Text } from "react-native";

import {
	nativePhaseFileSink,
	persistConnectPhases,
} from "@/features/auth/connect-phase-file";
import {
	formatConnectPhases,
	subscribeConnectPhases,
} from "@/features/auth/connect-phases";
import { SURFACE } from "@/ui/a11y";

/**
 * The connect phase ring (`connect-phases.ts`) as a text node a Maestro hierarchy
 * dump can read, so the native proof's failure capture names the stage a Save and
 * connect stopped at without a debugger attached.
 *
 * **Off unless the bundle was built for a proof.** It is an accessibility element
 * (iOS's hierarchy comes from the accessibility tree, so a node hidden from it is
 * hidden from Maestro too), which means VoiceOver could land on it: a shipped build
 * must never render it. The gate is the inlined `EXPO_PUBLIC_CONNECT_PHASE_NODE`,
 * the same `=== "1"` convention `EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES` uses; only the
 * unsigned simulator build in `.github/workflows/ios.yml` sets it.
 *
 * It is 1×1 and nearly transparent rather than `opacity: 0`, because UIKit drops a
 * fully transparent view from the accessibility tree; it takes no touches.
 */
export function ConnectPhaseNode() {
	if (process.env.EXPO_PUBLIC_CONNECT_PHASE_NODE !== "1") return null;
	return <ConnectPhaseText />;
}

function ConnectPhaseText() {
	/* The file mirror (`connect-phase-file.ts`): the carrier that does not depend
	 *  on this node being in the accessibility tree. Mounted here so it shares
	 *  this node's gate and lifetime (the root layout's). */
	useEffect(() => {
		if (Platform.OS === "web") return;
		let stop: (() => void) | undefined;
		let cancelled = false;
		nativePhaseFileSink()
			.then((sink) => {
				if (!cancelled) stop = persistConnectPhases(sink);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
			stop?.();
		};
	}, []);
	const text = useSyncExternalStore(
		subscribeConnectPhases,
		formatConnectPhases,
		formatConnectPhases,
	);
	return (
		<Text
			testID={SURFACE.connectPhaseLog}
			accessibilityLabel={`connect-phases\n${text}`}
			pointerEvents="none"
			style={{
				position: "absolute",
				left: 0,
				bottom: 0,
				width: 1,
				height: 1,
				opacity: 0.02,
			}}
		>
			{text}
		</Text>
	);
}
