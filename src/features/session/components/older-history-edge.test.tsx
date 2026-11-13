import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { t } from "@/i18n";

/**
 * Operator, 2026-11-13: "improve the style of the load messages interaction, it
 * looks really rough/amateur" — a full-width OUTLINED "Load earlier messages"
 * button at the top of the transcript. The edge is now the relay's quiet one:
 * hairline at rest, small spinner while a page loads, a small text "Try again"
 * only after a failure — and ONE accessible button throughout (PR #207 U1).
 * Asserted on rendered markup (host primitives serialise their props).
 */
vi.mock("react-native", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-native")>();
	const { createElement } = await import("react");
	type HostProps = {
		children?: import("react").ReactNode;
		className?: string;
		testID?: string;
		accessibilityLabel?: string;
		accessibilityRole?: string;
		accessibilityState?: { busy?: boolean };
		disabled?: boolean;
	};
	const host =
		(tag: string) =>
		({
			children,
			className,
			testID,
			accessibilityLabel,
			accessibilityRole,
			accessibilityState,
			disabled,
		}: HostProps) =>
			createElement(
				tag,
				{
					"data-class": className,
					"data-testid": testID,
					"aria-label": accessibilityLabel,
					"data-role": accessibilityRole,
					"data-busy": accessibilityState?.busy ? "true" : undefined,
					"data-disabled": disabled ? "true" : undefined,
				},
				children,
			);
	return {
		...actual,
		View: host("div"),
		Text: host("span"),
		Pressable: host("button"),
		ActivityIndicator: () => createElement("i", { "data-spinner": "" }),
	};
});
vi.mock("@/ui/appearance", () => ({
	useTokenColor: (role: string) => `token:${role}`,
}));

import { OlderHistoryEdge } from "./older-history-edge";

const render = (loading: boolean, retry: boolean, onPress = () => {}) =>
	renderToStaticMarkup(
		createElement(OlderHistoryEdge, {
			loading,
			retry,
			onPress,
			testID: "transcript-load-earlier",
		}),
	);

describe("the older-history edge is quiet", () => {
	it("at rest: no visible words and no border — a hairline, still an accessible button", () => {
		const markup = render(false, false);
		expect(markup).not.toContain(`>${t("mobile.session.history.load")}<`);
		expect(markup).toContain(
			`aria-label="${t("mobile.session.history.load")}"`,
		);
		expect(markup).toContain('data-role="button"');
		expect(markup).toContain("bg-hairline");
		expect(markup).not.toMatch(/\bborder\b/);
	});

	it("loading: a small spinner in the SAME 24 pt box, marked busy, never disabled", () => {
		const idle = render(false, false);
		const loading = render(true, false);
		expect(loading).toContain("data-spinner");
		expect(loading).toContain('data-busy="true"');
		expect(loading).not.toContain("data-disabled");
		const box = (markup: string) => /data-class="([^"]*)"/.exec(markup)?.[1];
		expect(box(loading)).toBe(box(idle));
		expect(box(idle)).toContain("h-6");
	});

	it("failed: a small quiet text retry, the one visible tap target", () => {
		const markup = render(false, true);
		expect(markup).toContain(`>${t("mobile.common.try_again")}<`);
		expect(markup).toContain("text-meta text-ink-muted");
		expect(markup).not.toMatch(/\bborder\b/);
	});

	it("ignores presses while a page is in flight (Button's own guard, not disabled)", () => {
		const onPress = vi.fn();
		// The guard lives in the component body; call it as the host would.
		const element = OlderHistoryEdge({
			loading: true,
			retry: false,
			onPress,
			testID: "x",
		}) as { props: { onPress: () => void } };
		element.props.onPress();
		expect(onPress).not.toHaveBeenCalled();
		const idle = OlderHistoryEdge({
			loading: false,
			retry: false,
			onPress,
			testID: "x",
		}) as { props: { onPress: () => void } };
		idle.props.onPress();
		expect(onPress).toHaveBeenCalledOnce();
	});
});
