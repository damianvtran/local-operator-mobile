import { readFileSync } from "node:fs";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredComputer } from "@/connection";
import { createConnectionStore } from "@/state/connection-store";
import { sansTextWidthDp } from "@/ui/components/list-row-meta";

/**
 * The two navigation entry points MOUNTED (M2b, ux-flows F5): the Home header
 * chip and the drawer footer's workspace row, each under the REAL
 * `ComputerSwitcherProvider`, so a tap is proved to raise the one sheet that
 * provider mounts — not a callback a stub recorded. Null native adapters, the
 * `computer-switcher-sheet.test.ts` pattern: react-dom's client renderer over a
 * stub container. It proves wiring and copy, not pixels: the frames are the
 * design and QA rounds' job.
 */
type Props = Record<string, unknown>;
const host = vi.hoisted(() => ({
	texts: [] as string[],
	labels: new Map<string, string>(),
	presses: new Map<string, () => void>(),
	sheetVisible: [] as unknown[],
	/* The focus target the ONE sheet was last handed, and the layout it ran in. */
	sheetReturnFocus: undefined as unknown,
	split: false,
	saved: [] as import("@/connection/saved-computers").SavedComputer[],
	scale: 1,
	chevrons: 0,
	navigated: 0,
	/* What `middleFit` was asked to fit into, and what it painted. */
	fitted: [] as string[],
	layoutWidth: 0,
	/* Each brand mark painted, by the testID of the Pressable it sits in
	 *  (null = outside every pressable, the dead strip UX U2 measured). */
	marks: [] as (string | null)[],
	/* Every View and Text in render order, with its class, so a test can read
	 *  the drawer row's left-to-right structure (design round 1, D12). */
	nodes: [] as { kind: "View" | "Text"; className: string; text?: string }[],
}));

vi.mock("react-native", async () => {
	const { createContext, createElement } = await import("react");
	/* The nearest Pressable's testID, so a child can prove it is INSIDE it. */
	const PressOwner = createContext<string | null>(null);
	const flatten = (children: unknown): string =>
		Array.isArray(children)
			? children.map(flatten).join("")
			: typeof children === "string" || typeof children === "number"
				? String(children)
				: "";
	return {
		Platform: { OS: "web" },
		View: (props: Props) => {
			host.nodes.push({
				kind: "View",
				className: String(props.className ?? ""),
			});
			if (host.layoutWidth > 0 && typeof props.onLayout === "function") {
				const width = host.layoutWidth;
				host.layoutWidth = 0;
				queueMicrotask(() =>
					(props.onLayout as (event: unknown) => void)({
						nativeEvent: { layout: { width } },
					}),
				);
			}
			return (props.children ?? null) as ReactNode;
		},
		Text: (props: Props) => {
			// Negative control: a Text measurement would recreate the shrink loop.
			expect(props.onLayout).toBeUndefined();
			host.texts.push(flatten(props.children));
			host.nodes.push({
				kind: "Text",
				className: String(props.className ?? ""),
				text: flatten(props.children),
			});
			return null;
		},
		ActivityIndicator: () => null,
		Pressable: (props: Props) => {
			if (typeof props.testID === "string") {
				host.presses.set(props.testID, props.onPress as () => void);
				host.labels.set(props.testID, String(props.accessibilityLabel));
			}
			return createElement(
				PressOwner.Provider,
				{ value: (props.testID as string | undefined) ?? null },
				(props.children ?? null) as ReactNode,
			);
		},
		__PressOwner: PressOwner,
	};
});
vi.mock("@/ui/components/navigation-mark", async () => {
	const { useContext } = await import("react");
	const rn = (await import("react-native")) as unknown as {
		__PressOwner: import("react").Context<string | null>;
	};
	return {
		NavigationMark: () => {
			host.marks.push(useContext(rn.__PressOwner));
			return null;
		},
	};
});
vi.mock("lucide-react-native", () => ({
	Check: () => null,
	ChevronDown: () => {
		host.chevrons += 1;
		return null;
	},
	ChevronsUpDown: () => null,
	Laptop: () => null,
	Plus: () => null,
	Server: () => null,
}));
/* The three drawn health marks are `react-native-svg` paths, so the module is in
 * this graph directly rather than only through lucide. Nulled like every other
 * native adapter here (the `modal-dismissal-ledger.test.ts` shape): this suite
 * proves wiring and copy over react-dom, and the SVG module itself does not
 * survive the node environment. */
