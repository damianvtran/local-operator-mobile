import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { STAGE_B_HOST } from "../../src/testing/stage-b-draft-transport";
import { capFor } from "./account-routing-proof-contract";
import {
	STAGE_B_DOCUMENT_ROW,
	STAGE_B_DOCUMENT_ROW_ID,
} from "./stage-b-document-seed";
import {
	assertStageBDraft,
	assertStageBPostReleaseDraft,
	attachStageBDocument,
	attachStageBPhoto,
	discardStageBDraft,
	STAGE_B_COLD_ASSERTION_MS,
	STAGE_B_DOCUMENT_DISMISS_LABEL,
	STAGE_B_DRAWN_SCREEN,
	STAGE_B_PICKER_BROWSER_ID,
	STAGE_B_PICKER_OUTCOME_LABEL,
	STAGE_B_PICKER_OUTCOME_MS,
	STAGE_B_PICKER_WAIT_MS,
	STAGE_B_WRONG_PICKER,
	selectStageBComputer,
	stageBFlow,
	stageBHasDrawnScreen,
	typeStageBDraft,
} from "./stage-b-draft-flows";

const steps = (flow: string): Record<string, unknown>[] =>
	flow
		.split("\n")
		.filter((line) => line.startsWith("- "))
		.map((line) => JSON.parse(line.slice(2)));

