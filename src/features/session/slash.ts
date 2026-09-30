/**
 * Slash commands: the trigger, the filter, and what a tap does.
 *
 * Three rules, each of which the shipped web client learned the hard way, kept
 * here as pure functions so the sheet cannot drift from the composer:
 *
 * 1. **The trigger is a leading `/` on a single line.** `slashQuery` returns
 *    `null` for anything else, and `null` is what closes the sheet. The web
 *    client's shape, kept: a `/` in the middle of a sentence is prose, and a
 *    multi-line draft is never a command.
 * 2. **A tap either fills or runs, and which one is a property of the CATALOGUE,
 *    not of the row.** `tapFillsOnly` reads the command's own `arguments` field:
 *    a command that takes text fills the composer and waits, because running it
 *    with no argument is not what the reader meant. The web client needed a test
 *    for exactly this after the backend moved `/goal` and `/loop` from `none` to
 *    `optional` and their taps silently changed behaviour under a remote field.
 * 3. **Filtering is a subsequence match, ranked.** The catalogue is long and the
 *    phone's keyboard is small, so `/rn` must find `/rename`; the web client's
 *    substring test does not, which is the improvement here rather than a
 *    divergence (`docs/ux/flows.md` F-6.8 asks for fuzzy filtering by name).
 *    Substring matches always outrank sparse subsequences, so the ranking is a
 *    superset of the old behaviour: nothing that used to match stops matching.
 *
 * No React, no React Native.
 */

import type { SlashCommand } from "@/contracts";

/**
 * The token after a leading `/`, lower-cased, or `null` when the draft is not a
 * slash draft.
 *
 * Only the first word is the filter: `/rename my session` filters on `rename`
 * and the rest is the argument, which is why the space is a boundary rather than
 * part of the query.
 */
export const slashQuery = (text: string): string | null => {
	if (!text.startsWith("/")) return null;
	if (text.includes("\n")) return null;
	const space = text.indexOf(" ");
	return (space === -1 ? text.slice(1) : text.slice(1, space)).toLowerCase();
};

/**
 * Whether a tap on this command's row only fills the composer.
 *
 * `arguments !== "none"` means "a space opens a value list", and that is exactly
 * the question a tap asks.
 */
export const tapFillsOnly = (
	argumentsField: SlashCommand["arguments"],
): boolean => argumentsField !== "none";

/** What a tap on a command row does to the draft, and whether it submits. */
export const slashTap = (
	command: SlashCommand,
): { fill: string; submit: boolean } =>
	tapFillsOnly(command.arguments)
		? { fill: `/${command.name} `, submit: false }
		: { fill: `/${command.name}`, submit: true };

/**
 * The request a tap on a command row SENDS, or `null` when the tap only fills.
 *
 * This exists so the send path cannot be derived from the DRAFT. The tap fills the
 * field and submits in one gesture, and a send reads the draft through a ref that
 * React assigns during render — so at that moment it still holds the text from
 * before the tap, and re-parsing it sent the token the reader had typed so far
 * (`/he`) instead of the command they tapped (`/help`). 24 of the relay's 46
 * commands take no argument and are therefore in that class. Deriving the request
 * from the COMMAND removes the draft from the question entirely (QA round 1, Q1).
 */
export const slashTapRequest = (
	command: SlashCommand,
): { command: string; args: string } | null => {
	const tap = slashTap(command);
	if (!tap.submit) return null;
	const parsed = parseSlashDraft(tap.fill);
	return parsed === null
		? null
		: { command: parsed.command, args: parsed.args };
};

/**
 * The visible argument hint, or `null`.
 *
 * `…` for a command that requires one, echoing the web client: it is the one
 * mark that tells the reader this row waits for text instead of running. An
 * OPTIONAL argument gets no mark — most of the catalogue takes one, so marking
 * them all is noise, and the fill-and-wait behaviour is itself the hint.
 */
