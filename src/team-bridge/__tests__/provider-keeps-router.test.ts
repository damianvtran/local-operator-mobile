import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { act, createElement, type ReactNode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * TestFlight 883 blocker (Ola): "After sign-in, I could not navigate away from
 * this page" — the custom-tunnel guide, with a Back that did nothing, for a
 * Radient user who had just signed in. The operator's "authorise does nothing"
 * is the same defect seen one screen earlier.
 *
 * The cause is not on either screen. `TeamBridgeProvider` sits ABOVE the router
 * (`app/_layout.tsx`) and used to key its child on the Radient account id, so the
 * sign-in publishing that id (`holdRadientTokens` → `setRadientAccountId`)
 * unmounted and remounted the whole router:
 *
 *  - every screen lost its local state — Welcome's `initiated`, the only thing
 *    that lets its own attempt navigate (`sign-in-presentation.ts`), so a
 *    successful sign-in went nowhere;
 *  - the (auth) stack was re-created from scratch, and React Navigation starts a
 *    fresh stack on its FIRST screen. Expo Router orders the (auth) group
 *    `custom` first, and `custom` IS the own-tunnel guide. Alone on its stack,
 *    its `router.back()` is a GO_BACK nobody handles.
 *
 * This mounts the real `TeamBridgeProvider` around the real navigation core
 * (Expo Router's own React Navigation build and `StackRouter`) with the (auth)
 * screens in the order Expo Router derives from `app/(auth)`, dispatches the
 * actions Expo Router dispatches for `/` → `replace("/welcome")`, and then signs
 * in by changing the account id, as `holdRadientTokens` does.
 *
 * Mocked: the connection context (its account id is the input), the Expo
 * router hook, native notifications/push and the fixture probe — as in
 * `provider-account-switch.test.ts`, whose minimal DOM host this reuses.
 */

const connection = vi.hoisted(() => ({
	radientAccountId: null as string | null,
}));

vi.mock("react-native", () => ({
	Platform: { OS: "web" },
	AppState: {
		currentState: "active",
		addEventListener: () => ({ remove() {} }),
	},
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push() {} }) }));
vi.mock("@/features/auth/connection-provider", () => ({
	useConnection: () => ({
		radientAccountId: connection.radientAccountId,
		coldStartSettled: false,
		radientSignedIn: connection.radientAccountId !== null,
		radientAccessToken: async () => null,
		radientRetirementAccessToken: async () => null,
	}),
}));
vi.mock("@/notifications/native", () => ({
	loadNotifications: async () => null,
}));
vi.mock("@/team-bridge/push", () => ({
	installTeamBridgeNotifications: async () => undefined,
	registerTeamBridgeDevice: async () => undefined,
	subscribeTeamBridgeReceived: async () => () => undefined,
	subscribeTeamBridgeTaps: async () => () => undefined,
	unregisterTeamBridgeDevice: async () => undefined,
}));
vi.mock("@/testing/team-bridge-fixture", () => ({
	teamBridgeFixture: () => null,
}));

const { TeamBridgeProvider } = await import("@/team-bridge/provider");

/* Expo Router's own React Navigation build: the navigator lifecycle under test
 * is this code's, not a model of it. CommonJS, so it is required. */
const require = createRequire(import.meta.url);
const core = require("expo-router/build/react-navigation/core/index.js");
const {
	StackRouter,
} = require("expo-router/build/react-navigation/routers/index.js");
const {
	findDivergentState,
	getPayloadFromStateRoute,
} = require("expo-router/build/global-state/stateUtils.js");
const { inMemoryContext } = await import(
	"expo-router/build/testing-library/context-stubs"
);
const { getRoutes } = await import("expo-router/build/getRoutes");
const { sortRoutesWithInitial } = await import("expo-router/build/sortRoutes");

const TSX = /\.tsx$/;

/** The (auth) group's screens in the order Expo Router gives its Stack, read
 *  from the real route files: the first one is where a fresh stack starts. */
function authScreenOrder(): string[] {
	const appDir = join(process.cwd(), "app");
	const screens = readdirSync(join(appDir, "(auth)"))
		.filter((file) => file.endsWith(".tsx") && file !== "_layout.tsx")
		.map((file) => `(auth)/${file.replace(TSX, "")}`);
	const context = inMemoryContext(
		Object.fromEntries(
			[
				"_layout",
				"(app)/_layout",
				"(app)/index",
				"(auth)/_layout",
				...screens,
			].map((key) => [key, () => null]),
		),
	);
	// biome-ignore lint/suspicious/noExplicitAny: Expo Router's route node type is internal.
	const tree: any = getRoutes(
		context as never,
		{
			internal_stripLoadRoute: true,
			skipGenerated: true,
		} as never,
	);
	// biome-ignore lint/suspicious/noExplicitAny: as above.
	const auth = tree.children.find((node: any) => node.route === "(auth)");
	return (
		[...auth.children]
			.sort(sortRoutesWithInitial(auth.initialRouteName))
			// biome-ignore lint/suspicious/noExplicitAny: as above.
			.map((node: any) => node.route)
	);
}

