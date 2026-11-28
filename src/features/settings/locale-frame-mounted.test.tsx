import {
	act,
	createElement,
	Fragment,
	isValidElement,
	type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "zustand";
import { renderFor, resetLocaleSource, setLocaleSource } from "@/i18n";
import { createConfigStore } from "@/state/config-store";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * Settings, MOUNTED, while a config frame changes the language underneath it
 * (D1 design QA, PR #251; the design ledger's known O1).
 *
 * THE DEFECT. Settings renders its headings and Appearance labels through
 * `t()`, but did not subscribe to the language: the served web build cold-loaded
 * with `<html lang="fr">` and still showed `Settings` / English Appearance
 * labels, because the screen painted before the config frame landed and nothing
 * re-rendered it afterwards. The same subscription gap as Projects
 * (`src/features/projects/__tests__/locale-frame-mounted.test.tsx`, which
 * documents the harness: a real reconciler, real i18n runtime and config store,
 * and recorder stubs only at the react-native / expo / leaf-component boundary).
 *
 * The child sections (account card, routing, notifications, sidebar, theme row)
 * are stubbed out: each owns its own subscription and its own test. This file
 * pins the copy Settings itself renders.
 */

const host = vi.hoisted(() => ({
	texts: [] as string[],
	store: null as unknown as ReturnType<
		typeof import("@/state/config-store").createConfigStore
	>,
}));

function strings(node: unknown): string[] {
	if (typeof node === "string") return [node];
	if (Array.isArray(node)) return node.flatMap(strings);
	return [];
}

/** Records the copy a leaf is handed and renders element-shaped props. */
function Recorder(props: Record<string, unknown>): ReactNode {
	const nested: ReactNode[] = [];
	for (const [name, value] of Object.entries(props)) {
		if (name === "children") continue;
		if (typeof value === "string") host.texts.push(value);
		else if (isValidElement(value)) nested.push(value);
		else if (Array.isArray(value))
			// `Segmented`'s options carry their labels as `{ label }` objects.
			for (const item of value)
				if (item && typeof item === "object" && "label" in item)
					host.texts.push(String((item as { label: unknown }).label));
	}
	const children = props.children as ReactNode;
	host.texts.push(...strings(children));
	return createElement(Fragment, null, ...nested, children ?? null);
}

const Nothing = (): null => null;

vi.mock("react-native", () => ({
	View: Recorder,
	Text: Recorder,
	Platform: { OS: "web" },
	AccessibilityInfo: { setAccessibilityFocus: () => undefined },
	findNodeHandle: () => null,
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: async () => true }));
vi.mock("expo-constants", () => ({
	default: { expoConfig: { version: "1.0.0" } },
}));
vi.mock("expo-router", () => ({
	useRouter: () => ({ back: () => undefined, push: () => undefined }),
	useLocalSearchParams: () => ({}),
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: async () => null }));
vi.mock("@/connection", () => ({
	RADIENT_CONSOLE_TUNNELS_URL: "https://example.invalid/tunnels",
}));
vi.mock("@/features/auth/computer-switcher-sheet", () => ({
	useComputerSwitcher: () => ({ visible: false, open: () => undefined }),
}));
vi.mock("@/features/auth/connection-provider", () => {
	const state = {
		computers: [],
		route: null,
		tunnelId: null,
		phase: "idle",
		discoveryFailure: null,
	};
	const connection = {
		signOut: async () => undefined,
		retry: () => undefined,
		refreshComputers: async () => undefined,
		refusal: null,
		signInWithRadient: async () => undefined,
		streamHealth: "idle",
		streamHealthReason: null,
		lastError: null,
		diagnosticError: null,
		transient: null,
		discovering: false,
	};
	return {
		connectionStore: {
			getState: () => state,
			subscribe: () => () => undefined,
		},
		useConnection: () => connection,
		useConnectionState: <T,>(select: (s: typeof state) => T) => select(state),
		useLocaleFrame: () => useStore(host.store, (s) => s.language),
	};
});
vi.mock("@/features/auth/transient-notice", () => ({
	TransientNotice: Nothing,
}));
vi.mock("@/state/ui-store", () => {
	const ui = {
		showToast: () => undefined,
		themeSelection: { mode: "system" },
		setThemeMode: () => undefined,
	};
	return {
		useUiStore: (select: (state: typeof ui) => unknown) => select(ui),
	};
});
vi.mock("@/ui/direction", () => ({
	LTR_WRITING: {},
	TEXT_END_CLASS: "",
	useComposedDir: () => "ltr",
	useIsRTL: () => false,
}));
vi.mock("@/ui/text-scale-provider", () => ({
	TEXT_SCALE_OPTIONS: [],
	useTextScale: () => ({
		effectiveScale: 1,
		platformScale: 1,
		preference: null,
		setPreference: () => undefined,
	}),
}));
vi.mock("./account-card", () => ({ AccountCard: Nothing }));
vi.mock("./account-routing-section", () => ({
	AccountRoutingSection: Nothing,
}));
vi.mock("./guard-section", () => ({ GuardSection: Nothing }));
vi.mock("./notifications-section", () => ({ NotificationsSection: Nothing }));
vi.mock("./own-tunnel-settings", () => ({ OwnTunnelSettings: Nothing }));
vi.mock("./sidebar-section", () => ({ SidebarSettingsSection: Nothing }));
vi.mock("./theme-row", () => ({ ThemeRow: Nothing }));
vi.mock("./use-refusal-reveal", () => ({ useRefusalReveal: () => undefined }));
for (const leaf of [
	"back-button",
	"badge",
	"button",
	"connection-pill",
	"dialog",
	"divider",
	"refusal-surface",
	"screen",
	"section-header",
	"segmented",
]) {
	// Not hoisted, and need not be: Settings is imported inside the test.
	vi.doMock("@/features/sessions/workspace-drawer", () => ({
		WorkspaceDrawerButton: Recorder,
	}));
	vi.doMock(`@/ui/components/${leaf}`, () => ({
		BackButton: Recorder,
		Badge: Recorder,
		Button: Recorder,
		ConnectionPill: Recorder,
		Dialog: Nothing,
		Divider: Nothing,
		RefusalSurface: Recorder,
		Screen: Recorder,
		SectionHeader: Recorder,
		Segmented: Recorder,
	}));
}

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	host.store = createConfigStore({ now: () => 1 });
	// connection-provider.tsx's registration, against this test's store.
	setLocaleSource(() => host.store.getState().language);
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	resetLocaleSource();
});

const frame = (language: string, at: number): void =>
	host.store
		.getState()
		.applyFrame({ changed_keys: ["language"], language }, at);

const KEYS = [
	"mobile.settings.screen_title",
	"mobile.settings.section.appearance",
	"mobile.settings.theme.mode_label",
	"mobile.settings.theme.mode_dark",
] as const;

describe("a mounted Settings screen repaints on a language frame", () => {
	it("a late frame after the first paint replaces the source copy", async () => {
		const { default: Settings } = await import("./settings");
		// The cold-load order the browser showed: first paint before any frame.
		await act(async () => root.render(createElement(Settings)));
		for (const key of KEYS)
			expect(host.texts).toContain(renderFor(key, {}, "en"));
		host.texts = [];
		await act(async () => frame("fr", 2));
		for (const key of KEYS) {
			expect(renderFor(key, {}, "fr")).not.toBe(renderFor(key, {}, "en"));
			expect(host.texts).toContain(renderFor(key, {}, "fr"));
		}
		host.texts = [];
		await act(async () => frame("ur", 3));
		for (const key of KEYS) {
			expect(host.texts).toContain(renderFor(key, {}, "ur"));
			expect(host.texts).not.toContain(renderFor(key, {}, "fr"));
		}
	});
});
