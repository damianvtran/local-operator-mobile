import { describe, expect, it } from "vitest";

import type { SlashCommand } from "@/contracts";
import {
	argumentHint,
	filterCommands,
	parseSlashDraft,
	slashQuery,
	slashTap,
	tapFillsOnly,
} from "@/features/session/slash";

/**
 * The slash rules that have actually changed behaviour underneath a client.
 *
 * Only the decisions are asserted — the trigger, the ranking, and what a tap does —
 * because those are the three that have produced a defect. A test per exported
 * function would double this file and prove nothing extra.
 */

const command = (
	name: string,
	overrides: Partial<SlashCommand> = {},
): SlashCommand => ({
	name,
	description: `${name} does a thing`,
	aliases: [],
	arguments: "none",
	...overrides,
});

const catalogue: SlashCommand[] = [
	command("rename", {
		description: "Rename this conversation",
		arguments: "required",
	}),
	command("review", {
		description: "Review the working tree",
		arguments: "optional",
	}),
	command("resume", { description: "Resume a past conversation" }),
	command("cost", { description: "Show spend" }),
];

describe("the slash trigger", () => {
	it("fires only on a leading slash, and only on one line", () => {
		expect(slashQuery("/re")).toBe("re");
		expect(slashQuery("/rename my session")).toBe("rename");
		// A slash inside a sentence is prose, and a multi-line draft is never a command.
		expect(slashQuery("see /re")).toBeNull();
		expect(slashQuery("/re\nmore")).toBeNull();
		expect(slashQuery("")).toBeNull();
	});

	it("takes only the first word as the filter, and the rest as the argument", () => {
		expect(parseSlashDraft("/rename my session")).toEqual({
			command: "rename",
			args: "my session",
		});
		expect(parseSlashDraft("/cost")).toEqual({ command: "cost", args: "" });
		expect(parseSlashDraft("not a command")).toBeNull();
	});
});

describe("filtering is a ranked subsequence match", () => {
	it("finds a command by the letters a thumb can spare", () => {
		// The web client's substring test misses this, which is the improvement the
		// flow asks for rather than a divergence.
		const names = filterCommands(catalogue, "rn").map(
			(row) => row.command.name,
		);
		expect(names).toContain("rename");
	});

	it("ranks a name match above a description match", () => {
		// A reader typing two characters means the verb. A description match exists only
		// so an empty result is rare, and it must never outrank the name.
		const focused: SlashCommand[] = [
			command("inspect", { description: "cost estimate for the turn" }),
			command("cost", { description: "show the spend" }),
		];
		expect(
			filterCommands(focused, "cost").map((row) => row.command.name),
		).toEqual(["cost", "inspect"]);
	});

	it("drops a command that matches nowhere, rather than padding the list", () => {
		// `review` has no `r-e-s` subsequence: the letters are not there, so a reader
		// typing `res` must not see it. (`rename` does match, via the `s` in its own
		// description; that is the fallback tier being modestly useful.)
		const names = filterCommands(catalogue, "res").map(
			(row) => row.command.name,
		);
		expect(names[0]).toBe("resume");
		expect(names).not.toContain("review");
	});

	it("keeps the catalogue's own order when nothing is typed", () => {
		// The relay ranks its own commands; re-sorting an unsearched list throws that
		// answer away.
		expect(
			filterCommands(catalogue, "").map((row) => row.command.name),
		).toEqual(["rename", "review", "resume", "cost"]);
	});
});

describe("what a tap does is a property of the catalogue", () => {
	it("fills and waits for a command that takes text", () => {
		for (const args of ["required", "optional"] as const) {
			expect(tapFillsOnly(args)).toBe(true);
			expect(slashTap(command("x", { arguments: args }))).toEqual({
				fill: "/x ",
				submit: false,
			});
		}
	});

	it("runs a command that takes none", () => {
		expect(slashTap(command("cost"))).toEqual({ fill: "/cost", submit: true });
	});

	it("hints the one case where a row waits for text", () => {
		expect(argumentHint(command("x", { arguments: "required" }))).toBe("…");
		expect(argumentHint(command("x", { arguments: "optional" }))).toBeNull();
	});
});
