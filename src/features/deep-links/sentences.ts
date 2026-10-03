/**
 * The two sentences the deep-link resolver may put in front of a reader.
 *
 * Both are ADR-mandated shapes, kept here as functions rather than at call
 * sites so the design round has one place to reword them and the tests one
 * place to read them:
 *
 * - the unknown-handle sentence is ADR 0006 §6.6 verbatim — a conversation the
 *   computer no longer knows lands on the sidebar "with one honest sentence"
 *   and no error state;
 * - the unreachable sentence follows §6.4's contract shape (the designer owns
 *   the final wording; this is the placeholder the PR carries until then),
 *   and says what the reader is looking at rather than what went wrong
 *   internally.
 *
 * `<computer>` is the app's own name for the machine (the connected computer's
 * name), or `THIS_COMPUTER` when it has none — never an opaque handle, which
 * names nothing a reader could act on.
 */

/** The label used when the app cannot name the computer it is addressing. */
export const THIS_COMPUTER = "this computer";

/** ADR 0006 §6.6, verbatim. */
export const unknownConversationNote = (computer: string): string =>
	`That conversation isn't on ${computer} any more.`;

/** ADR 0006 §6.4's shape — "…couldn't reach <computer>; here are your
 *  conversations." (final wording by the design round). */
export const unreachableComputerNote = (computer: string): string =>
	`Couldn't reach ${computer}; here are your conversations.`;
