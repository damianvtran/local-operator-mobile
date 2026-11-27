import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The real Markdown and DiagramBlock trees, mounted through react-native-web;
// only native adapters are replaced. This proves dispatch, fallback and theme
// wiring, not native pixels (the pull request says what ran on a device).
const host = vi.hoisted(() => ({
	dark: false,
	copied: [] as string[],
	window: { width: 390, height: 844 },
	/** Every Pressable's `onPress`, by testID, in the last render. */
	presses: {} as Record<string, () => void>,
	announced: [] as string[],
}));

/* The chart's plot is wrapped in `DrawerSwipeClaim`, which imports
 *  gesture-handler at module scope; its Node reduction is the shared one. */
vi.mock("react-native-gesture-handler", async () => {
	const { gestureHandlerModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return gestureHandlerModuleMock();
});
vi.mock("react-native-svg", async () => {
	const { createElement } = await import("react");
	const shape =
		(name: string) =>
		({ children, ...props }: { children?: ReactNode }) =>
			createElement(`svg-${name}`, props as Record<string, unknown>, children);
	return {
		default: shape("root"),
		G: shape("g"),
		Path: shape("path"),
		Rect: shape("rect"),
		Circle: shape("circle"),
		Ellipse: shape("ellipse"),
		Line: shape("line"),
		Polygon: shape("polygon"),
		Polyline: shape("polyline"),
		Text: shape("text"),
		TSpan: shape("tspan"),
		Defs: shape("defs"),
		LinearGradient: shape("lg"),
		Stop: shape("stop"),
	};
});
vi.mock("expo-clipboard", () => ({
	setStringAsync: vi.fn(async (text: string) => {
		host.copied.push(text);
	}),
}));
vi.mock("react-native", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-native")>();
	const { createElement } = await import("react");
	return {
		...actual,
		useWindowDimensions: () => host.window,
		// Records each control's handler so a test can press it; renders the real
		// react-native-web Pressable underneath.
		Pressable: (props: { testID?: string; onPress?: () => void }) => {
			if (props.testID && props.onPress)
				host.presses[props.testID] = props.onPress;
			return createElement(actual.Pressable as never, props as never);
		},
		// Static markup has no portal; the modal's children render in place.
		Modal: ({ children }: { children?: ReactNode }) =>
			createElement("div", { "data-modal": "" }, children),
		AccessibilityInfo: {
			announceForAccessibility: (text: string) => host.announced.push(text),
		},
	};
});
vi.mock("lucide-react-native", () => ({ X: () => null }));
vi.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("@/ui/appearance", async () => {
	const { THEMES } = await import("@/ui/tokens.gen");
	const pick = (mode: "light" | "dark") => {
		const entry = THEMES.find((theme) => theme.mode === mode);
		if (!entry) throw new Error(mode);
		return entry;
	};
	const light = pick("light");
	const dark = pick("dark");
	return {
		useTokenColor: () => "#ffffff",
		useTheme: () => ({ active: host.dark ? dark : light }),
	};
});
vi.mock("@/ui/direction", () => ({
	useIsRTL: () => false,
	LTR_TEXT: { writingDirection: "ltr" },
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/features/session/table-scroll-hook", () => ({
	forcedTableScroll: () => null,
}));

import { DIAGRAM_SOURCES } from "@/features/session/diagram-fixtures";
import {
	clearDiagramCache,
	renderDiagram,
} from "@/features/session/diagram-render";
import {
	diagramInnerWidth,
	diagramLayout,
	viewerScale,
} from "@/features/session/diagram-source";
import { peleThemeVariables } from "@/features/session/diagram-theme";
import { t } from "@/i18n";
import { estimatedColumnWidth } from "@/ui/column";
import { THEMES } from "@/ui/tokens.gen";
import { DiagramViewer } from "./diagram-viewer";
import { Markdown } from "./markdown";

const FLOW = DIAGRAM_SOURCES.flowchart ?? "";
const fenced = (source: string) => `\`\`\`mermaid\n${source}\n\`\`\``;

/** Draw `source` into the cache with exactly the request the component builds,
 *  as the component's own effect does after its first frame. */
const warm = (source: string, mode: "light" | "dark" = "light") => {
	const entry = THEMES.find((theme) => theme.mode === mode);
	if (!entry) throw new Error(mode);
	return renderDiagram({
		source,
		width: diagramInnerWidth(estimatedColumnWidth(host.window)),
		theme: peleThemeVariables((role) => entry.colors[role]),
		fonts: { sans: "Figtree", mono: "JetBrains Mono" },
	});
};

const markup = (text: string) =>
	renderToStaticMarkup(createElement(Markdown, { text }));

const VALUE_TEXT = / aria-valuetext="[^"]*"/;
const INERT = /<script|<a |href=|onerror=|<img|<foreignObject/i;
const FILL = /fill="(#[0-9a-f]{6})"/gi;
const fills = (html: string) =>
	new Set([...html.matchAll(FILL)].map((m) => m[1]));

beforeEach(() => {
	clearDiagramCache();
	host.dark = false;
	host.copied = [];
	host.presses = {};
	host.announced = [];
});

