/**
 * The chrome proof's fixed plan, as data: which simulator lanes run, and the
 * frames every lane must produce. Kept out of `chrome-ios-proof.ts` so it can be
 * unit-tested in Node (that driver refuses to run off a hosted macOS dispatch).
 *
 * THE LANES are the decision record's §7 device classes that a hosted iOS
 * runner can give (D1–D4, D7) in the two Local Operator themes, plus the
 * Reduce Transparency fallback. Android (D5/D6) is NOT here: it needs the KVM
 * emulator lane in a different workflow job, and is reported as not run.
 *
 * `before` lanes run main's own simulator build first with the same flows, so
 * each changed screen gets a before/after pair from one runner, one runtime and
 * one device — the only comparison in which a pixel difference is the change.
 */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export type Lane = {
	id: string;
	/** A device-type NAME as `simctl list devicetypes` prints it. */
	device: string;
	os: 26 | 18;
	theme: "dark" | "light";
	reduceTransparency?: boolean;
	before?: boolean;
};

export const LANES: readonly Lane[] = [
	// D1: home-button phone, R = 0 → r_b = 16, inner padding 2.
	{
		id: "d1-se-dark",
		device: "iPhone SE (3rd generation)",
		os: 26,
		theme: "dark",
	},
	// D2: 393 pt, R = 55 → r_b = 47.
	{
		id: "d2-16-dark",
		device: "iPhone 16",
		os: 26,
		theme: "dark",
		before: true,
	},
	// D3: the operator's class, 402 pt, R ≈ 62 → r_b = 54; both themes.
	{
		id: "d3-17pro-dark",
		device: "iPhone 17 Pro",
		os: 26,
		theme: "dark",
		before: true,
	},
	{
		id: "d3-17pro-light",
		device: "iPhone 17 Pro",
		os: 26,
		theme: "light",
		before: true,
	},
	// D4: 440 pt Pro Max.
	{
		id: "d4-17promax-light",
		device: "iPhone 17 Pro Max",
		os: 26,
		theme: "light",
	},
	// The fallback on iOS 26: Reduce Transparency on → solid fill, same boxes.
	{
		id: "d3-17pro-dark-rt",
		device: "iPhone 17 Pro",
		os: 26,
		theme: "dark",
		reduceTransparency: true,
	},
	// D7: iOS 18 → no Liquid Glass → solid fill. Skipped if the image lacks the runtime.
	{ id: "d7-16-ios18-dark", device: "iPhone 16", os: 18, theme: "dark" },
];

/** The frames each build in a lane must produce, in the order taken. */
export const LANE_FRAMES = [
	"session",
	"session-keyboard",
	"home",
	"sidebar",
] as const;

/** Assert a lane's frame set is complete for every build it ran, and list it. */
export function collectChromeFrames(laneDir: string): string[] {
	const found: string[] = [];
	for (const build of readdirSync(laneDir, { withFileTypes: true })) {
		if (!build.isDirectory()) continue;
		const names = readdirSync(join(laneDir, build.name));
		for (const frame of LANE_FRAMES)
			assert(
				names.includes(`${frame}.png`),
				`missing ${build.name}/${frame}.png`,
			);
		for (const name of names) found.push(`${build.name}/${name}`);
	}
	assert(found.length > 0, "no frames collected");
	return found.sort();
}

/**
 * Whether Send sits above the software keyboard, from a `maestro hierarchy`
 * dump (TestFlight 753: "it pushes the composer send buttons below the bottom
 * of the keyboard"). `session-keyboard.yaml` types a long draft with the
 * keyboard up; the driver dumps the hierarchy after it and the AFTER build
 * must pass this. The BEFORE build is not held to it — showing main's defect
 * is what its frame is for.
 *
 * Maestro's iOS hierarchy is a tree of `{ attributes, children }`, with
 * `attributes["resource-id"]` (the testID) and `attributes.bounds` as
 * "[x1,y1][x2,y2]" in points. The keyboard is found by its keys, not an
 * element type the dump does not carry: the `space` key proves a SOFTWARE
 * keyboard is up (a simulator defaulting to the hardware keyboard shows none,
 * and that is a FAIL, never a pass), and the keyboard's top is the highest key
 * within one keyboard's height of it. That is the top KEY row, so a Send
 * hidden behind the predictive bar alone would pass: the check is a floor,
 * stated so a green row is not read as more.
 */
export type HierarchyNode = {
	attributes?: Record<string, string | undefined>;
	children?: HierarchyNode[];
};
/** The JSON tree out of `maestro hierarchy`'s output, which the driver
 *  captures with stderr folded in, so log lines may surround it. */
export function parseHierarchy(output: string): HierarchyNode {
	const start = output.indexOf("{");
	const end = output.lastIndexOf("}");
	assert(start >= 0 && end > start, "no JSON in the hierarchy output");
	return JSON.parse(output.slice(start, end + 1)) as HierarchyNode;
}
type Box = { top: number; bottom: number };
const BOUNDS = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;
const SPACE_KEY = /^space$/i;
const boxOf = (bounds: string | undefined): Box | null => {
	const m = bounds?.match(BOUNDS);
	return m ? { top: Number(m[2]), bottom: Number(m[4]) } : null;
};
const KEY_LABEL = /^(space|return|shift|delete|[a-z])$/i;
/** The tallest iOS software keyboard's key area, in pt, above the space row. */
const KEYBOARD_SPAN = 300;

export function sendAboveKeyboard(
	tree: HierarchyNode,
	sendId = "composer-send",
): { ok: boolean; reason: string; send?: Box; keyboardTop?: number } {
	const nodes: HierarchyNode[] = [];
	const walk = (node: HierarchyNode) => {
		nodes.push(node);
		for (const child of node.children ?? []) walk(child);
	};
	walk(tree);
	const label = (n: HierarchyNode) =>
		(n.attributes?.accessibilityText || n.attributes?.text || "").trim();
	const send = nodes
		.filter((n) => n.attributes?.["resource-id"] === sendId)
		.map((n) => boxOf(n.attributes?.bounds))
		.find((b) => b !== null);
	if (!send) return { ok: false, reason: `no ${sendId} in the hierarchy` };
	const space = nodes
		.filter((n) => SPACE_KEY.test(label(n)))
		.map((n) => boxOf(n.attributes?.bounds))
		.find((b) => b !== null);
	if (!space)
		return {
			ok: false,
			send,
			reason: "no software keyboard (no space key) in the hierarchy",
		};
	const keyboardTop = Math.min(
		...nodes
			.filter((n) => KEY_LABEL.test(label(n)))
			.map((n) => boxOf(n.attributes?.bounds))
			.filter(
				(b): b is Box =>
					b !== null &&
					b.top >= space.top - KEYBOARD_SPAN &&
					b.top <= space.top,
			)
			.map((b) => b.top),
	);
	const ok = send.bottom <= keyboardTop;
	return {
		ok,
		send,
		keyboardTop,
		reason: ok
			? `send bottom ${send.bottom} <= keyboard top ${keyboardTop}`
			: `send bottom ${send.bottom} is below the keyboard top ${keyboardTop}`,
	};
}
