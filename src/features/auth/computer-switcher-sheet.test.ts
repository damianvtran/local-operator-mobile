import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedComputer } from "@/connection/saved-computers";
import { createConnectionStore } from "@/state/connection-store";
import { CONTROL, switcherRowIds } from "@/ui/a11y";

/**
 * THE SHEET, not the view model — and the distinction is the whole point of this
 * file (PR #122 round 1: review B1, design D1, QA Q1, UX U1).
 *
 * `computer-switcher-view.test.ts` asserts what a row says for a given probe
 * answer, and stayed green while the shipped sheet said "Checking…" forever: the
 * probe effect was keyed on an array rebuilt every render, so its cleanup threw
 * every answer away. Only a mounted sheet re-renders, so only a mounted sheet can
 * see that. This renders the REAL `ComputerSwitcherSheet` — its hooks, effects and
 * handlers — with null native adapters (the `pending-recovery.test.ts` pattern:
 * react-dom's client renderer over a stub container, no DOM package), a real
 * connection store, and a probe whose answers the test releases by hand AFTER
 * forcing several re-renders. It proves the effect lifecycle, not pixels: the
 * frames are the design and QA rounds' job.
 */
type Props = Record<string, unknown>;
const host = vi.hoisted(() => ({
	texts: [] as string[],
	presses: new Map<string, () => void>(),
	probes: new Map<string, Array<(value: unknown) => void>>(),
	saved: [] as SavedComputer[],
	account: null as string | null,
	closed: 0,
	pushed: [] as unknown[],
	pathname: "/settings",
	selectComputer: null as null | ((computer: unknown) => Promise<void>),
}));

/* Text is collected as rendered strings; a pressable is recorded by testID so the
 *  test can tap it the way the reader does. */