const AUTH = authScreenOrder();
const mounts: string[] = [];

function Stack({ children }: { children: ReactNode }) {
	const { state, descriptors, NavigationContent } = core.useNavigationBuilder(
		StackRouter,
		{ children },
	);
	return createElement(
		NavigationContent,
		null,
		descriptors[state.routes[state.index].key].render(),
	);
}
const Navigator = core.createNavigatorFactory(Stack)();
const screen = (name: string) =>
	function Screen() {
		useEffect(() => {
			mounts.push(name);
		}, []);
		return null;
	};
const group = (names: string[]) =>
	function Group() {
		return createElement(
			Navigator.Navigator,
			null,
			...names.map((name) =>
				createElement(Navigator.Screen, {
					key: name,
					name,
					component: screen(name),
				}),
			),
		);
	};
const AppGroup = group(["index"]);
const AuthGroup = group(AUTH);
function Router() {
	return createElement(
		Navigator.Navigator,
		null,
		createElement(Navigator.Screen, { name: "(app)", component: AppGroup }),
		createElement(Navigator.Screen, { name: "(auth)", component: AuthGroup }),
	);
}

/** Expo Router's `getStateFromPath` shape for this two-group tree. */
const pathState = (path: string) => {
	const name = path === "/" ? "index" : path.slice(1);
	return {
		routes: [
			{
				name: name === "index" ? "(app)" : "(auth)",
				params: {},
				state: { routes: [{ name, params: {}, path }] },
			},
		],
	};
};

let root: ReturnType<typeof createRoot> | null = null;

function host() {
	const doc = {
		nodeType: 9,
		activeElement: null,
		addEventListener() {},
		removeEventListener() {},
	};
	vi.stubGlobal("window", {
		document: doc,
		HTMLIFrameElement: class {},
		HTMLElement: class {},
		addEventListener() {},
		removeEventListener() {},
	});
	vi.stubGlobal("document", doc);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	return {
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		ownerDocument: doc,
		addEventListener() {},
		removeEventListener() {},
	} as unknown as Element;
}

afterEach(async () => {
	await act(async () => {
		root?.unmount();
		root = null;
	});
	vi.unstubAllGlobals();
	mounts.length = 0;
	connection.radientAccountId = null;
});

describe("Team Bridge provider keeps the router across a Radient sign-in", () => {
	it("orders the (auth) group with the own-tunnel guide first (why a reset strands the reader there)", () => {
		expect(AUTH[0]).toBe("custom");
	});

	it("leaves the reader on Welcome, with Welcome's own state, when sign-in publishes the account", async () => {
		const ref = core.createNavigationContainerRef();
		const tree = (children: ReactNode) =>
			createElement(
				core.BaseNavigationContainer,
				{ ref, initialState: pathState("/") },
				createElement(TeamBridgeProvider, null, children),
			);
		const render = async () => {
			await act(async () => {
				root?.render(tree(createElement(Router)));
			});
		};
		root = createRoot(host());
		await render();
		/* Home's landing effect on a first run: `router.replace("/welcome")`,
		 *  dispatched exactly as Expo Router's `getNavigateAction` builds it. */
		await act(async () => {
			const { actionStateRoute, navigationState } = findDivergentState(
				pathState("/welcome"),
				ref.getRootState(),
				false,
			);
			const payload = getPayloadFromStateRoute(actionStateRoute ?? {});
			ref.dispatch({
				type: "REPLACE",
				target: navigationState.key,
				payload: { name: payload.screen, params: payload.params },
			});
		});
		expect(ref.getCurrentRoute()?.name).toBe("welcome");
		mounts.length = 0;

		connection.radientAccountId = "acct_ola";
		await render();

		/* Before the fix: the focused route was `custom` (the guide), alone on its
		 *  stack (`canGoBack()` false), and Welcome had been remounted. */
		expect(ref.getCurrentRoute()?.name).toBe("welcome");
		expect(mounts).toEqual([]);
	});

	it("does not remount anything under it on an account change, so no screen loses local state", async () => {
		const seen: string[] = [];
		function Probe() {
			const [mountId] = useState(() => Math.random().toString(36).slice(2));
			useEffect(() => {
				seen.push(mountId);
			}, [mountId]);
			return null;
		}
		const render = async () => {
			await act(async () => {
				root?.render(
					createElement(TeamBridgeProvider, null, createElement(Probe)),
				);
			});
		};
		root = createRoot(host());
		await render();
		for (const account of ["acct_a", null, "acct_a", "acct_b"]) {
			connection.radientAccountId = account;
			await render();
		}
		expect(seen).toHaveLength(1);
	});
});
