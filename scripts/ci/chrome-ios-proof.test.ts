import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HierarchyNode } from "./chrome-ios-proof-contract.ts";
import {
	collectChromeFrames,
	LANE_FRAMES,
	LANES,
	parseHierarchy,
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
