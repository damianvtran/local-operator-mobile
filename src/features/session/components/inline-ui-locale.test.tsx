import { act, memo, type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useStore } from "zustand";
import { resetLocaleSource, setLocaleSource } from "@/i18n";
import { createConfigStore } from "@/state/config-store";
import { installDomShim } from "@/testing/dom-shim";
import { PALETTE } from "@/ui/tokens.gen";
import { InlineUiPreview, inlineUiData } from "./inline-ui-preview";

const host = vi.hoisted(() => ({
	store: null as unknown as ReturnType<typeof createConfigStore>,
	texts: [] as string[],
	disclosure: null as null | {
		accessibilityLabel: string;
		"aria-expanded": boolean;
		onPress: () => void;
	},
}));

vi.mock("@/features/auth/connection-provider", () => ({
	useLocaleFrame: () => useStore(host.store, (state) => state.language),
}));
vi.mock("react-native", () => ({
	View: ({
		children,
		onLayout,
	}: {
		children: ReactNode;
		onLayout?: (event: { nativeEvent: { layout: { width: number } } }) => void;
	}) => {
		useEffect(() => {
			onLayout?.({ nativeEvent: { layout: { width: 320 } } });
		}, [onLayout]);
		return children;
	},
	ScrollView: ({ children }: { children: ReactNode }) => children,
	Text: ({ children }: { children: ReactNode }) => {
		if (typeof children === "string") host.texts.push(children);
		return children;
	},
	Pressable: ({
		children,
		...props
	}: NonNullable<typeof host.disclosure> & { children: ReactNode }) => {
		host.disclosure = props;
		return children;
	},
}));
vi.mock("react-native-svg", () => {
	const noop = () => null;
	return {
		default: noop,
		Circle: noop,
		Defs: noop,
		Line: noop,
		Path: noop,
		Pattern: noop,
		Polyline: noop,
		Rect: noop,
	};
});
vi.mock("@/ui/appearance", () => ({
	useTheme: () => ({ active: { colors: PALETTE.light } }),
	useTokenColor: () => PALETTE.light["ink-muted"],
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));

it("repaints an open chart below a memoized row on a language-only frame", async () => {
	const data = inlineUiData({
		type: "bar",
		title: "Readings",
		data: [["A", 5]],
	});
	const Row = memo(() => <InlineUiPreview data={data} />);
	const dom = installDomShim();
	const root = createRoot(dom.container as Element);
	host.store = createConfigStore({ now: () => 1 });
	setLocaleSource(() => host.store.getState().language);
	const frame = (language: string, at: number) =>
		host.store
			.getState()
			.applyFrame({ changed_keys: ["language"], language }, at);
	try {
		frame("en", 1);
		await act(async () => root.render(<Row />));
		expect(host.disclosure).toMatchObject({
			accessibilityLabel: "Chart data · Readings",
			"aria-expanded": false,
		});
		expect(host.texts).toContain("2.5");
		await act(async () => host.disclosure?.onPress());
		expect(host.disclosure?.["aria-expanded"]).toBe(true);

		// The real config reducer moves, not the row props or the disclosure.
		host.texts = [];
		await act(async () => frame("fr", 2));
		expect(host.disclosure).toMatchObject({
			accessibilityLabel: "Données du graphique · Readings",
			"aria-expanded": true,
		});
		expect(host.texts).toContain("Données du graphique");
		expect(host.texts).toContain("2,5");
		expect(host.texts).not.toContain("2.5");
	} finally {
		await act(async () => root.unmount());
		dom.dispose();
		resetLocaleSource();
	}
});
