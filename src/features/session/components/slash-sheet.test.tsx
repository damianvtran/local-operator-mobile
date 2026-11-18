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

	it("names the filter field in sentence case for both its label and placeholder", () => {
		const html = render();
		expect(html).toContain('placeholder="Filter commands"');
		expect(html).toContain('aria-label="Filter commands"');
	});

	it("titles the sheet in Title case", () => {
		expect(render()).toContain('data-title="Commands"');
	});
});
