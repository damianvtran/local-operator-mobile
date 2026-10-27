import { Pressable, Text, View } from "react-native";

import { CONTROL, ROLE } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";

/**
 * The session's secondary status, folded into ONE row (design D2).
 *
 * The screen used to stack four persistent bands above the composer — a context
 * strip, the live working line, the task list and the subagent roster — and on a
 * phone the stack was clipped mid-row by a share of the window, with a text cue
 * doing the explaining. A reader lost the transcript to chrome they had already
 * read, and the cut fell wherever the arithmetic landed rather than at a boundary
 * they chose.
 *
 * The row is the whole of it now: a summary a reader can scan, and a control that
 * opens the SAME panels in a sheet, where they can be as tall as their content
 * because nothing else is competing for the column. Counts are never removed —
 * the tray says how many, and the sheet shows which.
 *
 * Urgent states do not go in here: a pending approval or an outstanding ask keeps
 * its own pinned surface adjacent to the composer (`PendingCard`, `AskBar`),
 * because a question that needs an answer must not be one tap deeper than the
 * answer's own control.
 */
export type StatusTrayFacts = {
	/** The live activity verb, when a turn is running. */
	working: string | null;
	/** Open tasks out of the projected total, when the session has a task list. */
	tasks: { open: number; total: number } | null;
	/** Running subagents out of the roster, when there is a roster. */
	agents: { running: number; total: number } | null;
	/** The context reading the strip used to paint, already abbreviated. */
	context: string | null;
};

/**
 * The one line the tray paints, derived from the facts rather than assembled in
 * the view: a capture cell and the sheet's own header both read this string, so
 * the row cannot claim a different count from the panel it opens.
 *
 * Order is the reader's: what is happening now, then what is left to do, then
 * who is doing it, then the meter. Absent facts are omitted entirely — a zero
 * count is a fact about the session, but a blank placeholder is only noise.
 */
export const statusTraySummary = (facts: StatusTrayFacts): string => {
	const parts: string[] = [];
	if (facts.working !== null && facts.working.trim() !== "")
		parts.push(facts.working.trim());
	if (facts.tasks !== null && facts.tasks.total > 0)
		parts.push(`${facts.tasks.open}/${facts.tasks.total} tasks`);
	if (facts.agents !== null && facts.agents.total > 0)
		parts.push(`${facts.agents.running}/${facts.agents.total} agents`);
	if (facts.context !== null) parts.push(facts.context);
	return parts.length === 0 ? "" : parts.join(" · ");
};

/** Whether anything would be in the tray. An empty tray is not rendered at all:
 *  a row saying nothing costs the transcript a line and tells no story. */
export const statusTrayHasFacts = (facts: StatusTrayFacts): boolean =>
	statusTraySummary(facts) !== "";

export const StatusTray = ({
	facts,
	onOpen,
}: {
	facts: StatusTrayFacts;
	onOpen: () => void;
}) => {
	const summary = statusTraySummary(facts);
	if (summary === "") return null;
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			/* The name is the summary itself: a reader hears the same counts the
			 *  row paints, rather than a bare "status" that hides them behind a
			 *  second gesture. */
			accessibilityLabel={`${summary} — show status`}
			accessibilityHint="Opens the working line, tasks and subagents"
			onPress={onOpen}
			testID={CONTROL.sessionStatusTray}
			style={{ minHeight: TOUCH_FLOOR }}
			className="flex-row items-center gap-2 px-4"
		>
			<Text
				className="min-w-0 flex-1 text-body-sm text-ink-muted"
				numberOfLines={1}
				ellipsizeMode="tail"
			>
				{summary}
			</Text>
			<View pointerEvents="none">
				<Text className="text-body-sm text-ink-dim" aria-hidden>
					›
				</Text>
			</View>
		</Pressable>
	);
};
