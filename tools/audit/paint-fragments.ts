/** U-08 geometry is a set of painted line boxes, not their bounding envelope.
 * Exact axis-aligned unions retain holes and avoid counting overlapping text
 * Range rectangles twice. These are typographic boxes, NOT raster glyph ink. */
export interface PaintRect {
	x: number;
	y: number;
	w: number;
	h: number;
}
export interface PaintSource {
	visibleRect: PaintRect | null;
	interactive?: boolean;
	ownBackground?: string;
	borderWidth?: number;
	childImages?: number;
	/** Missing = legacy/non-text conservative box; [] = observed no text paint. */
	u08PaintFragments?: PaintRect[];
}
export function rectangleUnion(rectangles: readonly PaintRect[]): PaintRect[] {
	if (
		rectangles.some(
			(r) => ![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w < 0 || r.h < 0,
		)
	)
		throw new Error("Invalid U08 fragment geometry; cannot manufacture a PASS");
	const rects = rectangles.filter((r) => r.w > 0 && r.h > 0);
	const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort(
		(a, b) => a - b,
	);
	const result: PaintRect[] = [];
	let previous = new Map<string, PaintRect>();
	for (let i = 0; i < xs.length - 1; i++) {
		const left = xs[i],
			right = xs[i + 1];
		if (left === undefined || right === undefined || right <= left) continue;
		const intervals = rects
			.filter((r) => r.x <= left && r.x + r.w >= right)
			.map((r) => [r.y, r.y + r.h] as [number, number])
			.sort((a, b) => a[0] - b[0]);
		const merged: [number, number][] = [];
		for (const interval of intervals) {
			const last = merged.at(-1);
			if (last && interval[0] <= last[1])
				last[1] = Math.max(last[1], interval[1]);
			else merged.push([...interval]);
		}
		const next = new Map<string, PaintRect>();
		for (const [top, bottom] of merged) {
			const key = `${top}:${bottom}`,
				old = previous.get(key);
			if (old && old.x + old.w === left) {
				old.w = right - old.x;
				next.set(key, old);
			} else {
				const rect = { x: left, y: top, w: right - left, h: bottom - top };
				result.push(rect);
				next.set(key, rect);
			}
		}
		previous = next;
	}
	return result;
}
export const unionArea = (rects: readonly PaintRect[]) =>
	rectangleUnion(rects).reduce((sum, r) => sum + r.w * r.h, 0);
/** Whether the intersection union contains a >1pt by >1pt contact region.
 * A sweep partition must not turn a real wide collision into many thin slabs.
 * Intersect Y coverage over consecutive X slabs; holes never become paint. */
function hasContact(rects: readonly PaintRect[]): boolean {
	if (rects.some((r) => r.w > 1 && r.h > 1)) return true;
	if (rects.length < 2) return false;
	const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort(
		(a, b) => a - b,
	);
	for (let start = 0; start < xs.length - 1; start++) {
		let common: [number, number][] | undefined;
		for (let at = start; at < xs.length - 1; at++) {
			const left = xs[at],
				right = xs[at + 1],
				origin = xs[start];
			if (left === undefined || right === undefined || origin === undefined)
				continue;
			const ys = rects
				.filter((r) => r.x <= left && r.x + r.w >= right)
				.map((r) => [r.y, r.y + r.h] as [number, number]);
			common =
				common === undefined
					? ys
					: common.flatMap((a) =>
							ys.flatMap((b) => {
								const low = Math.max(a[0], b[0]),
									high = Math.min(a[1], b[1]);
								return high - low > 1 ? [[low, high] as [number, number]] : [];
							}),
						);
			common = common.filter((y) => y[1] - y[0] > 1);
			if (common.length === 0) break;
			if (right - origin > 1) return true;
		}
	}
	return false;
}

export function paintOverlap(a: PaintSource, b: PaintSource) {
	const usesFragments = (n: PaintSource) =>
		n.u08PaintFragments != null &&
		!n.interactive &&
		!(n.borderWidth && n.borderWidth > 0) &&
		!(n.childImages && n.childImages > 0) &&
		(!n.ownBackground ||
			["transparent", "rgba(0, 0, 0, 0)"].includes(n.ownBackground));
	const fragmentMode = usesFragments(a) || usesFragments(b);
	const regions = (n: PaintSource) =>
		rectangleUnion(
			usesFragments(n)
				? (n.u08PaintFragments ?? [])
				: n.visibleRect
					? [n.visibleRect]
					: [],
		);
	const ar = regions(a),
		br = regions(b);
	const intersections = rectangleUnion(
		ar.flatMap((x) =>
			br.flatMap((y) => {
				const left = Math.max(x.x, y.x),
					top = Math.max(x.y, y.y),
					right = Math.min(x.x + x.w, y.x + y.w),
					bottom = Math.min(x.y + x.h, y.y + y.h);
				return right > left && bottom > top
					? [{ x: left, y: top, w: right - left, h: bottom - top }]
					: [];
			}),
		),
	);
	const area = intersections.reduce((sum, r) => sum + r.w * r.h, 0),
		smaller = Math.min(unionArea(ar), unionArea(br));
	// Preserve the existing >1pt contact tolerance on actual intersections, never
	// on a bounding envelope spanning disjoint pieces of text.
	const contact = hasContact(intersections);
	return {
		fragmentMode,
		intersections,
		area,
		smaller,
		pct: smaller > 0 ? area / smaller : 0,
		contact,
	};
}
