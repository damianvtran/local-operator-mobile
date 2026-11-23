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
	/** Each `Segmented`'s selected value, by the group's testID. */
	groups: new Map<string, string>(),
	hints: new Map<string, string | undefined>(),
	/** Every string a `Text` printed: what is on screen, as opposed to read. */
	texts: [] as string[],
	/** The platform the row believes it is on (`Platform.OS`). */
	os: "web" as string,
	/** The props the platform `Switch` was last drawn with. */
	switchProps: null as null | Record<string, unknown>,
}));

vi.mock("react-native", () => ({
	View: ({ children }: { children?: import("react").ReactNode }) =>
		children ?? null,
	Text: ({ children }: { children?: import("react").ReactNode }) => {
		if (typeof children === "string") host.texts.push(children);
		return children ?? null;
	},
	Platform: {
		get OS() {
			return host.os;
		},
	},
	Switch: (props: Record<string, unknown>) => {
		host.switchProps = props;
		return null;
	},
	Pressable: (props: {
		children?: import("react").ReactNode;
		testID: string;
		onPress: () => void;
		accessibilityRole?: string;
		accessibilityState?: { checked?: boolean };
		"aria-checked"?: boolean;
		accessibilityHint?: string;
	}) => {
		host.presses.set(props.testID, props.onPress);
		host.hints.set(props.testID, props.accessibilityHint);
		if (props.accessibilityRole)
			host.roles.set(props.testID, props.accessibilityRole);
		if (props.accessibilityState?.checked !== undefined)
			host.checked.set(props.testID, props.accessibilityState.checked);
		if (props["aria-checked"] !== undefined)
			host.ariaChecked.set(props.testID, props["aria-checked"]);
		return props.children ?? null;
	},
}));
/* The token colour IS the role name here, so a test reads which role painted
 *  which part of the switch. */
vi.mock("@/ui/appearance", () => ({ useTokenColor: (role: string) => role }));
vi.mock("@/ui/layout", () => ({ TOUCH_FLOOR: 44 }));
vi.mock("@/ui/components/segmented", () => ({
	Segmented: (props: {
		value: string;
		testID: string;
		options: { value: string; testID: string }[];
		onChange: (value: string) => void;
	}) => {
		host.groups.set(props.testID, props.value);
		for (const option of props.options)
			host.choices.set(option.testID, () => props.onChange(option.value));
		return null;
	},
}));

const { SidebarViewControls, SwitchRow } = await import(
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
	row("open", {
		mtime: NOON / 1000 - 120,
		tags: [{ id: "work", name: "Work" }],
		primary: "work",
	}),
];

