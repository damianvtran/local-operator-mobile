/** Align to the first line, never the height of a wrapped title block. Match
 * the previous single-line centring while keeping the mark at native cap size. */
export function brandTitleMetrics(line: {
	capHeight: number;
	height: number;
	y: number;
}) {
	if (
		![line.capHeight, line.height, line.y].every(Number.isFinite) ||
		line.capHeight <= 0
	)
		return null;
	return {
		cap: line.capHeight,
		top: Math.max(0, line.y + (line.height - line.capHeight) / 2),
	};
}
