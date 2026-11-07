import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The composer invariant (design spec §3, operator build 453): a folder or model
 * read failure must not change the composer's geometry. The home renders no box
 * in Node, so the guard is the STRUCTURE that makes the invariant true:
 *  1. each notice is an inset `Alert` (no full-bleed `Banner`, no full-width
 *     rule) in the composer stack, ABOVE the composer, as a sibling;
 *  2. nothing the notice depends on is an input to the composer — the composer's
 *     props are the same expression whether or not a notice renders;
 *  3. the splash (the free band) is the flex region that gives up the height,
 *     and it is laid out from its own measured band (`heroTopInset`).
 */
const HOME = readFileSync(new URL("./home.tsx", import.meta.url), "utf8");
const SPLASH = readFileSync(
	new URL("./home-splash.tsx", import.meta.url),
	"utf8",
);

const composerTag = (source: string) => {
	const at = source.indexOf("<Composer\n");
	return source.slice(
		at,
		source.indexOf("/>", source.indexOf("fieldRef={fieldRef}", at)),
	);
};

/* Review R3: this guards the STRUCTURE that makes the invariant true. It cannot
 * see geometry (a negative margin or a context read would pass it); the
 * composer's measured y/height with and without a notice is QA's row. */
describe("the home's folder warning is structurally outside the composer", () => {
	it("renders the notices as inset Alerts in the stack, never as a page Banner", () => {
		expect(HOME).not.toMatch(/<Banner\b/);
		const stack = HOME.indexOf("THE COMPOSER STACK");
		const composer = HOME.indexOf("<Composer\n");
		expect(stack).toBeGreaterThan(0);
		for (const id of [
			"testID={CONTROL.homeFoldersBanner}",
			"testID={CONTROL.homeModelsBanner}",
		]) {
			const at = HOME.indexOf(id);
			expect(at).toBeGreaterThan(stack);
			expect(at).toBeLessThan(composer);
			// The Alert's own tag carries the id, inside the 16 pt inset wrapper.
			const open = HOME.lastIndexOf("<Alert", at);
			expect(open).toBeGreaterThan(stack);
			expect(HOME.slice(HOME.lastIndexOf("<View", open), open)).toContain(
				'className="px-4 pb-2"',
			);
		}
	});

	it("feeds the composer nothing that the notices depend on", () => {
		const tag = composerTag(HOME);
		expect(tag).toContain("testID={SURFACE.homeComposer}");
		for (const input of [
			"directoriesError",
			"modelsRead",
			"foldersReadFailed",
			"modelsReadFailed",
		]) {
			expect(tag).not.toContain(input);
		}
	});

	it("gives the notice's height to the free band, which re-centres the hero", () => {
		expect(SPLASH).toContain('className="flex-1"');
		expect(SPLASH).toContain("const live = heroTopInset(band, block);");
		expect(SPLASH).toContain(
			"paddingTop: holding ? heroHeldInset(live, restInset.current) : live,",
		);
	});
});

/* UX U1 / review R4 / design D4: the hero's motion. */
describe("the hero holds still until there is something to move for", () => {
	it("keeps the display greeting on focus alone, compact only for a draft or a send", () => {
		expect(SPLASH).toContain("const headline = !draft.length && !starting;");
		expect(SPLASH).not.toMatch(/const headline = [^;]*editing/);
		expect(SPLASH).toContain(
			"const holding = Boolean(editing) && !draft.length && !starting;",
		);
	});
	it("paints the block only once both measurements have landed", () => {
		expect(SPLASH).toContain(
			"style={{ opacity: heroMeasured(band, block) ? 1 : 0 }}",
		);
	});
});

/* UX U3 / U5: both Retries show their flight, and a pressed Retry that
 * succeeds hands focus to the greeting instead of dropping it. */
describe("the inset notices' Retry", () => {
	it("passes loading to the folder Retry, like the model Retry", () => {
		const folder = HOME.slice(
			HOME.indexOf("onPress: retryDirectories,"),
			HOME.indexOf("testID: CONTROL.homeFoldersRetry,"),
		);
		expect(folder).toContain(
			"loading: directoriesSettled !== directoriesAttempt,",
		);
		expect(HOME).toContain("loading: modelsSettled !== modelsAttempt,");
	});
	it("asks the splash for focus only after a Retry the reader pressed succeeds", () => {
		expect(HOME).toContain("focusRequest={heroFocus}");
		for (const flag of ["foldersPressed", "modelsPressed"]) {
			const set = HOME.indexOf(`${flag}.current = next;`);
			expect(set).toBeGreaterThan(0);
			/* Set only inside the reader's own Retry callback. */
			expect(HOME.lastIndexOf("useCallback(", set)).toBeGreaterThan(
				HOME.lastIndexOf("useEffect(", set),
			);
		}
		expect(SPLASH).toContain("AccessibilityInfo.setAccessibilityFocus(handle)");
		expect(SPLASH).toContain("{...{ tabIndex: -1 }}");
		/* Review M1: a remount never replays the request it mounted with; the
		 *  latch's own rule is pinned in `hero-focus.test.ts`. */
		expect(SPLASH).toContain("useRef(focusLatch(focusRequest))");
		expect(SPLASH).toContain("if (!latch.current.take(focusRequest)) return;");
		/* Review m1: native keeps a reader who moved on to the composer. */
		expect(SPLASH).toContain(
			"if (TextInput.State.currentlyFocusedInput() != null) return;",
		);
	});
});

/* Design spec §12: one fill decision per screen, glass is fill-only, and the
 * attach/send discs stay opaque so their ink ratios never depend on content. */
describe("the composer's glass wiring", () => {
	const COMPOSER = readFileSync(
		new URL("../session/components/composer.tsx", import.meta.url),
		"utf8",
	);
	const SESSION = readFileSync(
		new URL("../../../app/(app)/session/[id].tsx", import.meta.url),
		"utf8",
	);

	it("takes ONE useChromeGlass() decision on both screens and hands it to the composer", () => {
		expect(HOME).toContain("const chromeGlass = useChromeGlass();");
		expect(composerTag(HOME)).toContain("glass={chromeGlass}");
		expect(SESSION).toContain("const chromeGlass = useChromeGlass();");
		const at = SESSION.indexOf("<Composer\n");
		expect(SESSION.slice(at, at + 200)).toContain("glass={chromeGlass}");
	});

	it("routes the shell's fill and the strip chips through ChromeSurface/ChromeGroup", () => {
		expect(COMPOSER).toContain(
			'backgroundColor: glass ? "transparent" : elevated',
		);
		expect(COMPOSER).toMatch(/\{glass \? \(\s*<View\s+pointerEvents="none"/);
		expect(COMPOSER).toMatch(
			/<ChromeGroup\s+glass=\{glass\}\s+spacing=\{COMPOSER_META_GLASS_SPACING\}\s+className=\{COMPOSER_META_ROW\}/,
		);
		// Solid chips are NOT wrapped: the fallback stays the quiet, fill-less chip.
		expect(COMPOSER).toMatch(
			/glass \? \(\s*<ChromeSurface[\s\S]*?\) : \(\s*chip\s*\)/,
		);
	});

	it("keeps attach and send opaque in both branches", () => {
		for (const id of ["CONTROL.composerAttach", "CONTROL.composerSend"]) {
			const at = COMPOSER.indexOf(`testID={${id}}`);
			const block = COMPOSER.slice(at, COMPOSER.indexOf("</Pressable>", at));
			expect(block).not.toContain("ChromeSurface");
			expect(block).toContain("COMPOSER_DISC");
		}
	});
});
