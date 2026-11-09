import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sessionProjectionSchema } from "../../src/contracts/schemas.ts";
import {
	activityWaitProjection,
	chromeProofPlan,
	collectChromeFrames,
	LANE_FRAMES,
	LANES,
} from "./chrome-ios-proof-contract.ts";

describe("chrome proof plan (record §7)", () => {
	it("fails missing-driver setup before boot and proves PATH in a token-free environment", () => {
		const workflow = readFileSync(
			new URL("../../.github/workflows/e2e.yml", import.meta.url),
			"utf8",
		);
		const job = workflow.split("\n  chrome-ios-proof:\n")[1] ?? "";
		const step =
			job
				.split("Provision the existing pinned Maestro driver")[1]
				?.split("Download and verify the already-built artifacts")[0] ?? "";
		const lines = step.split("\n").map((line) => line.trim());
		const check = lines.find((line) => line.startsWith("test -x "));
		const command = lines.find((line) => line.startsWith("env -i PATH="));
		expect(check).toBeTruthy();
		expect(command).toBeTruthy();
		const root = mkdtempSync(join(tmpdir(), "chrome-driver-"));
		try {
			const environment = {
				PATH: "/usr/bin:/bin",
				HOME: root,
				// Keep the child synthetic while satisfying the shared ProcessEnv contract.
				NODE_ENV: "test" as const,
				RUNNER_TEMP: root,
				JAVA_HOME: "/synthetic-java",
				GH_TOKEN: "synthetic-must-not-leak",
			};
			const run = () =>
				spawnSync("/bin/bash", ["-c", `${check} && ${command}`], {
					env: environment,
					encoding: "utf8",
					timeout: 1000,
				});
			expect(run().status).toBe(1);
			const bin = join(root, ".maestro", "bin");
			mkdirSync(bin, { recursive: true });
			const driver = join(bin, "maestro");
			writeFileSync(
				driver,
				'#!/bin/sh\nif [ -n "${GH_TOKEN+x}" ]; then exit 9; fi\nprintf "2.11.0\\n"\n',
			);
			chmodSync(driver, 0o700);
			const result = run();
			expect(result.status).toBe(0);
			expect(result.stdout.trim()).toBe("2.11.0");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("uses a valid busy wait frame and preserves the source fixture", () => {
		const source = sessionProjectionSchema.parse(
			JSON.parse(
				readFileSync(
					new URL(
						"../../fixtures/relay/synthetic/sse-projection-every-entry-kind.json",
						import.meta.url,
					),
					"utf8",
				),
			).data,
		);
		const before = JSON.stringify(source);
		const frame = activityWaitProjection(source);
		expect(sessionProjectionSchema.safeParse(frame).success).toBe(true);
		expect(frame.streaming).toBe(true);
		expect(frame.activity).toBe("Waiting for review");
		expect(frame.activity_started_s).toBe(1470);
		expect(frame.transcript.at(-1)).toMatchObject({
			kind: "tool",
			tool_name: "wait",
			tool_state: "running",
			intent: "Waiting for review",
			final: false,
		});
		expect(JSON.stringify(source)).toBe(before);
		expect(() => activityWaitProjection({ ...source, transcript: [] })).toThrow(
			"activity fixture has no tool row",
		);
	});
	it("keeps the original default matrix and scopes activity diagnosis to one phone", () => {
		expect(chromeProofPlan(false).lanes).toBe(LANES);
		expect(chromeProofPlan(false).frames).toBe(LANE_FRAMES);
		const focused = chromeProofPlan(true);
		expect(focused.lanes.map((lane) => lane.id)).toEqual(["d3-17pro-dark"]);
		expect(focused.frames).toEqual(["session", "session-keyboard"]);
	});
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
