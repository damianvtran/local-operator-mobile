import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredComputer } from "@/connection";
import { t } from "@/i18n";
import { createConnectionStore } from "@/state/connection-store";
import { CONTROL, computerRowIds } from "@/ui/a11y";

/**
 * THE COMPUTER ROW, mounted (TestFlight 883, Ola: "It was not obvious that this
 * was clickable"; design D1/D3/D4/D5).
 *
 * The old row was plain text under a hairline: no shape, no chevron, a pressed
 * fill of 1.01:1, and two bordered status pills that looked more tappable than
 * the row. This mounts the real Computers screen with Ola's account (one Radient
 * computer named by its EC2 internal DNS name) and reads what the row is: a
 * button with the raw name spoken, a card that changes ground under a finger, a
 * trailing chevron, a shortened title and sentence-case facts as text.
 *
 * Same harness as `computers-add-wait.test.ts` (react-dom over a stub container,
 * null native adapters, a real connection store), with the Pressable mock calling
 * its render-prop children so the row's content renders at all.
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
	/* What the row test reads: every Pressable's props and every View's class,
	 *  the icons drawn, and which Pressable is being held. */
	pressables: new Map<string, Props>(),
	classNames: [] as string[],
	icons: [] as string[],
	held: null as string | null,
	variants: new Map<string, unknown>(),
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
		View: (props: Props) => {
			if (typeof props.className === "string")
				host.classNames.push(props.className);
			return (props.children ?? null) as React.ReactNode;
		},
		Text: (props: Props) => {
			host.texts.push(flatten(props.children));
			return null;
		},
		ActivityIndicator: () => null,
		Pressable: (props: Props) => {
			host.pressables.set(String(props.testID), props);
			const children = props.children as
				| React.ReactNode
				| ((state: { pressed: boolean }) => React.ReactNode);
			return typeof children === "function"
				? children({ pressed: host.held === props.testID })
				: (children ?? null);
		},
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
	useFocusEffect: () => undefined,
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: async () => ({}) }));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000" }));
const stub = (name: string) => ({ [name]: () => null });
/* The header's back control is chrome, not part of the polling contract, and
 * its chevron reaches `lucide-react-native` (native SVG, Flow source Node cannot
 * parse) — the same reason the other leaf primitives here are stubs. */
