/** Types for `colour-math.mjs` (design/ sits outside every tsconfig). */
export declare const lum: (hex: string) => number;
export declare const ratio: (a: string, b: string) => number;
export declare const composite: (over: string, base: string) => string;
export declare const mix: (a: string, b: string, w: number) => string;
export declare const toLab: (hex: string) => [number, number, number];
export declare const lstar: (hex: string) => number;
export declare const deltaE: (a: string, b: string) => number;
export declare const labToHex: (lab: [number, number, number]) => string | null;
export declare const atLightness: (hex: string, L: number) => string | null;
