/**
 * Types for `frame-difference.mjs`.
 *
 * `design/` sits outside every tsconfig in this repository (it is not app source
 * and not a Node script), so the module that tests import cannot carry its own
 * types from a build config. This declaration is the contract instead: delete or
 * rename an export and the typecheck fails rather than the test failing weirdly.
 */
export declare const STRAY_PIXELS: number;
export declare const alphaTool: () => string | undefined;
export declare const parseScalar: (printed: string) => number | undefined;
export declare const pixelDifference: (
	a: string,
	b: string,
	fuzz: number,
) => number | null | undefined;
export declare const largestDifference: (a: string, b: string) => number | null | undefined;
