import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source pins for the 2026-11 secondary-screen polish (visual audit D11, D12,
 * D15, D16, D17). Each asserts the STRUCTURE a finding changed, over the
 * source text — these screens reach `uniwind` through `@/ui`, which the Node
 * test environment cannot import (the reason `sidebar-footer.test.ts` and
 * `tags-wiring.test.ts` record). They are regression guards for the shape,
 * not visual evidence: what each looks like is the capture rig's to show.
 */
const FEATURES = fileURLToPath(new URL(".", import.meta.url));
const read = (path: string) => readFileSync(join(FEATURES, path), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

const tsxUnder = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? tsxUnder(join(dir, entry.name))
			: entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
				? [join(dir, entry.name)]
				: [],
	);

const BACK_TEXT_BUTTON =
	/<Button[^>]*testID=\{CONTROL\.\w*Back\}|<Button[^>]*label="Back"/;

describe("D16: one back control", () => {
	it("no screen draws Back as a text button", () => {
		const offenders = tsxUnder(FEATURES).filter((file) =>
			BACK_TEXT_BUTTON.test(flat(readFileSync(file, "utf8"))),
		);
		expect(offenders).toEqual([]);
	});

	it.each([
		"settings/settings.tsx",
		"settings/theme-picker.tsx",
		"past/past.tsx",
		"projects/projects.tsx",
		"projects/project-detail.tsx",
		"schedules/schedules.tsx",
		"library/library-screen.tsx",
		"library/library-detail.tsx",
		"auth/sign-in.tsx",
		"auth/own-tunnel.tsx",
		"auth/computers.tsx",
		"team-bridge/gate.tsx",
	])("%s uses the shared chevron BackButton", (path) => {
		expect(read(path)).toContain("<BackButton");
	});

	it("the shared control is the chevron icon button", () => {
		const button = flat(read("../ui/components/back-button.tsx"));
		expect(button).toContain("<IconButton");
		expect(button).toContain('glyph="chevron"');
		expect(button).toContain('t("mobile.common.back")');
	});
});

describe("D11: the drawer footer is two rows and shared across Agents and Team Bridge", () => {
	const pane = read("sessions/conversations-pane.tsx");
	const footer = flat(
		pane.slice(
			pane.indexOf("export const WorkspaceSidebarFooter = ("),
			pane.indexOf("export const ConversationsPane = ("),
		),
	);

	it("puts the switcher, Team Bridge fallback and Settings on ONE workspace row", () => {
		const row = footer.slice(
			footer.indexOf("<DrawerComputerRow"),
			footer.indexOf("{largeText ? ("),
		);
		expect(row).toContain('<TeamBridgeEntry variant="compact"');
		expect(row).toContain("testID={CONTROL.settingsButton}");
		// One Team Bridge entry in the footer, and it is the compact one.
		expect(footer.match(/<TeamBridgeEntry/g)?.length).toBe(1);
	});

	it("drops the footer icon whenever the labelled WorkspaceModeBar header replaces it, and keeps WorkspaceSidebarFooter mounted in Team Bridge drawer mode", () => {
		// `hasModeHeader` is true inside the drawer (`onClose`) and on a docked
		// split pane with a `bridgeAdapter`; only a standalone pane with no mode
		// header keeps the compact footer icon as its Bridge fallback.
		expect(footer).toContain(
			'{hasModeHeader ? null : ( <TeamBridgeEntry variant="compact"',
		);
		const conversationsDrawer = flat(read("sessions/conversations-drawer.tsx"));
		expect(conversationsDrawer).toContain("<WorkspaceSidebarFooter");
		const root = flat(
			readFileSync(join(FEATURES, "../../app/_layout.tsx"), "utf8"),
		);
		expect(root).toContain(
			"<WorkspaceDrawerProvider bridgeAdapter={useTeamBridgeDrawerAdapter()}>",
		);
		expect(root).toContain(
			"<BridgeWorkspaceDrawer> <Stack screenOptions={{ headerShown: false }} /> </BridgeWorkspaceDrawer>",
		);
	});

	it("the shared Bridge directory dismisses the drawer before any row routes", () => {
		const list = flat(read("team-bridge/list-screen.tsx"));
		expect(list).toContain("onBeforeOpen?.(); openTarget(target);");
		const card = flat(read("team-bridge/profile-card.tsx"));
		expect(card).toContain("onBeforeOpen?.(); open(target);");
	});

	it("draws the switcher without a border or a fill", () => {
		const chip = read("auth/computer-entry-points.tsx");
		const row = chip.slice(chip.indexOf("export function DrawerComputerRow"));
		const className = row.slice(
			row.indexOf('className="w-full'),
			row.indexOf("\n", row.indexOf('className="w-full')),
		);
		expect(className).not.toContain("border");
		expect(className).not.toContain("bg-");
	});

	it("the compact Team Bridge entry is one icon control with no caption", () => {
		const entry = read("team-bridge/navigation.tsx");
		const compact = flat(
			entry.slice(
				entry.indexOf('if (variant === "compact")'),
				/* The block variant (a destination card since TestFlight 883, D2)
				 *  starts at its own doc comment. */
				entry.indexOf("The block variant is a DESTINATION"),
			),
		);
		expect(compact).toContain("<IconButton");
		expect(compact).toContain("testID={CONTROL.teamBridgeNavigation}");
		expect(compact).toContain('t("mobile.team_bridge.navigation.entry"');
		expect(compact).not.toContain("navigation.caption");
	});

	it("the block Team Bridge entry is one left-aligned button card with the caption as its hint (TestFlight 883, D2)", () => {
		const entry = read("team-bridge/navigation.tsx");
		const block = flat(
			entry.slice(entry.indexOf("The block variant is a DESTINATION")),
		);
		expect(block).toContain("<Pressable");
		expect(block).toContain("accessibilityRole={ROLE.button}");
		expect(block).toContain("testID={CONTROL.teamBridgeNavigation}");
		expect(block).toContain(
			'accessibilityHint={t("mobile.team_bridge.navigation.caption")}',
		);
		expect(block).toContain("navCardClasses({ pressed })");
		/* CI U-42, S13/error: the caption stack's gap is measured on both
		 * axes, even when there are no discovered computer rows below it. */
		expect(block).toContain('className="min-w-0 flex-1 gap-1"');
		expect(block).not.toContain("gap-0.5");
		expect(block).toContain("<ChevronRight");
		expect(block).not.toContain("text-center");
		expect(block).not.toContain("<Button");
	});

	it("the drawer's mode selector uses a minimal sunken track, keeps the label and count apart, and never stacks bg-accent on bg-accent", () => {
		const drawer = flat(read("sessions/workspace-drawer.tsx"));
		expect(drawer).toContain("rounded-md bg-sunken p-1");
		expect(drawer).toContain('{t("mobile.team_bridge.title")}');
		expect(drawer).toContain("accessibilityLabel={bridgeBadge.a11yLabel}");
		// Unknown (null) and not-ready never paint as a number.
		expect(drawer).toContain(
			'bridgeBadge.state === "ready" && bridgeBadge.count !== null && bridgeBadge.count > 0',
		);
		// Selected segment uses bg-elevated rather than a primary bg-accent button slab.
		expect(drawer).toContain("border-hairline bg-elevated");
		expect(drawer).not.toContain('variant={bridge ? "primary"');
	});
});

