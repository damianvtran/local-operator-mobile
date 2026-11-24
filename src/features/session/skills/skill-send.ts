/**
 * The send side of the `$skill` contract, as pure functions: whether a message
 * asks the relay to expand mentions, and the two sentences its answer can need.
 *
 * Kept apart from `use-composer.ts` (a very large hook) so the rules are testable
 * without a screen, and so the ONE definition of "this send expands" cannot drift
 * between a first send and a retry.
 */
import type { SkillExpansionReceipt } from "@/contracts";
import { t } from "@/i18n";

/** The relay's typed code for an expansion over its body budget (HTTP 422). */
export const SKILLS_TOO_LARGE = "skills_too_large";

/**
 * Whether this send carries `expand_skills: true`.
 *
 * `available` is the capability AND a local conversation (a remote one answers
 * `409 remote_unsupported` to the flag, so it is never sent). `slash` is a
 * parsed slash command, which never expands. A draft with no `$` has nothing to
 * expand, and omitting the flag keeps the body byte-identical to what an older
 * client sends.
 */
export const wantsSkillExpansion = (input: {
	available: boolean;
	text: string;
	slash: boolean;
}): boolean => input.available && !input.slash && input.text.includes("$");

/* LRI…PDI around a technical token: under an RTL layout the Latin `$name` and
 * the commas between names would otherwise reorder (the relay web client does
 * the same with its `isolate`). A runtime ARGUMENT, not catalogue text, so the
 * no-bidi-controls-in-catalogues rule is untouched. */
const isolate = (value: string): string => `\u2066${value}\u2069`;

/**
 * The ONE notice for skills the relay skipped (an empty or unreadable
 * SKILL.md), or `null` when nothing was skipped. The message still went: this
 * describes what it CONTAINS, so the caller clears it on the next edit.
 */
export const skippedSkillsNotice = (
	receipt: SkillExpansionReceipt | undefined,
): string | null => {
	const skipped = receipt?.skipped ?? [];
	if (skipped.length === 0) return null;
	return t("relay.skills.skipped", {
		names: skipped.map((name) => isolate(`$${name}`)).join(", "),
		count: skipped.length,
	});
};

/** The remedy for `422 skills_too_large`: retrying the same draft is refused
 *  again, so the generic retry sentence would point at an action that cannot
 *  work. */
export const skillsTooLargeMessage = (): string => t("relay.skills.too_large");
