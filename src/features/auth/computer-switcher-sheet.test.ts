import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredComputer } from "@/connection";
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
	dismissed: 0,
	/* The props the stub Sheet last received, so a test can fire its close and
	 *  dismissal the way the real modal does (R5-m1). */
	sheet: null as Props | null,
	pushed: [] as unknown[],
	pathname: "/settings",
	params: {} as Record<string, string>,
	readGate: null as Promise<void> | null,
	selectComputer: null as null | ((computer: unknown) => Promise<void>),
	discovering: false,
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
	useGlobalSearchParams: () => host.params,
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
	Sheet: (props: Props) => {
		host.sheet = props;
		return (
			props.visible ? [props.children, props.footer] : null
		) as import("react").ReactNode;
	},
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
	/* `readGate` holds the registry read so a test can look at the frame BEFORE it
	 *  lands; without it, async `act` lets the read finish inside the same render. */
	readSavedComputers: async () => {
		await host.readGate;
		return host.saved;
	},
	readStoredRadientAccount: async () => {
		await host.readGate;
		return host.account;
	},
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
			discovering: host.discovering,
			signInState: { kind: "idle" },
		}),
	};
});

const { ComputerSwitcherProvider, ComputerSwitcherSheet, useComputerSwitcher } =
	await import("./computer-switcher-sheet");

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

