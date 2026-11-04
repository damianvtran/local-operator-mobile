import { useState } from "react";
import { View } from "react-native";
import { useTextScale } from "@/ui/text-scale-provider";
import { Heading } from "./heading";
import { NavigationMark } from "./navigation-mark";

/** Shared brand-title lockup. Use the existing white-disk asset, not another
 * drawing. Native text metrics keep the mark at the ACTUAL cap height after OS
 * font scaling; it stays centred beside the title rather than beside controls. */
export function BrandTitle({
	compact,
	numberOfLines,
}: {
	compact?: boolean;
	numberOfLines?: number;
}) {
	const { effectiveScale } = useTextScale();
	const [measuredCap, setMeasuredCap] = useState<number | null>(null);
	const cap = measuredCap ?? (compact ? 16 : 20) * effectiveScale;
	return (
		<View className="min-w-0 flex-row items-center gap-2">
			<NavigationMark size={cap} />
			<Heading
				level={1}
				className={`${compact ? "text-title" : "text-display"} shrink text-ink`}
				numberOfLines={numberOfLines}
				onTextLayout={(event) => {
					const value = event.nativeEvent.lines[0]?.capHeight;
					if (value && Number.isFinite(value)) setMeasuredCap(value);
				}}
			>
				Local Operator
			</Heading>
		</View>
	);
}
