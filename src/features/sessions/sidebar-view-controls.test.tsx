import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionSummary } from "@/contracts";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { CONTROL, sidebarSectionSwitchId } from "@/ui/a11y";

/**
 * The View options controls drive the drawer's list (TestFlight 906): a press
 * on each control changes what `arrangeSidebar` draws. The REAL controls
 * component and the REAL arrangement run; only the platform leaves are replaced
 * by recorders (`uniwind` and the native switch cannot load in Node — the limit
 * `workspace-drawer.test.tsx` records), so each press is the control's own
 * `onPress`/`onChange`, keyed by the testID the e2e flows address.
 */

const host = vi.hoisted(() => ({
	presses: new Map<string, () => void>(),
	choices: new Map<string, () => void>(),
	roles: new Map<string, string>(),
	checked: new Map<string, boolean>(),
	ariaChecked: new Map<string, boolean>(),
}));

vi.mock("react-native", () => ({
	View: ({ children }: { children?: import("react").ReactNode }) =>
		children ?? null,
	Text: ({ children }: { children?: import("react").ReactNode }) =>
		children ?? null,
	Switch: () => null,
	Pressable: (props: {
		children?: import("react").ReactNode;
		testID: string;
		onPress: () => void;
		accessibilityRole?: string;
		accessibilityState?: { checked?: boolean };
		"aria-checked"?: boolean;
	}) => {
		host.presses.set(props.testID, props.onPress);
		if (props.accessibilityRole)
			host.roles.set(props.testID, props.accessibilityRole);
		if (props.accessibilityState?.checked !== undefined)
			host.checked.set(props.testID, props.accessibilityState.checked);
		if (props["aria-checked"] !== undefined)
			host.ariaChecked.set(props.testID, props["aria-checked"]);
		return props.children ?? null;
	},
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "black" }));
vi.mock("@/ui/layout", () => ({ TOUCH_FLOOR: 44 }));
vi.mock("@/ui/components/segmented", () => ({
	Segmented: (props: {
		options: { value: string; testID: string }[];
		onChange: (value: string) => void;
	}) => {
		for (const option of props.options)
			host.choices.set(option.testID, () => props.onChange(option.value));
		return null;
	},
}));

const { SidebarViewControls } = await import(
	"@/features/sessions/sidebar-view-controls"
);
const { arrangeSidebar, DEFAULT_SIDEBAR_VIEW } = await import(
	"@/features/sessions/sidebar-view"
);
type View = typeof DEFAULT_SIDEBAR_VIEW;

const NOON = new Date(2026, 10, 13, 12, 0, 0, 0).getTime();
const row = (id: string, extra: Partial<SessionSummary>): SessionSummary =>
	({
		session_id: id,
		pinned: false,
		streaming: false,
		needs_attention: false,
		ended: false,
		mtime: NOON / 1000 - 3600,
		...extra,
	}) as SessionSummary;
const ROWS = [
	row("ended", { ended: true, mtime: NOON / 1000 - 60 }),
	row("running", { streaming: true, created_at: NOON / 1000 - 600 }),
	row("open", { mtime: NOON / 1000 - 120 }),
];

let current: View = DEFAULT_SIDEBAR_VIEW;
function Harness({ scope }: { scope: "sheet" | "settings" }) {
	const [view, setView] = useState<View>(DEFAULT_SIDEBAR_VIEW);
	current = view;
	return createElement(SidebarViewControls, { view, onChange: setView, scope });
}
const drawn = () =>
	arrangeSidebar(ROWS, current, NOON).map(
		(group) => `${group.key}:${group.rows.map((r) => r.session_id).join(",")}`,
	);

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	dom = installDomShim();
	root = createRoot(dom.container as never);
	host.presses.clear();
	host.choices.clear();
	host.roles.clear();
	host.checked.clear();
	host.ariaChecked.clear();
	current = DEFAULT_SIDEBAR_VIEW;
});
afterEach(() => {
	act(() => root.unmount());
	dom.dispose();
});

const press = (map: Map<string, () => void>, id: string) => {
	const handler = map.get(id);
	if (!handler) throw new Error(`no control ${id}`);
	act(() => handler());
};

describe("the View options sheet", () => {
	it("each control changes the drawn list", () => {
		act(() => root.render(createElement(Harness, { scope: "sheet" })));
		expect(drawn()).toEqual(["running:running", "today:ended,open"]);

		press(host.choices, CONTROL.sidebarViewGroupFlat);
		expect(drawn()).toEqual(["all:running,ended,open"]);

		press(host.choices, CONTROL.sidebarViewOrderRecent);
		expect(drawn()).toEqual(["all:ended,open,running"]);

		expect(host.roles.get(CONTROL.sidebarViewShowEnded)).toBe("switch");
		expect(host.checked.get(CONTROL.sidebarViewShowEnded)).toBe(true);
		press(host.presses, CONTROL.sidebarViewShowEnded);
		expect(host.checked.get(CONTROL.sidebarViewShowEnded)).toBe(false);
		expect(drawn()).toEqual(["all:open,running"]);

		press(host.choices, CONTROL.sidebarViewGroupSection);
		press(host.choices, CONTROL.sidebarViewOrderActiveFirst);
		expect(drawn()).toEqual(["running:running", "today:open"]);
	});

	it("is compact: no clock or per-section switches in the sheet", () => {
		act(() => root.render(createElement(Harness, { scope: "sheet" })));
		expect(host.choices.has(CONTROL.settingsSidebarBasisCreated)).toBe(false);
		expect(host.presses.has(sidebarSectionSwitchId("today"))).toBe(false);
	});
});

describe("Settings → Sidebar", () => {
	it("holds the full set: clock and section switches change the list", () => {
		act(() => root.render(createElement(Harness, { scope: "settings" })));
		press(host.presses, sidebarSectionSwitchId("running"));
		expect(host.checked.get(sidebarSectionSwitchId("running"))).toBe(false);
		expect(drawn()).toEqual(["today:ended,open"]);

		press(host.choices, CONTROL.settingsSidebarBasisCreated);
		// `ended` and `open` carry no birth stamp, so Created reads their `mtime`
		// (older relay fallback); `ended`'s 1 min still leads `open`'s 2 min.
		expect(current.basis).toBe("created");
		expect(drawn()).toEqual(["today:ended,open"]);

		press(host.presses, CONTROL.settingsSidebarShowEnded);
		expect(drawn()).toEqual(["today:open"]);
	});
});

describe("review round 1 remediation", () => {
	it("Q1: the switch row states its value to the web's tree as well as the native one", () => {
		// react-native-web drops `accessibilityState.checked` for role `switch`, so a
		// browser screen reader heard no on/off; `Segmented` sets `aria-checked` too.
		act(() => root.render(createElement(Harness, { scope: "sheet" })));
		expect(host.ariaChecked.get(CONTROL.sidebarViewShowEnded)).toBe(true);
		press(host.presses, CONTROL.sidebarViewShowEnded);
		expect(host.ariaChecked.get(CONTROL.sidebarViewShowEnded)).toBe(false);
	});
});
