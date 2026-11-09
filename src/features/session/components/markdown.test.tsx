import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mount the real block/inline component tree; only native adapters/providers are
// replaced. This proves dispatch/actions, not native layout (browser/device QA).
const host = vi.hoisted(() => ({
	links: [] as {
		label: string;
		press: (event: {
			stopPropagation: () => void;
			preventDefault: () => void;
		}) => void;
	}[],
	open: vi.fn(async (_url: string) => undefined),
	copies: [] as (() => void)[],
}));
vi.mock("react-native", async () => {
	const { createElement } = await import("react");
	const text = ({
		children,
		accessibilityRole,
		onPress,
	}: {
		children: ReactNode;
		accessibilityRole?: string;
		onPress?: (event: {
			stopPropagation: () => void;
			preventDefault: () => void;
		}) => void;
	}) => {
		if (accessibilityRole === "link" && onPress)
			host.links.push({ label: String(children), press: onPress });
		return createElement(
			accessibilityRole === "link" ? "a" : "span",
			{ role: accessibilityRole },
			children,
		);
	};
	const view = ({ children }: { children: ReactNode }) =>
		createElement("div", null, children);
	return {
		Text: text,
		View: view,
		ScrollView: view,
		Pressable: ({
			children,
			onLongPress,
		}: {
			children: ReactNode;
			onLongPress?: () => void;
		}) => {
			if (onLongPress) host.copies.push(onLongPress);
			return view({ children });
		},
		Platform: { OS: "web" },
		Linking: { openURL: host.open },
	};
});
vi.mock("react-native-svg", async () => {
	const { createElement } = await import("react");
	const node = ({ children }: { children: ReactNode }) =>
		createElement("svg", null, children);
	return {
		default: node,
		Defs: node,
		LinearGradient: node,
		Rect: node,
		Stop: node,
	};
});
vi.mock("expo-clipboard", () => ({
	setStringAsync: vi.fn(async () => undefined),
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#ffffff" }));
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

import { Markdown } from "./markdown";

describe("rendered assistant markdown dispatch", () => {
	beforeEach(() => {
		host.links = [];
		host.copies = [];
		host.open.mockClear();
	});
	it.each([
		"[Reuters](https://www.reuters.com/world/)",
		"- **[Reuters](https://www.reuters.com/world/)**",
		"# [Reuters](https://www.reuters.com/world/)",
		"> [Reuters](https://www.reuters.com/world/)",
		"| Source |\n| --- |\n| [Reuters](https://www.reuters.com/world/) |",
	])("mounts an accessible actionable label in %s", async (source) => {
		const markup = renderToStaticMarkup(
			createElement(Markdown, { text: source }),
		);
		expect(markup).toContain('role="link"');
		expect(markup).not.toContain("[Reuters]");
		expect(host.links).toHaveLength(1);
		expect(host.links[0]?.label).toBe("Reuters");
		const stopPropagation = vi.fn();
		host.links[0]?.press({ stopPropagation, preventDefault: vi.fn() });
		await Promise.resolve();
		expect(stopPropagation).toHaveBeenCalledOnce();
		expect(host.open).toHaveBeenCalledExactlyOnceWith(
			"https://www.reuters.com/world/",
		);
	});
	it.each(["]", "["])(
		"dispatches a linked code-span label containing %s",
		async (bracket) => {
			const markup = renderToStaticMarkup(
				createElement(Markdown, {
					text: `[a \`${bracket}\` b](https://example.com)`,
				}),
			);
			expect(markup.match(/role="link"/g)).toHaveLength(3);
			expect(host.links.map((link) => link.label)).toEqual([
				"a ",
				bracket,
				" b",
			]);
			for (const link of host.links) {
				link.press({ stopPropagation: vi.fn(), preventDefault: vi.fn() });
				await Promise.resolve();
			}
			expect(host.open.mock.calls).toEqual(
				Array.from({ length: 3 }, () => ["https://example.com"]),
			);
		},
	);
	it("never wires unsafe links or link-shaped inline/fenced code", () => {
		const markup = renderToStaticMarkup(
			createElement(Markdown, {
				text: "[unsafe](javascript:alert(1)) <script>alert(1)</script>\n\n`[code](https://example.com)`\n\n```ts\n[fenced](https://example.com)\n```",
			}),
		);
		expect(host.links).toHaveLength(0);
		expect(host.open).not.toHaveBeenCalled();
		expect(markup).toContain("&lt;script&gt;");
		expect(markup).toContain("[code](https://example.com)");
		expect(markup).toContain("[fenced](https://example.com)");
	});
});
