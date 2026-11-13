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
import { clearBadgeSource, reassertBadge } from "@/notifications/app-badge";
import { registerBackgroundUnreadScope } from "@/notifications/background-clear";
import { registerBackgroundNotificationTask } from "@/notifications/background-task";
import { loadNotifications } from "@/notifications/native";
import { type AvatarCache, createAvatarCache } from "@/team-bridge/avatars";
import {
	backgroundUnreadScope,
	followTeamBridgeBadge,
	TEAM_BRIDGE_BADGE,
} from "@/team-bridge/badge";
import { createHubClient, type HubClient } from "@/team-bridge/client";
import { deviceNoticeDismissals } from "@/team-bridge/notice-dismissals";
import {
	installTeamBridgeNotifications,
	registerTeamBridgeDevice,
	subscribeTeamBridgeReceived,
	subscribeTeamBridgeTaps,
	unregisterTeamBridgeDevice,
} from "@/team-bridge/push";
import { retirementAccessForAccount } from "@/team-bridge/push-account";
import { createPushLifecycle } from "@/team-bridge/push-lifecycle";
import { teamBridgeThreadPath } from "@/team-bridge/push-payload";
import {
	registerTeamBridgeRetirement,
	retireTeamBridgeScope,
} from "@/team-bridge/retirement";
import {
	accountIdFromToken,
	createTeamBridgeStore,
	type TeamBridgeState,
	type TeamBridgeStore,
} from "@/team-bridge/store";
import { teamBridgeFixture } from "@/testing/team-bridge-fixture";

const Context = createContext<
	| (TeamBridgeStore & {
			hub: HubClient;
			avatars: AvatarCache;
			registerPush: () => Promise<void>;
			pushes: ReturnType<typeof createPushLifecycle>;
	  })
	| null
>(null);

/**
 * The account boundary is the STORE's, never the children's.
 *
 * A different account still gets a fresh store BEFORE its children render: the
 * value below is memoised on `radientAccountId`, so the render that sees the new
 * id hands every reader the new store, and the `[value]` effects retire the old
 * one (store, avatar cache, push registration) in the same commit.
 *
 * This provider used to get that by keying itself on the account id. It wraps the
 * router (`app/_layout.tsx`), so the key remounted EVERY screen on every account
 * change — a Radient sign-in included. Welcome lost the `initiated` flag that lets
 * its own attempt navigate ("authorise does nothing"), and the (auth) stack was
 * rebuilt on its first route, `custom`: a Radient user stranded on the own-tunnel
 * guide with a Back that had nothing to pop (TestFlight 883, Ola). Pinned by
 * `__tests__/provider-keeps-router.test.ts`.
 */
