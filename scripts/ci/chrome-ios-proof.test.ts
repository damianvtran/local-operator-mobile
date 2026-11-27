import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { isKnownIdentifier } from "../../src/ui/a11y.ts";
import type { HierarchyNode } from "./chrome-ios-proof-contract.ts";
import {
	collectChromeFrames,
	DRAG_FLOWS,
	dragVerdict,
	GESTURE_CLEARANCE_PT,
	gestureFlowValues,
	gestureGeometry,
	KEYBOARD_READY_FLOW,
	keyboardRestored,
	LANE_FRAMES,
	LANES,
	measureFrame,
	pairVerdict,
	parseHierarchy,
	pngSize,
	renderFlow,
	selectLanes,
	sendAboveKeyboard,
	shortpullPair,
	shortpullVerdict,
} from "./chrome-ios-proof-contract.ts";

/* A Maestro iOS hierarchy at 390x844: the composer's Send, plus (optionally)
 *  the software keyboard's keys, top row at 548 and space at 760. */
const FLAT_FALLBACK = /flat hierarchy/;
const tree = (sendBottom: number, keyboard = true) => ({
	attributes: {},
	children: [
		{
			attributes: {
				"resource-id": "composer-send",
				bounds: `[330,${sendBottom - 44}][374,${sendBottom}]`,
			},
		},
		{ attributes: { text: "a", bounds: "[0,100][20,120]" } }, // app text, far above
		...(keyboard
			? [
					{ attributes: { accessibilityText: "q", bounds: "[3,548][39,590]" } },
					{
						attributes: {
							accessibilityText: "return",
							bounds: "[290,760][387,802]",
						},
					},
					{
						attributes: {
							accessibilityText: "space",
							bounds: "[100,760][290,802]",
						},
					},
				]
			: []),
	],
});

describe("sendAboveKeyboard (TestFlight 753)", () => {
	it("passes when Send ends above the keyboard's top key row", () => {
		const verdict = sendAboveKeyboard(tree(540));
		expect(verdict).toMatchObject({ ok: true, keyboardTop: 548 });
	});

	it("fails when Send runs under the keyboard (the reported defect)", () => {
		expect(sendAboveKeyboard(tree(700)).ok).toBe(false);
	});

	it("fails, never passes, when no software keyboard is up", () => {
		const verdict = sendAboveKeyboard(tree(540, false));
		expect(verdict.ok).toBe(false);
		expect(verdict.reason).toMatch(/no software keyboard/);
	});

	it("fails when Send is missing", () => {
		expect(sendAboveKeyboard({ children: [] }).ok).toBe(false);
	});

	/* PR #216 review m3: app content shares key labels. XCUITest keeps the
	 *  keyboard in its own window, so a real dump nests the keys under a
	 *  container apart from the app's; an avatar initial within 300 pt of the
	 *  space key must not read as the keyboard's top. */
	const nested = (
		sendBottom: number,
		appLabel?: { text: string; top: number },
	) => ({
		attributes: {},
		children: [
			{
				attributes: {},
				children: [
					{
						attributes: {
							"resource-id": "composer-send",
							bounds: `[330,${sendBottom - 44}][374,${sendBottom}]`,
						},
					},
					...(appLabel
						? [
								{
									attributes: {
										accessibilityText: appLabel.text,
										bounds: `[16,${appLabel.top}][48,${appLabel.top + 32}]`,
									},
								},
							]
						: []),
				],
			},
			{
				attributes: {},
				children: [
					{
						attributes: {},
						children: [
							{
								attributes: {
									accessibilityText: "q",
									bounds: "[3,548][39,590]",
								},
							},
						],
					},
					{
						attributes: {},
						children: [
							{
								attributes: {
									accessibilityText: "space",
									bounds: "[100,760][290,802]",
								},
							},
						],
					},
				],
			},
		],
	});

	it("reads the keys from the keyboard's container: an avatar initial near it is not a key", () => {
		/* "D" at 470, inside the old 300 pt span above space (460..760). */
		const verdict = sendAboveKeyboard(nested(540, { text: "D", top: 470 }));
		expect(verdict).toMatchObject({ ok: true, keyboardTop: 548 });
		expect(verdict.reason).not.toMatch(FLAT_FALLBACK);
		/* And still fails the reported defect. */
		expect(sendAboveKeyboard(nested(700, { text: "D", top: 470 })).ok).toBe(
			false,
		);
	});

	it("a flat tree falls back to the label band, minus app testIDs, and says so", () => {
		const base = tree(540);
		const flat: HierarchyNode = {
			...base,
			children: [
				...base.children,
				{
					attributes: {
						"resource-id": "avatar-initial",
						accessibilityText: "D",
						bounds: "[16,470][48,502]",
					},
				},
			],
		};
		const verdict = sendAboveKeyboard(flat);
		expect(verdict).toMatchObject({ ok: true, keyboardTop: 548 });
		expect(verdict.reason).toMatch(FLAT_FALLBACK);
	});

	it("reads the tree out of output with log lines around it", () => {
		const out = `Running on iPhone\n${JSON.stringify(tree(540))}\n`;
		expect(sendAboveKeyboard(parseHierarchy(out)).ok).toBe(true);
	});
});

