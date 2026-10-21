/**
 * Hub lifetime, independent of the relay's lifetime. Selecting a computer is
 * deliberately not a prerequisite: a Radient-signed-in phone can read messages
 * with every computer asleep. All hub requests use the connection provider's
 * single-flight OAuth accessor; no second token store exists here.
 */
import { useRouter } from "expo-router";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { AppState } from "react-native";
import { useStore } from "zustand";
import { useConnection } from "@/features/auth/connection-provider";
import { useUiStore } from "@/state/ui-store";
import { createHubClient, type HubClient } from "@/team-bridge/client";
import {
	installTeamBridgeNotifications,
	registerTeamBridgeDevice,
	subscribeTeamBridgeTaps,
	unregisterTeamBridgeDevice,
} from "@/team-bridge/push";
import { teamBridgeThreadPath } from "@/team-bridge/push-payload";
import { registerTeamBridgeRetirement } from "@/team-bridge/retirement";
import {
	createTeamBridgeStore,
	type TeamBridgeState,
	type TeamBridgeStore,
} from "@/team-bridge/store";
import { teamBridgeFixture } from "@/testing/team-bridge-fixture";

const Context = createContext<(TeamBridgeStore & { hub: HubClient }) | null>(
	null,
);

export function TeamBridgeProvider({ children }: { children: ReactNode }) {
	const connection = useConnection();
	const router = useRouter();
	const access = useRef(connection.radientAccessToken);
	access.current = connection.radientAccessToken;
	const fixture = useMemo(() => teamBridgeFixture(), []);
	useEffect(() => {
		if (!fixture) return;
		const theme = new URLSearchParams(location.search).get("tb-theme");
		if (theme === "light" || theme === "dark")
			useUiStore.getState().setThemePreference(theme);
	}, [fixture]);
	const value = useMemo(() => {
		const accessToken = fixture
			? async () => fixture.token
			: (options?: { force?: boolean }) => access.current(options);
		const hub = createHubClient({
			accessToken,
			...(fixture ? { baseUrl: fixture.baseUrl } : {}),
		});
		return { ...createTeamBridgeStore({ hub: () => hub, accessToken }), hub };
	}, [fixture]);
	useEffect(
		() =>
			registerTeamBridgeRetirement(() => unregisterTeamBridgeDevice(value.hub)),
		[value],
	);
	useEffect(() => {
		if (!connection.coldStartSettled && !fixture) return;
		if (!connection.radientSignedIn && !fixture) {
			value.actions.reset();
			void value.actions.checkStatus();
			return;
		}
		const refresh = () => {
			void value.actions.refreshUnread();
			void registerTeamBridgeDevice(value.hub);
		};
		void value.actions.checkStatus().then(refresh);
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") refresh();
		});
		return () => subscription.remove();
	}, [connection.coldStartSettled, connection.radientSignedIn, fixture, value]);

	useEffect(() => {
		let disposed = false;
		let teardown: (() => void) | undefined;
		void installTeamBridgeNotifications();
		void subscribeTeamBridgeTaps((push) => {
			// The route owns admission. A cold tap can arrive before OAuth restore;
			// routing now retains its destination while the gate waits for restore.
			router.push(teamBridgeThreadPath(push) as never);
		}).then((stop) => {
			if (disposed) stop();
			else teardown = stop;
		});
		return () => {
			disposed = true;
			teardown?.();
		};
	}, [router]);
	return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTeamBridge() {
	const context = useContext(Context);
	if (!context) throw new Error("Team Bridge needs its hub provider");
	return context;
}

export function useTeamBridgeState<T>(
	selector: (state: TeamBridgeState) => T,
): T {
	return useStore(useTeamBridge().store, selector);
}
