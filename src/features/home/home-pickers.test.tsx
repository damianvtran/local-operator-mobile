import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ModelEntry } from "@/contracts";
import type { HomeFolders } from "@/features/home/home-defaults";
import {
	CONTROL,
	effortRungId,
	homeFolderRowId,
	modelOptionId,
	SURFACE,
} from "@/ui/a11y";

/**
 * The home's pickers, as DRAWN — the folder sheet's full-path header and its
 * read-only form (issue #325), and the one run-settings sheet that replaced the
 * separate model and effort sheets.
 *
 * The repo's component-test convention (`checkpoint-rail.test.tsx`,
 * `tags-sheet-locale-frame.test.tsx`): Node, `renderToStaticMarkup`, and leaf
 * stubs for the primitives, so what is asserted is the picker's own branching —
 * which rows, which lines, which controls — not a native layout. The stubs keep
 * the props a reader depends on (`testID`, the accessible name, `disabled`,
 * `selectable`) visible in the markup.
 */

type Props = Record<string, unknown> & { children?: unknown };
const kids = (props: Props): ReactNode =>
	typeof props.children === "function"
		? (props.children as (s: { pressed: boolean }) => ReactNode)({
				pressed: false,
			})
		: (props.children as ReactNode);

vi.mock("react-native", () => ({
	View: (props: Props) =>
		createElement(
			"div",
			{
				"data-testid": props.testID as string | undefined,
				role: props.accessibilityRole as string | undefined,
				"aria-label": props.accessibilityLabel as string | undefined,
			},
			kids(props),
		),
	Text: (props: Props) =>
		createElement(
			"span",
			{ "data-selectable": props.selectable ? "yes" : undefined },
			kids(props),
		),
	Pressable: (props: Props) =>
		createElement(
			"button",
			{
				type: "button",
				"data-testid": props.testID as string | undefined,
				"aria-label": props.accessibilityLabel as string | undefined,
				disabled: props.disabled as boolean | undefined,
			},
			kids(props),
		),
	ScrollView: (props: Props) => createElement("div", null, kids(props)),
}));
vi.mock("lucide-react-native", () => ({ Folder: () => null }));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000" }));
const sheet = (props: Props) =>
	props.visible
		? createElement(
				"section",
				{ "data-testid": props.testID as string },
				createElement("h2", null, props.title as string),
				kids(props),
			)
		: null;
vi.mock("@/ui/components/sheet", () => ({ Sheet: sheet }));
vi.mock("@/ui/components", () => ({ Sheet: sheet }));
vi.mock("@/ui/components/alert", () => ({
	Alert: (props: Props) => createElement("p", null, kids(props)),
}));
vi.mock("@/ui/components/badge", () => ({
	Badge: (props: Props) => createElement("i", null, props.label as string),
}));
vi.mock("@/ui/components/button", () => ({
	Button: (props: Props) =>
		createElement(
			"button",
			{ type: "button", "data-testid": props.testID as string },
			props.label as string,
		),
}));
vi.mock("@/ui/components/input", () => ({
	Input: (props: Props) =>
		createElement("input", { "data-testid": props.testID as string }),
}));

const { FolderPicker } = await import("@/features/home/home-pickers");

const FOLDERS: HomeFolders = {
	home: "/Users/demo",
	default: "/Users/demo/code/app",
	recent: ["/Users/demo/code/local-operator"],
	tmp: "/private/tmp",
};

const folderSheet = (over: Partial<Parameters<typeof FolderPicker>[0]>) =>
	renderToStaticMarkup(
		createElement(FolderPicker, {
			visible: true,
			onClose: () => undefined,
			folders: FOLDERS,
			current: "/Users/demo/code/local-operator",
			failure: null,
			onRetry: () => undefined,
			retrying: false,
			editable: true,
			onPick: () => undefined,
			...over,
		}),
	);

describe("the folder sheet's header (issue #325)", () => {
	it("leads with the FULL current path, selectable, above the choices", () => {
		const html = folderSheet({});
		const header = html.indexOf(`data-testid="${CONTROL.homeFolderCurrent}"`);
		expect(header).toBeGreaterThan(-1);
		expect(html).toContain("Current folder");
		/* Whole and unshortened: the chip that used to name it cut it to `loc`. */
		expect(html).toContain(
			'<span data-selectable="yes">/Users/demo/code/local-operator</span>',
		);
		expect(header).toBeLessThan(html.indexOf(homeFolderRowId(0)));
	});

	it("still offers the computer's folders and Other path while the folder can change", () => {
		const html = folderSheet({});
		for (let row = 0; row < 4; row += 1)
			expect(html).toContain(`data-testid="${homeFolderRowId(row)}"`);
		expect(html).toContain(`data-testid="${CONTROL.homeFolderOther}"`);
		expect(html).not.toContain(
			"A conversation keeps the folder it started in. To use another folder, start a new chat.",
		);
	});

	it("is read-only once the conversation has started: the path and why, no dead rows", () => {
		/* The relay takes a folder only at start (`StartSessionRequest.cwd`);
		 *  there is no in-session op to change it. */
		const html = folderSheet({ editable: false, folders: null });
		expect(html).toContain(
			'<span data-selectable="yes">/Users/demo/code/local-operator</span>',
		);
		expect(html).toContain(
			"A conversation keeps the folder it started in. To use another folder, start a new chat.",
		);
		expect(html).not.toContain(homeFolderRowId(0));
		expect(html).not.toContain(CONTROL.homeFolderOther);
		/* Not the list's loading line: a running conversation reads no folders. */
		expect(html).not.toContain("Loading…");
	});

	it("draws no header while no folder is known", () => {
		expect(folderSheet({ current: null })).not.toContain(
			CONTROL.homeFolderCurrent,
		);
	});
});

