import { type Layout, SPLIT_PANE_WIDTH } from "@/ui/layout";

/**
 * Whether the session's panels (todos, subagents) get a rail beside the
 * transcript.
 *
 * This is the ONE session-specific layout decision, and it is deliberately an
 * expression over `@/ui/layout`'s vocabulary rather than a second policy: the
 * breakpoints, the measures and the pane width all come from the one place D1
 * owns. What is specific to this screen is the *composition* — the panels sit
 * AFTER the transcript, and `SplitView` (which puts its fixed pane first) cannot
 * say that, so the row is written here from their constants.
 *
 * Two conditions, and both are load-bearing:
 *
 *  - `layout.split` — width AND height, so an 844x390 landscape phone stays one
 *    column even though it is wider than a portrait tablet. The keyboard takes
 *    half that height.
 *  - room for a FULL readable measure beside the pane. A rail that eats into the
 *    measure trades the thing the reader came for (the conversation) for a
 *    panel, and the first tablet capture showed exactly that: a 533 pt transcript
 *    beside an 833 pt rail. Where the measure does not fit, the panels stack
 *    INSIDE the capped column instead, which is the other deliberate use of a
 *    tablet's width.
 */
export const panelRail = (layout: Layout): boolean =>
	layout.split &&
	layout.measure !== null &&
	layout.width - SPLIT_PANE_WIDTH >= layout.measure;
