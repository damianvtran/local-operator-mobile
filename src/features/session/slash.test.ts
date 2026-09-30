import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { SlashCommand } from "@/contracts";
import {
	argumentHint,
	filterCommands,
	parseSlashDraft,
	slashQuery,
	slashTap,
	slashTapRequest,
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

/**
 * The relay's own catalogue, committed as a fixture: 46 commands, 24 of which take
 * no argument and therefore run on a tap (`fixtures/relay/http/commands.json`).
 * Read from the fixture rather than hand-written here, because the class that broke
 * is defined by the CATALOGUE, not by this file's idea of it.
 */
const CATALOGUE: SlashCommand[] = JSON.parse(
	readFileSync(
		fileURLToPath(
			new URL("../../../fixtures/relay/http/commands.json", import.meta.url),
		),
		"utf8",
	),
).body.commands;

describe("a tap sends the command it named, never the token typed so far (Q1)", () => {
	const runsImmediately = CATALOGUE.filter((c) => c.arguments === "none");

	it("covers the class that broke: every no-argument command in the relay's catalogue", () => {
		expect(runsImmediately.length).toBe(24);
		expect(CATALOGUE.length).toBe(46);
	});

	it("sends the WHOLE command for every one of them", () => {
		// The defect: the reader types `/he`, the sheet filters, they tap `/help`, and
		// the request on the wire carried `command: "he"` — the partial token — because
		// the send path re-parsed the draft ref, which React had assigned during the
		// render that preceded the tap.
		for (const entry of runsImmediately) {
			const request = slashTapRequest(entry);
			expect(request, entry.name).toEqual({
				command: entry.name,
				args: "",
			});
			// And explicitly not the prefix a reader would have typed to reach the row.
			const typedSoFar = `/${entry.name}`.slice(0, 3);
			expect(request?.command, entry.name).not.toBe(
				typedSoFar.replace("/", ""),
			);
		}
	});

	it("sends nothing for a command that takes text: that tap only fills the field", () => {
		for (const entry of CATALOGUE.filter((c) => c.arguments !== "none")) {
			expect(slashTapRequest(entry), entry.name).toBeNull();
			expect(slashTap(entry).submit, entry.name).toBe(false);
		}
	});

	it("is derived from the command, so the token typed so far cannot reach the wire", () => {
		// The claim is about the REQUEST, not about determinism: the draft the reader
		// had typed (`/he`) parses to a different command than the row they tapped, and
		// only one of the two is what a tap sends. (An earlier version of this case
		// compared `slashTapRequest(help)` with `slashTapRequest(help)` — the same call
		// with the same argument, which passes for any implementation and proved
		// nothing; review round 2, F3a.)
		const help = CATALOGUE.find((c) => c.name === "help");
		expect(help).toBeDefined();
		if (help === undefined) return;
		const tapped = slashTapRequest(help);
		const typed = parseSlashDraft("/he");
		expect(typed).toEqual({ command: "he", args: "" });
		expect(tapped).toEqual({ command: "help", args: "" });
		expect(tapped).not.toEqual(typed);
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
