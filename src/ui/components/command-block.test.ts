import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
	COMPUTER_COMMANDS,
	TUNNEL_COMMANDS,
} from "@/features/auth/tunnel-commands";
import { CommandBlock } from "@/ui/components/command-block";

/**
 * M3 S2b-1: the copy control's and the command text's test IDs used to be slugged
 * from the human LABEL (`tunnel-copy-${slug(label)}`). The slug alphabet is
 * `[a-z0-9]`, so once the labels are translated a zh-CN, ru, ur or hi label
 * collapses to `tunnel-copy--` and every block on the screen shares one ID — a
 * flow (or an assistive-tech audit) can then reach only the first. The IDs now
 * come from each command's stable, never-translated `id`.
 *
 * The labels below are STAND-INS: real values from each locale's own
 * `mobile.computers` catalogue, one distinct value per block, because the step
 * labels themselves are not translated yet. What matters is the script they are
 * written in, not their meaning.
 */
vi.mock("expo-clipboard", () => ({ setStringAsync: async () => true }));
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000",
	useKeyboardAppearance: () => "default",
}));

const TEST_ID_ATTR = /data-testid="([^"]*)"/g;
const ID_SHAPE = /^(tunnel-copy|command)-[a-z0-9]+(-[a-z0-9]+)*$/;
const COMMAND_BLOCK_TAG = /<CommandBlock\b[^>]*>/gs;
const ID_PROP = /\bid="([a-z0-9-]+)"/;

const LOCALES = ["en", "fr", "es", "zh-CN", "ru", "vi", "ur", "hi"] as const;

/** The three blocks the Radient set-up screen shows (`setup-computer.tsx`). */
const SETUP_IDS = ["terminal", "tui", "attach"] as const;

const standInLabels = (locale: string, count: number): string[] => {
	const catalogue = JSON.parse(
		readFileSync(`src/i18n/catalogues/${locale}/mobile.computers.json`, "utf8"),
	) as Record<string, string>;
	const values = [...new Set(Object.values(catalogue))].filter(
		(value) => !value.includes("{") && value.length < 40,
	);
	expect(values.length).toBeGreaterThanOrEqual(count);
	return values.slice(0, count);
};

const testIdsOf = (
	blocks: readonly { id: string; command: string }[],
	labels: readonly string[],
): string[] => {
	const markup = renderToStaticMarkup(
		h(
			"div",
			null,
			blocks.map((block, index) =>
				h(CommandBlock, {
					key: block.id,
					id: block.id,
					label: labels[index] ?? "",
					command: block.command,
				}),
			),
		),
	);
	return [...markup.matchAll(TEST_ID_ATTR)].map((match) => match[1] ?? "");
};

describe("CommandBlock test IDs do not depend on the translated label", () => {
	const ownTunnel = [...COMPUTER_COMMANDS, ...TUNNEL_COMMANDS];
	const setup = SETUP_IDS.map((id) => ({ id, command: `lop ${id}` }));

	for (const locale of LOCALES) {
		it(`${locale}: every copy and command ID on the own-tunnel and set-up screens is unique and non-empty`, () => {
			for (const blocks of [ownTunnel, setup]) {
				const labels = standInLabels(locale, blocks.length);
				const ids = testIdsOf(blocks, labels);
				// Two IDs per block: the copy button and the command text.
				expect(ids).toHaveLength(blocks.length * 2);
				expect(new Set(ids).size).toBe(ids.length);
				for (const id of ids) {
					expect(id).toMatch(ID_SHAPE);
				}
			}
		});
	}

	it("the English IDs the screens shipped with are unchanged", () => {
		const ids = testIdsOf(
			ownTunnel,
			ownTunnel.map((block) => block.label),
		);
		expect(ids.filter((id) => id.startsWith("tunnel-copy-"))).toEqual([
			"tunnel-copy-install-on-the-computer",
			"tunnel-copy-or-run-it-in-the-foreground",
			"tunnel-copy-check-it",
			"tunnel-copy-set-or-rotate-the-password",
			"tunnel-copy-cloudflare",
			"tunnel-copy-ngrok",
		]);
	});

	it("every CommandBlock on the set-up screen names its stable id", () => {
		const source = readFileSync("src/features/auth/setup-computer.tsx", "utf8");
		const blocks = source.match(COMMAND_BLOCK_TAG) ?? [];
		expect(blocks).toHaveLength(SETUP_IDS.length);
		expect(blocks.map((block) => ID_PROP.exec(block)?.[1])).toEqual([
			...SETUP_IDS,
		]);
	});
});
