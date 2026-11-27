import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The drawer shell's two structural promises, read from the source because Node
 * has no native overlay to mount:
 *
 * 1. A FULL-WIDTH drawer never claims the page's dim (`scrim: false`), so a
 *    sheet raised inside the pane paints its own scrim (`@/ui/modal-stack`).
 * 2. Native is an overlay; web keeps the `Modal` and its scope. The Modal is
 *    what owns the browser focus trap and Escape; the native shell recreates
 *    back and accessibility itself.
 *
 * Absence must not read as a pass, so the scan also asserts that both shells
 * exist and that the native one carries the a11y/back wiring.
 */
const source = readFileSync(
	new URL("./conversations-drawer.tsx", import.meta.url),
	"utf8",
);
const NO_DIM_CLAIM =
	/useModalStackEntry\(\s*presented\s*&&\s*revealed\s*,\s*\{\s*scrim:\s*false,?\s*\}\s*\)/;
const DIM_CLAIM = /scrim:\s*true/;
const WEB_SHELL = /Platform\.OS === "web"/;

describe("the conversations drawer shell", () => {
	it("claims no dim for its host, and only while its content is up", () => {
		expect(source).toMatch(NO_DIM_CLAIM);
		expect(source).not.toMatch(DIM_CLAIM);
	});

	it("keeps the web Modal and its scope provider", () => {
		expect(source).toContain("<Modal");
		expect(source).toContain("ModalScopeContext.Provider");
		expect(source).toMatch(WEB_SHELL);
	});

	it("recreates native a11y and Android back in the overlay", () => {
		expect(source).toContain("accessibilityViewIsModal");
		expect(source).toContain("onAccessibilityEscape");
		expect(source).toContain("BackHandler.addEventListener");
		expect(source).toContain("setAccessibilityFocus");
	});
});