vi.mock("@/ui/components/back-button", () => stub("BackButton"));
/* The computer row's glyph, check and chevron: same reason (TestFlight 883, D1). */
vi.mock("lucide-react-native", () => {
	const icon = (name: string) => () => {
		host.icons.push(name);
		return null;
	};
	return {
		Check: icon("Check"),
		ChevronLeft: icon("ChevronLeft"),
		ChevronRight: icon("ChevronRight"),
		Laptop: icon("Laptop"),
	};
});
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
vi.mock("@/ui/components/screen", async () => {
	const { createElement: h, Fragment } = await import("react");
	/* The header's actions too: Switch computer and Refresh live there (D3). */
	return {
		Screen: (props: Props) =>
			h(
				Fragment,
				null,
				props.headerAction as React.ReactNode,
				props.children as React.ReactNode,
			),
	};
});
vi.mock("@/ui/components/button", () => ({
	Button: (props: Props) => {
		host.texts.push(String(props.label));
		host.presses.set(String(props.testID), props.onPress as () => void);
		host.variants.set(String(props.testID), props.variant);
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

const { default: Computers, COMPUTER_FACTS_CLASS } = await import(
	"./computers"
);

/* Placeholder tunnel host (AGENTS.md: never a real tunnel hostname); the NAME is
 * the shape `socket.gethostname()` gives on EC2, which is what Ola's is. */
const OLA = listed(
	"t-ola",
	"0123456789abcdef0123456789abcdef-lop.example.com",
	"ip-192-168-0-70.ca-central-1.compute.internal",
);

let root: ReturnType<typeof createRoot> | null = null;
async function render() {
	host.texts.length = 0;
	host.classNames.length = 0;
	host.icons.length = 0;
	host.pressables.clear();
	await act(async () => root?.render(createElement(Computers)));
}
const words = () => host.texts.join(" | ");
/* A 2 pt (`*.5`) spacing step, which the U-42 audit refuses. */
const HALF_STEP_GAP = /gap-(?:[xy]-)?\d*\.5/;
const ids = computerRowIds(OLA.hostname);

beforeEach(() => {
	host.params = {};
	host.refusal = null;
	store.api = createConnectionStore();
	store.api.getState().setComputers([OLA]);
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
	host.held = null;
	vi.unstubAllGlobals();
});

describe("the Computers row reads as something to press (TestFlight 883)", () => {
	it("is a button that connects, with the RAW name spoken", async () => {
		await render();
		const row = host.pressables.get(ids.row);
		expect(row?.accessibilityRole).toBe("button");
		expect(row?.onPress).toBeTypeOf("function");
		expect(String(row?.accessibilityLabel)).toContain(OLA.name);
	});

	it("is a bordered card with a glyph and a trailing chevron, not text under a hairline", async () => {
		await render();
		expect(host.classNames).toContain(
			"flex-row items-center gap-3 rounded-md border border-border-control px-3 py-3 bg-surface",
		);
		expect(
			host.classNames.some((c) => c.includes("border-b border-hairline")),
		).toBe(false);
		expect(host.icons).toEqual(
			expect.arrayContaining(["Laptop", "ChevronRight"]),
		);
	});

	it("changes ground while held", async () => {
		host.held = ids.row;
		await render();
		expect(host.classNames).toContain(
			"flex-row items-center gap-3 rounded-md border border-border-control px-3 py-3 bg-sunken",
		);
	});

	/* The status word is the catalogue's `status.route_ready` (#243), which stays
	 *  lower case because the same key is the wait panel's mid-sentence predicate;
	 *  see `computerStatusLabel`. The pin is that both facts are text, from the
	 *  catalogue, not hard-coded English. */
	it("titles the computer by its first DNS label and states both facts as catalogue text", async () => {
		await render();
		expect(host.texts).toContain("ip-192-168-0-70");
		expect(host.texts).not.toContain(OLA.name);
		expect(words()).toContain(t("mobile.computers.status.route_ready"));
		expect(words()).toContain(t("mobile.computers.protected"));
	});

	/* Design round 1, D11: at 320 pt the line wrapped as "● Route ready ·" /
	 *  "● Sign-in protected". Each fact has its own dot, so no separator glyph is
	 *  painted, and the line breaks only between whole facts. */
	it("parts the two facts by space alone, so a wrap leaves no dangling separator", async () => {
		await render();
		expect(host.texts.some((text) => text.trim() === "·")).toBe(false);
		expect(host.classNames).toContain(COMPUTER_FACTS_CLASS);
		expect(COMPUTER_FACTS_CLASS).toContain("flex-wrap");
		expect(COMPUTER_FACTS_CLASS).toContain("gap-x-3");
		/* U-42: no half-step (2 pt) spacing on the line. */
		expect(COMPUTER_FACTS_CLASS).not.toMatch(HALF_STEP_GAP);
	});

	it("puts the check in the trailing slot for the computer in use, never a chevron", async () => {
		const api = store.api?.getState();
		api?.startRoute({
			mode: "radient",
			hostname: OLA.hostname,
			tunnelId: OLA.tunnelId,
		});
		api?.selectComputer(OLA);
		api?.markLive();
		await render();
		expect(host.icons).toContain("Check");
		expect(host.icons).not.toContain("ChevronRight");
		expect(words()).toContain("active");
		expect(CONTROL.computerSelectedMarker).toBeTruthy();
	});

	it("outlines the header's Switch computer and Refresh actions", async () => {
		await render();
		expect(host.variants.get(CONTROL.computersSwitch)).toBe("outline");
		expect(host.variants.get(CONTROL.computersRefresh)).toBe("outline");
	});
});
