import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SlashCommand } from "@/contracts";
import { resetLocaleSource, setLocaleSource } from "@/i18n";
import { slashCommandId } from "@/ui/a11y";
import { SlashSheet } from "./slash-sheet";

/**
 * The slash sheet's drawn body, rendered by react-native-web's server renderer.
 *
 * Only the shared `Sheet` is replaced: its Modal portal draws nothing in a
 * static render. The stand-in keeps what this suite asserts on — the title and
 * the children — and counts nothing else, so the rows, the filter and the
 * status lines are the real component's.
 */
vi.mock("@/ui/components", () => ({
	Sheet: ({ title, children }: { title: string; children: ReactNode }) =>
		createElement("section", { "data-title": title }, children),
}));

const command = (name: string, description: string): SlashCommand => ({
	name,
	description,
	aliases: [],
	arguments: "none",
});

const LONG =
	"Summarise the conversation so far and replace the older turns with the summary, keeping the latest instruction";

const render = (
	extra: Partial<Parameters<typeof SlashSheet>[0]> = {},
): string =>
	renderToStaticMarkup(
		createElement(SlashSheet, {
			visible: true,
			onClose: () => {},
			commands: [command("compact", LONG), command("clear", "Start fresh")],
			query: "",
			onPick: () => {},
			...extra,
		}),
	);

/** The markup of one command row, from its testID to the next row. */
const rowOf = (html: string, name: string): string => {
	const start = html.indexOf(`data-testid="${slashCommandId(name)}"`);
	expect(start).toBeGreaterThan(-1);
	return html.slice(start, html.indexOf("data-testid=", start + 12));
};

/** The class list of the View that directly wraps the mono command name. */
const ROW_AROUND_NAME =
	/<View className="([^"]*)">\s*<Text className="[^"]*font-mono/;
const FLEX_ROW = /(^|\s)flex-row(\s|$)/;

beforeEach(() => setLocaleSource(() => "en"));
afterEach(() => resetLocaleSource());

describe("SlashSheet", () => {
	it("lets a description wrap past one line, capped at three", () => {
		const row = rowOf(render(), "compact");
		expect(row).toContain(LONG);
		/* react-native-web draws `numberOfLines={1}` as a single `nowrap` line with
		 *  an ellipsis — how "Summarise the conversation so…" lost its point — and
		 *  a larger count as a WebKit line clamp of that count. */
		expect(row).not.toContain("r-whiteSpace-");
		expect(row).toContain("-webkit-line-clamp:3");
	});

	it("has no scroller of its own inside the sheet's scroller", () => {
		/* The Sheet's body already scrolls and is capped at the detent; a nested
		 *  same-axis ScrollView is a second, unmarked scroll region (and does not
		 *  scroll at all on Android without `nestedScrollEnabled`). */
		expect(render()).not.toContain("r-WebkitOverflowScrolling-");
	});

	it("states loading and no-match in sentence case from the catalogue", () => {
		expect(render({ loading: true, commands: [] })).toContain(">Loading<");
		expect(render({ query: "zzz" })).toContain(">No matching commands<");
	});

	it("says the read failed instead of claiming nothing matched", () => {
		const html = render({ commands: [], failed: true });
		expect(html).toContain(
			">Couldn’t load commands from your computer. Reopen this conversation to try again.<",
		);
		expect(html).not.toContain("No matching commands");
	});

	it("keeps held rows on screen while the catalogue is re-read", () => {
		const html = render({ loading: true });
		expect(html).toContain('data-testid="slash-command-compact"');
		expect(html).not.toContain(">Loading<");
	});

	it("puts the description on its own line under the command name", () => {
		/* Design review round 1, D1: beside the name, a wrapped description hung
		 *  at whatever x the name ended (11 different indents at 390 pt), and at
		 *  320 pt / 200 % a long name left it a 52 pt column (QA Q2). Stacked,
		 *  every description shares the name's leading edge and the full width.
		 *  The server renderer drops the layout classes, so this reads the row's
		 *  own class list from source. */
		const source = readFileSync(
			fileURLToPath(new URL("./slash-sheet.tsx", import.meta.url)),
			"utf8",
		);
		const row = source.match(ROW_AROUND_NAME);
		expect(row?.[1]).toBeDefined();
		expect(row?.[1]).not.toMatch(FLEX_ROW);
	});

	it("names the filter field in sentence case for both its label and placeholder", () => {
		const html = render();
		expect(html).toContain('placeholder="Filter commands"');
		expect(html).toContain('aria-label="Filter commands"');
	});

	it("titles the sheet in Title case", () => {
		expect(render()).toContain('data-title="Commands"');
	});
});