vi.mock("react-native-svg", () => ({
	default: () => null,
	Path: () => null,
	Svg: () => null,
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: async () => ({}) }));
vi.mock("expo-router", () => ({
	useRouter: () => ({ push: () => {} }),
	usePathname: () => "/",
	useGlobalSearchParams: () => ({}),
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000" }));
vi.mock("@/ui/layout", () => ({
	TOUCH_FLOOR: 48,
	useLayout: () => ({ split: host.split }),
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: host.scale }),
}));
vi.mock("@/ui/components/button", () => ({ Button: () => null }));
vi.mock("@/ui/components/section-header", () => ({
	SectionHeader: () => null,
}));
/* The provider's ONE sheet: record every `visible` it is given. */
vi.mock("@/ui/components/sheet", () => ({
	Sheet: (props: Props) => {
		host.sheetVisible.push(props.visible);
		host.sheetReturnFocus = props.returnFocusTestID;
		return null;
	},
}));
vi.mock("@/features/auth/connector-wait", () => ({
	probeHealthAt: () => new Promise(() => {}),
}));
vi.mock("@/features/auth/tunnel-storage", () => ({
	readSavedComputers: async () => host.saved,
	readStoredRadientAccount: async () => null,
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
			selectComputer: async () => {},
			connectCustom: async () => {},
			signInWithRadient: async () => {},
			savedTunnel: null,
			refusal: null,
			discovering: false,
			signInState: { kind: "idle" },
		}),
	};
});

const { ComputerSwitcherProvider } = await import("./computer-switcher-sheet");
const {
	DRAWER_ROW_NAME_CLASS,
	DrawerComputerRow,
	drawerRowFit,
	drawerRowName,
	HeaderComputerChip,
	headerChipFit,
	switcherFocusReturn,
} = await import("./computer-entry-points");

/* Placeholder host only (AGENTS.md: never a real tunnel hostname). */
const HOST = "0123456789abcdef0123456789abcdef-lop.example.com";
const listed = (name: string): DiscoveredComputer => ({
	tunnelId: "t1",
	name,
	deviceId: "device-t1",
	hostname: HOST,
	status: "ready",
	rawStatus: "active",
	supportsLocalOperator: true,
	billing: { eligible: true, message: null },
	updatedAt: 0,
});
const CHIP = "computers-button";
const ROW = "sidebar-computers";

let root: ReturnType<typeof createRoot> | null = null;
async function mount(child: ReactNode) {
	await act(async () =>
		root?.render(createElement(ComputerSwitcherProvider, null, child)),
	);
}
const live = (name: string) =>
	act(async () => {
		const api = store.api;
		if (!api) return;
		api
			.getState()
			.startRoute({ mode: "radient", hostname: HOST, tunnelId: "t1" });
		const computer = listed(name);
		api.getState().setComputers([computer]);
		/* The store's own transitions, not a `setState` shortcut: a pick, then live. */
		api.getState().selectComputer(computer);
		api.getState().markLive();
	});
const press = (id: string) =>
	act(async () => {
		host.presses.get(id)?.();
	});
const sheetUp = () => host.sheetVisible.at(-1) === true;

