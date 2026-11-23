import { withinDrawBudget } from "./diagram-source";
import { type PreparedDiagram, prepareDiagramSvg } from "./diagram-svg";
import { PELE_FONT_SIZE } from "./diagram-theme";

/**
 * Mermaid source in, a drawable diagram out — the one place the app talks to Pele.
 *
 * PELE IS LOADED ON FIRST USE, NOT AT STARTUP. `pele/lazy` is Pele's own
 * on-demand entry: the core is small and each diagram type is a separate module
 * pulled in by the first diagram of that type. Metro turns the `import()` into a
 * lazily evaluated module inside the one native bundle (there is no network
 * fetch), so a session with no diagram never evaluates any of it, and the
 * source-size cost is the same either way (see the pull request's bundle table).
 *
 * THE RESULT IS CACHED, AND THE CACHE IS READ SYNCHRONOUSLY. The transcript is a
 * virtualised list, so a diagram's row unmounts and mounts again as the reader
 * scrolls; if the second mount had to wait a microtask for an answer it already
 * had, the row would flash its code block each time (the image cache,
 * `image-cache.ts`, exists for the same reason). `peekDiagram` answers a settled
 * diagram in the first frame. The key is everything the output depends on:
 * source, available width (layout adapts to it), the theme's values and the
 * fonts, so a theme change or a rotation is a different entry, not a stale one.
 */

export type DiagramFonts = { sans?: string; mono?: string };

export type DiagramRequest = {
	source: string;
	/** Width the diagram may use, in points. Pele lays out to it where it can. */
	width: number;
	theme: Readonly<Record<string, string>>;
	fonts: DiagramFonts;
};

export type DiagramResult =
	| {
			ok: true;
			/** Pele's own type name: `flowchart`, `sequence`, `state`, … */
			type: string;
			prepared: PreparedDiagram;
	  }
	| {
			ok: false;
			/** `invalid`: Pele (or the SVG reader) refused this source, which is a
			 *  fact about the text and is cached. `unavailable`: the engine itself
			 *  could not load, which is not. */
			reason: "invalid" | "unavailable";
			/** Pele's own message for an `invalid` source, bounded. */
			message: string;
	  };

type PeleModule = typeof import("pele/lazy");

let loading: Promise<PeleModule> | null = null;

const loadPele = (): Promise<PeleModule> => {
	if (!loading) {
		loading = import("pele/lazy").catch((error: unknown) => {
			loading = null;
			throw error;
		});
	}
	return loading;
};

const CACHE_LIMIT = 48;
const cache = new Map<string, DiagramResult>();

/** Width is bucketed so a pixel of jitter from layout does not re-render a
 *  diagram that cannot look different. */
const WIDTH_STEP = 8;

const cacheKey = (request: DiagramRequest): string =>
	JSON.stringify([
		request.source,
		Math.floor(request.width / WIDTH_STEP),
		request.theme,
		request.fonts,
	]);

const remember = (key: string, result: DiagramResult): void => {
	cache.delete(key);
	cache.set(key, result);
	if (cache.size > CACHE_LIMIT) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
};

/** A settled answer for `request`, or `undefined` when none exists yet. */
export const peekDiagram = (
	request: DiagramRequest,
): DiagramResult | undefined => {
	// Read-only: this runs during render, so it must not reorder the cache.
	// Recency is updated when a result settles (`remember`).
	return cache.get(cacheKey(request));
};

/** Forget every settled diagram. Tests only; the cache is bounded in use. */
export const clearDiagramCache = (): void => {
	cache.clear();
};

const MESSAGE_LIMIT = 280;
const WHITESPACE_RUN = /\s+/g;

const bounded = (message: string): string => {
	const flat = message.replace(WHITESPACE_RUN, " ").trim();
	return flat.length > MESSAGE_LIMIT
		? `${flat.slice(0, MESSAGE_LIMIT - 1)}…`
		: flat;
};

/**
 * Render a diagram. Never throws: a source Pele refuses, and an SVG this app
 * will not draw, both come back as `ok: false` so the caller shows the code block
 * with the reason beside it.
 */
export const renderDiagram = async (
	request: DiagramRequest,
): Promise<DiagramResult> => {
	const key = cacheKey(request);
	const hit = cache.get(key);
	if (hit) return hit;

	let pele: PeleModule;
	try {
		pele = await loadPele();
	} catch {
		return { ok: false, reason: "unavailable", message: "" };
	}

	let result: DiagramResult;
	try {
		const rendered = await pele.renderAsync(request.source, {
			fontSize: PELE_FONT_SIZE,
			fontFamily: request.fonts.sans,
			fontFamilyMono: request.fonts.mono,
			maxWidth: request.width,
			// Fixed pixel size: the view scales the finished drawing itself.
			responsive: false,
			// Links and images are the two places an SVG reaches outside itself.
			// A transcript diagram needs neither, and the converter drops both
			// anyway (`diagram-svg.ts`); this keeps them from being written.
			links: false,
			images: false,
		});
		const prepared = prepareDiagramSvg(rendered.svg, {
			theme: request.theme,
			sansFamily: request.fonts.sans,
			monoFamily: request.fonts.mono,
			fontSize: PELE_FONT_SIZE,
		});
		// A native view is one surface the size of the drawing; past the budget it
		// cannot be allocated, so the block shows its source instead (see
		// `MAX_DRAWN_AREA_PT`).
		result = withinDrawBudget(prepared, request.width)
			? { ok: true, type: rendered.type, prepared }
			: {
					ok: false,
					reason: "invalid",
					message: `Too large to draw on a phone (${Math.round(prepared.width)} × ${Math.round(prepared.height)} pt).`,
				};
	} catch (error) {
		const message =
			error instanceof Error && error.message !== ""
				? bounded(error.message)
				: "";
		result = { ok: false, reason: "invalid", message };
	}
	remember(key, result);
	return result;
};

/**
 * What a block shows right now: the cached drawing if there is one, else the
 * last settled result FOR THE SAME SOURCE (a theme change, a rotation or a width
 * correction re-requests the same text — keep its drawing until the new one
 * arrives rather than flash the code block), else nothing yet.
 */
export const currentResult = (
	cached: DiagramResult | undefined,
	settled: { request: DiagramRequest; result: DiagramResult } | null,
	source: string,
): DiagramResult | null =>
	cached ??
	(settled && settled.request.source === source ? settled.result : null);