let current: View = DEFAULT_SIDEBAR_VIEW;
let tagsOn = false;
function Harness({
	scope,
	tagsAvailable = false,
	initial = DEFAULT_SIDEBAR_VIEW,
}: {
	scope: "sheet" | "settings";
	tagsAvailable?: boolean;
	initial?: View;
}) {
	const [view, setView] = useState<View>(initial);
	current = view;
	tagsOn = tagsAvailable;
	return createElement(SidebarViewControls, {
		view,
		onChange: setView,
		scope,
		tagsAvailable,
	});
}
const drawn = () =>
	arrangeSidebar(ROWS, current, NOON, { tagsAvailable: tagsOn }).map(
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
	host.groups.clear();
	host.hints.clear();
	host.texts.length = 0;
	host.os = "web";
	host.switchProps = null;
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

/* The tag view options (mobile sidebar tag view options, 2026-11-22). Both
 * controls are RELAY-GATED, and the grouping's selected value is the DRAWN one
 * so a stored `tag` never claims a mode the list is not drawing. */
describe("the tag view options", () => {
	it("draws the Tag grouping and the Show tags switch only on a relay that has tags", () => {
		act(() =>
			root.render(
				createElement(Harness, { scope: "sheet", tagsAvailable: false }),
			),
		);
		expect(host.choices.has(CONTROL.sidebarViewGroupTag)).toBe(false);
		expect(host.presses.has(CONTROL.sidebarViewShowTags)).toBe(false);

		act(() =>
			root.render(
				createElement(Harness, { scope: "settings", tagsAvailable: true }),
			),
		);
		expect(host.choices.has(CONTROL.settingsSidebarGroupTag)).toBe(true);
		expect(host.roles.get(CONTROL.settingsSidebarShowTags)).toBe("switch");
		expect(host.checked.get(CONTROL.settingsSidebarShowTags)).toBe(true);
		// The hint lives in Settings, under the switch (the Show ended pattern).
		expect(host.texts).toContain("Tags stay in each conversation's menu.");
	});

	it("the Tag grouping writes and groups the list; Show tags writes its switch", () => {
		act(() =>
			root.render(
				createElement(Harness, { scope: "sheet", tagsAvailable: true }),
			),
		);
		expect(host.groups.get(CONTROL.sidebarViewGroup)).toBe("section");
		press(host.choices, CONTROL.sidebarViewGroupTag);
		expect(current.groupBy).toBe("tag");
		expect(host.groups.get(CONTROL.sidebarViewGroup)).toBe("tag");
		expect(drawn()).toEqual(["tag:work:open", "untagged:running,ended"]);

		press(host.presses, CONTROL.sidebarViewShowTags);
		expect(current.showTags).toBe(false);
		expect(host.checked.get(CONTROL.sidebarViewShowTags)).toBe(false);
		expect(host.ariaChecked.get(CONTROL.sidebarViewShowTags)).toBe(false);
		press(host.presses, CONTROL.sidebarViewShowTags);
		expect(current.showTags).toBe(true);
	});

	it("a stored Tag on a relay without tags selects Time section and is not rewritten", () => {
		act(() =>
			root.render(
				createElement(Harness, {
					scope: "settings",
					tagsAvailable: false,
					initial: { ...DEFAULT_SIDEBAR_VIEW, groupBy: "tag" },
				}),
			),
		);
		// The drawn grouping is what the control names…
		expect(host.groups.get(CONTROL.settingsSidebarGroup)).toBe("section");
		// …while a write of another field keeps the reader's stored Tag.
		press(host.presses, CONTROL.settingsSidebarShowEnded);
		expect(current.groupBy).toBe("tag");
		expect(current.showEnded).toBe(false);
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

describe("PR #264 design D6 / UX U9", () => {
	it("a screen-reader-only hint is read, never printed under the label", () => {
		const id = "switch-with-reason";
		act(() =>
			root.render(
				createElement(SwitchRow, {
					label: "Agent finished",
					value: true,
					disabled: true,
					onChange: () => {},
					testID: id,
					accessibilityHint: "Needs a newer Local Operator on your computer.",
				}),
			),
		);
		expect(host.hints.get(id)).toBe(
			"Needs a newer Local Operator on your computer.",
		);
		expect(host.texts).toContain("Agent finished");
		expect(host.texts.join("\n")).not.toContain("Needs a newer");
	});

	it("the visible `hint` is still the spoken hint when no override is given", () => {
		const id = "switch-with-visible-hint";
		act(() =>
			root.render(
				createElement(SwitchRow, {
					label: "Show ended",
					hint: "Visible hint",
					value: true,
					onChange: () => {},
					testID: id,
				}),
			),
		);
		expect(host.hints.get(id)).toBe("Visible hint");
		expect(host.texts).toContain("Visible hint");
	});
});

/* Review round 1, R2/Q1/Q3: the switch's colours, as the platform `Switch`
 * actually receives them. A source grep passed with the on and off thumbs
 * swapped; these fail on that swap, on a missing web on-thumb, and on a
 * disabled switch drawn in the enabled colours. Roles: `SWITCH_ROLES`. */
describe("SwitchRow paints the switch from the platform's roles", () => {
	const draw = (os: string, value: boolean, disabled = false) => {
		host.os = os;
		act(() =>
			root.render(
				createElement(SwitchRow, {
					label: "Show ended sessions",
					value,
					onChange: () => {},
					testID: "switch-under-test",
					disabled,
				}),
			),
		);
		return host.switchProps as Record<string, unknown>;
	};

	it("web, on: an accent thumb on the accent-muted track, the web's own on-thumb included", () => {
		const props = draw("web", true);
		expect(props.thumbColor).toBe("accent");
		expect(props.activeThumbColor).toBe("accent");
		expect(props.trackColor).toEqual({
			true: "accent-muted",
			false: "hairline-strong",
		});
	});

	it("web, off: a neutral ink thumb", () => {
		const props = draw("web", false);
		expect(props.thumbColor).toBe("ink-muted");
		expect(props.trackColor).toEqual({
			true: "accent-muted",
			false: "hairline-strong",
		});
	});

	it("Android overhangs like the web", () => {
		expect(draw("android", true).thumbColor).toBe("accent");
		expect(draw("android", false).thumbColor).toBe("ink-muted");
	});

	it("iOS, thumb inside the track: on-accent on accent, elevated on border-control", () => {
		const on = draw("ios", true);
		expect(on.thumbColor).toBe("on-accent");
		expect(on.trackColor).toEqual({ true: "accent", false: "border-control" });
		expect(on.ios_backgroundColor).toBe("border-control");
		expect(draw("ios", false).thumbColor).toBe("elevated");
	});

	it("disabled: the disabled roles in both states, never the enabled colours", () => {
		for (const value of [true, false]) {
			const props = draw("web", value, true);
			expect(props.thumbColor).toBe("ink-disabled");
			expect(props.activeThumbColor).toBe("ink-disabled");
			expect(props.trackColor).toEqual({ true: "hairline", false: "hairline" });
			expect(props.disabled).toBe(true);
		}
	});
});