vi.mock("react-native", async () => {
	const React = await import("react");
	const flatten = (children: unknown): string =>
		Array.isArray(children)
			? children.map(flatten).join("")
			: typeof children === "string" || typeof children === "number"
				? String(children)
				: "";
	return {
		Platform: { OS: "web" },
		View: (props: Props) => (props.children ?? null) as React.ReactNode,
		Text: (props: Props) => {
			host.texts.push(flatten(props.children));
			return null;
		},
		ActivityIndicator: () => null,
		Pressable: (props: Props) => {
			if (typeof props.testID === "string")
				host.presses.set(props.testID, props.onPress as () => void);
			const children = props.children as
				| React.ReactNode
				| ((state: { pressed: boolean }) => React.ReactNode);
			return (
				typeof children === "function" ? children({ pressed: false }) : children
			) as React.ReactNode;
		},
	};
});
vi.mock("lucide-react-native", () => ({
	Check: () => null,
	Laptop: () => null,
	Plus: () => null,
	Server: () => null,
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: async () => ({}) }));
vi.mock("expo-router", () => ({
	useRouter: () => ({ push: (target: unknown) => host.pushed.push(target) }),
	usePathname: () => host.pathname,
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000" }));
vi.mock("@/ui/components/button", () => ({
	Button: (props: Props) => {
		if (typeof props.testID === "string")
			host.presses.set(props.testID, props.onPress as () => void);
		return null;
	},
}));
/* The sheet's footer is a prop, so the stub renders it to reach its button. */
vi.mock("@/ui/components/section-header", () => ({
	SectionHeader: (props: Props) => {
		host.texts.push(String(props.label));
		return null;
	},
}));
vi.mock("@/ui/components/sheet", () => ({
	Sheet: (props: Props) =>
		(props.visible
			? [props.children, props.footer]
			: null) as import("react").ReactNode,
}));
/* The probe never answers on its own: the test releases each one after the
 *  re-renders that used to discard it. */
vi.mock("@/features/auth/connector-wait", () => ({
	probeHealthAt: (origin: string) =>
		new Promise((resolve) => {
			const waiting = host.probes.get(origin) ?? [];
			waiting.push(resolve);
			host.probes.set(origin, waiting);
		}),
}));
vi.mock("@/features/auth/tunnel-storage", () => ({
	readSavedComputers: async () => host.saved,
	readStoredRadientAccount: async () => host.account,
	unhideRadientComputer: async () => {},
	unhideSavedComputer: async () => {},
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
			selectComputer: (computer: unknown) =>
				host.selectComputer?.(computer) ?? Promise.resolve(),
			connectCustom: async () => {},
			signInWithRadient: async () => {},
			savedTunnel: null,
			refusal: null,
		}),
	};
});

const { ComputerSwitcherSheet } = await import("./computer-switcher-sheet");

/* Placeholder hosts only (AGENTS.md: never a real tunnel hostname). */
const HOST_AWAKE = "0123456789abcdef0123456789abcdef-lop.example.com";
const HOST_ASLEEP = "fedcba9876543210fedcba9876543210-lop.example.com";
const ASLEEP_WORD = /Asleep/;
const radient = (
	id: string,
	tunnelId: string,
	hostname: string,
	name: string,
	account: string | null = null,
): SavedComputer => ({
	id,
	transport: "radient",
	tunnelId,
	hostname,
	name,
	account,
	addedAt: 1,
	lastUsedAt: 0,
	hidden: false,
	identity: null,
});

let root: ReturnType<typeof createRoot> | null = null;
let visible = true;
async function render() {
	host.texts.length = 0;
	await act(async () =>
		root?.render(
			createElement(ComputerSwitcherSheet, {
				visible,
				onClose: () => {
					host.closed += 1;
				},
			}),
		),
	);
}
const flush = () =>
	act(async () => {
		await new Promise<void>((resolve) => setImmediate(resolve));
	});
const words = () => host.texts.join(" | ");

beforeEach(() => {
	host.texts.length = 0;
	host.presses.clear();
	host.probes.clear();
	host.saved = [
		radient("r1", "t1", HOST_AWAKE, "Awake computer"),
		radient("r2", "t2", HOST_ASLEEP, "Asleep computer"),
	];
	host.account = null;
	host.closed = 0;
	host.pushed.length = 0;
	host.pathname = "/settings";
	host.selectComputer = null;
	visible = true;
	store.api = createConnectionStore();
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
	vi.unstubAllGlobals();
});

describe("the switcher sheet's health words resolve (B1/D1/Q1/U1)", () => {
	it("shows Online and Asleep once the probes answer, after the sheet has re-rendered many times", async () => {
		await render();
		await flush();
		expect(words()).toContain("Awake computer");
		expect(words()).toContain("Checking…");
		/* Both probes went out once. */
		expect([...host.probes.keys()].sort()).toEqual(
			[`https://${HOST_AWAKE}`, `https://${HOST_ASLEEP}`].sort(),
		);
		/* The case that broke: re-render repeatedly while the probes are in flight —
		 *  each render rebuilt `sections`, and each re-run of the old effect retired
		 *  the run whose probes were still out. */
		for (let index = 0; index < 5; index += 1) {
			await act(async () => store.api?.getState().setComputers([]));
			await render();
		}
		/* No re-probe storm: still one request per origin this open. */
		for (const waiting of host.probes.values()) expect(waiting).toHaveLength(1);

		await act(async () => {
			host.probes.get(`https://${HOST_AWAKE}`)?.[0]?.({ ok: true });
			host.probes.get(`https://${HOST_ASLEEP}`)?.[0]?.(null);
		});
		await render();
		expect(words()).toContain("Online");
		expect(words()).toMatch(ASLEEP_WORD);
		expect(words()).not.toContain("Checking…");
	});

	it("drops an answer that arrives after the sheet closed, and probes again on the next open", async () => {
		await render();
		await flush();
		const first = host.probes.get(`https://${HOST_AWAKE}`)?.[0];
		visible = false;
		await render();
		await act(async () => first?.({ ok: true }));
		visible = true;
		await render();
		await flush();
		/* The closed open's answer did not land, and this open asked again. */
		expect(words()).not.toContain("Online");
		expect(host.probes.get(`https://${HOST_AWAKE}`)).toHaveLength(2);
		await act(async () =>
			host.probes.get(`https://${HOST_AWAKE}`)?.[1]?.({ ok: true }),
		);
		await render();
		expect(words()).toContain("Online");
	});
});

describe("a failed pick does not hold the sheet (M1/U2)", () => {
	it("closes the sheet when the pick ends refused, so the screen's reason is visible", async () => {
		host.selectComputer = async () => {
			/* What the provider does on a refused mint. */
			store.api?.getState().startRoute({
				mode: "radient",
				hostname: HOST_AWAKE,
				tunnelId: "t1",
			});
			store.api?.getState().noteFailure({
				surface: "console",
				displayableMessage: "Synthetic refusal",
			});
		};
		await render();
		await flush();
		const tap = host.presses.get(switcherRowIds("r1").row);
		expect(tap).toBeTypeOf("function");
		await act(async () => tap?.());
		await flush();
		expect(store.api?.getState().phase).toBe("refused");
		expect(host.closed).toBe(1);
	});
});

describe("saved Radient computers follow the account (M2)", () => {
	it("does not list account A's computers to account B", async () => {
		host.saved = [
			radient("r1", "t1", HOST_AWAKE, "Account A computer", "acct-A"),
			radient("r2", "t2", HOST_ASLEEP, "Account B computer", "acct-B"),
		];
		host.account = "acct-B";
		await render();
		await flush();
		await render();
		expect(words()).toContain("Account B computer");
		expect(words()).not.toContain("Account A computer");
		/* And nothing probes the other account's computer. */
		expect(host.probes.has(`https://${HOST_AWAKE}`)).toBe(false);
	});
});

describe("Add a computer from the Computers screen (U6)", () => {
	it("closes instead of pushing a second Computers screen, and pushes it from anywhere else", async () => {
		host.pathname = "/tunnels";
		await render();
		await flush();
		await act(async () => host.presses.get(CONTROL.switcherAddComputer)?.());
		expect(host.closed).toBe(1);
		expect(host.pushed).toEqual([]);
		host.pathname = "/settings";
		await render();
		await act(async () => host.presses.get(CONTROL.switcherAddComputer)?.());
		expect(host.pushed).toEqual(["/tunnels"]);
	});
});
