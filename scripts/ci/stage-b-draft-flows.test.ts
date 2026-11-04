import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { STAGE_B_HOST } from "../../src/testing/stage-b-draft-transport";
import { capFor } from "./account-routing-proof-contract";
import {
	assertStageBDraft,
	assertStageBPostReleaseDraft,
	attachStageBPhoto,
	STAGE_B_COLD_ASSERTION_MS,
	STAGE_B_DRAWN_SCREEN,
	STAGE_B_PICKER_BROWSER_ID,
	STAGE_B_PICKER_WAIT_MS,
	STAGE_B_WRONG_PICKER,
	selectStageBComputer,
	stageBFlow,
	stageBHasDrawnScreen,
} from "./stage-b-draft-flows";

const steps = (flow: string): Record<string, unknown>[] =>
	flow
		.split("\n")
		.filter((line) => line.startsWith("- "))
		.map((line) => JSON.parse(line.slice(2)));

describe("Stage B foreground-only Maestro flows", () => {
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
			extendedWaitUntil: { notVisible: { id: "attach-sheet" }, timeout: 15000 },
		});
		expect(picker[1]).toEqual({
			extendedWaitUntil: {
				visible: { id: STAGE_B_PICKER_BROWSER_ID },
				timeout: STAGE_B_PICKER_WAIT_MS,
			},
		});
		expect(picker[2]).toEqual({
			assertNotVisible: { id: "DOC.browsingRoot", label: STAGE_B_WRONG_PICKER },
		});
		expect(picker[3]).toEqual({
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