/* A discovered row in the shape the provider stores (`DiscoveredComputer`). */
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
				/* The real provider counts completed dismissals; this host records them
				 *  so a test can assert the sheet reported one. */
				onDismiss: () => {
					host.dismissed += 1;
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
	host.dismissed = 0;
	host.sheet = null;
	host.pushed.length = 0;
	host.pathname = "/settings";
	host.params = {};
	host.readGate = null;
	host.selectComputer = null;
	host.discovering = false;
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

describe("Add a computer reaches an add path from every screen (U6, U12)", () => {
	const ADD = { pathname: "/tunnels", params: { add: "1" } };

	it("closes over a Computers screen already showing the set-up paths", async () => {
		/* An empty account: the screen behind IS the set-up path (U6). */
		host.pathname = "/tunnels";
		await render();
		await flush();
		await act(async () => host.presses.get(CONTROL.switcherAddComputer)?.());
		expect(host.closed).toBe(1);
		expect(host.pushed).toEqual([]);
		/* The add mode itself: the same. */
		host.params = { add: "1" };
		await act(async () =>
			store.api
				?.getState()
				.setComputers([listed("t1", HOST_AWAKE, "Awake computer")]),
		);
		await render();
		await act(async () => host.presses.get(CONTROL.switcherAddComputer)?.());
		expect(host.pushed).toEqual([]);
	});

	it("opens the set-up paths over a POPULATED Computers list, and from Settings (U12)", async () => {
		host.pathname = "/tunnels";
		await act(async () =>
			store.api
				?.getState()
				.setComputers([listed("t1", HOST_AWAKE, "Awake computer")]),
		);
		await render();
		await flush();
		await act(async () => host.presses.get(CONTROL.switcherAddComputer)?.());
		expect(host.closed).toBe(1);
		expect(host.pushed).toEqual([ADD]);
		host.pathname = "/settings";
		await render();
		await act(async () => host.presses.get(CONTROL.switcherAddComputer)?.());
		expect(host.pushed).toEqual([ADD, ADD]);
	});

	it("pushes over an empty Computers list that is still loading, as that screen shows no add path (R3-n1)", async () => {
		/* No rows yet and discovery in flight: the screen behind is a skeleton, not
		 *  the set-up paths, so a bare close would leave the reader on it. */
		host.pathname = "/tunnels";
		host.discovering = true;
		await render();
		await flush();
		await act(async () => host.presses.get(CONTROL.switcherAddComputer)?.());
		expect(host.pushed).toEqual([ADD]);
		/* A failed discovery: a banner, still no add path. */
		host.discovering = false;
		await act(async () =>
			store.api?.getState().noteDiscoveryFailure("unreachable"),
		);
		await render();
		await act(async () => host.presses.get(CONTROL.switcherAddComputer)?.());
		expect(host.pushed).toEqual([ADD, ADD]);
	});
});

describe("reopening after an account switch shows and probes only the new account (review round 2, m1)", () => {
	it("never paints or probes account A's computer once B is signed in", async () => {
		host.saved = [
			radient("r1", "t1", HOST_AWAKE, "Account A computer", "acct-A"),
		];
		host.account = "acct-A";
		await render();
		await flush();
		await render();
		expect(words()).toContain("Account A computer");
		expect(host.probes.get(`https://${HOST_AWAKE}`)).toHaveLength(1);

		/* Close, then "Sign in again" as B: the registry and the grant both move. */
		visible = false;
		await render();
		host.account = "acct-B";
		let landRead!: () => void;
		host.readGate = new Promise<void>((resolve) => {
			landRead = resolve;
		});
		visible = true;
		/* The reopen's frames BEFORE the registry read lands. */
		await render();
		await flush();
		await render();
		expect(words()).not.toContain("Account A computer");
		/* Nor a "No computers" answer the read has not given yet. */
		expect(words()).not.toContain("No computers on this phone yet.");
		expect(host.probes.get(`https://${HOST_AWAKE}`)).toHaveLength(1);
		await act(async () => landRead());
		await flush();
		await render();
		expect(words()).not.toContain("Account A computer");
		/* A's host was probed once, for A's open, and never again. */
		expect(host.probes.get(`https://${HOST_AWAKE}`)).toHaveLength(1);
	});
});

describe("the provider counts the dismissals Settings waits on (review round 5, R5-m1)", () => {
	/* Settings reveals a refusal only once no dismissal is owed (`dismissals >=
	 *  closes`). That contract holds only if the provider counts BOTH and the Sheet's
	 *  `onDismiss` is wired through to it: removing the forwarding would leave a web
	 *  close owed forever and every switcher-caused refusal unrevealed. */
	it("counts a close when the sheet goes down and a dismissal when the Sheet reports one", async () => {
		let seen: ReturnType<typeof useComputerSwitcher> | null = null;
		const Probe = () => {
			seen = useComputerSwitcher();
			return null;
		};
		const snap = () => {
			const s = seen as ReturnType<typeof useComputerSwitcher> | null;
			return {
				visible: s?.visible,
				closes: s?.closes,
				dismissals: s?.dismissals,
			};
		};
		/* Fires a handler the provider handed the (stubbed) Sheet; a missing one throws,
		 *  which is the failure removing the wiring must produce. */
		const fire = (name: "onClose" | "onDismiss") => {
			const handler = host.sheet?.[name];
			if (typeof handler !== "function")
				throw new Error(`the provider passed the Sheet no ${name}`);
			handler();
		};
		await act(async () =>
			root?.render(
				createElement(ComputerSwitcherProvider, null, createElement(Probe)),
			),
		);
		expect(snap()).toEqual({ visible: false, closes: 0, dismissals: 0 });
		await act(async () => (seen as unknown as { open: () => void }).open());
		expect(snap()).toEqual({ visible: true, closes: 0, dismissals: 0 });
		await act(async () => fire("onClose"));
		/* Down but not yet dismissed: one dismissal owed. */
		expect(snap()).toEqual({ visible: false, closes: 1, dismissals: 0 });
		expect(typeof host.sheet?.onDismiss).toBe("function");
		await act(async () => fire("onDismiss"));
		expect(snap()).toEqual({ visible: false, closes: 1, dismissals: 1 });
		/* A stray dismissal never runs ahead of the closes it settles. */
		await act(async () => fire("onDismiss"));
		expect(snap()).toEqual({ visible: false, closes: 1, dismissals: 1 });
	});
});
