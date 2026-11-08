import { useState } from "react";
import { View } from "react-native";
import { lineBoxPt } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";
import { brandTitleMetrics } from "./brand-title-metrics";
import { Heading } from "./heading";
import { NavigationMark } from "./navigation-mark";

/** Shared brand-title lockup. Use the existing white-disk asset, not another
 * drawing. Native text metrics keep the mark at the ACTUAL cap height after OS
 * font scaling; it stays centred beside the title rather than beside controls. */
export function BrandTitle({
	compact,
	title,
	numberOfLines,
}: {
	compact?: boolean;
	title?: string;
	numberOfLines?: number;
}) {
	const { effectiveScale } = useTextScale();
	const [metrics, setMetrics] = useState<{ cap: number; top: number } | null>(
		null,
	);
	const cap = metrics?.cap ?? (compact ? 16 : 20) * effectiveScale;
	const top =
		metrics?.top ??
		Math.max(
			0,
			(lineBoxPt(compact ? "title" : "display", effectiveScale) - cap) / 2,
		);
	return (
		<View className="min-w-0 flex-row items-start gap-2">
			<View style={{ paddingTop: top }}>
				<NavigationMark size={cap} />
			</View>
			<Heading
				level={1}
				className={`${compact ? "text-title" : "text-display"} shrink text-ink`}
				numberOfLines={numberOfLines}
				onTextLayout={(event) => {
					const line = event.nativeEvent.lines[0];
					const next = line && brandTitleMetrics(line);
					if (next)
						setMetrics((old) =>
							old?.cap === next.cap && old.top === next.top ? old : next,
						);
				}}
			>
				{title}
			</Heading>
		</View>
	);
}
