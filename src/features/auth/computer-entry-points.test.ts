import { readFileSync } from "node:fs";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredComputer } from "@/connection";
import { createConnectionStore } from "@/state/connection-store";

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
	scale: 1,
	chevrons: 0,
	navigated: 0,
	/* What `middleFit` was asked to fit into, and what it painted. */
	fitted: [] as string[],
	layoutWidth: 0,
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
		View: (props: Props) => (props.children ?? null) as ReactNode,
		Text: (props: Props) => {
			/* Fire the measured width once, as `onLayout` does after first paint. */
			if (host.layoutWidth > 0 && typeof props.onLayout === "function") {
				const width = host.layoutWidth;
				host.layoutWidth = 0;
				queueMicrotask(() =>
					(props.onLayout as (e: unknown) => void)({
						nativeEvent: { layout: { width } },
					}),
				);
			}
			host.texts.push(flatten(props.children));
			return null;
		},
		ActivityIndicator: () => null,
		Pressable: (props: Props) => {
			if (typeof props.testID === "string") {
				host.presses.set(props.testID, props.onPress as () => void);
				host.labels.set(props.testID, String(props.accessibilityLabel));
			}
			return (props.children ?? null) as ReactNode;
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
vi.mock("expo-web-browser", () => ({ openBrowserAsync: async () => ({}) }));
vi.mock("expo-router", () => ({
	useRouter: () => ({ push: () => {} }),
	usePathname: () => "/",
	useGlobalSearchParams: () => ({}),
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000" }));
vi.mock("@/ui/layout", () => ({ TOUCH_FLOOR: 48 }));
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
		return null;
	},
}));
vi.mock("@/features/auth/connector-wait", () => ({
	probeHealthAt: () => new Promise(() => {}),
}));
vi.mock("@/features/auth/tunnel-storage", () => ({
	readSavedComputers: async () => [],
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
const { DrawerComputerRow, HeaderComputerChip } = await import(
	"./computer-entry-points"
);

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
	host.labels.clear();
	host.presses.clear();
	host.sheetVisible.length = 0;
	host.scale = 1;
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
});

/* The header's D24 rules, over the SOURCE (the screen reaches `uniwind` through
 *  `@/ui`, which Node cannot import — `header-fit.test.ts` reasons the same way):
 *  the chip keeps the slot's `min-w-0 flex-1` and its both-axis floor, and the
 *  bell and Settings follow it in the same row. */
describe("the chip in the Home header", () => {
	const HOME = readFileSync(
		new URL("../home/home.tsx", import.meta.url),
		"utf8",
	).replace(/\s+/g, " ");
	const CHIP_SOURCE = readFileSync(
		new URL("./computer-entry-points.tsx", import.meta.url),
		"utf8",
	).replace(/\s+/g, " ");
	it("sits where the label was, before the bell and Settings", () => {
		const chip = HOME.indexOf(
			"<HeaderComputerChip testID={CONTROL.computersButton} />",
		);
		expect(chip).toBeGreaterThan(0);
		expect(HOME.indexOf("testID={CONTROL.homeNotifications}")).toBeGreaterThan(
			chip,
		);
		expect(HOME.indexOf("testID={CONTROL.settingsButton}")).toBeGreaterThan(
			chip,
		);
		expect(HOME).not.toContain("— choose a computer");
	});
	it("keeps the both-axis touch floor and yields width, never the bell", () => {
		const header = CHIP_SOURCE.slice(
			CHIP_SOURCE.indexOf("export function HeaderComputerChip"),
			CHIP_SOURCE.indexOf("export function DrawerComputerRow"),
		);
		expect(header).toContain(
			'className="min-w-0 flex-1 flex-row items-center gap-1.5"',
		);
		expect(header).toContain(
			"style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}",
		);
		expect(header).toContain("numberOfLines={1}");
		expect(header).toContain("middleFit(label, nameWidth, effectiveScale)");
	});
});
