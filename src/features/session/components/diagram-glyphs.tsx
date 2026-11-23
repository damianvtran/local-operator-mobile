import Svg, { Path, Rect } from "react-native-svg";

/**
 * The diagram header's two icons, drawn with `react-native-svg` directly
 * (Lucide's `copy` and `check` outlines, ISC licence) rather than through
 * `lucide-react-native`: the transcript's static import graph stays free of an
 * icon library for the sake of two glyphs, and the tests that mount the
 * transcript with a partial `react-native-svg` mock need not stub it.
 */
export function DiagramGlyph({
	kind,
	color,
}: {
	kind: "copy" | "check";
	color: string;
}) {
	return (
		<Svg
			width={18}
			height={18}
			viewBox="0 0 24 24"
			fill="none"
			stroke={color}
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			{kind === "check" ? (
				<Path d="M20 6 9 17l-5-5" />
			) : (
				<>
					<Rect x={9} y={9} width={13} height={13} rx={2} />
					<Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
				</>
			)}
		</Svg>
	);
}
