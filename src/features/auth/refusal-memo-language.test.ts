import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* Regression guard for PR #260 design review round 1, D2 (MAJOR): the provider's
 * `refusal` memo resolves `t("mobile.computers.your_computer")` as the refusal's
 * subject — and `refusalFromError` reads more catalogue copy (the billing,
 * disabled and remedy lines) — but its dependency list did not name the
 * language. A reader who switched language while a failure view was mounted kept
 * the OLD language's subject inside a headline the surface re-rendered in the
 * new one ("Your computer n'est pas…").
 *
 * WHY THIS IS A SOURCE TEST, as `src/features/home/localized-memos.test.ts` (the
 * precedent this mirrors): vitest runs in Node with no React renderer, and the
 * provider pulls react-native, expo and the relay client, so a real mount is the
 * native E2E layer's job. This pins the two mechanical halves the fix needs —
 * the subscription that re-renders the provider on a language frame, and the
 * language in the memo's dependencies so the memo re-runs — and does NOT prove
 * a mounted surface repaints. A future renderer harness should replace it. */
const provider = readFileSync(
	resolve(import.meta.dirname, "connection-provider.tsx"),
	"utf8",
);

/** The memo that begins at `marker`, through its closing `]);` — biome writes a
 *  multi-line dependency list as `}, [\n…\n\t]);`, so that is the end anchor. */
function memoBlock(marker: string): string {
	const start = provider.indexOf(marker);
	expect(start).toBeGreaterThan(-1);
	const end = provider.indexOf("\n\t]);", start);
	expect(end).toBeGreaterThan(start);
	return provider.slice(start, end + "\n\t]".length);
}

/** Its dependency array: the LAST `[...]` in the block, the shape React requires. */
function memoDependencies(marker: string): string {
	const arrays = memoBlock(marker).match(/\[[^[\]]*\]/g) ?? [];
	const last = arrays.at(-1);
	expect(last).toBeDefined();
	return last ?? "";
}

describe("the refusal memo re-resolves its copy when the language changes", () => {
	const marker = "const refusal = useMemo<RefusalView | null>(";

	it("still resolves catalogue copy inside the memo (else this guard is moot)", () => {
		expect(memoBlock(marker)).toContain('t("mobile.computers.your_computer")');
	});

	it("subscribes the provider to the config frame the language arrives on", () => {
		expect(provider).toContain("const language = useLocaleFrame();");
	});

	it("lists the language in the refusal memo's dependencies", () => {
		expect(memoDependencies(marker)).toContain("language");
	});
});
