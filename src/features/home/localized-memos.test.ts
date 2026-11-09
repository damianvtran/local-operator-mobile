import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createConfigStore } from "@/state/config-store";

/* Regression guard for the review's MAJOR M3: Home cached rendered copy in
 * `useMemo`s whose dependency lists did not mention the language, so a config
 * frame that changed it kept the previous language's sentences on screen.
 *
 * WHY THIS IS A SOURCE TEST. `vitest.config.ts` runs in Node with no React
 * renderer (its own header says so), and Home pulls expo-router, uniwind and
 * lucide — a real mount is the native E2E layer's job (ADR 0003), not this
 * suite's. So this pins the two mechanical halves that make the fix work, and
 * says what it does NOT prove: that a mounted Home repaints. The store half is
 * asserted behaviourally below; the screen half is the dependency arrays.
 *
 * A future renderer harness should delete this file and keep its assertions. */
const home = readFileSync(resolve(import.meta.dirname, "home.tsx"), "utf8");

/** The `useMemo` block that begins at `marker`, through its dependency array.
 *
 *  The array is the LAST `[...]` in the block: `controls` and `chips` both write
 *  the literal as the final argument, which is the shape React requires. */
function memoDependencies(marker: string): string {
	const start = home.indexOf(marker);
	expect(start).toBeGreaterThan(-1);
	const end = home.indexOf("\n\t);", start);
	expect(end).toBeGreaterThan(start);
	const block = home.slice(start, end);
	const arrays = block.match(/\[[^[\]]*\]/g) ?? [];
	const last = arrays.at(-1);
	expect(last).toBeDefined();
	return last ?? "";
}

describe("home re-resolves its copy when the language changes", () => {
	it("subscribes to the config frame the language arrives on", () => {
		// Without a subscription nothing re-renders Home for a language change at
		// all, and neither the memo nor an inline call would ever re-run.
		expect(home).toContain("const language = useLocaleFrame();");
	});

	it("lists the language in the composer controls' dependencies", () => {
		// `disabledReason` is a `t()` reading, and the reviewer's case was a memo
		// that handed the first language's sentence back after the change.
		expect(
			memoDependencies("const controls: ComposerControls = useMemo("),
		).toContain("language");
	});

	it("gives the chips the dependency only once their labels are keyed", () => {
		/* The sibling memo the review named does NOT hold catalogue copy today:
		 * `composerChipLabels` renders the model's own name, `n/a` and English
		 * accessibility labels, and imports nothing from `@/i18n`. Adding the
		 * dependency there would be cargo cult — a re-run for a value nothing reads.
		 * So the guard is the INVARIANT rather than the current shape: the moment
		 * `chip-labels.ts` starts reading the runtime, this memo must name the
		 * language, and this test is what says so. */
		const labels = readFileSync(
			resolve(import.meta.dirname, "..", "session", "chip-labels.ts"),
			"utf8",
		);
		const keyed = labels.includes("@/i18n");
		const dependencies = memoDependencies("const chips = useMemo(");
		if (keyed) expect(dependencies).toContain("language");
		else expect(dependencies).not.toContain("language");
	});

	it("is subscribed through a store a frame actually notifies", () => {
		/* The behavioural half: `useLocaleFrame` is `useStore(configStore, …)`, so
		 *  the mechanism it depends on is zustand's subscription — asserted here
		 *  on a fresh store, without the React/RN provider this suite cannot load. */
		const store = createConfigStore({ now: () => 1 });
		const seen: (string | null)[] = [];
		const unsubscribe = store.subscribe((state) => {
			seen.push(state.language);
		});
		store
			.getState()
			.applyFrame({ changed_keys: ["language"], language: "fr" }, 2);
		unsubscribe();
		expect(seen).toEqual(["fr"]);
		expect(store.getState().language).toBe("fr");
	});
});