describe("Stage B foreground-only Maestro flows", () => {
	it("reproduces both the 50-backspace limit and the native suffix left by a middle caret", () => {
		// Maestro 2.11 EraseTextHandler sends delete keys at the existing caret.
		// This is a source-backed deletion model, NOT a UIKit/native execution.
		const original = `stage-b-private-draft-${"a".repeat(32)}`;
		const erase = (text: string, caret: number, count: number) =>
			text.slice(0, Math.max(0, caret - count)) + text.slice(caret);
		expect(original).toHaveLength(54);
		expect(erase(original, original.length, 50)).toHaveLength(4);
		expect(erase(original, 16, 50)).toBe(original.slice(16));
		expect(erase(original, 16, original.length)).toHaveLength(38);
		for (const text of [original, `${original}-edited-after-fresh-proof`]) {
			const clear = discardStageBDraft(text);
			expect(clear[0]).toEqual({
				tapOn: {
					id: "composer-input",
					point: "99%,99%",
					retryTapIfNoChange: false,
				},
			});
			const count =
				(clear[1]?.eraseText as { charactersToErase?: number } | undefined)
					?.charactersToErase ?? 0;
			expect(count).toBe(text.length);
			expect(erase(text, text.length, count)).toBe("");
		}
	});
	it("fails on nonempty text before typing; blank hints cannot fake an empty field", () => {
		const clear = discardStageBDraft("synthetic-owned-ASCII-draft");
		expect(clear[2]).toEqual({ copyTextFrom: { id: "composer-input" } });
		const condition = clear[3]?.assertTrue;
		if (typeof condition !== "string")
			throw new Error("clear must assert its readback before typing");
		const expression = condition.slice(2, -1);
		// Orchestra.resolveText prefers nonempty text over hint/label. Only an
		// empty field falls through to this composer's placeholder or label.
		const copied = (text: string) => text || "Message…";
		// Exact AX shapes observed/allowed for this empty proof composer. Real
		// content wins even when a blank hint or the aggregate label is present.
		for (const attributes of [
			{ text: "", hintText: "", accessibilityText: "Message Message…" },
			{ text: "", hintText: "Message…", accessibilityText: "Message" },
			{ text: "", hintText: "", accessibilityText: "Message" },
			{ text: "Message…", hintText: "", accessibilityText: "Message Message…" },
		]) {
			const copiedText =
				attributes.text || attributes.hintText || attributes.accessibilityText;
			expect(runInNewContext(expression, { maestro: { copiedText } })).toBe(
				true,
			);
		}
		for (const remaining of [
			"stale-suffix",
			`stage-b-private-draft-${"a".repeat(32)}`,
			"x".repeat(38),
			"Message Message… stale",
			" Message Message… ",
		])
			expect(
				runInNewContext(expression, {
					maestro: { copiedText: copied(remaining) },
				}),
			).toBe(false);
		expect(
			runInNewContext(expression, { maestro: { copiedText: copied("") } }),
		).toBe(true);
		const generated = steps(
			stageBFlow([...clear, ...typeStageBDraft("replacement")]),
		);
		expect(generated.findIndex((step) => "assertTrue" in step)).toBeLessThan(
			generated.findIndex((step) => "inputText" in step),
		);
	});
	it("wires the longer edited draft into the subsequent clear rather than reusing the original length", () => {
		const source = readFileSync(
			new URL("./stage-b-draft-proof.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain("...discardStageBDraft(pendingDraft)");
		expect(source).not.toContain("discardStageBDraft()");
		const composer = readFileSync(
			new URL("../../src/features/session/composer.ts", import.meta.url),
			"utf8",
		);
		const view = readFileSync(
			new URL(
				"../../src/features/session/components/composer.tsx",
				import.meta.url,
			),
			"utf8",
		);
		expect(composer).toContain('placeholder: "Message…"');
		expect(view).toContain('label="Message"');
	});
	it("waits on the real remote grid with measured headroom, without obscuring it with app foreground assertions", () => {
		const attachment = attachStageBPhoto();
		const tapIndex = attachment.findIndex(
			(step) =>
				(step.tapOn as { id?: string } | undefined)?.id ===
				"attach-option-library",
		);
		const picker = attachment.slice(tapIndex + 1);
		expect(STAGE_B_PICKER_WAIT_MS).toBe(30000);
		expect(picker[0]).toEqual({
			extendedWaitUntil: { notVisible: { id: "attach-sheet" }, timeout: 10000 },
		});
		expect(picker[1]).toEqual({
			extendedWaitUntil: {
				visible: { id: STAGE_B_PICKER_BROWSER_ID },
				timeout: STAGE_B_PICKER_OUTCOME_MS,
				label: STAGE_B_PICKER_OUTCOME_LABEL,
			},
		});
		expect(picker[2]).toEqual({
			assertNotVisible: { id: "DOC.browsingRoot", label: STAGE_B_WRONG_PICKER },
		});
		expect(picker[3]).toEqual({
			assertNotVisible: {
				id: "composer-error",
				label: "Photo picker failed: composer attach error",
			},
		});
		expect(STAGE_B_PICKER_OUTCOME_MS + 10000).toBe(130000);
		expect(picker[4]).toEqual({
			extendedWaitUntil: {
				visible: { id: "PXGGridLayout-Info", text: "Photo, .*" },
				timeout: STAGE_B_PICKER_WAIT_MS,
			},
		});
		expect(attachment.slice(0, tapIndex + 1)).toEqual([
			{ tapOn: { id: "composer-attach" } },
			{ waitForAnimationToEnd: { timeout: 5000 } },
			{ assertVisible: { id: "attach-option-library" } },
			{ tapOn: { id: "attach-option-library", retryTapIfNoChange: false } },
		]);
		const generated = steps(stageBFlow(picker));
		expect(generated).toEqual(picker);
		expect(JSON.stringify(generated)).not.toContain('"visible":"Photos"');
	});
	it("repeats the production negative selector over ten seconds rather than checking once before release", () => {
		const generated = assertStageBPostReleaseDraft("synthetic-canary");
		const script = generated[0]?.evalScript as string;
		const repeat = generated[1]?.repeat as {
			while: { true: string };
			commands: unknown[];
		};
		let clock = 0,
			observations = 0;
		const context = { output: {}, Date: { now: () => clock } };
		runInNewContext(script.slice(2, -1), context);
		while (runInNewContext(repeat.while.true.slice(2, -1), context)) {
			observations++;
			clock += 1000;
		}
		expect(observations).toBe(10);
		expect(clock).toBe(10000);
		expect(repeat.commands).toEqual(
			assertStageBDraft("synthetic-canary", false),
		);
		expect(generated.slice(2)).toEqual(
			assertStageBDraft("synthetic-canary", false),
		);
	});
	it("dismisses optional Photos onboarding and selects the first real photo without point taps", () => {
		const commands = steps(stageBFlow(attachStageBPhoto()));
		expect(commands).toContainEqual({
			runFlow: {
				when: { visible: "Private Access to Photos.*" },
				commands: [{ tapOn: { text: "Close", index: 0 } }],
			},
		});
		expect(commands).toContainEqual({
			tapOn: { id: "PXGGridLayout-Info", text: "Photo, .*", index: 0 },
		});
		expect(commands).toContainEqual({
			extendedWaitUntil: {
				visible: { id: "PXGGridLayout-Info", text: "Photo, .*" },
				timeout: 15000,
			},
		});
		expect(commands).toContainEqual({
			runFlow: { when: { visible: "Add" }, commands: [{ tapOn: "Add" }] },
		});
		expect(commands).toContainEqual({
			extendedWaitUntil: {
				visible: { id: "composer-attachment-0" },
				timeout: 15000,
			},
		});
		expect(JSON.stringify(commands)).not.toContain('"point"');
	});
	it.each([
		{ evidence: [] },
		{ evidence: [{ assertVisible: { id: "composer-input" } }] },
	])(
		"foregrounds without restart or data reset before any supplied evidence steps: %j",
		({ evidence }) => {
			const generated = stageBFlow(evidence);
			const commands = steps(generated);
			expect(commands[0]).toEqual({
				launchApp: { stopApp: false, permissions: {} },
			});
			expect(commands[1]).toEqual({
				extendedWaitUntil: {
					visible: { id: STAGE_B_DRAWN_SCREEN },
					timeout: STAGE_B_COLD_ASSERTION_MS,
				},
			});
			expect(commands.slice(2)).toEqual(evidence);
			expect(generated).not.toContain("clearState");
			expect(generated).not.toContain("clearKeychain");
			expect(generated).not.toContain('stopApp":true');
		},
	);
	it("retains the measured 78-second cold-app assertion after driver warm-up", () => {
		expect(STAGE_B_COLD_ASSERTION_MS).toBe(78000);
		expect(STAGE_B_COLD_ASSERTION_MS).toBe(capFor("coldAppLaunch") * 1000);
		expect(selectStageBComputer()[0]).toEqual({
			extendedWaitUntil: {
				visible: {
					id: `(computer-row-${STAGE_B_HOST.replaceAll(".", "\\.")}|composer-input)`,
				},
				timeout: STAGE_B_COLD_ASSERTION_MS,
			},
		});
		expect(capFor("maestroCold")).toBeGreaterThan(
			STAGE_B_COLD_ASSERTION_MS / 1000,
		);
	});
	it("recognizes only app-drawn screen ids, never SpringBoard app/driver labels", () => {
		for (const id of [
			"stage-b-proof-gate",
			"welcome-screen",
			"home-screen",
			"composer-input",
			`computer-row-${STAGE_B_HOST}`,
		])
			expect(stageBHasDrawnScreen(JSON.stringify({ identifier: id }))).toBe(
				true,
			);
		for (const label of [
			"SpringBoard",
			"Stage B Draft Proof",
			"maestro-driver-iosUITests-Runner",
			`computer-row-${STAGE_B_HOST.replaceAll(".", "x")}`,
		])
			expect(
				stageBHasDrawnScreen(
					JSON.stringify({ application: "SpringBoard", label }),
				),
			).toBe(false);
	});
});

describe("document-picker attachment is the native proof surface", () => {
	it("selects the seeded Files document and never touches the photo grid", () => {
		const flow = attachStageBDocument("local");
		const raw = JSON.stringify(flow);
		expect(raw).toContain("attach-option-files");
		expect(raw).toContain("Browse");
		// Run 42132547421 captured the row as "stage-b-seed, txt"; an exact
		// "stage-b-seed.txt" match never lands on iOS.
		expect(raw).toContain("stage-b-seed, txt");
		expect(STAGE_B_DOCUMENT_ROW).toBe("stage-b-seed, txt(,.*)?");
		expect(raw).toContain("composer-attachment-0");
		// 42078247373: PhotoKit ingest is environment-BLOCKED. The Photos grid may
		// appear ONLY as the wrong-picker negative, never as a wait or a tap.
		expect(raw).toContain('"assertNotVisible":{"id":"PXGGridLayout-Info"');
		expect(raw).not.toContain('"visible":{"id":"PXGGridLayout-Info"');
		expect(raw).not.toContain('"tapOn":{"id":"PXGGridLayout-Info"');
		expect(raw).not.toContain("attach-option-library");
		// No coordinate taps anywhere in the attach proof.
		expect(raw).not.toContain("point");
	});
	it("is the flow the coordinator actually queues for attachment-bearing drafts", () => {
		const source = readFileSync(
			new URL("./stage-b-draft-proof.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain('"attach-native-document"');
		expect(source).toContain('"attach-native-document-second"');
		expect(source).not.toContain('flow("attach-native-photo"');
	});

	it("selects the documents row by resource id, settles first, and re-taps once", () => {
		const flow = attachStageBDocument("local");
		const raw = JSON.stringify(flow);
		// The cell's own id, not the text regex: run 42262867379's text tap landed on
		// a label that does not select and the picker stayed open.
		expect(raw).toContain(`"id":"${STAGE_B_DOCUMENT_ROW_ID}"`);
		expect(raw).toContain('"retryTapIfNoChange":false');
		// The transition settles before the tap.
		const settle = raw.indexOf("waitForAnimationToEnd");
		expect(settle).toBeGreaterThan(-1);
		expect(settle).toBeLessThan(
			raw.indexOf(`"id":"${STAGE_B_DOCUMENT_ROW_ID}"`),
		);
		// Exactly one conditional re-tap, gated on the browser still being up.
		expect(raw).toContain('"when":{"visible":{"text":"Browse"}}');
		expect(raw.split(`"id":"${STAGE_B_DOCUMENT_ROW_ID}"`).length - 1).toBe(2);
		// Selection failure is labelled apart from the composer assertion, and the
		// dismissal wait comes before the chip assertion.
		expect(raw).toContain(STAGE_B_DOCUMENT_DISMISS_LABEL);
		expect(raw.indexOf(STAGE_B_DOCUMENT_DISMISS_LABEL)).toBeLessThan(
			raw.indexOf("composer-attachment-0"),
		);
	});
});
