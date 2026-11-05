import { composerOuterGap } from "@/ui/device-corner";

/** The field's own painted box at 100 % text: the 44 pt touch floor. */
export const COMPOSER_FIELD_BOX = 44;
/** The record's gap between the expanded field and its controls row. */
export const COMPOSER_CONTROLS_GAP = 4;
/** Where the record's heights come from, so a test can assert the arithmetic
 *  rather than a class name: rest 6 + 44 + 6 = 56; expanded 12 + 44 + 4 + 44 +
 *  8 = 112. A change to either padding has to keep these sums true. */
export const composerShellPadding = (expanded: boolean) =>
	expanded ? { top: 12, bottom: 8 } : { top: 6, bottom: 6 };
export const composerPaintedHeight = (expanded: boolean) => {
	const pad = composerShellPadding(expanded);
	return expanded
		? pad.top +
				COMPOSER_FIELD_BOX +
				COMPOSER_CONTROLS_GAP +
				COMPOSER_FIELD_BOX +
				pad.bottom
		: pad.top + COMPOSER_FIELD_BOX + pad.bottom;
};
/** Build389 presentation only: never derives auth or modifies draft content. */
export type ComposerPresentationFacts = {
	focused: boolean;
	draft: string;
	attachments: number;
	dictation: boolean;
	stop: boolean;
	error: boolean;
	keyboard: boolean;
	inset: number;
	scale: number;
};
/** Clearance is outside the shell; one radius applies to all corners. Whitespace
 * is still a draft, so geometry must never normalize the reader's content. */
export const composerPresentation = (facts: ComposerPresentationFacts) => {
	const expanded =
		facts.focused ||
		facts.draft.length > 0 ||
		facts.attachments > 0 ||
		facts.dictation ||
		facts.stop ||
		facts.error;
	const idleHeight = Math.max(56, Math.ceil(24 * facts.scale + 24));
	return {
		expanded,
		height: expanded
			? composerPaintedHeight(true)
			: Math.max(idleHeight, composerPaintedHeight(false)),
		radius: expanded ? 24 : idleHeight / 2,
		gap: composerOuterGap(facts.inset, facts.keyboard),
		side: 12,
	};
};
export const keyboardOverlap = (hostBottom: number, keyboardTop: number) =>
	Math.max(0, hostBottom - keyboardTop);
