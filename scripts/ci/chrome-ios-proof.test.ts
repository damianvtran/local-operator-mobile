import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HierarchyNode } from "./chrome-ios-proof-contract.ts";
import {
	ATTACHMENT_FRAMES,
	collectChromeFrames,
	LANE_FRAMES,
	LANES,
	parseHierarchy,
	proofPlan,
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

describe("attachment-only artifact plan", () => {
	it("selects exactly one simulator and no before build, not the chrome matrix", () => {
		const plan = proofPlan("attachments-ios-proof");
		expect(plan.lanes).toEqual([
			{
				id: "attachments-17pro-dark",
				device: "iPhone 17 Pro",
				os: 26,
				theme: "dark",
			},
		]);
		expect(plan.frames).toEqual([
			"attachments-opening",
			"attachments-settled",
			"attachments-no-camera",
		]);
		expect(proofPlan("chrome-ios-proof").lanes).toBe(LANES);
		expect(() => proofPlan("typo")).toThrow("unknown proof mode");
	});
	it("rejects missing native frames instead of accepting an incomplete capture", () => {
		const dir = mkdtempSync(join(tmpdir(), "attachment-plan-"));
		try {
			mkdirSync(join(dir, "after"));
			for (const frame of ATTACHMENT_FRAMES.slice(0, 2))
				writeFileSync(join(dir, "after", `${frame}.png`), "test");
			expect(() => collectChromeFrames(dir, ATTACHMENT_FRAMES)).toThrow(
				"missing after/attachments-no-camera.png",
			);
			writeFileSync(join(dir, "after", "attachments-no-camera.png"), "test");
			expect(collectChromeFrames(dir, ATTACHMENT_FRAMES)).toHaveLength(3);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("attachment flow contract (native execution still required)", () => {
	const read = (name: string) =>
		readFileSync(
			new URL(`../../e2e/maestro/chrome-proof/${name}.yaml`, import.meta.url),
			"utf8",
		);
	it("reuses the own-tunnel session route and asserts all four actual product row IDs", () => {
		const opening = read("attachments");
		expect(opening).toContain("- runFlow: session.yaml");
		expect(opening).toContain('id: "composer-attach"');
		for (const source of ["library", "camera", "files", "paste"]) {
			expect(opening).toContain(`id: "attach-option-${source}"`);
			expect(read("attachments-settled")).toContain(
				`id: "attach-option-${source}"`,
			);
		}
		expect(opening).not.toContain("waitForAnimationToEnd:");
		expect(read("attachments-settled")).toContain("waitForAnimationToEnd:");
	});
	it("requests the real simulator camera notice, not injected TCC or picker success", () => {
		const camera = read("attachments-no-camera");
		expect(camera).toContain('id: "attach-option-camera"');
		expect(camera).toContain('id: "attach-camera-notice"');
		expect(camera).toContain(
			'assertVisible: "No camera is available on this device."',
		);
		expect(camera).toContain(
			'assertNotVisible:\n    id: "attach-camera-settings"',
		);
		for (const text of [
			"launchApp:",
			"clearState:",
			"openLink:",
			"setPermissions:",
		])
			expect(camera).not.toContain(text);
	});
});
