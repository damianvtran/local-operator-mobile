/** Actual fixed regions, measured on their existing hosts. `before` is the
 * pending wrapper's column-relative y AFTER the transcript is collapsed; it
 * includes Find/panels/cues without measuring hidden duplicate controls. */
export type RecoveryFacts = Partial<
	Record<
		"column" | "before" | "after" | "composer" | "header" | "controls",
		number
	>
>;
export const PENDING_BODY_MIN_PT = 56;
// Recovery spends less on optional frame padding, never on text or hit targets:
// 2px top/bottom + the existing 1px border on each side. Horizontal padding stays.
export const RECOVERY_FRAME_PADDING = 2;
const FRAME_CHROME = RECOVERY_FRAME_PADDING * 2 + 2;
const WRAPPER_BOTTOM = 4;
export function recoveryBudget(facts: RecoveryFacts): {
	kind: "unmeasured" | "infeasible" | "fit";
	body: number;
	card?: number;
} {
	const { column, before, after, composer, header, controls } = facts;
	if (
		column === undefined ||
		before === undefined ||
		after === undefined ||
		composer === undefined ||
		header === undefined ||
		controls === undefined ||
		[column, before, after, composer, header, controls].some(
			(value) => !Number.isFinite(value) || value < 0,
		) ||
		column === 0 ||
		composer === 0 ||
		header === 0 ||
		controls === 0
	)
		return { kind: "unmeasured", body: PENDING_BODY_MIN_PT };
	const card = column - before - after - composer - WRAPPER_BOTTOM;
	const body = card - header - controls - FRAME_CHROME;
	// Never turn an impossible floor into a claimed fit by clamping it. In that
	// case no root maxHeight is imposed: required controls aren't silently clipped.
	return body < PENDING_BODY_MIN_PT
		? { kind: "infeasible", body: PENDING_BODY_MIN_PT }
		: { kind: "fit", body, card };
}
