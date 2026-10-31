import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredComputer } from "@/connection";
import { createConnectionStore } from "@/state/connection-store";
import { CONTROL } from "@/ui/a11y";

/**
 * THE SCREEN'S WAIT, through the real `useConnectorWait` (PR #122 review round 3,
 * R3-M1; UX U17).
 *
 * "Add a computer" opens the set-up paths over an account that already lists
 * computers (U12), and "I've run it — connect it" then waits for the NEW one. The
 * screen's `acquire` refreshed the list and always answered `null`, which the hook
 * reads as "no row yet": the wait sat in W1 for three minutes and ended on
 * "Nothing answered … no tunnel listed" while the list held the new computer. On an
 * EMPTY account the first listed computer unmounted the panel, which hid it.
 * `computers-view.test.ts` cannot see this — only the mounted screen runs the
 * hook's loop against the screen's own `acquire`. Same harness as
 * `computer-switcher-sheet.test.ts`: react-dom over a stub container, null native
 * adapters, a real connection store, fake timers for the poll.
 */
type Props = Record<string, unknown>;
const host = vi.hoisted(() => ({
	texts: [] as string[],
	presses: new Map<string, () => void>(),
	params: {} as Record<string, string>,
	refreshes: 0,
	/* Which refresh lists the new computer: poll N, not the first, so the test
	 *  proves the loop keeps asking rather than catching a lucky first read. */
	listOnRefresh: 3,
	picked: [] as unknown[],
	onWait: null as null | (() => void),
	refusal: null as null | Record<string, unknown>,
	surface: null as null | Props,
}));

vi.mock("react-native", async () => {
	const flatten = (children: unknown): string =>
		Array.isArray(children)
			? children.map(flatten).join("")
			: typeof children === "string" || typeof children === "number"
				? String(children)
				: "";
	return {
		Platform: { OS: "web" },
		AppState: { addEventListener: () => ({ remove() {} }) },
		View: (props: Props) => (props.children ?? null) as React.ReactNode,
		Text: (props: Props) => {
			host.texts.push(flatten(props.children));
			return null;
		},
		ActivityIndicator: () => null,
		Pressable: (props: Props) => (props.children ?? null) as React.ReactNode,
	};
});
vi.mock("expo-router", () => ({
	useRouter: () => ({
		push: () => {},
		replace: () => {},
		back: () => {},
		canGoBack: () => true,
	}),
	useLocalSearchParams: () => host.params,
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: async () => ({}) }));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000" }));
const stub = (name: string) => ({ [name]: () => null });
vi.mock("@/ui/components/badge", () => stub("Badge"));
vi.mock("@/ui/components/banner", () => stub("Banner"));
vi.mock("@/ui/components/dialog", () => stub("Dialog"));
vi.mock("@/ui/components/refusal-surface", () => ({
	RefusalSurface: (props: Props) => {
		host.surface = props;
		return null;
	},
}));
vi.mock("@/ui/components/section-header", () => stub("SectionHeader"));
vi.mock("@/ui/components/skeleton", () => stub("Skeleton"));
vi.mock("@/features/auth/sign-in-panel", () => stub("SignInPanel"));
/* Team Bridge is a separate hub feature, not part of the connector polling
 * screen's contract. Keep its provider/push native adapters outside this Node
 * harness instead of inventing a production __DEV__ global for Expo imports. */
vi.mock("@/team-bridge/navigation", () => ({ TeamBridgeEntry: () => null }));
vi.mock("@/ui/components/shimmer", () => ({
	Shimmer: (props: Props) => (props.children ?? null) as React.ReactNode,
}));
vi.mock("@/ui/components/screen", () => ({
	Screen: (props: Props) => (props.children ?? null) as React.ReactNode,
}));
vi.mock("@/ui/components/button", () => ({
	Button: (props: Props) => {
		host.texts.push(String(props.label));
		host.presses.set(String(props.testID), props.onPress as () => void);
		return null;
	},
}));
vi.mock("@/features/auth/tunnel-paths", () => ({
	TunnelPaths: (props: Props) => (props.children ?? null) as React.ReactNode,
}));
/* The command block's "I've run it — connect it" is the only part this test taps. */
vi.mock("@/features/auth/setup-computer", () => ({
	SetupComputer: (props: Props) => {
		host.onWait = props.onWaitForConnector as () => void;
		return null;
	},
}));
vi.mock("@/features/auth/saved-computers-sync", () => ({
	removeComputer: async () => {},
}));
vi.mock("@/features/auth/computer-switcher-sheet", () => ({
	useComputerSwitcher: () => ({ open: () => {}, visible: false }),
	usePhoneKnowsComputers: () => true,
}));
const store = vi.hoisted(() => ({
	api: null as null | ReturnType<
		typeof import("@/state/connection-store").createConnectionStore
	>,
}));
vi.mock("@/features/auth/connection-provider", async () => {
	const { useStore } = await import("zustand");
	return {
		get connectionStore() {
			return store.api;
		},
		useConnectionState: <T>(selector: (state: never) => T): T =>
			// biome-ignore lint/style/noNonNullAssertion: set in beforeEach.
			useStore(store.api!, selector as never),
		useConnection: () => ({
			/* What the provider's discovery does: the control plane lists the new
			 *  tunnel on refresh N, and the store's `setComputers` carries it. */
			refreshComputers: async () => {
				host.refreshes += 1;
				if (host.refreshes >= host.listOnRefresh)
					store.api?.getState().setComputers([OLD, NEW]);
			},
			billing: null,
			discovering: false,
			selectComputer: async (computer: unknown) => {
				host.picked.push(computer);
				/* The provider's successful path: a route, then the pick, then live. The
				 *  store's actions ignore both calls while no route exists. */
				const api = store.api?.getState();
				api?.startRoute({
					mode: "radient",
					hostname: (computer as DiscoveredComputer).hostname,
					tunnelId: (computer as DiscoveredComputer).tunnelId,
				});
				api?.selectComputer(computer as DiscoveredComputer);
				api?.markLive();
			},
			retry: async () => {},
			refusal: host.refusal,
			signInWithRadient: async () => {},
			signInState: { kind: "idle" },
		}),
	};
});

