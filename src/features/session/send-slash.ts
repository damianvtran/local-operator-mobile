import { COMPOSER_COPY } from "@/features/session/composer";
import { isRelayError, type RelayEndpoints } from "@/relay";

/**
 * One slash command, sent — with the three effects a send has, and nothing else.
 *
 * This exists because the tap path is a send: the row the reader taps runs a
 * command, and it must be indistinguishable from typing `/help` and pressing the
 * primary. Written inline in the composer's tap handler it was none of those
 * things: `void endpoints.command(...)` with no in-flight flag (so a double tap
 * sent it twice), no `catch` (so a refusal carrying a code the client is supposed
 * to decide on became an unhandled rejection with no surface), and no draft clear
 * — which on this screen is also what dismisses the sheet, since the sheet's
 * visibility IS the draft (`slashQuery(draft) !== null`).
 *
 * The effects are injected rather than closed over so this stays a plain module:
 * the composer is a hook inside a component, and the RN renderer cannot be loaded
 * by the test runner (react-native's Flow source is not parseable), so a send
 * that only exists inside that hook cannot be tested at all. The seam that
 * carries the draft is the one worth testing.
 *
 * `client` is narrowed to `command` on purpose: this function decides about ONE
 * request's lifecycle, and nothing here should grow the ability to make a second.
 */
export type SlashSendInput = {
	client: Pick<RelayEndpoints, "command">;
	sessionId: string;
	/** The command to run, already derived from the catalogue entry (`slashTapRequest`). */
	request: { command: string; args: string };
	/** The state the composer owns; a send reports into it and keeps no copy. */
	effects: {
		setSending: (sending: boolean) => void;
		setError: (message: string | null) => void;
		setDraft: (draft: string) => void;
		/** The caller's synchronous in-flight guard, released however this ends. */
		released?: () => void;
	};
};

/** `true` when the command was admitted, `false` when it was refused or unreachable. */
export const sendSlashCommand = async (
	input: SlashSendInput,
): Promise<boolean> => {
	const { effects } = input;
	effects.setSending(true);
	effects.setError(null);
	try {
		await input.client.command(input.sessionId, {
			op: "slash",
			command: input.request.command,
			args: input.request.args,
		});
		/* Clearing the draft is what closes the sheet: `SlashSheet`'s `visible` is
		 * `slashQuery(draft) !== null`, and its `onClose` is a no-op. A refused
		 * command therefore keeps the draft, and with it the sheet and the row the
		 * reader can try again. */
		effects.setDraft("");
		return true;
	} catch (failure) {
		effects.setError(
			isRelayError(failure)
				? failure.displayableMessage
				: COMPOSER_COPY.continuationError,
		);
		return false;
	} finally {
		/* Always, which is the half that makes a second tap safe: the disable is on
		 * the primary and on this path's own control, so it must not latch. The ref
		 * is released in the same breath, or the composer would latch instead. */
		effects.released?.();
		effects.setSending(false);
	}
};
