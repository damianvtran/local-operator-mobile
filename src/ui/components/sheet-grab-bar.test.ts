/**
 * The grab bar's frame is CENTRED, and the title outside it still taps as a title.
 *
 * WHY THIS EXISTS. Three attempts at the bar's geometry each passed the tests and
 * then failed on a frame: a 5 pt pill grown by `hitSlop` (announced 5 pt tall), a
 * full-width band (the title's own taps flipped the size), and a single node
 * centred with `alignSelf` in a ROW parent — which moves a child on the CROSS
 * axis only, so Yoga placed the 120 pt target at the row's start edge, over the
 * title (design D9 -> D10, measured at 390 pt: frame left 16, centre 76, screen
 * centre 195). The fix is structural: a full-width, touch-transparent wrapper
 * centres the 120×44 Pressable inside it. This pins the structure, because the
 * geometry is what the wrapper produces.
 *
 * Asserted over the SOURCE for the reason `sheet-body-tap.test.ts` states — the
 * module reaches `uniwind`, so the Node environment cannot import it. The
 * assertions are written on the props, not on line numbers, so re-indenting keeps
 * them passing while the failing shapes (no wrapper, `alignSelf`, a full-width
 * Pressable) fail by name.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
	fileURLToPath(new URL("./sheet.tsx", import.meta.url)),
	"utf8",
);

/** The bar block: from the resizable branch to the Close button after it. */
const barBlock = (): string => {
	const start = SOURCE.indexOf("{resizable ? (");
	expect(start, "the resizable branch must exist").toBeGreaterThan(-1);
	const end = SOURCE.indexOf("<IconButton", start);
	expect(end, "Close must follow the bar in the tree").toBeGreaterThan(start);
	return SOURCE.slice(start, end);
};

/** The wrapper's opening tag. */
const wrapperTag = (): string => {
	const block = barBlock();
	const at = block.indexOf("<View");
	expect(at, "the bar must have a wrapper").toBeGreaterThan(-1);
	return block.slice(at, block.indexOf(">", at));
};

describe("the grab bar's frame", () => {
	it("spans the header so its child can be centred", () => {
		const wrapper = wrapperTag();
		expect(wrapper).toContain('position: "absolute"');
		// Logical edges: the band mirrors with the page.
		expect(wrapper).toContain("start: 0");
		expect(wrapper).toContain("end: 0");
		expect(wrapper).not.toContain("left: 0");
		expect(wrapper).not.toContain("right: 0");
	});

	it("centres the target on the cross axis of that wrapper", () => {
		expect(wrapperTag()).toContain('alignItems: "center"');
	});

	it("leaves the rest of the header tappable and out of the a11y band", () => {
		expect(wrapperTag()).toContain('pointerEvents="box-none"');
	});

	it("is a real 44 × 120 target that carries no position of its own", () => {
		const pressable = barBlock().slice(barBlock().indexOf("<Pressable"));
		expect(pressable).toContain("width: 120");
		expect(pressable).toContain("height: 44");
		// The two failing shapes: its own centring attempt, and its own band.
		expect(pressable).not.toContain('alignSelf: "center"');
		expect(pressable).not.toContain('position: "absolute"');
	});

	it("stays behind Close in the touch order", () => {
		// `barBlock()` ends at the Close button, so the bar precedes it by
		// construction; a bar moved AFTER Close would find no IconButton and fail.
		expect(barBlock()).not.toContain("<IconButton");
	});
});