export const argumentHint = (command: SlashCommand): string | null =>
	command.arguments === "required" ? "…" : null;

/**
 * Parse a draft into the `slash` op's two fields, or `null` when this is not a
 * command at all.
 *
 * The caller must ALSO check for attachments before routing here: a `/foo` caption
 * with an image is a prompt with a slash in it, not a command (the web client's
 * rule), and that decision needs the images, which are not part of the text.
 */
export const parseSlashDraft = (
	text: string,
): { command: string; args: string } | null => {
	const query = slashQuery(text);
	if (query === null) return null;
	const space = text.indexOf(" ");
	return {
		command: query,
		args: space === -1 ? "" : text.slice(space + 1),
	};
};

/* ------------------------------------------------------------------ the filter */

export interface RankedCommand {
	command: SlashCommand;
	/** Higher is better. Exposed so a test can pin the ORDER, not just the set. */
	score: number;
}

/** Fold a name for matching: `/` and the separators are not part of the word. */
const fold = (value: string): string =>
	value.toLowerCase().replace(/[-_/\s]/g, "");

/**
 * Subsequence match with a contiguity bonus.
 *
 * Returns a 0..1 quality where 1 is a run of adjacent characters, or `null` when
 * `needle` is not a subsequence of `hay` at all. Adjacency is what separates
 * `/rename` from a scattered match: both are subsequences of `r-e-n-a-m-e`, and
 * only one of them is the word the reader typed.
 */
const subsequence = (needle: string, hay: string): number | null => {
	if (needle.length === 0) return 1;
	let index = 0;
	let runs = 0;
	let previous = -2;
	for (const character of needle) {
		const found = hay.indexOf(character, index);
		if (found === -1) return null;
		if (found === previous + 1) runs += 1;
		previous = found;
		index = found + 1;
	}
	return 0.5 + 0.5 * (runs / needle.length);
};

/**
 * Score one command against a query, or `null` when it does not match.
 *
 * The tiers are ordered so that a match on the command's own NAME always beats a
 * match on its prose: a reader typing two characters means the verb, and a
 * description match is a fallback that only exists so an empty result is rare.
 */
export const scoreCommand = (
	command: SlashCommand,
	query: string,
): number | null => {
	if (query.length === 0) return 0;
	const name = command.name.toLowerCase();
	const foldedName = fold(command.name);
	const foldedQuery = fold(query);
	const aliases = command.aliases.map((alias) => alias.toLowerCase());
	const description = command.description.toLowerCase();

	if (name === query) return 1000;
	if (aliases.some((alias) => alias === query)) return 950;
	if (name.startsWith(query)) return 900 - name.length / 100;
	if (aliases.some((alias) => alias.startsWith(query)))
		return 850 - name.length / 100;
	if (name.includes(query)) return 800 - name.indexOf(query);
	if (aliases.some((alias) => alias.includes(query))) return 750;
	const folded = subsequence(foldedQuery, foldedName);
	if (folded !== null) return 500 + 100 * folded;
	if (description.includes(query)) return 300;
	if (subsequence(foldedQuery, fold(description)) !== null) return 100;
	return null;
};

/**
 * The sheet's rows: matching commands, best first.
 *
 * An empty query keeps the catalogue's OWN order (the relay ranks it), the same
 * rule as the model list: re-sorting an unsearched list throws away an answer the
 * server already gave. Ties keep catalogue order too, via a stable sort.
 */
export const filterCommands = (
	commands: SlashCommand[],
	query: string,
): RankedCommand[] => {
	const trimmed = query.trim();
	if (trimmed.length === 0) {
		return commands.map((command) => ({ command, score: 0 }));
	}
	const scored: RankedCommand[] = [];
	for (const command of commands) {
		const score = scoreCommand(command, trimmed);
		if (score !== null) scored.push({ command, score });
	}
	return scored.sort((a, b) => b.score - a.score);
};