describe("a mermaid fence in assistant markdown", () => {
	it("is the plain code block on the first frame, before Pele has answered", () => {
		const html = markup(fenced(FLOW));
		expect(html).toContain("flowchart TD");
		expect(html).not.toContain("<svg-root");
	});

	it("draws the diagram, in its own frame, once Pele has answered", async () => {
		await warm(FLOW);
		const html = markup(fenced(FLOW));
		expect(html).toContain("<svg-root");
		expect(html).toContain("<svg-text");
		expect(html).toContain("mermaid");
		// The listing is not shown beside the picture (the source is only the
		// control's spoken value).
		expect(html).not.toContain('data-testid="code-block-copy"');
	});

	it("stays code for an unterminated fence even when the same text is drawn", async () => {
		await warm(FLOW);
		const open = `\`\`\`mermaid\n${FLOW}`;
		const html = markup(open);
		expect(html).not.toContain("<svg-root");
		expect(html).toContain("flowchart TD");
	});

	it("leaves every other language alone", async () => {
		const html = markup("```ts\nconst a = 1;\n```");
		expect(html).toContain("const a = 1;");
		expect(html).not.toContain("<svg-root");
	});

	it("names the diagram for a screen reader and says what activating it does", async () => {
		await warm(FLOW);
		const html = markup(fenced(FLOW));
		expect(html).toContain('aria-label="flowchart diagram: Start"');
		expect(html).toContain('aria-label="Copy diagram source"');
		// react-native-web has no DOM channel for `accessibilityHint`; the string
		// the native control is handed is the catalogue's.
		expect(t("mobile.session.diagram.open_hint")).toBe(
			"Opens the diagram full screen",
		);
		expect(html).toContain('role="button"');
		expect(html).toContain('data-testid="diagram-open"');
		// The source is the text alternative, on web as on native.
		expect(html).toContain("aria-valuetext=");
		expect(html).toContain("flowchart TD");
		// The drawing itself is out of the reading order.
		expect(html).toContain('aria-hidden="true"');
	});

	it("falls back to the code block with Pele's own message when it cannot draw", async () => {
		const broken = "flowchart TD\n  A[Start --> B";
		await warm(broken);
		const html = markup(fenced(broken));
		expect(html).not.toContain("<svg-root");
		expect(html).toContain("Couldn’t draw this diagram");
		expect(html).toContain("A[Start --&gt; B");
		const refusal = await warm(broken);
		if (!refusal.ok) expect(html).toContain(refusal.message.slice(0, 20));
	});

	it("redraws from the active theme's colours", async () => {
		await warm(FLOW, "light");
		await warm(FLOW, "dark");
		const light = markup(fenced(FLOW));
		host.dark = true;
		const dark = markup(fenced(FLOW));
		const lightFills = fills(light);
		const darkFills = fills(dark);
		expect(lightFills.size).toBeGreaterThan(0);
		expect(darkFills.size).toBeGreaterThan(0);
		for (const colour of lightFills) expect(darkFills.has(colour)).toBe(false);
	});

	it("puts no event handler, script or link into the drawn markup", async () => {
		const hostile =
			'flowchart TD\n  A["<img src=x onerror=alert(1)>"] --> B["javascript:alert(1)"]\n  click A "https://evil.example/x"';
		await warm(hostile);
		const html = markup(fenced(hostile));
		expect(html).toContain("<svg-root");
		// The spoken value legitimately carries the source text, escaped; the
		// drawn markup is everything else.
		const drawn = html.replace(VALUE_TEXT, "");
		expect(drawn).not.toMatch(INERT);
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
	});
});

describe("the diagram's controls", () => {
	it("copies exactly the source from the header button and announces it", async () => {
		await warm(FLOW);
		markup(fenced(FLOW));
		const copy = host.presses["diagram-copy"];
		expect(copy).toBeDefined();
		copy?.();
		await Promise.resolve();
		await Promise.resolve();
		expect(host.copied).toEqual([FLOW]);
		expect(host.announced).toEqual(["copied"]);
	});

	it("opens the viewer from the picture, not the copy button", async () => {
		await warm(FLOW);
		markup(fenced(FLOW));
		expect(host.presses["diagram-open"]).toBeDefined();
		expect(host.presses["diagram-copy"]).not.toBe(host.presses["diagram-open"]);
	});
});

describe("the full-screen viewer", () => {
	it("draws the same prepared diagram larger, in a named dialog with a close button", async () => {
		const result = await warm(FLOW);
		if (!result.ok) throw new Error("not drawn");
		const html = renderToStaticMarkup(
			createElement(DiagramViewer, {
				prepared: result.prepared,
				onClose: () => undefined,
			}),
		);
		expect(html).toContain('aria-label="Diagram viewer"');
		expect(html).toContain('aria-label="Close diagram"');
		expect(html).toContain("<svg-root");
		const scale = viewerScale(result.prepared, host.window.width);
		const inline = diagramLayout(
			result.prepared,
			diagramInnerWidth(estimatedColumnWidth(host.window)),
		).scale;
		expect(scale).toBeGreaterThanOrEqual(inline);
	});
});
