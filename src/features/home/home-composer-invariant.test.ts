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
		expect(SPLASH).toContain(
			"const live = heroTopInsetAbove(band, block, listHeight);",
		);
		/* QA Q-R2-3: the offset is a spacer's height. As `paddingTop` it was
		 *  read by U-42 as an off-scale spacing token (216/208/156 pt). */
		expect(SPLASH).toContain(
			"height: holding ? heroHeldInset(live, restInset.current) : live,",
		);
		expect(SPLASH).not.toMatch(/paddingTop:/);
	});

	it("caps the notices in one shrinkable ScrollView that ends above the composer (Q-R2-1)", () => {
		const open = HOME.indexOf("<ScrollView\n");
		const close = HOME.indexOf("</ScrollView>");
		const composer = HOME.indexOf("<Composer\n");
		expect(open).toBeGreaterThan(0);
		expect(HOME.slice(open, HOME.indexOf(">", open))).toContain(
			"style={NOTICE_STACK_STYLE}",
		);
		// Every notice, the startup line included, is inside the cap.
		for (const id of [
			"testID={SURFACE.startupPending}",
			"testID={CONTROL.homeFoldersBanner}",
			"testID={CONTROL.homeModelsBanner}",
			'title="Could not start"',
		]) {
			const at = HOME.indexOf(id);
			expect(at).toBeGreaterThan(open);
			expect(at).toBeLessThan(close);
		}
		// The composer is the cap's sibling, after it, never inside it.
		expect(composer).toBeGreaterThan(close);
		expect(HOME.indexOf("<ScrollView", open + 1)).toBe(-1);
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
		expect(SPLASH).toContain("heroMeasured(band, block)");
		// Hero and list appear together: the list's height is part of the hero's
		// place, so neither paints on a half-measured frame.
		expect(SPLASH).toContain("(!hasList || listMeasured > 0)");
		expect(
			SPLASH.match(/style=\{\{ opacity: painted \? 1 : 0 \}\}/g),
		).toHaveLength(2);
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

	it("routes the shell's fill through ChromeSurface and keeps the card's controls plain", () => {
		expect(COMPOSER).toContain(
			'backgroundColor: glass ? "transparent" : elevated',
		);
		expect(COMPOSER).toMatch(/\{glass \? \(\s*<View\s+pointerEvents="none"/);
		/* The controls ride INSIDE the shell (visual audit D5), so they sit on
		 *  the shell's one material and take no capsule of their own: a glass
		 *  group around them would be glass on glass. Since issue #325 they are
		 *  transparent icon buttons, like attach and the mic beside them, so
		 *  there is no chip capsule left to wrap in either branch. */
		expect(COMPOSER).not.toContain("<ChromeGroup");
		const zone = COMPOSER.slice(
			COMPOSER.indexOf("const controlZone = ("),
			COMPOSER.indexOf("const clearDraft ="),
		);
		expect(zone).not.toMatch(/glass=\{glass\}/);
		expect(zone).not.toContain("<ChromeSurface");
		expect(COMPOSER).not.toContain("stripChipSurface");
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

/* The work list lives INSIDE the splash's band — never in the composer stack — so
 * it can only ever take the band's height, and the composer stays put. */
describe("the work list is part of the band, not the composer stack", () => {
	it("renders inside the splash's ScrollView, after the hero, above the composer", () => {
		const scroll = SPLASH.indexOf("<ScrollView");
		const list = SPLASH.indexOf("<WorkListView");
		expect(list).toBeGreaterThan(
			SPLASH.indexOf("testID={SURFACE.homeHeroMark}"),
		);
		expect(list).toBeGreaterThan(scroll);
		expect(list).toBeLessThan(SPLASH.indexOf("</ScrollView>"));
		expect(composerTag(HOME)).not.toContain("workList");
		expect(composerTag(HOME)).not.toContain("sessions");
	});

	it("decides from the recovery and refusal states, which render instead of the splash", () => {
		expect(HOME).toContain(
			"recovery: homeRecovery !== null || namedRefusal !== null,",
		);
		// The splash only mounts when there is no recovery state at all.
		expect(HOME).toContain(
			") : homeRecovery === null ? (\n\t\t\t\t\t<HomeSplash",
		);
	});
});
