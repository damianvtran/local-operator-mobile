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
	LANE_FRAMES,
	LANES,
	pairVerdict,
	parseHierarchy,
	selectLanes,
	sendAboveKeyboard,
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
			...drag(0),
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

	it("are the two the driver samples, and only use identifiers the app renders", () => {
		expect(DRAG_FLOWS.map((f) => f.file)).toEqual([
			"session-keyboard-drag.yaml",
			"session-keyboard-shortpull.yaml",
		]);
		for (const { file } of DRAG_FLOWS) {
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

	it("swipe the documented paths", () => {
		const swipes = (file: string) =>
			[
				...read(file).matchAll(
					/start: "([^"]+)"\n\s+end: "([^"]+)"\n\s+duration: (\d+)/g,
				),
			].map((m) => m.slice(1, 4).join(" | "));
		expect(swipes("session-keyboard-drag.yaml")).toEqual([
			"50%, 60% | 50%, 30% | 200",
			"50%, 62% | 50%, 96% | 2500",
		]);
		expect(read("session-keyboard-drag.yaml")).toMatch(/times: 6/);
		expect(swipes("session-keyboard-shortpull.yaml")).toEqual([
			"50%, 62% | 50%, 72% | 700",
		]);
	});
});
