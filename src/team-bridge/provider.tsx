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
import { loadNotifications } from "@/notifications/native";
import { useUiStore } from "@/state/ui-store";
import { clearAttachmentCache } from "@/team-bridge/attachments";
import { createHubClient, type HubClient } from "@/team-bridge/client";
import {
	installTeamBridgeNotifications,
	registerTeamBridgeDevice,
	subscribeTeamBridgeTaps,
	unregisterTeamBridgeDevice,
} from "@/team-bridge/push";
import { retirementAccessForAccount } from "@/team-bridge/push-account";
import { createPushLifecycle } from "@/team-bridge/push-lifecycle";
import { teamBridgeThreadPath } from "@/team-bridge/push-payload";
import { registerTeamBridgeRetirement } from "@/team-bridge/retirement";
import {
	createTeamBridgeStore,
	type TeamBridgeState,
	type TeamBridgeStore,
} from "@/team-bridge/store";
import { teamBridgeFixture } from "@/testing/team-bridge-fixture";

const Context = createContext<
	| (TeamBridgeStore & {
			hub: HubClient;
			registerPush: () => Promise<void>;
			pushes: ReturnType<typeof createPushLifecycle>;
	  })
	| null
>(null);

export function TeamBridgeProvider({ children }: { children: ReactNode }) {
	const { radientAccountId } = useConnection();
	// A different account gets a fresh store BEFORE its children render. A
	// boolean signed-in effect would leave old messages visible for one paint
	// when an already signed-in person replaces their account.
	return (
		<AccountTeamBridgeProvider key={radientAccountId ?? "signed-out"}>
			{children}
		</AccountTeamBridgeProvider>
	);
}

function AccountTeamBridgeProvider({ children }: { children: ReactNode }) {
	const connection = useConnection();
	const router = useRouter();
	const access = useRef(connection.radientAccessToken);
	access.current = connection.radientAccessToken;
	const retirementAccess = useRef(connection.radientRetirementAccessToken);
	retirementAccess.current = connection.radientRetirementAccessToken;
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
		// Captured by this account-keyed provider, not read from a later render.
		const owner = connection.radientAccountId;
		let registeredHub: { hub: HubClient; token: string } | null = null;
		const bindAccount = async (retiring = false) => {
			const token = await (retiring && !fixture
				? owner
					? retirementAccess.current({ accountId: owner })
					: null
				: accessToken());
			if (!token) return null;
			// Push cleanup must not accidentally DELETE under a replacement login.
			// Pin this operation's grant; the general UI client remains refreshable.
			return {
				token,
				hub: createHubClient({
					accessToken: async () => token,
					...(fixture ? { baseUrl: fixture.baseUrl } : {}),
				}),
			};
		};
		const pushes = createPushLifecycle({
			register: async (isCurrent) => {
				const bound = await bindAccount();
				if (!bound || !isCurrent()) return;
				registeredHub = bound;
				await registerTeamBridgeDevice(bound.hub, isCurrent);
			},
			unregister: async () => {
				const bound = registeredHub ?? (await bindAccount(true));
				if (bound) {
					const cleanup = createHubClient({
						accessToken: retirementAccessForAccount(bound.token, (options) =>
							fixture
								? Promise.resolve(fixture.token)
								: retirementAccess.current(options),
						),
						...(fixture ? { baseUrl: fixture.baseUrl } : {}),
					});
					await unregisterTeamBridgeDevice(cleanup);
				}
				registeredHub = null;
			},
		});
		return {
			...createTeamBridgeStore({ hub: () => hub, accessToken }),
			hub,
			pushes,
			registerPush: () => pushes.register(),
		};
	}, [fixture, connection.radientAccountId]);
	useEffect(() => {
		const remove = registerTeamBridgeRetirement(() => value.pushes.retire());
		return () => {
			/*
			 * This provider is keyed by account (`TeamBridgeProvider`), so its
			 * teardown IS the account boundary, including a direct A→B replacement
			 * that never passes through signed-out and so never reaches
			 * `store.actions.reset`. The image cache is module-level: clearing it
			 * here empties A's decoded images and bumps the epoch, so A's loads
			 * still in flight are returned to nobody and never stored for B.
			 */
			clearAttachmentCache();
			remove();
			void value.pushes.retire().catch(() => undefined);
		};
	}, [value]);
	useEffect(() => {
		if (!connection.coldStartSettled && !fixture) return;
		if (!connection.radientSignedIn && !fixture) {
			value.pushes.suspend();
			value.actions.reset();
			void value.actions.checkStatus();
			return;
		}
		value.pushes.activate();
		const refresh = () => {
			void value.actions.refreshUnread();
			void value.registerPush().catch(() => undefined);
		};
		void value.actions.checkStatus().then(refresh);
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") refresh();
		});
		let disposed = false;
		let tokenSubscription: { remove: () => void } | undefined;
		// Providers can rotate a token while the app is running, not just at launch.
		void loadNotifications()
			.then((module) => {
				if (!module || disposed) return;
				tokenSubscription = module.addPushTokenListener(() => {
					void value.registerPush().catch(() => undefined);
				});
			})
			.catch(() => undefined);
		return () => {
			disposed = true;
			subscription.remove();
			tokenSubscription?.remove();
		};
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
