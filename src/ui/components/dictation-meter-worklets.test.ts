import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The dictation meter's animated styles run on reanimated's UI runtime, a
 * separate JS context. A worklet body may CALL another function only if that
 * function is itself a worklet: a plain function has no serialisable closure, so
 * the UI runtime falls back to a synchronous call back into JS, which throws
 * `[Worklets] Tried to synchronously call a Remote Function` and aborts the app
 * (SIGABRT through the animation frame batchinator) the first time the waveform
 * draws. That is what shipped: `barHeight` was a plain arrow called from
 * `WaveBar`'s `useAnimatedStyle`, exactly one link from the crash.
 *
 * This file is that failure, statically — the same shape as
 * `features/session/composer-worklets.test.ts`, which guards the composer's own
 * helpers for the identical reason. LIMITS, stated so a green run is not read as
 * more than it is: helpers are found by `const <name> =` in THIS file only
 * (nothing imported into a worklet is visible here), the hooks scanned are the
 * animated-style family reanimated's babel plugin turns into worklets, and "is a
 * worklet" is the directive being the first statement of the helper's own body —
 * it cannot prove the plugin ran. Only the native lane proves that.
 */
const METER = readFileSync(
	new URL("./dictation-meter.tsx", import.meta.url),
	"utf8",
);

/** Hooks whose callback argument reanimated's babel plugin turns into a worklet. */
const WORKLET_HOOKS = [
	"useAnimatedStyle",
	"useAnimatedProps",
	"useAnimatedReaction",
	"useDerivedValue",
	"useAnimatedScrollHandler",
	"useFrameCallback",
];

/** reanimated's plugin only reads a directive at the TOP of the body; a quoted
 *  `"worklet"` anywhere else is inert. */
const WORKLET_DIRECTIVE = /^\{\s*(["'])worklet\1\s*;?/;

const skipString = (source: string, at: number): number => {
	const quote = source[at];
	for (let i = at + 1; i < source.length; i += 1) {
		if (source[i] === "\\") {
			i += 1;
			continue;
		}
		if (source[i] === quote) return i;
	}
	return -1;
};

/** Slice from an opening bracket to its match, skipping strings and comments: the
 *  file carries prose and quoted class names, so a bare depth count would stop
 *  inside one or run past the body. */
const sliceBalanced = (source: string, open: number): string => {
	let depth = 0;
	for (let i = open; i < source.length; i += 1) {
		const char = source[i];
		if (char === "/" && source[i + 1] === "/") {
			const end = source.indexOf("\n", i);
			if (end < 0) return "";
			i = end;
			continue;
		}
		if (char === "/" && source[i + 1] === "*") {
			const end = source.indexOf("*/", i + 2);
			if (end < 0) return "";
			i = end + 1;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			const end = skipString(source, i);
			if (end < 0) return "";
			i = end;
			continue;
		}
		if (char === "(" || char === "{" || char === "[") depth += 1;
		else if (char === ")" || char === "}" || char === "]") {
			depth -= 1;
			if (depth === 0) return source.slice(open, i + 1);
		}
	}
	return "";
};

/** Comments would otherwise be read as code: prose naming a helper is not a call
 *  to it. Block and line comments only; no string in this file holds `//`. */
const stripComments = (source: string) =>
	source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Every top-level `const <name> = ` in the file. */
const DECLARES_CONST = /^const (\w+) = /gm;

/** Where a helper's own body ends: the next top-level declaration or docstring. */
const NEXT_DECLARATION = /^(?:const|export|\/\*\*)/m;

/** Every `const <name> = <body>` in the file, body up to the next top-level
 *  declaration. The meter declares its helpers and components this way. */
const helpers = [...stripComments(METER).matchAll(DECLARES_CONST)].map(
	(match) => match[1] as string,
);

const bodyOf = (name: string): string => {
	const at = METER.indexOf(`const ${name} = `);
	if (at < 0) return "";
	/* To the next top-level `const`/`export`/`/**` after this one; a helper's own
	 * body is far shorter than that window, so the reachability scan is safe. */
	const rest = METER.slice(at + 1);
	const next = rest.search(NEXT_DECLARATION);
	return stripComments(next < 0 ? rest : rest.slice(0, next));
};

const declaresWorklet = (body: string) => {
	const arrow = body.indexOf("=>");
	if (arrow < 0) return false;
	return WORKLET_DIRECTIVE.test(body.slice(arrow + 2).trimStart());
};

/** The argument text of every worklet-taking call in the component. */
const workletBodies = WORKLET_HOOKS.flatMap((hook) => {
	const found: { hook: string; body: string }[] = [];
	let from = 0;
	for (;;) {
		const at = METER.indexOf(`${hook}(`, from);
		if (at < 0) break;
		const body = sliceBalanced(METER, at + hook.length);
		if (body) found.push({ hook, body: stripComments(body) });
		from = at + hook.length;
	}
	return found;
});

const calledIn = (text: string, name: string) =>
	new RegExp(`\\b${name}\\s*\\(`).test(text);

/** Helpers the worklet bodies call, then the helpers THOSE helpers call: a
 *  worklet reaches the UI runtime only through a chain of worklets, so the crash
 *  reproduces one link down as well. */
const reachable = (() => {
	const roots = new Set(
		helpers
			.filter((helper) =>
				workletBodies.some((worklet) => calledIn(worklet.body, helper)),
			)
			.map((helper) => helper),
	);
	const seen = new Set(roots);
	const queue = [...roots];
	while (queue.length > 0) {
		const name = queue.shift() as string;
		for (const helper of helpers) {
			if (seen.has(helper)) continue;
			if (calledIn(bodyOf(name), helper)) {
				seen.add(helper);
				queue.push(helper);
			}
		}
	}
	return [...seen].sort();
})();

describe("the dictation meter's worklets run on the UI runtime", () => {
	it("finds the animated styles, so an empty scan cannot pass this file", () => {
		/* The guard's own negative control: a parse that silently found nothing
		 * would report "no unmarked helpers" and prove the opposite of its claim.
		 * The meter has two animated styles at the time of writing — the bar's
		 * height and the row's roll. */
		expect(workletBodies.length).toBeGreaterThanOrEqual(2);
		expect(workletBodies.map((worklet) => worklet.hook)).toContain(
			"useAnimatedStyle",
		);
	});

	it("reaches the bar-height helper, and only it", () => {
		/* Named rather than counted: if a worklet starts calling another helper,
		 * this list changes and the reviewer sees WHICH one became UI-runtime code
		 * instead of a number that quietly grew. `waveformBars` and `peakLevel` are
		 * called during render and in the subscription, never from a worklet. */
		expect(reachable).toEqual(["barHeight"]);
	});

	it("marks every one of them a worklet", () => {
		const plain = reachable.filter((name) => !declaresWorklet(bodyOf(name)));
		/* The assertion carries the failure mode: this name is CALLED from a
		 * `useAnimatedStyle` body, so shipping it unmarked is the SIGABRT on the
		 * first waveform draw, not a style nit. */
		expect(plain).toEqual([]);
	});
});
