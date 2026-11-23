/**
 * Pele's SVG text, turned into a tree React Native can draw — and nothing else.
 *
 * WHY THIS EXISTS. Pele returns an SVG STRING written for a browser: every colour
 * is `var(--pele-*, #fallback)` behind a chain of private `--_*` variables, the
 * corner radius is the CSS property `style="rx:var(--_r)"`, and the font is the
 * shorthand `font:14px sans-serif` on the root. `react-native-svg` implements the
 * SVG DRAWING model, not the CSS cascade, so handed that string as it is every
 * `var()` is an unparseable colour and the diagram paints black or not at all.
 * This module is the missing CSS step, done once and in plain TypeScript so it
 * runs (and is tested) in Node:
 *
 *   1. a strict, small XML reader (react-native-svg's own `SvgXml` parser does not
 *      decode entities, so `A &amp; B` would draw literally),
 *   2. `var()` resolution against the app theme, then the root's private
 *      variables, then the variable's own fallback,
 *   3. CSS `style` declarations folded into attributes,
 *   4. font inheritance written onto each text node,
 *   5. an ALLOW-LIST of elements, attributes and value shapes.
 *
 * THE ALLOW-LIST IS THE SECURITY BOUNDARY. A transcript is model-written text,
 * and Pele's source is that text. Pele escapes labels and filters styles and
 * links itself (https://pele.run/security, read 2026-11-17), and the caller
 * additionally renders with `links: false, images: false`; this module does not
 * rely on either. An element or attribute that is not named below is DROPPED, not
 * passed through: no `script`, `foreignObject`, `a`, `image`, `use`, `style`, no
 * `on*` handler, no `href`, no `url(...)` or `javascript:` in any value. The
 * output is a tree of plain props, so there is no string for a native view to
 * re-interpret.
 */

export type SvgTag =
	| "svg"
	| "g"
	| "path"
	| "rect"
	| "circle"
	| "ellipse"
	| "line"
	| "polygon"
	| "polyline"
	| "text"
	| "tspan";

export type SvgProp = string | number | readonly number[];

export type SvgNode = {
	tag: SvgTag;
	props: Record<string, SvgProp>;
	children: (SvgNode | string)[];
};

export type PreparedDiagram = {
	/** The root `<svg>`: its props carry `viewBox`; width/height are the caller's. */
	root: SvgNode;
	/** Natural size from the root's `width`/`height`, in points. */
	width: number;
	height: number;
	/** The diagram's own title if it has one, else its first node label. Short,
	 *  for an accessibility label; empty when the diagram has no text. */
	label: string;
};

export type PrepareOptions = {
	/** Pele's `--pele-*` variables, resolved to concrete colours by the caller. */
	theme: Readonly<Record<string, string>>;
	/** The family for Pele's generic `sans-serif` (undefined: platform default). */
	sansFamily?: string;
	/** The family for Pele's generic `monospace`. */
	monoFamily?: string;
	/** Size when neither the root nor an ancestor names one. */
	fontSize: number;
};

/** Thrown for SVG this module will not draw. The caller falls back to the code
 *  block, so the message is a developer diagnostic and not user copy. */
export class DiagramSvgError extends Error {}

/* ------------------------------------------------------------------ limits */

/** Pele caps its own output at 4 M characters; a phone should not walk that many
 *  nodes. These are far above the largest real diagram measured (a few thousand
 *  nodes) and exist so a hostile source cannot make the reader allocate without
 *  bound. */
const MAX_NODES = 40_000;
const MAX_DEPTH = 48;
const MAX_VAR_DEPTH = 8;
const MAX_VALUE_LENGTH = 200_000;

/* --------------------------------------------------------------- XML reader */

type RawElement = {
	name: string;
	attrs: Map<string, string>;
	children: (RawElement | string)[];
};

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[-A-Za-z0-9_:.]/;
const SPACE = /\s/;

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

