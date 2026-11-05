import { composerOuterGap } from "@/ui/device-corner";
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
		height: expanded ? 112 : idleHeight,
		radius: expanded ? 24 : idleHeight / 2,
		gap: composerOuterGap(facts.inset, facts.keyboard),
		side: 12,
	};
};
export const keyboardOverlap = (hostBottom: number, keyboardTop: number) =>
	Math.max(0, hostBottom - keyboardTop);
