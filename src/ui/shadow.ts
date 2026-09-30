/**
 * The two shadows, adapted from the tokens to React Native's model.
 *
 * `tokens.json § elevation` authors them as CSS shadows, and React Native wants the
 * same information split across `shadowOffset` / `shadowRadius` / `shadowColor`
 * (iOS) plus `elevation` (Android). The token file is explicit that BOTH must be
 * set or one platform silently gets nothing, so this adapter sets both and nothing
 * in the app hand-writes a shadow.
 *
 * The parser is pure and throws on a shape it does not understand, rather than
 * degrading to a default: a quietly-dropped shadow changes how far an object looks
 * from the page, and no review catches that. It lives apart from the hook so it can
 * be unit-tested in Node without React Native in the graph.
 */

export type ShadowToken = {
	light: string;
	dark: string;
	androidElevation: number;
};

export type ResolvedShadow = {
	shadowColor: string;
	shadowOpacity: number;
	shadowOffset: { width: number; height: number };
	shadowRadius: number;
	// React Native accepts elevation only on Android, and warns on web if it is
	// present on iOS; the platform check is the caller's, so the value is always
	// returned and the style object decides.
	elevation: number;
};

/**
 * Four lengths and a colour. The `px` unit is OPTIONAL on each length because CSS
 * allows a bare `0` — and the tokens' own overlay value is written
 * `0 12px 32px -12px …`, so a parser that insists on `0px` rejects the file it was
 * written for. That was a real bug here, caught by the test below.
 */
/* Hoisted so the patterns are compiled once rather than per call: this parser runs
 * on every render that resolves a shadow. */
const COLOUR = /rgba?\(\s*([^)]+)\)/;
const CHANNEL_SEPARATOR = /[\s,]+/;

const SHADOW =
	/^\s*(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+(rgba?\([^)]+\))\s*$/;

/** `rgb(20 17 12 / 0.25)` and `rgba(0, 0, 0, 0.6)` both resolve here: the tokens
 * use the modern space-separated form, the kit inherited the comma form. */
export const parseColour = (
	value: string,
): { hex: string; opacity: number } => {
	const match = COLOUR.exec(value);
	if (!match?.[1]) {
		throw new Error(`Not an rgb()/rgba() colour: "${value}"`);
	}
	// Two accepted forms, and the alpha lives in a different place in each:
	// `rgb(20 17 12 / 0.25)` (modern) and `rgba(0, 0, 0, 0.6)` (legacy). The legacy
	// form is the awkward one: splitting it on commas blindly leaves `0` as the only
	// channel, so the alpha is only taken when there is genuinely a fourth value.
	const body = match[1].trim();
	const slash = body.indexOf("/");
	let channelPart = body;
	let alphaPart = "1";
	if (slash >= 0) {
		channelPart = body.slice(0, slash).trim();
		alphaPart = body.slice(slash + 1).trim();
	} else if (body.includes(",")) {
		const parts = body.split(",").map((part) => part.trim());
		if (parts.length === 4) {
			alphaPart = parts[3] ?? "1";
			channelPart = parts.slice(0, 3).join(" ");
		}
	}
	const channels = channelPart.split(CHANNEL_SEPARATOR).map(Number);
	const alpha = Number(alphaPart);
	const [r, g, b] = channels;
	if (r === undefined || g === undefined || b === undefined) {
		throw new Error(`Could not read three channels from "${value}"`);
	}
	const hex = `#${[r, g, b]
		.map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
		.join("")}`;
	return { hex, opacity: Number.isFinite(alpha) ? alpha : 1 };
};

/**
 * One CSS shadow → React Native's fields.
 *
 * Returns null for `none`, which is what the tokens would say if a token ever
 * stopped having a shadow; every other shape throws.
 */
export const parseCssShadow = (
	value: string,
	androidElevation: number,
): ResolvedShadow | null => {
	if (value.trim() === "none") return null;
	const match = SHADOW.exec(value);
	if (!match) {
		throw new Error(
			`Not a single-layer shadow: "${value}". tokens.json § elevation holds one layer per shadow; a multi-layer value needs its own decision here rather than being approximated.`,
		);
	}
	const [, offsetX, offsetY, blur, spread, colour] = match as unknown as [
		string,
		string,
		string,
		string,
		string,
		string,
	];
	const { hex, opacity } = parseColour(colour);
	const spreadPx = Number(spread);
	return {
		shadowColor: hex,
		shadowOpacity: opacity,
		// React Native has no spread radius, so it is folded into the blur: dropping
		// it would make a `-12px` spread render as a noticeably larger shadow.
		shadowOffset: { width: Number(offsetX), height: Number(offsetY) },
		shadowRadius: Math.max(0, Number(blur) + spreadPx),
		elevation: androidElevation,
	};
};
