import { createContext, useContext, useRef } from "react";

import {
	type AskChipFact,
	askChipSignature,
} from "@/features/session/ask-chip";

/**
 * What the prose renderer needs from the session screen to draw an ask-id chip.
 *
 * WHY A CONTEXT AND NOT A PROP. The chip is drawn inside `Markdown`, several
 * layers under the transcript row, and the transcript row is memoised on its own
 * content: threading "the session's asks" and "open the sheet at this ask"
 * through that tree would put a sheet's callback into every row's props and
 * re-render the whole column whenever the queue moved. A context lets the one
 * component that draws a chip subscribe, and nothing else.
 */
export interface AskChipHost {
	/** THIS session's asks, by id — the only set a chip may resolve against,
	 *  because the runtime only guarantees ids are unique per session. */
	facts: ReadonlyMap<string, AskChipFact>;
	/** Open the asks sheet on this ask (the BARE `ask_id` the sheet's rows are
	 *  keyed by), expanding it. */
	open: (askId: string) => void;
}

export const AskChipHostContext = createContext<AskChipHost | null>(null);

/**
 * Whether this surface draws chips at all.
 *
 * SEPARATE FROM THE HOST because it is read by the prose component itself: a
 * surface with no ask queue (a notification body, a Bridge message rendered
 * through the same renderer) must draw the agent's id as ordinary text, exactly
 * as it did before, rather than as a control that can do nothing. A boolean
 * changes at most once per mount, so reading it does not re-render prose when
 * the queue moves.
 */
export const AskChipDrawnContext = createContext(false);

export const useAskChipHost = (): AskChipHost | null =>
	useContext(AskChipHostContext);

/**
 * The host a screen passes to `AskChipHostContext.Provider`, memoised on what a
 * chip can READ rather than on the map's identity.
 *
 * WHY. The facts map is rebuilt on every projection frame (the frame is the live
 * reading), and a provider whose value changed that often would re-render every
 * chip in the transcript on every token — work whose result cannot differ. The
 * signature is the map's content (`askChipSignature`), so a frame that leaves
 * every id's state unchanged keeps the same value object and the chips do not
 * re-render. A plain `useMemo` cannot express this: the cache key is not a value
 * the callback uses, and only a render-phase memo keyed on the signature is both
 * honest and lint-clean.
 */
export const useAskChipHostValue = (
	facts: ReadonlyMap<string, AskChipFact>,
	open: (askId: string) => void,
): AskChipHost => {
	const signature = askChipSignature(facts as Map<string, AskChipFact>);
	const held = useRef<{
		signature: string;
		open: unknown;
		host: AskChipHost;
	} | null>(null);
	const current = held.current;
	if (
		current !== null &&
		current.signature === signature &&
		current.open === open
	)
		return current.host;
	const host: AskChipHost = { facts, open };
	held.current = { signature, open, host };
	return host;
};

export const askChipsDrawn = (): boolean => useContext(AskChipDrawnContext);