vi.mock("@/ui/components/section-header", () => ({
	SectionHeader: (props: Props) =>
		createElement("h3", null, props.label as string),
}));

const { RunSettingsPicker } = await import("@/features/home/home-pickers");

const opus: ModelEntry = {
	selector: "anthropic/claude-opus-5",
	provider: "anthropic",
	model_id: "claude-opus-5",
	name: "claude-opus-5",
	label: "Opus 5",
	connected: true,
	efforts: ["low", "medium", "high"],
};

const runSettings = (
	over: Partial<Parameters<typeof RunSettingsPicker>[0]> = {},
) =>
	renderToStaticMarkup(
		createElement(RunSettingsPicker, {
			visible: true,
			onClose: () => undefined,
			editable: true,
			summary: "Opus 5 · High",
			model: {
				models: [opus],
				rows: [{ model: opus, selected: true, isDefault: true, kind: "model" }],
				chosen: false,
				loading: false,
				failure: null,
				onRetry: () => undefined,
				retrying: false,
				onPick: () => undefined,
			},
			effort: {
				offer: {
					kind: "ladder",
					rungs: ["low", "medium", "high"],
					exact: true,
				},
				chosen: null,
				defaultEffort: "high",
				onPick: () => undefined,
			},
			...over,
		}),
	);

describe("the home's run-settings sheet (issue #325)", () => {
	it("keeps a picked rung's width: no 'This conversation' badge in the compact group (round 2 D1/Q4)", () => {
		/* A badge added on pick made the group wrap again under the thumb, so a
		 *  second tap at the same point hit another rung. The source line under
		 *  the heading already says "Chosen for this conversation". */
		const html = runSettings({
			effort: {
				offer: {
					kind: "ladder",
					rungs: ["low", "medium", "high"],
					exact: true,
				},
				chosen: "low",
				defaultEffort: "high",
				onPick: () => undefined,
			},
		});
		const group = html.slice(
			html.indexOf(`data-testid="${SURFACE.effortRungs}"`),
			html.indexOf(`data-testid="${CONTROL.homeModelPicker}"`),
		);
		expect(html).toContain("Chosen for this conversation");
		expect(group).toContain(`aria-label="Low"`);
		expect(group).not.toContain("This conversation");
		// The default's badge is static (it never moves on a pick), so it stays.
		expect(group).toContain(`aria-label="High, Default"`);
	});

	it("is ONE sheet — the current values, the effort rungs, then the model list (D1)", () => {
		const html = runSettings();
		expect(html).toContain(`data-testid="${SURFACE.runSettingsSheet}"`);
		expect(html).toContain("<h2>Model and effort</h2>");
		const summary = html.indexOf(`data-testid="${SURFACE.runSettingsSummary}"`);
		const model = html.indexOf(`data-testid="${CONTROL.homeModelPicker}"`);
		const effort = html.indexOf(`data-testid="${CONTROL.homeEffortPicker}"`);
		expect(summary).toBeGreaterThan(-1);
		expect(html).toContain("Opus 5 · High");
		expect(effort).toBeGreaterThan(summary);
		expect(model).toBeGreaterThan(effort);
		expect(html).toContain(`data-testid="${SURFACE.effortRungs}"`);
		expect(html).toContain(`data-testid="${modelOptionId("claude-opus-5")}"`);
		for (const rung of ["low", "medium", "high"])
			expect(html).toContain(`data-testid="${effortRungId(rung)}"`);
	});

	it("says once, not per section, that a started conversation's options are fixed", () => {
		const html = runSettings({ editable: false });
		const fixed =
			"This conversation&#x27;s starting options are fixed. Use Conversation details for its live controls.";
		expect(html.split(fixed)).toHaveLength(2);
		expect(html).toMatch(
			new RegExp(
				`data-testid="${modelOptionId("claude-opus-5")}"[^>]*disabled`,
			),
		);
	});

	it("keeps the effort section's own explanation when the computer cannot take one", () => {
		const html = runSettings({
			effort: {
				offer: { kind: "unsupported" },
				chosen: null,
				defaultEffort: null,
				onPick: () => undefined,
			},
		});
		expect(html).toContain("too old to accept an effort");
		expect(html).not.toContain(effortRungId("high"));
	});
});
