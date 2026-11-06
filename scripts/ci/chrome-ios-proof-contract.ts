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