describe("chrome proof plan (record §7)", () => {
	it("covers the device classes a hosted iOS runner can give, both themes, and both fallbacks", () => {
		const ids = LANES.map((lane) => lane.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(LANES.some((l) => l.device.startsWith("iPhone SE"))).toBe(true);
		expect(LANES.some((l) => l.theme === "light")).toBe(true);
		expect(LANES.some((l) => l.reduceTransparency === true)).toBe(true);
		expect(LANES.some((l) => l.os === 18)).toBe(true);
		// Before/after pairs exist in both themes on the operator's device class.
		expect(
			LANES.filter((l) => l.before && l.device === "iPhone 17 Pro").map(
				(l) => l.theme,
			),
		).toEqual(["dark", "light"]);
	});

	it("refuses an incomplete frame set, and lists a complete one", () => {
		const root = mkdtempSync(join(tmpdir(), "chrome-proof-"));
		try {
			mkdirSync(join(root, "after"));
			for (const frame of LANE_FRAMES)
				writeFileSync(join(root, "after", `${frame}.png`), "");
			expect(collectChromeFrames(root)).toHaveLength(LANE_FRAMES.length);
			mkdirSync(join(root, "before"));
			writeFileSync(join(root, "before", "session.png"), "");
			expect(() => collectChromeFrames(root)).toThrow(
				/before\/session-keyboard/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

/* ---- Finger-driven keyboard instrument ----------------------------------
 * Synthetic frames at 1 px = 1 pt (`pxPerPt` 1): a light page, a mid-grey
 * composer panel from `composer` down to `keyboard`, a dark keyboard below it.
 * Two clean luminance steps, so the two edges are exactly where we put them. */
const W = 60;
const H = 400;

const png = (rgb: Uint8Array): Uint8Array => {
	const raw = Buffer.alloc((W * 3 + 1) * H);
	for (let y = 0; y < H; y += 1) {
		raw[y * (W * 3 + 1)] = 0; // filter: none
		Buffer.from(rgb.subarray(y * W * 3, (y + 1) * W * 3)).copy(
			raw,
			y * (W * 3 + 1) + 1,
		);
	}
	const chunk = (type: string, data: Buffer) => {
		const out = Buffer.alloc(12 + data.length);
		out.writeUInt32BE(data.length, 0);
		out.write(type, 4, "latin1");
		data.copy(out, 8);
		return out; // CRC left zero: decodePng documents that it does not verify it
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(W, 0);
	header.writeUInt32BE(H, 4);
	header[8] = 8;
	header[9] = 2;
	return new Uint8Array(
		Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			chunk("IHDR", header),
			chunk("IDAT", deflateSync(raw)),
			chunk("IEND", Buffer.alloc(0)),
		]),
	);
};

/** `composer` null draws no composer panel (one edge only). */
const frame = (composer: number | null, keyboard: number): Uint8Array => {
	const rgb = new Uint8Array(W * H * 3);
	for (let y = 0; y < H; y += 1) {
		const level =
			y >= keyboard ? 40 : composer !== null && y >= composer ? 120 : 200;
		rgb.fill(level, y * W * 3, (y + 1) * W * 3);
	}
	return png(rgb);
};

/** Two still frames, then the keyboard descends 300 -> 380 in 20 pt steps with
 *  the composer `lift` x as far (1 = rides it, 0 = stays), then two still. */
const drag = (lift: number, travel = 80): Uint8Array[] => {
	const out: Uint8Array[] = [frame(240, 300), frame(240, 300)];
	for (let step = 0; step <= travel; step += 20)
		out.push(frame(240 + Math.round(lift * step), 300 + step));
	const last = [240 + Math.round(lift * travel), 300 + travel];
	out.push(frame(last[0] as number, last[1] as number));
	out.push(frame(last[0] as number, last[1] as number));
	return out;
};

describe("dragVerdict: what the finger-driven keyboard frames prove", () => {
	it("composer rides the keyboard: after is ok, before is inconclusive (never a pass)", () => {
		const frames = drag(1);
		const after = dragVerdict("after", frames, 1);
		expect(after).toMatchObject({ status: "ok", deltaKeyboard: 80 });
		expect(after.deltaComposer).toBeCloseTo(80);
		const before = dragVerdict("before", frames, 1);
		expect(before.status).toBe("inconclusive");
		expect(before.reason).toMatch(
			/BEFORE build also shows the composer following/,
		);
	});

	it("composer stays while the keyboard moves: after fails with the numbers, before is the ok baseline", () => {
		const frames = drag(0);
		const after = dragVerdict("after", frames, 1);
		expect(after.status).toBe("fail");
		expect(after.reason).toMatch(/Δkeyboard=80\.0 pt, Δcomposer=0\.0 pt/);
		expect(dragVerdict("before", frames, 1)).toMatchObject({
			status: "ok",
			deltaComposer: 0,
		});
	});

	it("the baseline's static tolerance is 12 pt: a composer that moved 20 of 80 pt is neither a baseline nor a follower", () => {
		const before = dragVerdict("before", drag(0.25), 1);
		expect(before.status).toBe("inconclusive");
		expect(before.reason).toMatch(/moved but not with the keyboard/);
		// 10 of 80 pt is within the tolerance: still the non-following baseline.
		expect(dragVerdict("before", drag(0.125), 1).status).toBe("ok");
	});

	it("the follow tolerance is 8 pt: 8 passes, 12 does not", () => {
		// Composer lags the keyboard by 8 / 12 pt of the 80 pt travel.
		const lag = (pt: number) => {
			const out = drag(1);
			return [
				...out.slice(0, 2),
				...drag(1, 80)
					.slice(2, -2)
					.map((_, i, all) =>
						i === all.length - 1
							? frame(240 + 80 - pt, 380)
							: frame(240 + i * 20, 300 + i * 20),
					),
				...out.slice(-2).map(() => frame(240 + 80 - pt, 380)),
			];
		};
		expect(dragVerdict("after", lag(8), 1).status).toBe("ok");
		expect(dragVerdict("after", lag(12), 1).status).toBe("fail");
	});

	it("no motion at all is inconclusive", () => {
		const still = Array.from({ length: 8 }, () => frame(240, 300));
		const verdict = dragVerdict("after", still, 1);
		expect(verdict.status).toBe("inconclusive");
		expect(verdict.reason).toMatch(/no motion/);
	});

	it("a drag that did not engage (keyboard moved < 60 pt) is inconclusive for both builds", () => {
		const frames = drag(1, 40);
		for (const build of ["after", "before"] as const) {
			const verdict = dragVerdict(build, frames, 1);
			expect(verdict.status).toBe("inconclusive");
			expect(verdict.reason).toMatch(/did not engage/);
		}
	});

	it("a missing edge (no composer panel) is inconclusive, not a pass", () => {
		const frames: Uint8Array[] = [];
		for (const kb of [300, 300, 320, 340, 360, 380, 380])
			frames.push(frame(null, kb));
		const verdict = dragVerdict("after", frames, 1);
		expect(verdict.status).toBe("inconclusive");
		expect(verdict.reason).toMatch(/fewer than two edges/);
	});

	it("too few samples, an unreadable PNG and mixed sizes are inconclusive", () => {
		expect(dragVerdict("after", drag(1).slice(0, 2), 1).status).toBe(
			"inconclusive",
		);
		const bad = [...drag(1)];
		bad[3] = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		const unreadable = dragVerdict("after", bad, 1);
		expect(unreadable.status).toBe("inconclusive");
		expect(unreadable.reason).toMatch(/unreadable PNG/);
	});

	it("ignores frames after the finger lifts: a composer that drops once the keyboard is gone is not 'following'", () => {
		// Main's behaviour: composer static during the drag, then it drops after release.
		const frames = [
			frame(240, 300),
			...Array.from({ length: 41 }, (_, i) => frame(240, 300 + i * 2)),
			frame(330, 400),
			frame(330, 400),
			frame(330, 400),
		];
		expect(dragVerdict("before", frames, 1)).toMatchObject({
			status: "ok",
			deltaComposer: 0,
		});
	});
});

/** A frame with an extra strip (a third horizontal edge pair, 25 pt below the
 *  composer's top so it is >= 20 pt from both real edges) inside the composer panel, `level` bright. 200 against the panel's 120 is a step as
 *  strong as the composer's and the keyboard's own (80); 160 is half of it. */
const frameWithStrip = (
	composer: number,
	keyboard: number,
	level: number,
): Uint8Array => {
	const rgb = new Uint8Array(W * H * 3);
	for (let y = 0; y < H; y += 1) {
		const inStrip = y >= composer + 25 && y < composer + 45;
		const value =
			y >= keyboard ? 40 : y >= composer ? (inStrip ? level : 120) : 200;
		rgb.fill(value, y * W * 3, (y + 1) * W * 3);
	}
	return png(rgb);
};

/** The keyboard descends 300 -> 380 (5 frames, composer riding), bracketed by
 *  still frames; `compose` places each frame so a test can break one rule. */
const ride = (
	compose: (step: number, index: number) => Uint8Array,
): Uint8Array[] => [
	frame(240, 300),
	frame(240, 300),
	...[0, 20, 40, 60, 80].map((step, index) => compose(step, index)),
	frame(320, 380),
	frame(320, 380),
];

describe("dragVerdict: continuous attachment (U1)", () => {
	// Composer position per step: rides 1:1 except where `lag` pulls it back.
	const withLag = (lag: readonly number[]) =>
		ride((step, index) => frame(240 + step - (lag[index] ?? 0), 300 + step));

	it("a composer that lags mid-drag and catches up is NOT attached, though its endpoints match", () => {
		const frames = withLag([0, 20, 20, 20, 0]);
		const after = dragVerdict("after", frames, 1);
		expect(after.status).toBe("fail");
		expect(after).toMatchObject({ deltaKeyboard: 80, deltaComposer: 80 });
		expect(after.gapSpread).toBe(20);
		expect(after.reason).toMatch(/separation spread=20\.0 pt/);
		// The baseline reads it as "not attached" too, never as a clean baseline.
		expect(dragVerdict("before", frames, 1).status).toBe("inconclusive");
	});

	it("the separation bound is 8 pt over the whole segment: 8 passes, 12 does not", () => {
		const eight = dragVerdict("after", withLag([0, 8, 8, 8, 0]), 1);
		expect(eight.status).toBe("ok");
		expect(eight.gapSpread).toBe(8);
		expect(dragVerdict("after", withLag([0, 12, 12, 12, 0]), 1).status).toBe(
			"fail",
		);
	});

	it("a rigidly attached composer has a zero spread", () => {
		expect(dragVerdict("after", withLag([]), 1)).toMatchObject({
			status: "ok",
			gapSpread: 0,
		});
	});
});

describe("dragVerdict: fail-closed rules each have a test (R2-2)", () => {
	it("rising-keyboard split: the run ends where the keyboard rises, so a spring-back is not the drag", () => {
		// Sample the descent densely enough that the returning frames occupy less
		// than 10 % of the motion window, while still testing the split.
		const frames = [
			frame(240, 300),
			frame(240, 300),
			...Array.from({ length: 46 }, (_, i) => frame(240 + i * 2, 300 + i * 2)),
			...[80, 70, 60, 50].map((s) => frame(240 + s, 300 + s)),
			frame(290, 350),
		];
		expect(dragVerdict("after", frames, 1)).toMatchObject({
			status: "ok",
			deltaKeyboard: 90,
		});
	});

	it("AMBIGUITY_RATIO: a third edge as strong as the pair drops the frame, splitting the drag", () => {
		// Frame 4 (keyboard 340) carries a strip whose edges are as strong as the
		// composer's: which two edges are the pair is a guess, so the frame is
		// dropped and the two halves (2 samples each) are too short.
		const strong = ride((step, index) =>
			index === 2
				? frameWithStrip(240 + step, 300 + step, 200)
				: frame(240 + step, 300 + step),
		);
		const verdict = dragVerdict("after", strong, 1);
		expect(verdict.status).toBe("inconclusive");
		expect(verdict.reason).toMatch(/ambiguous edges/);
		// Under the ratio (a strip half as strong) the same frame is read.
		const weak = ride((step, index) =>
			index === 2
				? frameWithStrip(240 + step, 300 + step, 160)
				: frame(240 + step, 300 + step),
		);
		expect(dragVerdict("after", weak, 1).status).toBe("ok");
		const measured = measureFrame(frameWithStrip(240, 340, 200), "strip", 1);
		expect(measured.edges).toBeNull();
		expect(measured.reason).toMatch(/third edge is 100 % as strong/);
	});

	it.each([
		["static run first", true],
		["static run last", false],
	])(
		"furthest-travel run choice (%s): a longer-travelled drag wins over a static run in the window",
		(_name, staticFirst) => {
			// Two runs of >= 3 clean samples split by a frame with no composer edge:
			// the drag (keyboard 300 -> 380, composer riding) and a static run (the
			// keyboard stays put while the composer moves INSIDE the motion band, the
			// bottom 40 % of the frame, so the window covers it).
			// Dense drag samples keep the competing run below 10 % of the window.
			const dragRun = Array.from({ length: 46 }, (_, i) =>
				frame(240 + i * 2, 300 + i * 2),
			);
			const staticRun = (from: number, kb: number) =>
				[from, from + 10, from + 20].map((c) => frame(c, kb));
			const frames = staticFirst
				? [
						...staticRun(250, 340),
						frame(null, 340),
						...dragRun,
						frame(330, 390),
					]
				: [...dragRun, frame(null, 390), ...staticRun(330, 390)];
			expect(dragVerdict("after", frames, 1)).toMatchObject({
				status: "ok",
				deltaKeyboard: 90,
			});
		},
	);
});

describe("shortpullVerdict: recovery, not following", () => {
	/** Still, then the keyboard (and its composer) pulled `pull` pt and back. */
	const pulled = (
		pull: number,
		endKeyboard = 300,
		endComposer = 240,
	): Uint8Array[] => [
		frame(240, 300),
		frame(240, 300),
		frame(240 + pull / 2, 300 + pull / 2),
		frame(240 + pull, 300 + pull),
		frame(240 + pull / 2, 300 + pull / 2),
		frame(endComposer, endKeyboard),
		frame(endComposer, endKeyboard),
	];

	it("passes when both edges return to where they started", () => {
		expect(shortpullVerdict(pulled(40), 1)).toMatchObject({
			status: "ok",
			deltaKeyboard: 0,
			deltaComposer: 0,
		});
	});

	it("fails with the numbers when the composer is stranded at the dragged position", () => {
		const verdict = shortpullVerdict(pulled(40, 300, 262), 1);
		expect(verdict.status).toBe("fail");
		expect(verdict.reason).toMatch(/Δkeyboard=0\.0 pt, Δcomposer=22\.0 pt/);
	});

	it("fails when the keyboard does not return", () => {
		expect(shortpullVerdict(pulled(40, 330, 270), 1).status).toBe("fail");
	});

	it("the recovery tolerance is 4 pt on each edge: 4 passes, 5 does not", () => {
		expect(shortpullVerdict(pulled(40, 304, 244), 1).status).toBe("ok");
		expect(shortpullVerdict(pulled(40, 305, 244), 1).status).toBe("fail");
		expect(shortpullVerdict(pulled(40, 304, 245), 1).status).toBe("fail");
		expect(shortpullVerdict(pulled(40, 296, 236), 1).status).toBe("ok");
		expect(shortpullVerdict(pulled(40, 295, 236), 1).status).toBe("fail");
	});

	it("is inconclusive, never ok, when the pull never moved the keyboard", () => {
		const still = Array.from({ length: 7 }, () => frame(240, 300));
		const verdict = shortpullVerdict(still, 1);
		expect(verdict.status).toBe("inconclusive");
		expect(verdict.reason).toMatch(/did not move the keyboard/);
	});

	it("a single displaced sample is not engagement", () => {
		const one = [
			frame(240, 300),
			frame(240, 300),
			frame(260, 320),
			frame(240, 300),
			frame(240, 300),
		];
		expect(shortpullVerdict(one, 1).status).toBe("inconclusive");
	});

	it("is inconclusive on too few usable samples, an unreadable PNG and no edges", () => {
		expect(shortpullVerdict(pulled(40).slice(0, 2), 1).status).toBe(
			"inconclusive",
		);
		const bad = pulled(40);
		bad[3] = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(shortpullVerdict(bad, 1).reason).toMatch(/unreadable PNG/);
		const blank = Array.from({ length: 6 }, () => frame(null, 300));
		const verdict = shortpullVerdict(blank, 1);
		expect(verdict.status).toBe("inconclusive");
		expect(verdict.reason).toMatch(/usable sample/);
	});

	it("the lane verdict is the AFTER's; the baseline is reported, never required", () => {
		const ok = { status: "ok" as const, reason: "r" };
		const inc = { status: "inconclusive" as const, reason: "x" };
		const fail = { status: "fail" as const, reason: "y" };
		expect(shortpullPair(inc, ok).status).toBe("ok");
		expect(shortpullPair(ok, ok).status).toBe("ok");
		expect(shortpullPair(ok, fail).status).toBe("fail");
		expect(shortpullPair(ok, inc).status).toBe("inconclusive");
		expect(shortpullPair(fail, ok).reason).toMatch(/baseline fail/);
	});
});

describe("keyboardRestored (after the short pull)", () => {
	const withInput = (keyboard: boolean) => ({
		attributes: {},
		children: [
			{
				attributes: {
					"resource-id": "composer-input",
					bounds: "[16,500][300,548]",
				},
			},
			...(keyboard
				? [
						{
							attributes: {
								accessibilityText: "space",
								bounds: "[100,760][290,802]",
							},
						},
					]
				: []),
		],
	});
	it("is ok with the software keyboard up and the input in the tree", () => {
		expect(keyboardRestored(withInput(true)).ok).toBe(true);
	});
	it("FAILS, never skips, when the pull dismissed the keyboard", () => {
		const verdict = keyboardRestored(withInput(false));
		expect(verdict.ok).toBe(false);
		expect(verdict.reason).toMatch(/no software keyboard/);
	});
	it("FAILS without the composer input", () => {
		const tree = withInput(true);
		tree.children.shift();
		expect(keyboardRestored(tree).ok).toBe(false);
	});
});

describe("pairVerdict", () => {
	const ok = (reason: string) => ({ status: "ok" as const, reason });
	const inc = { status: "inconclusive" as const, reason: "x" };
	const fail = { status: "fail" as const, reason: "y" };
	it("is ok only for a non-following baseline AND a following after", () => {
		expect(pairVerdict(ok("b"), ok("a")).status).toBe("ok");
		expect(pairVerdict(inc, ok("a")).status).toBe("inconclusive");
		expect(pairVerdict(ok("b"), inc).status).toBe("inconclusive");
	});
	it("keeps an after FAIL a fail whatever the baseline did", () => {
		expect(pairVerdict(inc, fail).status).toBe("fail");
		expect(pairVerdict(ok("b"), fail).status).toBe("fail");
	});
});

describe("PROOF_LANES", () => {
	it("is not narrowed when unset or empty, and lists every lane", () => {
		for (const raw of [undefined, "", " , "]) {
			const picked = selectLanes(raw);
			expect(picked.narrowed).toBe(false);
			expect(picked.lanes).toEqual(LANES);
			expect(picked.requested).toEqual([]);
		}
	});
	it("narrows to the named lanes, in plan order, and says so", () => {
		const picked = selectLanes("d3-17pro-light, d2-16-dark");
		expect(picked.lanes.map((l) => l.id)).toEqual([
			"d2-16-dark",
			"d3-17pro-light",
		]);
		expect(picked).toMatchObject({
			narrowed: true,
			requested: ["d3-17pro-light", "d2-16-dark"],
		});
	});
	it("refuses an unknown id rather than running nothing", () => {
		expect(() => selectLanes("d2-16-dark,nope")).toThrow(
			/unknown lane\(s\): nope/,
		);
	});
	it("can only reduce: naming every lane is the full plan, not narrowed", () => {
		expect(selectLanes(LANES.map((l) => l.id).join(",")).narrowed).toBe(false);
	});
	it("a drag frame directory does not replace the required frames", () => {
		const root = mkdtempSync(join(tmpdir(), "chrome-proof-drag-"));
		try {
			mkdirSync(join(root, "after", "drag"), { recursive: true });
			writeFileSync(join(root, "after", "drag", "f-000.png"), "");
			expect(() => collectChromeFrames(root)).toThrow(
				/missing after\/session\.png/,
			);
			for (const name of LANE_FRAMES)
				writeFileSync(join(root, "after", `${name}.png`), "");
			expect(collectChromeFrames(root)).toContain("after/drag/f-000.png");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("the finger-driven keyboard flows", () => {
	const flowsDir = new URL("../../e2e/maestro/chrome-proof/", import.meta.url);
	const read = (file: string) => readFileSync(new URL(file, flowsDir), "utf8");
	const flows = [
		KEYBOARD_READY_FLOW,
		...DRAG_FLOWS.map((f) => f.file),
	] as string[];

	it("are the two the driver samples plus the unsampled ready step, and only use identifiers the app renders", () => {
		// The short pull runs FIRST: it must start from the keyboard-up end state.
		expect(DRAG_FLOWS.map((f) => f.file)).toEqual([
			"session-keyboard-shortpull.yaml",
			"session-keyboard-drag.yaml",
		]);
		expect(KEYBOARD_READY_FLOW).toBe("session-keyboard-ready.yaml");
		for (const file of flows) {
			const text = read(file);
			const body = text.split("\n---\n")[1] ?? "";
			expect(text).toMatch(/^appId: \$\{APP_ID\}$/m);
			expect(body).not.toMatch(/launchApp|inputText|RELAY_PASSWORD/);
			const ids = [...body.matchAll(/id: "([^"]+)"/g)].map(
				(m) => m[1] as string,
			);
			expect(ids.length).toBeGreaterThan(0);
			for (const id of ids) expect(isKnownIdentifier(id)).toBe(true);
		}
	});

	it("swipe the documented paths: every start is a hierarchy-derived placeholder", () => {
		const swipes = (file: string) =>
			[
				...read(file).matchAll(
					/start: "([^"]+)"\n\s+end: "([^"]+)"\n\s+duration: (\d+)/g,
				),
			].map((m) => m.slice(1, 4).join(" | "));
		expect(swipes(KEYBOARD_READY_FLOW)).toEqual([
			"50%, __DRAG_START_PCT__% | 50%, __PREPARE_END_PCT__% | 150",
		]);
		expect(swipes("session-keyboard-shortpull.yaml")).toEqual([
			"50%, __DRAG_START_PCT__% | 50%, __SHORTPULL_END_PCT__% | 850",
		]);
		expect(swipes("session-keyboard-drag.yaml")).toEqual([
			"50%, __DRAG_START_PCT__% | 50%, 96% | 3500",
		]);
		expect(read(KEYBOARD_READY_FLOW)).toMatch(/times: 10\b/);
	});

	it("U3: the sampled flows hold ONLY the measured swipe, never the prepare swipes or the re-tap", () => {
		const steps = (file: string) =>
			(read(file).split("\n---\n")[1] ?? "")
				.split("\n")
				.flatMap((line) => /^- (\w+)/.exec(line)?.[1] ?? []);
		expect(steps(KEYBOARD_READY_FLOW)).toEqual([
			"tapOn",
			"waitForAnimationToEnd",
			"repeat",
			"tapOn",
			"waitForAnimationToEnd",
		]);
		// Neither sampled flow taps, repeats, or swipes more than once.
		expect(steps("session-keyboard-shortpull.yaml")).toEqual([
			"swipe",
			"waitForAnimationToEnd",
			"assertVisible",
		]);
		expect(steps("session-keyboard-drag.yaml")).toEqual([
			"swipe",
			"assertVisible",
		]);
		for (const { file } of DRAG_FLOWS)
			expect(read(file)).not.toMatch(/tapOn|repeat:|times:/);
	});

	it("each template carries exactly the placeholders the driver supplies, and renders to integers", () => {
		const geometry = {
			screenWidth: 402,
			screenHeight: 874,
			composerTop: 250,
			composerSource: "composer-shell-ring",
			keyboardTop: 538,
			dragStartPct: 24,
			prepareEndPct: 57,
			shortpullEndPct: 34,
			marginPt: 40,
		};
		for (const file of flows) {
			const text = read(file);
			const used = new Set(
				[...text.matchAll(/__([A-Z][A-Z0-9_]*)__/g)].map((m) => m[1]),
			);
			const values = gestureFlowValues(file, geometry);
			expect([...used].sort()).toEqual(Object.keys(values).sort());
			const rendered = renderFlow(text, values);
			expect(rendered).not.toMatch(/__[A-Z]/);
			expect(rendered).not.toMatch(/\$\{(?!APP_ID\})/);
		}
		expect(
			renderFlow(read("session-keyboard-shortpull.yaml"), {
				DRAG_START_PCT: 24,
				SHORTPULL_END_PCT: 34,
			}),
		).toContain('start: "50%, 24%"');
	});
});

describe("renderFlow fails closed", () => {
	it("on a leftover placeholder, a value the template lacks, and a non-percentage", () => {
		expect(() => renderFlow('a: "__A__ __B__"', { A: 1 })).toThrow(
			/unrendered placeholder\(s\): __B__/,
		);
		expect(() => renderFlow('a: "__A__"', { A: 1, B: 2 })).toThrow(/no __B__/);
		expect(() => renderFlow('a: "__A__"', { A: 24.5 })).toThrow(
			/integer percentage/,
		);
		expect(() => renderFlow('a: "__A__"', { A: 101 })).toThrow(
			/integer percentage/,
		);
		expect(renderFlow('a: "__A__, __A__"', { A: 7 })).toBe('a: "7, 7"');
	});
});

/* A Maestro hierarchy at 402x874 pt with the long draft's composer card. */
const SCREEN_PNG = { width: 1206, height: 2622 };
const geometryTree = (
	opts: {
		ringTop?: number | null;
		inputTop?: number | null;
		screen?: string | null;
		keyboard?: boolean;
		/** The top key row; the space key sits 222 pt below it. */
		keyboardTop?: number;
	} = {},
): HierarchyNode => {
	const {
		ringTop = 255,
		inputTop = 275,
		screen = "[0,0][402,874]",
		keyboardTop = 538,
	} = opts;
	const node = (id: string, top: number) => ({
		attributes: {
			"resource-id": id,
			bounds: `[12,${top}][390,${top + 240}]`,
		},
	});
	return {
		attributes: screen ? { bounds: screen } : {},
		children: [
			...(ringTop === null ? [] : [node("composer-shell-ring", ringTop)]),
			...(inputTop === null ? [] : [node("composer-input", inputTop)]),
			{
				attributes: {
					"resource-id": "composer-send",
					bounds: "[330,470][374,514]",
				},
			},
			...(opts.keyboard === false
				? []
				: [
						{
							attributes: {
								accessibilityText: "q",
								bounds: `[3,${keyboardTop}][39,${keyboardTop + 58}]`,
							},
						},
						{
							attributes: {
								accessibilityText: "space",
								bounds: `[100,${keyboardTop + 222}][290,${keyboardTop + 280}]`,
							},
						},
					]),
		],
	};
};

describe("gestureGeometry (U4): the finger starts above the composer, from the hierarchy", () => {
	it("pngSize reads the IHDR and refuses a non-PNG", () => {
		expect(pngSize(frame(240, 300))).toEqual({ width: W, height: H });
		expect(() => pngSize(new Uint8Array(30))).toThrow(/not a PNG/);
	});

	it("starts 40 pt above the composer card's top, as an integer percentage rounded down", () => {
		const verdict = gestureGeometry(geometryTree(), SCREEN_PNG);
		expect(verdict.ok).toBe(true);
		if (!verdict.ok) return;
		const g = verdict.geometry;
		expect(g.composerSource).toBe("composer-shell-ring");
		expect(g.composerTop).toBe(255);
		// (255 - 40) / 874 = 24.6 % -> 24 %, which is 209.8 pt: 45.2 pt clear.
		expect(g.dragStartPct).toBe(24);
		expect(g.marginPt).toBeCloseTo(255 - 0.24 * 874, 5);
		expect(g.marginPt).toBeGreaterThanOrEqual(GESTURE_CLEARANCE_PT);
		// 40 pt above the keyboard's top key row (538): 56.99 % -> 56 %.
		expect(g.prepareEndPct).toBe(56);
		// A short pull of 10 percentage points (~87 pt).
		expect(g.shortpullEndPct).toBe(34);
		expect(g.keyboardTop).toBe(538);
	});

	it("never starts inside the card: the clearance holds for every composer top", () => {
		for (let top = 150; top < 480; top += 1) {
			const verdict = gestureGeometry(
				geometryTree({ ringTop: top, inputTop: top + 20 }),
				SCREEN_PNG,
			);
			if (verdict.ok) {
				const startPt = (verdict.geometry.dragStartPct * 874) / 100;
				expect(top - startPt).toBeGreaterThanOrEqual(GESTURE_CLEARANCE_PT);
			}
		}
	});

	it("falls back to composer-input when there is no shell ring", () => {
		const verdict = gestureGeometry(
			geometryTree({ ringTop: null }),
			SCREEN_PNG,
		);
		expect(verdict.ok && verdict.geometry.composerSource).toBe(
			"composer-input",
		);
		expect(verdict.ok && verdict.geometry.composerTop).toBe(275);
	});

	it("takes the TOPMOST composer element", () => {
		const verdict = gestureGeometry(
			geometryTree({ ringTop: 300, inputTop: 270 }),
			SCREEN_PNG,
		);
		expect(verdict.ok && verdict.geometry.composerSource).toBe(
			"composer-input",
		);
	});

	const refused = (tree: HierarchyNode, png = SCREEN_PNG) => {
		const verdict = gestureGeometry(tree, png);
		expect(verdict.ok).toBe(false);
		return verdict.ok ? "" : verdict.reason;
	};

	it("is INCONCLUSIVE, never a guessed position, when the composer bounds cannot be read", () => {
		expect(refused(geometryTree({ ringTop: null, inputTop: null }))).toMatch(
			/no composer-shell-ring or composer-input bounds/,
		);
	});

	it("refuses an unreadable screen, an unreadable keyboard and a screenshot of another shape", () => {
		expect(refused(geometryTree({ screen: null }))).toMatch(/no screen frame/);
		expect(refused(geometryTree({ keyboard: false }))).toMatch(
			/keyboard's top is not readable/,
		);
		expect(refused(geometryTree(), { width: 1206, height: 2000 })).toMatch(
			/disagrees with the 1206x2000 px screenshot/,
		);
	});

	it("refuses a composer with no transcript room above it", () => {
		expect(refused(geometryTree({ ringTop: 120, inputTop: 130 }))).toMatch(
			/no transcript room above the composer/,
		);
	});

	it("refuses a keyboard so close under the composer that there is no room to scroll, or to pull", () => {
		// ringTop 250 -> start 24 %; a keyboard top of 255 gives a prepare end of 24 %.
		expect(
			refused(geometryTree({ ringTop: 250, inputTop: 260, keyboardTop: 255 })),
		).toMatch(/no room to scroll between the start \(24 %\)/);
		// keyboard top 300 -> prepare end 29 %, under the start + 10 = 34 % pull end.
		expect(
			refused(geometryTree({ ringTop: 250, inputTop: 260, keyboardTop: 300 })),
		).toMatch(/short pull's end \(34 %\) would reach the prepare limit/);
	});

	it("refuses a composer top outside the screen and a keyboard that is not below the composer", () => {
		expect(refused(geometryTree({ ringTop: 900, inputTop: 910 }))).toMatch(
			/outside the 874 pt screen/,
		);
		expect(refused(geometryTree({ ringTop: 600, inputTop: 610 }))).toMatch(
			/not below the composer top/,
		);
	});
});

describe("R3-1: the measured segment must hold most of the motion window", () => {
	/* still x2, then `clean` frames of a keyboard descending 10 pt a step with
	 * the composer riding it, then `bad` frames the keyboard keeps moving in but
	 * whose composer panel is missing (edges unreadable), then one more such
	 * frame. The motion window is clean + bad + 1 frames (it starts at the first
	 * frame of the descent), so the segment's share is clean / (clean + bad + 1). */
	const run = (clean: number, bad: number): Uint8Array[] => {
		const out: Uint8Array[] = [frame(240, 300), frame(240, 300)];
		for (let i = 0; i < clean; i += 1)
			out.push(frame(240 + 10 * i, 300 + 10 * i));
		for (let i = 0; i < bad; i += 1)
			out.push(frame(null, 300 + 10 * (clean + i)));
		out.push(frame(null, 300 + 10 * (clean + bad)));
		return out;
	};

	it("9 of 10 passes (>= 90 %), 8 of 10 is inconclusive with the share", () => {
		const ok = dragVerdict("after", run(9, 0), 1);
		expect(ok.segmentSamples).toBe(9);
		expect(ok.windowSamples).toBe(10);
		expect(ok.status).toBe("ok");
		const thin = dragVerdict("after", run(8, 1), 1);
		expect(thin).toMatchObject({
			status: "inconclusive",
			segmentSamples: 8,
			windowSamples: 10,
		});
		expect(thin.reason).toMatch(/8 of 10 motion-window samples \(80 %\)/);
	});

	it("the same frames are inconclusive for the baseline too", () => {
		expect(dragVerdict("before", run(6, 3), 1).status).toBe("inconclusive");
	});
});

describe("R3-2: the short pull must be read at the run's last sampled frame", () => {
	it("an unreadable first sampled frame is inconclusive even if later frames return", () => {
		const verdict = shortpullVerdict(
			[
				frame(null, 300),
				frame(260, 320),
				frame(240, 300),
				frame(240, 300),
				frame(260, 320),
			],
			1,
		);
		expect(verdict.status).toBe("inconclusive");
		expect(verdict.reason).toMatch(/first sampled frame has no readable edges/);
	});
	it("a last frame with no readable edges is inconclusive, even though earlier ones recovered", () => {
		const frames = [
			frame(240, 300),
			frame(240, 300),
			frame(260, 320),
			frame(280, 340),
			frame(260, 320),
			frame(240, 300),
			frame(null, 300),
		];
		const verdict = shortpullVerdict(frames, 1);
		expect(verdict.status).toBe("inconclusive");
		expect(verdict.reason).toMatch(/final sampled frame has no readable edges/);
		// The same run with a readable last frame is a pass.
		expect(
			shortpullVerdict([...frames.slice(0, -1), frame(240, 300)], 1).status,
		).toBe("ok");
	});
});
