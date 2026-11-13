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
		hitSlop?: { top?: number; bottom?: number };
		style?: { minHeight?: number };
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
			hitSlop,
			style,
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
					"data-hitslop": hitSlop ? JSON.stringify(hitSlop) : undefined,
					"data-min-height":
						style?.minHeight === undefined
							? undefined
							: String(style.minHeight),
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

import { TOUCH_FLOOR } from "@/ui/layout";
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
	/* Agent review round 1, M2: when the first window does not fill the screen
	 *  auto-load cannot fire, and the 24 pt hairline is the only way in. */
	/* CI web audit, run 43489920862: 218 U-01 FAILs, `button 64x24`. The
	 *  earlier cut reached the floor through `hitSlop`, which react-native-web
	 *  drops on `Pressable`, so the floor must be the BOX itself, in every state. */
	it("the box itself is at least the touch floor tall in every state, with no hitSlop", () => {
		for (const [loading, retry] of [
			[false, false],
			[true, false],
			[false, true],
		] as const) {
			const markup = render(loading, retry);
			const minHeight = Number(/data-min-height="([^"]*)"/.exec(markup)?.[1]);
			expect(minHeight).toBeGreaterThanOrEqual(TOUCH_FLOOR);
			expect(minHeight).toBeGreaterThanOrEqual(44);
			expect(markup).not.toContain("data-hitslop");
			// No fixed 24 pt height class may cap the box under the floor.
			expect(/data-class="([^"]*)"/.exec(markup)?.[1]).not.toMatch(/\bh-6\b/);
		}
	});

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

	it("loading: a small spinner in the SAME box as the hairline, marked busy, never disabled", () => {
		const idle = render(false, false);
		const loading = render(true, false);
		expect(loading).toContain("data-spinner");
		expect(loading).toContain('data-busy="true"');
		expect(loading).not.toContain("data-disabled");
		const box = (markup: string) => /data-class="([^"]*)"/.exec(markup)?.[1];
		expect(box(loading)).toBe(box(idle));
		const minHeight = (markup: string) =>
			/data-min-height="([^"]*)"/.exec(markup)?.[1];
		expect(minHeight(loading)).toBe(minHeight(idle));
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
