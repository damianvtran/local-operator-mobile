import type { ComponentType } from "react";
import Svg, {
	Circle,
	Ellipse,
	G,
	Line,
	Path,
	Polygon,
	Polyline,
	Rect,
	Text as SvgText,
	TSpan,
} from "react-native-svg";
import type {
	PreparedDiagram,
	SvgNode,
	SvgTag,
} from "@/features/session/diagram-svg";

/**
 * Draw a `PreparedDiagram` with `react-native-svg`.
 *
 * The tree it receives has already been through the allow-list in
 * `diagram-svg.ts`: every tag below is one that module can emit, and every prop
 * is a name it validated, so this file is a plain tag-to-component table with no
 * decisions of its own. A tag with no entry draws nothing, so a future widening
 * of the allow-list cannot reach the screen until it is added here too.
 */
type Drawn = ComponentType<Record<string, unknown>>;

/* A function, not a module-level table: the bindings are read when a diagram is
 * drawn, not when this file loads, so a test that mocks `react-native-svg` for
 * the chrome around a transcript need not stub every shape. */
const componentFor = (tag: SvgTag): Drawn | undefined => {
	switch (tag) {
		case "g":
			return G as Drawn;
		case "path":
			return Path as Drawn;
		case "rect":
			return Rect as Drawn;
		case "circle":
			return Circle as Drawn;
		case "ellipse":
			return Ellipse as Drawn;
		case "line":
			return Line as Drawn;
		case "polygon":
			return Polygon as Drawn;
		case "polyline":
			return Polyline as Drawn;
		case "text":
			return SvgText as Drawn;
		case "tspan":
			return TSpan as Drawn;
		default:
			return undefined;
	}
};

const drawNode = (node: SvgNode | string, key: number) => {
	if (typeof node === "string") return node;
	if (node.tag === "svg") return null;
	const Tag = componentFor(node.tag);
	if (!Tag) return null;
	return (
		<Tag key={key} {...node.props}>
			{node.children.map(drawNode)}
		</Tag>
	);
};

export function DiagramSvgView({
	prepared,
	scale,
}: {
	prepared: PreparedDiagram;
	/** Drawn size over natural size; the viewBox does the scaling. */
	scale: number;
}) {
	const { root, width, height } = prepared;
	return (
		<Svg
			{...(root.props as Record<string, never>)}
			width={width * scale}
			height={height * scale}
		>
			{root.children.map(drawNode)}
		</Svg>
	);
}
