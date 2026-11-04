import { describe, expect, it } from "vitest";
import { STAGE_B_HOST } from "../../src/testing/stage-b-draft-transport";
import { capFor } from "./account-routing-proof-contract";
import {
	STAGE_B_COLD_ASSERTION_MS,
	STAGE_B_DRAWN_SCREEN,
	selectStageBComputer,
	stageBFlow,
} from "./stage-b-draft-flows";

const DRAWN_SCREEN = new RegExp(`^${STAGE_B_DRAWN_SCREEN}$`);
const steps = (flow: string): Record<string, unknown>[] =>
	flow
		.split("\n")
		.filter((line) => line.startsWith("- "))
		.map((line) => JSON.parse(line.slice(2)));

describe("Stage B foreground-only Maestro flows", () => {
	it.each([
		{ evidence: [] },
		{ evidence: [{ assertVisible: { id: "composer-input" } }] },
	])(
		"foregrounds without restart or data reset before any supplied evidence steps: %j",
		({ evidence }) => {
			const generated = stageBFlow(evidence);
			const commands = steps(generated);
			expect(commands[0]).toEqual({ launchApp: { stopApp: false } });
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
			"welcome-screen",
			"home-screen",
			"composer-input",
			`computer-row-${STAGE_B_HOST}`,
		])
			expect(DRAWN_SCREEN.test(id)).toBe(true);
		for (const label of [
			"SpringBoard",
			"Stage B Draft Proof",
			"maestro-driver-iosUITests-Runner",
			`computer-row-${STAGE_B_HOST.replaceAll(".", "x")}`,
		])
			expect(DRAWN_SCREEN.test(label)).toBe(false);
	});
});
