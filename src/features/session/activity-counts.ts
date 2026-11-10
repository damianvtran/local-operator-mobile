import type { StatusTrayFacts } from "@/features/session/components/status-tray";
import { t } from "@/i18n";

/**
 * The trailing counts on the ONE activity line above the composer (visual audit
 * D1; the operator: the indicator "sits just above the composer", one line).
 *
 * Tasks and agents were two 36 pt capsules on a 48 pt band of their own, and the
 * queued-message count a third chip on the composer's strip — with the working
 * line that made three bands of chrome between the transcript and the field,
 * 288 of 844 pt at 390 by the audit's measurement. They are counts, so they fold
 * into the working line as glyph + number pairs behind ONE press target that
 * opens the same status sheet both capsules opened.
 *
 * Pure and Node-loadable (no native import), like `statusTraySummary`: the view
 * in `activity-counts.tsx` paints what this returns and a test reads it without
 * rendering.
 */
export type ActivityCount = {
	kind: "tasks" | "agents" | "queued";
	/** The visible reading beside the glyph: `3/5`, `1/6`, `2`. */
	text: string;
	/** The whole fact, for the accessible name — the glyph is not announced. */
	label: string;
};

export const activityCounts = (
	facts: Pick<StatusTrayFacts, "tasks" | "agents"> | null,
	queued: number,
): ActivityCount[] => {
	const counts: ActivityCount[] = [];
	const tasks = facts?.tasks ?? null;
	/* A zero TOTAL is "no list", and absent; a zero numerator is a fact. The
	 *  capsules made the same call. */
	if (tasks !== null && tasks.total > 0) {
		const done = tasks.total - tasks.open;
		counts.push({
			kind: "tasks",
			text: `${done}/${tasks.total}`,
			label: t("relay.chrome.session.tray.tasks", {
				done,
				total: tasks.total,
			}),
		});
	}
	const agents = facts?.agents ?? null;
	if (agents !== null && agents.total > 0)
		counts.push({
			kind: "agents",
			text: `${agents.running}/${agents.total}`,
			label: t("relay.chrome.session.tray.agents", {
				running: agents.running,
				total: agents.total,
			}),
		});
	if (queued > 0)
		counts.push({
			kind: "queued",
			text: String(queued),
			label: t("mobile.chrome.composer.queued", { count: queued }),
		});
	return counts;
};

/** One accessible name for the one target: every fact, in reading order. */
export const activityCountsLabel = (counts: readonly ActivityCount[]): string =>
	counts.map((count) => count.label).join(", ");

/** The glyph's box and its gap to the number, and the gap between pairs, pt. */
export const ACTIVITY_GLYPH_PT = 14;
const PAIR_GAP_PT = 4;
const ITEM_GAP_PT = 12;
/** `text-mono-sm`'s advance at 100 % (12 pt × 0.6 em), as in the chip plan. */
const CHAR_PT = 7.2;

/** The counts' estimated width at a text scale. An estimate for the same
 *  reason `composerChipPlan` uses one: the decision is needed before layout. */
export const activityCountsWidth = (
	counts: readonly ActivityCount[],
	scale: number,
): number =>
	counts.reduce(
		(width, count, index) =>
			width +
			(index > 0 ? ITEM_GAP_PT : 0) +
			ACTIVITY_GLYPH_PT +
			PAIR_GAP_PT +
			Math.ceil(count.text.length * CHAR_PT * scale),
		0,
	);

/**
 * Whether the counts take their own line under the status instead of sharing
 * it. They share whenever the status keeps room for its spinner, a short
 * intent, the clock's reserved `59m 59s` and the Stop; at 320 pt or 200 % text
 * they do not, and squeezing them in is how a label ends up painted over its
 * neighbour (the web audit's U-08) or cut mid-word (U-07). A second line there
 * still costs less than the capsule band it replaces.
 */
export const activityCountsStack = (input: {
	/** The dock's width, pt (the window on a phone). */
	width: number;
	scale: number;
	counts: readonly ActivityCount[];
	touchFloor: number;
}): boolean => {
	if (input.counts.length === 0) return false;
	/* spinner (2) + a 10-character intent + the clock's 7, in mono. */
	const status = Math.ceil((2 + 10 + 7) * CHAR_PT * input.scale);
	const stop = Math.max(
		input.touchFloor,
		Math.ceil(4 * CHAR_PT * input.scale) + 16,
	);
	/* The slot's `px-2` and the row's `px-2`, both sides, and three row gaps. */
	const chrome = 2 * 8 + 2 * 8 + 3 * 8;
	return (
		status + stop + activityCountsWidth(input.counts, input.scale) + chrome >
		input.width
	);
};