beforeEach(() => {
	host.texts.length = 0;
	host.nodes.length = 0;
	host.labels.clear();
	host.presses.clear();
	host.sheetVisible.length = 0;
	host.scale = 1;
	host.saved = [];
	host.chevrons = 0;
	host.navigated = 0;
	host.layoutWidth = 0;
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

describe("the Home header chip", () => {
	it("names the computer and its health, and opens the ONE sheet", async () => {
		await mount(createElement(HeaderComputerChip, { testID: CHIP }));
		await live("Mac mini");
		expect(host.texts).toContain("Mac mini");
		expect(host.labels.get(CHIP)).toBe(
			"Computer: Mac mini, Online. Switch computer",
		);
		expect(sheetUp()).toBe(false);
		await press(CHIP);
		expect(sheetUp()).toBe(true);
	});

	/* UX U2: the mark beside the chip was a dead 20 pt target. It is now the
	 *  chip's leading glyph, so its tap IS the chip's tap. */
	it("paints the brand mark INSIDE the chip's pressable only when asked", async () => {
		host.marks = [];
		await mount(createElement(HeaderComputerChip, { testID: CHIP }));
		expect(host.marks).toEqual([]);
		await mount(
			createElement(HeaderComputerChip, { testID: CHIP, brandMark: true }),
		);
		expect(host.marks.length).toBeGreaterThan(0);
		expect(new Set(host.marks)).toEqual(new Set([CHIP]));
		await press(CHIP);
		expect(sheetUp()).toBe(true);
	});

	it("reads 'Choose a computer' with nothing chosen, and still opens the sheet", async () => {
		await mount(createElement(HeaderComputerChip, { testID: CHIP }));
		expect(host.texts).toContain("Choose a computer");
		expect(host.labels.get(CHIP)).toBe("No computer chosen. Choose a computer");
		await press(CHIP);
		expect(sheetUp()).toBe(true);
	});

	it("fits a long name to its measured width with an ellipsis, one line", async () => {
		const long = "The studio Mac Pro under the desk in the back office";
		await mount(createElement(HeaderComputerChip, { testID: CHIP }));
		host.layoutWidth = 90;
		await live(long);
		await act(async () => {
			await new Promise<void>((resolve) => setImmediate(resolve));
		});
		const painted = host.texts.filter((text) => text.includes("…"));
		expect(painted.length).toBeGreaterThan(0);
		expect(painted.at(-1)?.length).toBeLessThan(long.length);
		// The accessible name keeps the whole name.
		expect(host.labels.get(CHIP)).toContain(long);
	});

	it("drops its chevron at 200 % text, as the bell drops its count", async () => {
		await mount(createElement(HeaderComputerChip, { testID: CHIP }));
		await live("Mac mini");
		expect(host.chevrons).toBeGreaterThan(0);
		host.chevrons = 0;
		host.scale = 2;
		await mount(createElement(HeaderComputerChip, { testID: CHIP }));
		await live("Mac mini 2");
		expect(host.chevrons).toBe(0);
	});
});

describe("the drawer footer's workspace row", () => {
	it("paints name and health word, closes the drawer, opens the ONE sheet", async () => {
		let closed = 0;
		await mount(
			createElement(DrawerComputerRow, {
				testID: ROW,
				onNavigate: () => {
					closed += 1;
				},
			}),
		);
		await live("Mac mini");
		expect(host.texts).toContain("Mac mini");
		expect(host.texts).toContain("· Online");
		expect(host.labels.get(ROW)).toBe(
			"Computer: Mac mini, Online. Switch computer",
		);
		await press(ROW);
		expect(closed).toBe(1);
		expect(sheetUp()).toBe(true);
	});

	it("reads 'Choose a computer' with nothing chosen", async () => {
		await mount(createElement(DrawerComputerRow, { testID: ROW }));
		expect(host.texts).toContain("Choose a computer");
		await press(ROW);
		expect(sheetUp()).toBe(true);
	});

	/* Review round 1, R3: the split layout does not render the header chip
	 *  (`home.tsx`: `{split ? null : <HeaderComputerChip …`), so naming it as the
	 *  focus target sent the sheet's close after a node that is not there. */
	/* UX round 1, U2: a session screen renders no Home chip, so naming ONLY the
	 *  chip left focus on nothing after drawer → switcher → Escape. The phone
	 *  names a fallback order; the Sheet takes the first that accepts focus. */
	it("names a fallback chain on a phone: the chip, itself, then the drawer's own opener", async () => {
		host.split = false;
		await mount(createElement(DrawerComputerRow, { testID: ROW }));
		await press(ROW);
		expect(host.sheetReturnFocus).toEqual([
			CHIP,
			ROW,
			"session-back",
			"home-sidebar",
		]);
	});

	/* Design round 1 D1 / QA round 2 Q2, and the web audit's U-08 on
	 *  S15/loading at 200 %: the health word was `shrink-0`, so the NAME paid for
	 *  every missing point and an unshrinkable "· Checking…" left the row. */
	describe("the name keeps priority; the status word drops first", () => {
		const WORD = "· Online";
		it("paints both when the whole name fits beside the word", () => {
			expect(drawerRowFit("Mac mini", WORD, 200, 1, 12)).toEqual({
				name: "Mac mini",
				word: WORD,
			});
		});
		it("drops the word whole, and paints the WHOLE name, when both do not fit", () => {
			/* Wide enough for the name alone, not for name + gap + word. */
			const both = drawerRowFit("192.168.100.210", WORD, 400, 1, 12);
			expect(both.word).toBe(WORD);
			const fit = drawerRowFit("192.168.100.210", WORD, 120, 1, 12);
			expect(fit).toEqual({ name: "192.168.100.210", word: null });
		});
		it("cuts the name only once the word is already gone", () => {
			const fit = drawerRowFit("192.168.100.210", WORD, 40, 1, 12);
			expect(fit.word).toBeNull();
			expect(fit.name).toContain("…");
		});
		it("drops an unshrinkable word at 200 % rather than let it leave the row", () => {
			/* The S15/loading frame: a short name, "· Checking…" at 24 pt, and
			 *  a slot far narrower than the word alone. */
			expect(drawerRowFit("…", "· Checking…", 60, 2, 24)).toEqual({
				name: "…",
				word: null,
			});
		});
		/* TestFlight 883 (Ola, 430 pt drawer, design D9): his EC2 name in the
		 *  measured 281 pt slot painted `ip-192-16…ca-central-1.compute.inte…` —
		 *  the fit's ellipsis, then the Text's own, because the advance table
		 *  under-counts this string by ~14 % (`DRAWER_CUT_MARGIN`). */
		const OLA = "ip-192-168-0-70.ca-central-1.compute.internal";
		it("cuts a long DNS name with headroom, so the web paints one ellipsis", () => {
			const fit = drawerRowFit(OLA, WORD, 281, 1, 12);
			expect(fit.word).toBeNull();
			expect(fit.name.split("…")).toHaveLength(2);
			expect(sansTextWidthDp(fit.name, 14 / 12)).toBeLessThanOrEqual(
				281 * 0.86,
			);
		});
		it("hands native the raw name to truncate once in the middle; the web paints the fit", () => {
			const fit = drawerRowFit(OLA, WORD, 281, 1, 12);
			expect(drawerRowName(OLA, fit, "ios")).toEqual({
				text: OLA,
				ellipsizeMode: "middle",
			});
			expect(drawerRowName(OLA, fit, "android").text).toBe(OLA);
			expect(drawerRowName(OLA, fit, "web")).toEqual({
				text: fit.name,
				ellipsizeMode: "tail",
			});
		});
		it("keeps the health word for Ola's computer once its title is shortened (D4)", () => {
			expect(drawerRowFit("ip-192-168-0-70", WORD, 281, 1, 12)).toEqual({
				name: "ip-192-168-0-70",
				word: WORD,
			});
		});
		it("paints both before the slot is measured, so the common case never reflows", () => {
			expect(drawerRowFit("Mac mini", WORD, 0, 1, 12)).toEqual({
				name: "Mac mini",
				word: WORD,
			});
		});
		it("the row renders what the fit decides: no word in a slot too narrow for it", async () => {
			await mount(createElement(DrawerComputerRow, { testID: ROW }));
			host.layoutWidth = 60;
			await live("Mac mini");
			await act(async () => {
				await new Promise<void>((resolve) => setImmediate(resolve));
			});
			host.texts.length = 0;
			await live("Mac mini");
			expect(host.texts).toContain("Mac mini");
			expect(host.texts).not.toContain(WORD);
			/* The state is still spoken in full. */
			expect(host.labels.get(ROW)).toBe(
				"Computer: Mac mini, Online. Switch computer",
			);
		});
	});

	/* Design round 1, D12: the name was `flex-1`, so "· Online" sat ~110 pt
	 *  from it against ⇅. Read the painted structure left to right: the name
	 *  is a shrinkable box that never grows, the word follows it directly, and
	 *  a growing spacer comes after the word. */
	it("keeps the health word beside the name, with the free space after it", async () => {
		await mount(createElement(DrawerComputerRow, { testID: ROW }));
		host.nodes.length = 0;
		await live("Mac mini");
		const word = "· Online";
		const last = (predicate: (n: (typeof host.nodes)[number]) => boolean) =>
			host.nodes.map(predicate).lastIndexOf(true);
		const name = last((n) => n.kind === "Text" && n.text === "Mac mini");
		const after = last((n) => n.kind === "Text" && n.text === word);
		expect(name).toBeGreaterThanOrEqual(0);
		expect(after).toBe(name + 1);
		expect(host.nodes[name]?.className).toBe(DRAWER_ROW_NAME_CLASS);
		expect(DRAWER_ROW_NAME_CLASS.split(" ")).toEqual(
			expect.arrayContaining(["min-w-0", "shrink"]),
		);
		expect(DRAWER_ROW_NAME_CLASS.split(" ")).not.toContain("flex-1");
		expect(host.nodes[after + 1]).toEqual({
			kind: "View",
			className: "flex-1",
		});
	});

	it("returns focus to ITSELF in the split layout, where the chip is not rendered", async () => {
		host.split = true;
		try {
			await mount(createElement(DrawerComputerRow, { testID: ROW }));
			await press(ROW);
			expect(host.sheetReturnFocus).toBe(ROW);
		} finally {
			host.split = false;
		}
	});

	it("the pane's other opener (the no-computer empty state) follows the same rule", () => {
		expect(switcherFocusReturn(false, "sessions-connect")).toEqual([
			CHIP,
			"sessions-connect",
			"session-back",
			"home-sidebar",
		]);
		expect(switcherFocusReturn(true, "sessions-connect")).toBe(
			"sessions-connect",
		);
		const PANE = readFileSync(
			new URL("../sessions/conversations-pane.tsx", import.meta.url),
			"utf8",
		).replace(/\s+/g, " ");
		expect(PANE).toContain(
			"returnFocusTestID: switcherFocusReturn( layout.split, CONTROL.sessionsConnectAction, )",
		);
		/* The stale literal is gone from both pane openers. */
		expect(PANE).not.toContain("returnFocusTestID: CONTROL.computersButton");
	});
});

/* The header's D24 rules, over the SOURCE (the screen reaches `uniwind` through
 *  `@/ui`, which Node cannot import — `header-fit.test.ts` reasons the same way):
 *  the chip keeps the slot's `min-w-0 flex-1` and its both-axis floor, and the
 *  bell follows it in the same row. Settings moved to the sidebar's workspace
 *  row (decision record 2026-11-04 §2.4), which is what frees the chip's width. */
describe("the chip in the Home header", () => {
	const HOME = readFileSync(
		new URL("../home/home.tsx", import.meta.url),
		"utf8",
	).replace(/\s+/g, " ");
	const CHIP_SOURCE = readFileSync(
		new URL("./computer-entry-points.tsx", import.meta.url),
		"utf8",
	).replace(/\s+/g, " ");
	it("sits where the label was, before the bell, with Settings gone from the header", () => {
		const chip = HOME.indexOf(
			"<HeaderComputerChip testID={CONTROL.computersButton}",
		);
		expect(chip).toBeGreaterThan(0);
		expect(HOME.indexOf("testID={CONTROL.homeNotifications}")).toBeGreaterThan(
			chip,
		);
		expect(HOME).not.toContain("testID={CONTROL.settingsButton}");
		/* D-H3 is reversed on the operator's word (build 453: "add the local
		 *  operator logo to the left of the local operator title"): ONE mark, the
		 *  existing asset, as the chip's LEADING glyph inside its pressable (UX
		 *  U2), yielding on the bell's own gate so the chip keeps its floor at
		 *  320 pt / large text. */
		expect(HOME).not.toContain("<NavigationMark");
		expect(HOME.slice(chip, chip + 900)).toContain(
			"brandMark={viewport.width >= 360 && effectiveScale < 1.5}",
		);
		const header = CHIP_SOURCE.slice(
			CHIP_SOURCE.indexOf("export function HeaderComputerChip"),
			CHIP_SOURCE.indexOf("export function DrawerComputerRow"),
		);
		expect(header.match(/<NavigationMark /g) ?? []).toHaveLength(1);
		const mark = header.indexOf(
			"<NavigationMark size={CONTROL_HEIGHTS.icon.icon} />",
		);
		expect(mark).toBeGreaterThan(header.indexOf("<Pressable"));
		expect(mark).toBeLessThan(header.indexOf("<HealthMark"));
		expect(mark).toBeLessThan(header.indexOf("</Pressable>"));
		expect(HOME).not.toContain("— choose a computer");
	});
	it("keeps the both-axis touch floor and yields width, never the bell", () => {
		const header = CHIP_SOURCE.slice(
			CHIP_SOURCE.indexOf("export function HeaderComputerChip"),
			CHIP_SOURCE.indexOf("export function DrawerComputerRow"),
		);
		expect(header).toContain(
			/* Spec §1: a 10 pt rounded rectangle with the kit's 12 pt inset, not
			 *  a capsule whose mark sat 2.5 pt from its edge. */
			'className="min-w-0 flex-1 flex-row items-center gap-2 rounded-md border border-border-control px-3"',
		);
		expect(header).toContain(
			"style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}",
		);
		expect(header).toContain("numberOfLines={1}");
		/* D-H1: the head of the name survives, not its middle. */
		expect(header).toContain("headerChipFit(label, nameWidth, effectiveScale)");
	});
});

describe("headerChipFit (D-H1)", () => {
	it("keeps the whole name when it fits, as at 393 pt / 100 %", () => {
		// 281 pt is the chip's slot on a 393 pt phone (record §2.4) less its mark
		// and chevron; the record's own example name.
		expect(headerChipFit("Mac – Local Operator", 220, 1)).toBe(
			"Mac – Local Operator",
		);
	});
	it("keeps the HEAD and drops the tail when it does not", () => {
		const fitted = headerChipFit("Mac – Local Operator", 90, 1);
		expect(fitted.startsWith("Mac")).toBe(true);
		expect(fitted.endsWith("…")).toBe(true);
		expect(fitted).not.toContain("Operator");
	});
	it("still keeps a host:port's port (the identifying half)", () => {
		expect(headerChipFit("127.0.0.1:49892", 70, 1)).toContain(":49892");
	});
});

describe("slot fitting regression", () => {
	for (const Component of [HeaderComputerChip, DrawerComputerRow]) {
		for (const [name, width, scale] of [
			["Mac mini", 160, 1],
			["Choose a computer", 194, 1],
			["Connect a computer", 194, 1],
			["127.0.0.1:65423", 180, 1],
			["QA Studio Mac", 200, 2],
		] as const) {
			it(`${Component.name} keeps ${name} whole at ${scale}x and is a layout fixed point`, async () => {
				host.scale = scale;
				await mount(createElement(Component, { testID: CHIP }));
				await live(name);
				for (let i = 0; i < 4; i++) {
					host.texts = [];
					host.layoutWidth = width;
					await mount(createElement(Component, { testID: CHIP }));
					await act(async () => {
						await new Promise<void>((resolve) => setImmediate(resolve));
					});
					expect(host.texts).toContain(name);
					expect(
						host.texts.filter((text) => text.includes("…") && text !== "…"),
					).toEqual([]);
				}
			});
		}
	}
});

it("updates both mounted entry points to the saved Radient label after a custom-to-Radient switch with no discovery", async () => {
	host.saved = [
		{
			id: "saved-t1",
			transport: "radient",
			tunnelId: "t1",
			hostname: HOST,
			name: "QA Laptop",
			account: null,
			addedAt: 1,
			lastUsedAt: 1,
			hidden: false,
			identity: null,
		},
	];
	await mount([
		createElement(HeaderComputerChip, { key: "chip", testID: CHIP }),
		createElement(DrawerComputerRow, { key: "row", testID: ROW }),
	]);
	await act(async () => {
		const state = store.api?.getState();
		if (!state) throw new Error("missing store");
		state.startRoute({
			mode: "custom",
			baseUrl: "https://relay.example.com",
			allowInsecure: false,
		});
		state.startRoute({ mode: "radient", tunnelId: "t1", hostname: HOST });
		state.selectComputer(listed("Discovery is not populated"));
		state.markLive();
		state.noteComputer("saved-t1");
	});
	expect(store.api?.getState().discoveredComputers).toEqual([]);
	expect(host.labels.get(CHIP)).toBe(
		"Computer: QA Laptop, Online. Switch computer",
	);
	expect(host.labels.get(ROW)).toBe(host.labels.get(CHIP));
});