/* Placeholder hosts only (AGENTS.md: never a real tunnel hostname). */
const listed = (
	tunnelId: string,
	hostname: string,
	name: string,
): DiscoveredComputer => ({
	tunnelId,
	name,
	deviceId: `device-${tunnelId}`,
	hostname,
	status: "ready",
	rawStatus: "active",
	supportsLocalOperator: true,
	billing: { eligible: true, message: null },
	updatedAt: 0,
});
const OLD = listed(
	"t-old",
	"0123456789abcdef0123456789abcdef-lop.example.com",
	"Old Mac",
);
const NEW = listed(
	"t-new",
	"fedcba9876543210fedcba9876543210-lop.example.com",
	"New Mini",
);

const { default: Computers } = await import("./computers");

let root: ReturnType<typeof createRoot> | null = null;
const probed: string[] = [];
async function render() {
	host.texts.length = 0;
	await act(async () => root?.render(createElement(Computers)));
}
const words = () => host.texts.join(" | ");
/* One poll interval: lets the hook's `setTimeout` fire and its awaits settle. */
const poll = () =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(4_000);
	});

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
	host.texts.length = 0;
	host.presses.clear();
	host.params = { add: "1" };
	host.refreshes = 0;
	host.listOnRefresh = 3;
	host.picked.length = 0;
	host.onWait = null;
	host.refusal = null;
	host.surface = null;
	probed.length = 0;
	store.api = createConnectionStore();
	store.api.getState().setComputers([OLD]);
	/* The health probe: only the NEW computer's host answers. The old one being
	 *  silent proves the wait is not satisfied by a computer already listed. */
	vi.stubGlobal("fetch", async (url: string) => {
		probed.push(url);
		const ok = url.includes(NEW.hostname);
		return {
			ok,
			json: async () => ({ ok: true, version: 3, sessions: 1 }),
		};
	});
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
	root = createRoot({
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		ownerDocument: doc,
		addEventListener() {},
		removeEventListener() {},
	} as unknown as Element);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("adding a computer over a populated list finds the new one (R3-M1/U17)", () => {
	it("reaches W3 and offers Use this computer for the computer listed on poll N", async () => {
		await render();
		expect(words()).not.toContain("Use this computer");
		expect(host.onWait).toBeTypeOf("function");
		await act(async () => host.onWait?.());
		expect(words()).toContain("Waiting for Radient to list your computer");

		for (let tick = 0; tick < 6; tick += 1) await poll();
		await render();

		expect(host.refreshes).toBeGreaterThanOrEqual(host.listOnRefresh);
		expect(words()).toContain("Your computer answered.");
		expect(words()).toContain("Use this computer");
		expect(words()).not.toContain("Nothing answered.");
		/* The wait asked the NEW computer's host whether it is up. (The old row's
		 *  own reachability probe also runs; that is the list's, not the wait's.) */
		expect(probed.some((url) => url.includes(NEW.hostname))).toBe(true);

		await act(async () => {
			host.presses.get(CONTROL.computersUseThisComputer)?.();
		});
		expect(host.picked).toEqual([NEW]);
		/* Q8/U19: after the pick goes live the answered panel and its mint action are
		 *  gone, so a second tap cannot mint again. Re-rendered first, because `words()`
		 *  accumulates every Text of every render since the last one. */
		await render();
		expect(store.api?.getState().phase).toBe("live");
		expect(words()).toContain("Connected to New Mini.");
		expect(words()).not.toContain("Your computer answered.");
		expect(words()).not.toContain("Use this computer");
		/* One mint, not two: the control is gone from the tree and the row says active. */
		expect(host.picked).toHaveLength(1);
	});

	it("omits an unknown protocol version rather than showing developer vocabulary", async () => {
		vi.stubGlobal("fetch", async () => ({
			ok: true,
			json: async () => ({ ok: true, version: null, sessions: null }),
		}));
		await render();
		await act(async () => host.onWait?.());
		for (let tick = 0; tick < 6; tick += 1) await poll();
		await render();
		expect(words()).toContain("Your computer answered.");
		expect(words()).not.toContain("protocol version unknown");
	});

	it("keeps waiting while only the computers listed at the start are there", async () => {
		host.listOnRefresh = Number.POSITIVE_INFINITY;
		await render();
		await act(async () => host.onWait?.());
		for (let tick = 0; tick < 4; tick += 1) await poll();
		await render();
		expect(host.refreshes).toBeGreaterThan(1);
		expect(words()).toContain("Waiting for Radient to list your computer");
		expect(words()).not.toContain("Use this computer");
		/* The already-listed computer is not offered as the one that appeared. */
		expect(words()).not.toContain("Radient has the tunnel");
	});
});

describe("a console-side refusal on Computers offers the console (QA round 3, Q7)", () => {
	it("passes Open the Radient console, as Settings does", async () => {
		host.params = {};
		host.refusal = { kind: "console", subject: "Old Mac" };
		await render();
		expect(host.surface?.kind).toBe("console");
		expect(host.surface?.onOpenConsole).toBeTypeOf("function");
	});
});
