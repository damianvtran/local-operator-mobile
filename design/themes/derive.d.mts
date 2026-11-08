/** Types for `derive.mjs` (design/ sits outside every tsconfig). */
export declare const FIXED: Record<string, string>;
export declare const DIFF_TINT_BAND: Record<"light" | "dark", [number, number]>;
export declare const rgbToHex: (css: string) => string;
export declare const derivePalette: (desktop: {
	id: string;
	name: string;
	mode: "light" | "dark";
	values: Record<string, string>;
}) => {
	id: string;
	name: string;
	mode: "light" | "dark";
	colors: Record<string, string>;
	unsolved: { role: string; why: string }[];
};