const decodeEntities = (value: string): string =>
	value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, body) => {
		if (body.startsWith("#x") || body.startsWith("#X")) {
			const code = Number.parseInt(body.slice(2), 16);
			return Number.isInteger(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: "";
		}
		if (body.startsWith("#")) {
			const code = Number.parseInt(body.slice(1), 10);
			return Number.isInteger(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: "";
		}
		return Object.hasOwn(ENTITIES, body) ? (ENTITIES[body] as string) : whole;
	});

/**
 * Read well-formed SVG into plain elements. Strict on purpose: anything it does
 * not understand (a DOCTYPE, a CDATA section, an unquoted attribute, a mismatched
 * close) throws, because Pele's output is machine-written and a document that
 * needs leniency is not Pele's.
 */
const readXml = (source: string): RawElement => {
	if (source.length > MAX_VALUE_LENGTH * 20) {
		throw new DiagramSvgError("svg too large");
	}
	let i = 0;
	let nodes = 0;
	const stack: RawElement[] = [];
	let root: RawElement | null = null;
	const n = source.length;

	const fail = (message: string): never => {
		throw new DiagramSvgError(`${message} at ${i}`);
	};
	const skipSpace = () => {
		while (i < n && SPACE.test(source[i] ?? "")) i += 1;
	};
	const readName = (): string => {
		const start = i;
		if (!NAME_START.test(source[i] ?? "")) fail("expected a name");
		i += 1;
		while (i < n && NAME_CHAR.test(source[i] ?? "")) i += 1;
		return source.slice(start, i);
	};

	while (i < n) {
		const lt = source.indexOf("<", i);
		const text = source.slice(i, lt === -1 ? n : lt);
		if (text.trim() !== "") {
			const top = stack[stack.length - 1];
			if (!top) fail("text outside the root");
			else top.children.push(decodeEntities(text));
		}
		if (lt === -1) break;
		i = lt + 1;
		const head = source[i];
		if (head === "!") {
			if (source.startsWith("!--", i)) {
				const end = source.indexOf("-->", i + 3);
				if (end === -1) fail("unterminated comment");
				i = end + 3;
				continue;
			}
			fail("DOCTYPE and CDATA are not drawn");
		}
		if (head === "?") {
			const end = source.indexOf("?>", i);
			if (end === -1) fail("unterminated declaration");
			i = end + 2;
			continue;
		}
		if (head === "/") {
			i += 1;
			const name = readName();
			skipSpace();
			if (source[i] !== ">") fail("expected >");
			i += 1;
			const open = stack.pop();
			if (!open || open.name !== name) fail("mismatched close tag");
			continue;
		}
		const name = readName();
		const attrs = new Map<string, string>();
		let selfClosing = false;
		for (;;) {
			skipSpace();
			const c = source[i];
			if (c === "/") {
				if (source[i + 1] !== ">") fail("expected />");
				i += 2;
				selfClosing = true;
				break;
			}
			if (c === ">") {
				i += 1;
				break;
			}
			if (i >= n) fail("unterminated tag");
			const attr = readName();
			skipSpace();
			if (source[i] !== "=") fail("attribute without a value");
			i += 1;
			skipSpace();
			const quote = source[i];
			if (quote !== '"' && quote !== "'") fail("unquoted attribute");
			const end = source.indexOf(quote as string, i + 1);
			if (end === -1) fail("unterminated attribute");
			if (end - i > MAX_VALUE_LENGTH) fail("attribute too long");
			if (!attrs.has(attr)) {
				attrs.set(attr, decodeEntities(source.slice(i + 1, end)));
			}
			i = end + 1;
		}
		nodes += 1;
		if (nodes > MAX_NODES) fail("too many elements");
		const element: RawElement = { name, attrs, children: [] };
		const parent = stack[stack.length - 1];
		if (parent) parent.children.push(element);
		else if (root) fail("more than one root");
		else root = element;
		if (!selfClosing) {
			stack.push(element);
			if (stack.length > MAX_DEPTH) fail("nested too deeply");
		}
	}
	if (stack.length > 0) fail("unclosed element");
	if (!root) fail("empty document");
	return root as RawElement;
};

/* ----------------------------------------------------------- var() and CSS */

const parseDeclarations = (css: string): [string, string][] => {
	const out: [string, string][] = [];
	for (const part of css.split(";")) {
		const colon = part.indexOf(":");
		if (colon <= 0) continue;
		const name = part.slice(0, colon).trim().toLowerCase();
		const value = part.slice(colon + 1).trim();
		if (name !== "" && value !== "") out.push([name, value]);
	}
	return out;
};

type Scope = {
	theme: Readonly<Record<string, string>>;
	/** The root's own custom properties (`--_bg: var(--pele-bg, #fff)` …). */
	own: Map<string, string>;
	/** What each private variable resolved to, so a chain is walked once. */
	settled: Map<string, string | null>;
	/** Substitutions left for this document. A chain of variables that each name
	 *  the next one many times grows as references^depth; the memo above makes
	 *  Pele's own (short, linear) chains cheap and this ends anything else. */
	steps: number;
};

const VAR_STEP_BUDGET = 400_000;

/** Substitute every `var(--name, fallback)` in `value`; `null` when one cannot be
 *  resolved (no theme value, no private variable, no fallback). */
const resolveVars = (value: string, scope: Scope, depth = 0): string | null => {
	if (depth > MAX_VAR_DEPTH) return null;
	scope.steps -= 1;
	if (scope.steps < 0) return null;
	let out = "";
	let i = 0;
	while (i < value.length) {
		const at = value.indexOf("var(", i);
		if (at === -1) {
			out += value.slice(i);
			break;
		}
		out += value.slice(i, at);
		let level = 1;
		let j = at + 4;
		let comma = -1;
		while (j < value.length && level > 0) {
			const c = value[j];
			if (c === "(") level += 1;
			else if (c === ")") level -= 1;
			else if (c === "," && level === 1 && comma === -1) comma = j;
			j += 1;
		}
		if (level !== 0) return null;
		const inner = value.slice(at + 4, j - 1);
		const name = (comma === -1 ? inner : inner.slice(0, comma - at - 4)).trim();
		const fallback =
			comma === -1 ? undefined : value.slice(comma + 1, j - 1).trim();
		if (!VAR_NAME.test(name)) return null;
		let resolved: string | null = null;
		const themed = Object.hasOwn(scope.theme, name)
			? scope.theme[name]
			: undefined;
		if (themed !== undefined) {
			resolved = resolveVars(themed, scope, depth + 1);
		} else if (scope.own.has(name)) {
			if (scope.settled.has(name)) {
				resolved = scope.settled.get(name) ?? null;
			} else {
				resolved = resolveVars(scope.own.get(name) as string, scope, depth + 1);
				scope.settled.set(name, resolved);
			}
		}
		if (resolved === null && fallback !== undefined) {
			resolved = resolveVars(fallback, scope, depth + 1);
		}
		if (resolved === null) return null;
		out += resolved;
		i = j;
	}
	return out.trim();
};

/* ------------------------------------------------------- value validation */

const LENGTH = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?(?:px|pt)?$/i;
const PERCENT_LENGTH = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?(?:px|pt|%)?$/i;
const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i;
const HEX_COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL_COLOUR = /^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/-]+\)$/i;
const NAMED_COLOUR = /^[a-z]{3,24}$/i;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;
const POINTS = /^[0-9eE.,\s+-]*$/;
// Leading whitespace once, trailing whitespace once per term: two matchers over
// the same spaces made this exponential on `translate(1)  translate(1)  x`.
const TRANSFORM =
	/^\s*(?:(?:translate|rotate|scale|matrix|skewX|skewY)\([-0-9eE.,\s+]*\)\s*)+$/;