/* Top-level for biome's useTopLevelRegex; it scans source text. */
const VARIANT = /variant="(\w+)"/;

describe("D15: Settings labels its controls and ranks its actions alike", () => {
	const settings = read("settings/settings.tsx");

	it("draws a visible label above each segmented control", () => {
		const appearance = flat(
			settings.slice(settings.indexOf("testID={REGION.settingsAppearance}")),
		);
		const theme = appearance.indexOf(
			'{t("mobile.settings.theme.mode_label")} </Text>',
		);
		const size = appearance.indexOf(
			'{t("mobile.settings.text_size.label")} </Text>',
		);
		expect(theme).toBeGreaterThan(-1);
		expect(size).toBeGreaterThan(-1);
		expect(theme).toBeLessThan(
			appearance.indexOf("testID={CONTROL.settingsThemeGroup}"),
		);
		expect(size).toBeLessThan(
			appearance.indexOf("testID={CONTROL.settingsTextScaleGroup}"),
		);
		// The visible label IS the accessible name (WCAG 2.5.3).
		expect(appearance).toContain(
			'label={t("mobile.settings.text_size.label")}',
		);
	});

	it("gives the three connection actions one variant", () => {
		const variants = [
			"settingsRefresh",
			"settingsSwitchComputer",
			"settingsAddComputer",
		].map((id) => {
			const at = settings.indexOf(`testID={CONTROL.${id}}`);
			const block = settings.slice(at, settings.indexOf("/>", at));
			return block.match(VARIANT)?.[1];
		});
		expect(new Set(variants).size).toBe(1);
		expect(variants[0]).toBe("quiet");
	});
});

describe("D17: the Library has one scrolling type row", () => {
	const library = read("library/library-screen.tsx");
	const screen = library.slice(0, library.indexOf("function FilterSheet("));
	const sheet = library.slice(
		library.indexOf("function FilterSheet("),
		library.indexOf("function SortSheet("),
	);

	it("draws the kinds as one horizontal scroller, not a wrapping control", () => {
		expect(screen).not.toContain("<Segmented");
		const at = screen.indexOf("testID={CONTROL.libraryMore}");
		const scroller = screen.slice(screen.lastIndexOf("<ScrollView", at), at);
		expect(scroller).toContain("horizontal");
		expect(screen).toContain("segments.map((segment) => (");
	});

	it("moves Created/Mentioned and tags off the screen and into Filters", () => {
		expect(screen).not.toContain("LIBRARY_ORIGINS.map");
		expect(screen).not.toContain("libraryTagId(");
		expect(sheet).toContain("LIBRARY_ORIGINS.map");
		expect(sheet).toContain("testID={REGION.libraryOrigins}");
		expect(sheet).toContain("libraryTagId(option.id)");
	});

	it("still counts an active origin or tag on the Filters chip", () => {
		expect(screen).toContain('(browse.origin === "all" ? 0 : 1)');
		expect(screen).toContain("(browse.tag === null ? 0 : 1)");
	});
});

describe("D12: one computer switcher on tablet", () => {
	const home = flat(read("home/home.tsx"));

	it("hides the header chip in the split layout, where the pane has the switcher", () => {
		expect(home).toContain(
			"{split ? null : ( <HeaderComputerChip testID={CONTROL.computersButton}",
		);
		// The pane (always mounted in split) still carries the one switcher.
		expect(read("sessions/conversations-pane.tsx")).toContain(
			"<DrawerComputerRow",
		);
	});

	it("keeps the bell on the trailing edge once the chip is gone", () => {
		expect(home).toContain('split && "justify-end",');
	});
});
