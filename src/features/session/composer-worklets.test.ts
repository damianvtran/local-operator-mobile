import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The composer's animated styles run on reanimated's UI runtime, which is a
 * separate JS context. A worklet body may CALL another function only if that
 * function is itself a worklet: reanimated serialises a worklet's closure, and a
 * plain function has nothing to serialise, so the UI runtime falls back to a
 * synchronous call back into JS — which throws
 * `[Worklets] Tried to synchronously call a Remote Function` and kills the app
 * at mount. That is exactly what shipped: nightly 42156335030 lost 11/11 Maestro
 * flows on both attempts, `FATAL EXCEPTION: main` through `composerTsx1` →
 * `useAnimatedStyleTs1`, because `shellMotion`/`ringMotion` called
 * `composerShellRadius`/`morphHeight` from `composer-presentation.ts` and neither
 * carried `"worklet"`.
 *
 * This file is that failure, statically: it collects the presentation helpers
 * reachable from the component's worklet bodies (transitively — a worklet helper
 * that calls a non-worklet helper crashes identically) and asserts each one
 * compiles for the UI runtime.
 *
 * LIMITS, stated so a green run is not read as more than it is:
 *  - Helpers are found by `export const <name> =` in `composer-presentation.ts`
 *    only. A helper imported into a worklet from ANY other module is invisible
 *    here — this guard covers the file that caused the crash, not the whole
 *    tree. Extending it to another module means adding that module to the scan.
 *  - `WORKLET_HOOKS` is a name list, so a worklet-taking API that is not listed
 *    is not scanned. It is a constant rather than a heuristic so that the gap is
 *    visible in review instead of silently guessed at.
 *  - "Is a worklet" is the directive being the first statement of the helper's
 *    own body, which is what reanimated's babel plugin requires. It cannot prove
 *    the plugin ran — only the native lane can prove that.
 */
const read = (path: string) =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const COMPONENT = read("src/features/session/components/composer.tsx");
const PRESENTATION = read("src/features/session/composer-presentation.ts");

/** Hooks whose callback argument reanimated's babel plugin turns into a worklet. */
const WORKLET_HOOKS = [
	"useAnimatedStyle",
	"useAnimatedProps",
	"useAnimatedReaction",
	"useDerivedValue",
	"useAnimatedScrollHandler",
	"useFrameCallback",
];

/** Slice from an opening bracket to its match, skipping strings and comments.
 *  Both matter here: the worklet bodies carry prose and the file carries quoted
 *  paths, so a bare depth count stops inside a comment or runs past the body.
 *  Template interpolation is treated as string content (a `$ {}` inside a
 *  backtick would be skipped) — no worklet in this file interpolates a call. */
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

/** Comments would otherwise be read as code: a doc comment naming a helper with
 *  its argument list looks exactly like a call. */
const stripComments = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Every helper `composer-presentation.ts` exports, as its own declaration text.
 *  Chunks run declaration-to-declaration, so a helper's chunk ends where the next
 *  one starts and no call can be attributed to a neighbour. */
const helpers = (() => {
	const starts = [
		...PRESENTATION.matchAll(/export const ([A-Za-z_$][\w$]*) =/g),
	]
		.map((match) => ({ name: match[1] ?? "", at: match.index ?? 0 }))
		.filter((entry) => entry.at >= 0);
	return starts.map((entry, index) => {
		const next = starts[index + 1];
		const end = next ? next.at : PRESENTATION.length;
		return {
			name: entry.name,
			body: stripComments(PRESENTATION.slice(entry.at, end)),
		};
	});
})();

const bodyOf = (name: string) =>
	helpers.find((helper) => helper.name === name)?.body ?? "";

/** A directive is only a directive as the FIRST statement of the body, which is
 *  where reanimated's plugin looks; a `"worklet"` string anywhere else is inert. */
const WORKLET_DIRECTIVE = /^\{\s*(["'])worklet\1\s*;?/;

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
		const at = COMPONENT.indexOf(`${hook}(`, from);
		if (at < 0) break;
		const body = sliceBalanced(COMPONENT, at + hook.length);
		if (body) found.push({ hook, body: stripComments(body) });
		from = at + hook.length;
	}
	return found;
});

const calledIn = (text: string, name: string) =>
	new RegExp(`\\b${name}\\s*\\(`).test(text);

/** Helpers the worklet bodies call, then the helpers THOSE helpers call: a
 *  worklet can only reach the UI runtime through a chain of worklets, so the
 *  crash reproduces one link down as well. */
const reachable = (() => {
	const roots = new Set(
		helpers
			.filter((helper) =>
				workletBodies.some((worklet) => calledIn(worklet.body, helper.name)),
			)
			.map((helper) => helper.name),
	);
	const seen = new Set(roots);
	const queue = [...roots];
	while (queue.length > 0) {
		const name = queue.shift() as string;
		for (const helper of helpers) {
			if (seen.has(helper.name)) continue;
			if (calledIn(bodyOf(name), helper.name)) {
				seen.add(helper.name);
				queue.push(helper.name);
			}
		}
	}
	return [...seen].sort();
})();

describe("the composer's worklets run on the UI runtime", () => {
	it("finds the worklets, so an empty scan cannot pass this file", () => {
		/* The guard's own negative control: a parse that silently found nothing
		 *  would report "no unmarked helpers" and prove the opposite of what it
		 *  claims. The composer has three animated styles at the time of writing. */
		expect(workletBodies.length).toBeGreaterThanOrEqual(3);
		expect(workletBodies.map((worklet) => worklet.hook)).toContain(
			"useAnimatedStyle",
		);
	});

	it("reaches the shell helpers, and only them", () => {
		/* Named rather than counted: if a worklet starts calling another helper,
		 *  this list changes and the reviewer sees WHICH one became UI-runtime
		 *  code, instead of a number that quietly grew. */
		expect(reachable).toEqual([
			"composerShellRadius",
			"morphHeight",
			"morphPillRadius",
		]);
	});

	it("marks every one of them a worklet", () => {
		const plain = reachable.filter((name) => !declaresWorklet(bodyOf(name)));
		/* The assertion carries the failure mode: these names are CALLED from a
		 *  `useAnimatedStyle` body, so shipping them unmarked is the launch crash
		 *  in `composer.tsx`, not a style nit. */
		expect(plain).toEqual([]);
	});

	it("leaves the render-only helper a plain function", () => {
		/* Deliberate, and asserted so a later sweep cannot "fix" it by marking
		 *  everything: `composerPresentation` calls `composerOuterGap`,
		 *  `composerPaintedHeight` and `composerShellPadding`, none of which are
		 *  worklets. The UI runtime does not load modules — it serialises closures —
		 *  so marking this one would capture those three as remote functions and
		 *  reproduce the same synchronous-call crash one call deeper. It is only ever
		 *  called during render. */
		/* Presence first: `bodyOf` answers "" for a helper it could not find, and
		 *  `declaresWorklet("")` is false, so a deleted or renamed
		 *  `composerPresentation` would satisfy the assertion below while proving
		 *  nothing. Fail on absence instead. */
		expect(bodyOf("composerPresentation")).not.toBe("");
		expect(declaresWorklet(bodyOf("composerPresentation"))).toBe(false);
	});
});
