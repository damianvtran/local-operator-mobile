import { describe, expect, it } from "vitest";

import {
	compactElapsedLabel,
	countLabel,
	elapsedLabel,
	homeShortened,
} from "@/lib/format";

describe("compact working clock (relay parity)", () => {
	it.each([
		[0, "0s"],
		[59, "59s"],
		[60, "1m"],
		[64, "1m4s"],
		[1470, "24m30s"],
		[3599, "59m59s"],
		[3600, "1h"],
		[86399, "23h59m"],
		[86400, "1d"],
		[99 * 86400 + 23 * 3600, "99d23h"],
		[100 * 86400, "100d+"],
		[Number.MAX_VALUE, "100d+"],
	] as const)("formats %s into six unbroken cells", (seconds, label) => {
		expect(compactElapsedLabel(seconds)).toBe(label);
		expect(label.length).toBeLessThanOrEqual(6);
		expect(label).not.toContain(" ");
	});
	it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
		"withholds invalid age %s",
		(seconds) => {
			expect(compactElapsedLabel(seconds)).toBe("");
		},
	);
});

describe("homeShortened", () => {
	it("shortens a path under the home directory", () => {
		expect(
			homeShortened("/Users/damian/Development/app", "/Users/damian"),
		).toBe("~/Development/app");
	});

	it("leaves a path outside home alone", () => {
		expect(homeShortened("/srv/app", "/Users/damian")).toBe("/srv/app");
	});

	it("does not shorten a sibling whose name merely starts with home's", () => {
		// `/Users/damianother` is not under `/Users/damian`, and a naive prefix test
		// would render it as `~other`.
		expect(homeShortened("/Users/damianother/app", "/Users/damian")).toBe(
			"/Users/damianother/app",
		);
	});

	it("renders the home directory itself as a tilde", () => {
		expect(homeShortened("/Users/damian", "/Users/damian")).toBe("~");
	});
});

describe("countLabel", () => {
	it("singularises one", () => {
		expect(countLabel(1, "agent")).toBe("1 agent");
		expect(countLabel(2, "agent")).toBe("2 agents");
		expect(countLabel(0, "agent")).toBe("0 agents");
	});

	it("takes an irregular plural from the caller", () => {
		expect(countLabel(2, "todo")).toBe("2 todos");
		expect(countLabel(1, "todo")).toBe("1 todo");
	});
});

describe("elapsedLabel", () => {
	it("keeps seconds under a minute", () => {
		expect(elapsedLabel(0)).toBe("0s");
		expect(elapsedLabel(59)).toBe("59s");
	});

	it("zero-pads the seconds once minutes appear, so the width stops jittering", () => {
		expect(elapsedLabel(64)).toBe("1m 04s");
		expect(elapsedLabel(60)).toBe("1m 00s");
	});

	it("never renders a PREFIX of a longer duration", () => {
		// The client's own bug: `59m 59s` rendered as `59m`, which is still a valid
		// duration, so nothing looked wrong.
		expect(elapsedLabel(3599)).toBe("59m 59s");
		expect(elapsedLabel(3599)).not.toBe("59m");
	});

	it("rolls into hours with padded minutes", () => {
		expect(elapsedLabel(7200)).toBe("2h 00m");
		expect(elapsedLabel(7620)).toBe("2h 07m");
	});

	it("never renders a negative duration", () => {
		expect(elapsedLabel(-5)).toBe("0s");
	});
});
