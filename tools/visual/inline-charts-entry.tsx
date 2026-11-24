// Local visual fixture only: Expo Router never imports this entry. It uses the
// production chart components, tokens and providers without signing in or
// navigating the full app; the mock-relay scenario covers that wire separately.
import "../../src/ui/theme.css";
import { registerRootComponent } from "expo";
import { useEffect } from "react";
import { ScrollView, View } from "react-native";
import {
	InlineUiPreview,
	inlineUiData,
} from "../../src/features/session/components/inline-ui-preview";
import { useUiStore } from "../../src/state/ui-store";
import { ThemeProvider } from "../../src/ui/appearance";
import { TextScaleProvider } from "../../src/ui/text-scale-provider";
import { inlineChartExamples } from "../mock-relay/inline-charts";

function InlineChartsFixture() {
	const params = new URLSearchParams(globalThis.location?.search);
	const size = Number(params.get("width"));
	const width = size > 0 ? size : 390;
	const mode = params.get("theme") === "dark" ? "dark" : "light";
	const requested = params.get("case");
	const examples = requested
		? inlineChartExamples.filter(
				(chart) =>
					(chart.type === "series" ? chart.mode : chart.type) === requested,
			)
		: inlineChartExamples;
	const hydrated = useUiStore((state) => state.themeHydrated);
	useEffect(() => {
		if (hydrated) useUiStore.getState().setThemeMode(mode);
	}, [hydrated, mode]);
	return (
		<ThemeProvider>
			<TextScaleProvider>
				<ScrollView className="bg-canvas" style={{ maxWidth: width }}>
					<View className="gap-3 p-3">
						{examples.map((chart) => (
							<InlineUiPreview key={chart.title} data={inlineUiData(chart)} />
						))}
					</View>
				</ScrollView>
			</TextScaleProvider>
		</ThemeProvider>
	);
}

registerRootComponent(InlineChartsFixture);