const FAMILY = /^[A-Za-z0-9 ,'"_.-]+$/;
const VIEW_BOX =
	/^\s*-?(?:\d+(?:\.\d*)?|\.\d+)(?:[\s,]+-?(?:\d+(?:\.\d*)?|\.\d+)){3}\s*$/;

/** Anything that could make a native view fetch, run or navigate. Checked on
 *  every value as well as shape-validated, so a future change to a validator
 *  cannot quietly admit one. */
const VAR_NAME = /^--[A-Za-z0-9_-]+$/;
const LIST_SEPARATOR = /[\s,]+/;
const FONT_SIZE_PX = /(\d+(?:\.\d+)?)px/;
const WHITESPACE_RUN = /\s+/g;

const DANGEROUS = /url\s*\(|javascript:|data:|vbscript:|expression\s*\(|[<>]/i;

type Kind =
	| "colour"
	| "length"
	| "pctLength"
	| "number"
	| "unit"
	| "path"
	| "points"
	| "transform"
	| "dash"
	| "family"
	| "weight"
	| "linecap"
	| "linejoin"
	| "anchor"
	| "fontStyle"
	| "fillRule";

const FONT_WEIGHTS = new Set([
	"normal",
	"bold",
	"bolder",
	"lighter",
	"100",
	"200",
	"300",
	"400",
	"500",
	"600",
	"700",
	"800",
	"900",
]);

/** The attributes drawn, as `[react-native-svg prop, value shape]`. Everything
 *  else is dropped. */
const ATTRIBUTES: Record<string, [string, Kind]> = {
	fill: ["fill", "colour"],
	stroke: ["stroke", "colour"],
	"stroke-width": ["strokeWidth", "length"],
	"stroke-linecap": ["strokeLinecap", "linecap"],
	"stroke-linejoin": ["strokeLinejoin", "linejoin"],
	"stroke-dasharray": ["strokeDasharray", "dash"],
	"stroke-opacity": ["strokeOpacity", "unit"],
	"fill-opacity": ["fillOpacity", "unit"],
	"fill-rule": ["fillRule", "fillRule"],
	opacity: ["opacity", "unit"],
	x: ["x", "length"],
	y: ["y", "length"],
	dx: ["dx", "length"],
	dy: ["dy", "length"],
	x1: ["x1", "length"],
	y1: ["y1", "length"],
	x2: ["x2", "length"],
	y2: ["y2", "length"],
	cx: ["cx", "length"],
	cy: ["cy", "length"],
	r: ["r", "length"],
	rx: ["rx", "length"],
	ry: ["ry", "length"],
	width: ["width", "pctLength"],
	height: ["height", "pctLength"],
	d: ["d", "path"],
	points: ["points", "points"],
	transform: ["transform", "transform"],
	"font-size": ["fontSize", "length"],
	"font-weight": ["fontWeight", "weight"],
	"font-style": ["fontStyle", "fontStyle"],
	"font-family": ["fontFamily", "family"],
	"text-anchor": ["textAnchor", "anchor"],
};

/** CSS declarations Pele writes into `style="…"` that mean something drawable.
 *  Same value shapes as the attribute of the same name. */
const STYLE_PROPERTIES = new Set([
	"fill",
	"stroke",
	"stroke-width",
	"stroke-dasharray",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-opacity",
	"fill-opacity",
	"opacity",
	"rx",
	"ry",
	"font-size",
	"font-weight",
	"font-style",
	"font-family",
	"text-anchor",
]);

const ELEMENTS: ReadonlySet<string> = new Set<SvgTag>([
	"svg",
	"g",
	"path",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polygon",
	"polyline",
	"text",
	"tspan",
]);

type Inherited = {
	fontSize: number;
	fontWeight?: string;
	fontStyle?: string;
	fontFamily?: string;
	textAnchor?: string;
	colour: string;
};

const GENERIC_SANS = new Set(["sans-serif", "system-ui", "ui-sans-serif"]);
const GENERIC_MONO = new Set(["monospace", "ui-monospace"]);

const lengthNumber = (value: string): number | null => {
	if (!LENGTH.test(value)) return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
};

type Context = {
	scope: Scope;
	options: PrepareOptions;
};

const checkValue = (
	kind: Kind,
	raw: string,
	inherited: Inherited,
	ctx: Context,
): SvgProp | null => {
	const value = raw.trim();
	if (value === "" || value.length > MAX_VALUE_LENGTH) return null;
	if (DANGEROUS.test(value)) return null;
	switch (kind) {
		case "colour": {
			const lower = value.toLowerCase();
			if (lower === "none" || lower === "transparent") return "none";
			if (lower === "currentcolor") return inherited.colour;
			if (HEX_COLOUR.test(value) || FUNCTIONAL_COLOUR.test(value)) return value;
			return NAMED_COLOUR.test(value) ? lower : null;
		}
		case "length": {
			const parsed = lengthNumber(value);
			return parsed === null ? null : parsed;
		}
		case "pctLength":
			return PERCENT_LENGTH.test(value) ? value : null;
		case "number":
			return NUMBER.test(value) ? Number.parseFloat(value) : null;
		case "unit": {
			if (!NUMBER.test(value)) return null;
			const parsed = Number.parseFloat(value);
			return parsed >= 0 && parsed <= 1 ? parsed : null;
		}
		case "path":
			return PATH_DATA.test(value) ? value : null;
		case "points":
			return POINTS.test(value) ? value : null;
		case "transform":
			return TRANSFORM.test(value) ? value : null;
		case "dash": {
			if (value.toLowerCase() === "none") return "none";
			const parts = value.split(LIST_SEPARATOR).filter(Boolean);
			const numbers = parts.map((part) => lengthNumber(part));
			if (numbers.length === 0 || numbers.some((part) => part === null)) {
				return null;
			}
			return numbers as number[];
		}
		case "family": {
			if (!FAMILY.test(value)) return null;
			const first = (value.split(",")[0] ?? "")
				.trim()
				.replace(/^['"]|['"]$/g, "");
			if (first === "") return null;
			const lower = first.toLowerCase();
			if (GENERIC_SANS.has(lower)) return ctx.options.sansFamily ?? "";
			if (GENERIC_MONO.has(lower)) return ctx.options.monoFamily ?? "";
			return first;
		}
		case "weight": {
			const lower = value.toLowerCase();
			return FONT_WEIGHTS.has(lower) ? lower : null;
		}
		case "linecap":
			return ["butt", "round", "square"].includes(value) ? value : null;
		case "linejoin":
			return ["miter", "round", "bevel"].includes(value) ? value : null;
		case "anchor":
			return ["start", "middle", "end"].includes(value) ? value : null;
		case "fontStyle":
			return ["normal", "italic", "oblique"].includes(value) ? value : null;
		case "fillRule":
			return ["nonzero", "evenodd"].includes(value) ? value : null;
	}
};

const CLASS_TITLE = /(?:^|\s)pele-title(?:\s|$)/;
const CLASS_LABEL = /(?:^|\s)pele-label(?:\s|$)/;

const textOf = (element: RawElement): string => {
	let out = "";
	for (const child of element.children) {
		out += typeof child === "string" ? child : textOf(child);
	}
	return out;
};

/**
 * The theme's own values must be drawable colours: a role that resolved to
 * something odd (a semantic string, an empty value) would otherwise be dropped
 * silently and leave a black shape. Callers pass hex.
 */
const checkTheme = (theme: Readonly<Record<string, string>>) => {
	for (const [name, value] of Object.entries(theme)) {
		if (!name.startsWith("--pele-")) {
			throw new DiagramSvgError(`theme variable ${name} is not a --pele- name`);
		}
		if (DANGEROUS.test(value)) {
			throw new DiagramSvgError(`theme variable ${name} is not a plain value`);
		}
	}
};

/** Read Pele's SVG into a drawable tree. Throws `DiagramSvgError` for a document
 *  that is not drawable; never returns partial output. */
export const prepareDiagramSvg = (
	svg: string,
	options: PrepareOptions,
): PreparedDiagram => {
	checkTheme(options.theme);
	const rootElement = readXml(svg);
	if (rootElement.name !== "svg") {
		throw new DiagramSvgError("root is not an svg element");
	}

	const own = new Map<string, string>();
	const rootStyle = parseDeclarations(rootElement.attrs.get("style") ?? "");
	for (const [name, value] of rootStyle) {
		if (name.startsWith("--")) own.set(name, value);
	}
	const scope: Scope = {
		theme: options.theme,
		own,
		settled: new Map(),
		steps: VAR_STEP_BUDGET,
	};
	const ctx: Context = { scope, options };

	const rootColourSource = rootStyle.find(([name]) => name === "color")?.[1];
	const rootColour =
		(rootColourSource ? resolveVars(rootColourSource, scope) : null) ??
		options.theme["--pele-fg"] ??
		"#000000";

	// `font:14px sans-serif` — only the size is read from the shorthand; the
	// family is `font-family`'s job and the weight is per element.
	const fontShorthand = rootStyle.find(([name]) => name === "font")?.[1];
	const shorthandSize = fontShorthand
		? FONT_SIZE_PX.exec(fontShorthand)?.[1]
		: undefined;
	const rootFamilySource = rootStyle.find(
		([name]) => name === "font-family",
	)?.[1];
	const rootFamilyResolved = rootFamilySource
		? resolveVars(rootFamilySource, scope)
		: null;
	const baseInherited: Inherited = {
		fontSize: shorthandSize
			? Number.parseFloat(shorthandSize)
			: options.fontSize,
		colour: rootColour,
	};
	if (rootFamilyResolved) {
		const family = checkValue("family", rootFamilyResolved, baseInherited, ctx);
		if (typeof family === "string" && family !== "") {
			baseInherited.fontFamily = family;
		}
	} else if (options.sansFamily) {
		baseInherited.fontFamily = options.sansFamily;
	}

	let label = "";
	let labelIsTitle = false;

	const convert = (
		element: RawElement,
		inherited: Inherited,
		isRoot: boolean,
	): SvgNode | null => {
		if (!ELEMENTS.has(element.name)) return null;
		const tag = element.name as SvgTag;
		const props: Record<string, SvgProp> = {};
		const next: Inherited = { ...inherited };

		const apply = (name: string, rawValue: string) => {
			if (!Object.hasOwn(ATTRIBUTES, name)) return;
			const spec = ATTRIBUTES[name] as [string, Kind];
			const [prop, kind] = spec;
			const resolved = resolveVars(rawValue, scope);
			if (resolved === null) return;
			const value = checkValue(kind, resolved, inherited, ctx);
			if (value === null) return;
			if (prop === "fontFamily" && value === "") {
				// A generic family with no app face: inherit the platform default.
				delete props.fontFamily;
				next.fontFamily = undefined;
				return;
			}
			props[prop] = value;
		};

		for (const [name, value] of element.attrs) {
			if (name === "style") continue;
			apply(name, value);
		}
		const style = element.attrs.get("style");
		if (style) {
			for (const [name, value] of parseDeclarations(style)) {
				if (STYLE_PROPERTIES.has(name)) apply(name, value);
			}
		}

		if (isRoot) {
			const box = element.attrs.get("viewBox");
			if (box && VIEW_BOX.test(box)) props.viewBox = box.trim();
			delete props.width;
			delete props.height;
		}

		if (typeof props.fontSize === "number") next.fontSize = props.fontSize;
		if (typeof props.fontWeight === "string") {
			next.fontWeight = props.fontWeight;
		}
		if (typeof props.fontStyle === "string") next.fontStyle = props.fontStyle;
		if (typeof props.fontFamily === "string") {
			next.fontFamily = props.fontFamily;
		}
		if (typeof props.textAnchor === "string") {
			next.textAnchor = props.textAnchor;
		}

		if (tag === "text" || tag === "tspan") {
			props.fontSize = next.fontSize;
			if (next.fontWeight) props.fontWeight = next.fontWeight;
			if (next.fontStyle) props.fontStyle = next.fontStyle;
			if (next.fontFamily) props.fontFamily = next.fontFamily;
			if (next.textAnchor) props.textAnchor = next.textAnchor;
		} else {
			delete props.fontSize;
			delete props.fontWeight;
			delete props.fontStyle;
			delete props.fontFamily;
			delete props.textAnchor;
		}

		const className = element.attrs.get("class") ?? "";
		if (tag === "text") {
			const text = textOf(element).replace(WHITESPACE_RUN, " ").trim();
			if (text !== "") {
				if (CLASS_TITLE.test(className) && !labelIsTitle) {
					label = text;
					labelIsTitle = true;
				} else if (label === "" && CLASS_LABEL.test(className)) {
					label = text;
				}
			}
		}

		const children: (SvgNode | string)[] = [];
		const takesText = tag === "text" || tag === "tspan";
		for (const child of element.children) {
			if (typeof child === "string") {
				if (takesText) children.push(child);
			} else {
				const converted = convert(child, next, false);
				if (converted) children.push(converted);
			}
		}
		return { tag, props, children };
	};

	const root = convert(rootElement, baseInherited, true);
	if (!root) throw new DiagramSvgError("root is not drawable");

	const width = lengthNumber(rootElement.attrs.get("width") ?? "");
	const height = lengthNumber(rootElement.attrs.get("height") ?? "");
	const box = rootElement.attrs.get("viewBox");
	let w = width;
	let h = height;
	if ((w === null || h === null) && box && VIEW_BOX.test(box)) {
		const parts = box.trim().split(LIST_SEPARATOR).map(Number);
		w = w ?? parts[2] ?? null;
		h = h ?? parts[3] ?? null;
	}
	if (w === null || h === null || !(w > 0) || !(h > 0)) {
		throw new DiagramSvgError("svg has no usable size");
	}
	if (!root.props.viewBox) root.props.viewBox = `0 0 ${w} ${h}`;
	return { root, width: w, height: h, label: label.slice(0, 120) };
};

/** Every element tag and prop name in a tree: what a test asserts the allow-list
 *  against, and what a reviewer reads to see nothing unexpected survived. */
export const surveyTree = (
	node: SvgNode,
): { tags: Set<string>; props: Set<string> } => {
	const tags = new Set<string>([node.tag]);
	const props = new Set<string>(Object.keys(node.props));
	for (const child of node.children) {
		if (typeof child === "string") continue;
		const inner = surveyTree(child);
		for (const tag of inner.tags) tags.add(tag);
		for (const prop of inner.props) props.add(prop);
	}
	return { tags, props };
};
