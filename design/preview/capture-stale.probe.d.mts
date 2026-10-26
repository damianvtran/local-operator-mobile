/**
 * Types for `capture-stale.probe.mjs` — the design job runs it as a script and
 * `scripts/design/capture-check.test.ts` imports this one function, so the shape
 * is declared here rather than inferred (design/ sits outside every tsconfig).
 *
 * Both fields are optional because the result is one of two shapes: `skipped` when
 * this machine has no browser, or `problems`/`output` when it ran.
 */
export declare const checkStaleFrame: () => {
	skipped?: string;
	problems?: string[];
	output?: string;
};