export function TeamBridgeProvider({ children }: { children: ReactNode }) {
	const connection = useConnection();
	const router = useRouter();
	const unreadRefresh = useRef<() => Promise<void>>(() => Promise.resolve());
	const access = useRef(connection.radientAccessToken);
	access.current = connection.radientAccessToken;
	const retirementAccess = useRef(connection.radientRetirementAccessToken);
	retirementAccess.current = connection.radientRetirementAccessToken;
	const fixture = useMemo(() => teamBridgeFixture(), []);
	const value = useMemo(() => {
		// The connection's accessor is refreshable across account replacements.
		// A retiring UI client must never replay its upload (or cleanup) as the
		// replacement account; token ownership is not a second auth lifecycle.
		const owner = connection.radientAccountId;
		const accessToken = async (options?: {
			force?: boolean;
		}): Promise<string | null> => {
			// Check before the general accessor: even a rejected old request must
			// not spend the replacement provider's refresh grant (including A→null→A).
			if (!scope.isActive()) return null;
			const token = fixture ? fixture.token : await access.current(options);
			return scope.isActive() &&
				(fixture || (owner && accountIdFromToken(token) === owner))
				? token
				: null;
		};
		const hub = createHubClient({
			accessToken,
			...(fixture ? { baseUrl: fixture.baseUrl } : {}),
		});
		// Captured by this account's value, not read from a later render.
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
		const scope = createTeamBridgeStore({
			hub: () => hub,
			accessToken,
			dismissals: deviceNoticeDismissals,
		});
		return {
			...scope,
			hub,
			// Created with this account-keyed value, so a different account
			// never reads this cache (`src/team-bridge/avatars.ts`).
			avatars: createAvatarCache(),
			pushes,
			registerPush: () => pushes.register(),
		};
	}, [fixture, connection.radientAccountId]);
	useEffect(() => {
		const remove = registerTeamBridgeRetirement(() => {
			value.actions.retire();
			return retireTeamBridgeScope(value);
		});
		// The icon badge follows THIS account's unread total for exactly the
		// provider's lifetime (`src/team-bridge/badge.ts`).
		const stopBadge = followTeamBridgeBadge(value.store);
		return () => {
			// The account boundary: a retired store never publishes the reset that
			// would clear the badge, so A's count is dropped here before B reads.
			stopBadge();
			void clearBadgeSource(TEAM_BRIDGE_BADGE);
			/*
			 * `value` is memoised on the account id, so this teardown IS the account
			 * boundary, including a direct A→B replacement without signed-out (and
			 * provider unmount). Permanently retire the store and clear decoded media:
			 * A's late upload refusal must not reset B's module-level image cache.
			 */
			value.actions.retire();
			// Account replacement retires this value; drop its photos now
			// rather than waiting for the collector, and retire reads in flight.
			value.avatars.clear();
			remove();
			void value.pushes.retire().catch(() => undefined);
		};
	}, [value]);
	useEffect(() => {
		if (!connection.coldStartSettled && !fixture) return;
		if (!connection.radientSignedIn && !fixture) {
			value.pushes.suspend();
			value.actions.reset();
			// Signed out: no Bridge count may stay on the icon.
			void clearBadgeSource(TEAM_BRIDGE_BADGE);
			value.avatars.clear();
			void value.actions.checkStatus();
			return;
		}
		value.pushes.activate();
		// Signed in: the silent attention push may now re-read THIS account's
		// unread from the background (`notifications/background-clear.ts`). The
		// registration lasts exactly as long as this signed-in branch, so a task
		// that runs signed out, or after the switch, finds no scope and writes
		// nothing.
		const stopBackground = registerBackgroundUnreadScope(
			backgroundUnreadScope(value),
		);
		void registerBackgroundNotificationTask();
		const refresh = () => {
			void value.actions.refreshUnread();
			void value.registerPush().catch(() => undefined);
		};
		void value.actions.checkStatus().then(refresh);
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") {
				// Re-write the known number at once (the OS may hold another), then
				// the refresh's answer moves it through the store subscription.
				void reassertBadge();
				refresh();
			}
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
			stopBackground();
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
			// The tap says the account's unread moved; re-read it for the badge.
			void unreadRefresh.current();
		}).then((stop) => {
			if (disposed) stop();
			else teardown = stop;
		});
		return () => {
			disposed = true;
			teardown?.();
		};
	}, [router]);
	useEffect(() => {
		// The ref, not `value`, so the once-per-process tap effect above reaches
		// the CURRENT account's store after an account switch.
		unreadRefresh.current = () => value.actions.refreshUnread();
		let disposed = false;
		let teardown: (() => void) | undefined;
		// A Team Bridge push arriving while the app runs (foreground, or a
		// background delivery the OS hands to JS) means unread moved: re-read the
		// authoritative total rather than counting pushes (ADR 0006 §1.4).
		void subscribeTeamBridgeReceived(() => {
			void value.actions.refreshUnread();
		}).then((stop) => {
			if (disposed) stop();
			else teardown = stop;
		});
		return () => {
			disposed = true;
			teardown?.();
		};
	}, [value]);
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
