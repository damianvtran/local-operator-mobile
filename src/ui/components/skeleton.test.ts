import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The skeleton's fill is a property of its GROUND, and the conversations pane's
 * bars are the raised case.
 *
 * Measured on the 2026-10-11 full-surface pass, with the FIX ABSENT: the
 * pane's loading cell (`S15/loading`, iphone-15, dark) rendered **zero**
 * non-background pixels in the bars' own band — a resting `elevated` bar
 * (#322d22) on the pane's own `elevated` surface (#322d22; light #fefdfa on
 * #fefdfa), which is the "loading reads as empty" failure `Skeleton` exists to
 * avoid. The fix is `ground="raised"`, which swaps the pulse's ends to
 * `sunken`/`canvas` so both ends stay visible against everything above the
 * canvas.
 *
 * Asserted over the SOURCE, like `safe-area.test.ts` and `segmented.test.ts`,
 * because there is no render seam to read: the component reaches `uniwind`
 * (through `@/ui/appearance`), which the Node test environment cannot render.
 * The anchors are the mapping expression and each call site, so a renamed prop
 * fails by name rather than passing quietly.
 */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/.*$/gm;
const NATIVE_DRIVER = /useNativeDriver: true/g;
const REDUCED_MOTION_OPTS_OUT =
	/if \(reduceMotion\) return;\s*return pulseUsers\.retain\(\);/;

const read = (file: string): string =>
	readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");

describe("the skeleton's ground", () => {
	it("defaults to the canvas pair and swaps both ends for a raised ground", () => {
		const source = read("skeleton.tsx");
		expect(source).toContain('ground = "canvas"');
		expect(source).toContain('ground === "raised" ? "sunken" : "elevated"');
		expect(source).toContain('ground === "raised" ? "canvas" : "sunken"');
	});

	it("is passed as raised by every bar in the conversations pane's loading state", () => {
		const pane = read("../../features/sessions/conversations-pane.tsx");
		const loadingBars = pane.match(/<Skeleton lines=\{1\}[^/]*\/>/g) ?? [];
		expect(loadingBars.length).toBeGreaterThanOrEqual(3);
		for (const bar of loadingBars) {
			expect(bar, bar).toContain('ground="raised"');
		}
	});

	it("keeps the transcript's own loading bars on the canvas pair", () => {
		// The counter-example that keeps the mapping honest: the transcript's
		// skeletons sit on the canvas, where `raised` would be the invisible pair.
		const image = read(
			"../../features/session/components/transcript-image.tsx",
		);
		expect(image).toContain("<Skeleton");
		expect(image).not.toContain('ground="raised"');
	});
});

/**
 * Performance audit P6 — the pulse runs on the NATIVE driver.
 *
 * It interpolated `backgroundColor`, which only the JS driver can animate: one
 * 60 Hz JS loop per instance, on screen exactly while the JS thread mounts the
 * content the skeleton stands in for. It is now the opacity of a dimmed layer
 * over a resting bar — the same blend, on the native driver — from ONE shared
 * loop (`shared-loop.test.ts` holds the counting). Source checks for the reason
 * above: no render seam, and what must not return is a driver flag.
 */
describe("the skeleton's pulse driver", () => {
	const source = read("skeleton.tsx");
	/** Code only: the comments describe the retired approach by name. */
	const code = source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");

	it("never animates on the JS driver", () => {
		expect(code).not.toContain("useNativeDriver: false");
		const flags = code.match(NATIVE_DRIVER) ?? [];
		// Both halves of the loop.
		expect(flags).toHaveLength(2);
	});

	it("animates opacity, and no colour", () => {
		expect(code).not.toContain(".interpolate(");
		expect(code).toContain("opacity: sharedPulse");
		// The bar's own fill is a plain colour on a plain View.
		expect(code).toContain("style={{ backgroundColor: resting }}");
		// The brightness step is still between the ground pair: the dimmed
		// colour fades OVER the bar, the bar never fades towards its ground.
		expect(code).toContain("backgroundColor: dimmed, opacity: sharedPulse");
	});

	it("shares one loop between every instance", () => {
		expect(code).toContain("createSharedLoop(");
		expect(code).toContain("return pulseUsers.retain();");
		// No per-instance animated value any more.
		expect(code).not.toContain("useRef(new Animated.Value");
	});

	it("takes no share of the loop under reduced motion", () => {
		expect(code).toMatch(REDUCED_MOTION_OPTS_OUT);
		expect(code).toContain("{reduceMotion ? null : (");
	});
});
