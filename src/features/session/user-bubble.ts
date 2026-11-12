import type { ThemeEntry } from "@/ui/tokens.gen";

/**
 * The reader's own message box: ONE definition for the settled row
 * (`transcript-row.tsx`'s `user` arm) and the in-flight copy of the same
 * message (`pending-echo-row.tsx` via `pendingEchoBoxClass`).
 *
 * Kept in a plain module (no `react-native`, no `uniwind`) so a Node test can
 * pin both the class and the native fill.
 *
 * WHY ONE DEFINITION. The pending echo IS the settled message before the
 * daemon echoes it. When the two boxes differed (pending kept `bg-surface` and
 * a hairline after the settled row moved to `bg-user-bubble`), every send
 * changed colour and lost its edge at handover — the jump the pending row's
 * own design rule (round 1, D1) calls a defect. Agent review round 1, M1.
 *
 * A STEER uses this box too, in both states: as an unfilled block it read as
 * bare indented text, not the reader's own message (operator report, iOS
 * 2026-11-11). Prompt and steer differ only in the pending caption.
 */

/** The box's classes. `bg-user-bubble` is the role solved per palette to
 *  >= 1.25:1 off `canvas` with `ink` at the text floor (`design/themes/
 *  derive.mjs`; `palette-rules.mjs` § "the user bubble"). No border and no
 *  accent edge: the fill and the right alignment say whose turn it is. On the
 *  WEB this class is what paints; on native see `userBubbleFill`. */
export const USER_BUBBLE_BOX_CLASS = "rounded-md bg-user-bubble px-3 py-1.5";

/**
 * The bubble's fill as an explicit style, for native.
 *
 * WHY A STYLE AS WELL AS THE CLASS (design review round 1, D1). On the iOS
 * build the operator reported (TestFlight 753 at `aef9b7b2`, Tokyo Night) this
 * box's padding applied but its fill did not: pixels inside the padded box read
 * exactly `canvas`, while the ask bar in the same frame painted `bg-surface`.
 * The cause is NOT proven: uniwind 1.12.0 compiles `bg-surface` and
 * `bg-user-bubble` for native to the same getter shape as the ask bar's (a
 * `vars["--color-…"]` read, Variables + Theme dependencies), the className is a
 * plain space-joined literal, and no `.native` sibling, overlay or Pressable
 * style function touches the box. What is left is the run-time variable read
 * itself, so the fill no longer depends on it: the colour comes straight from
 * the active palette in the generated catalogue — the same entry `ThemeProvider`
 * writes into uniwind — and rides `style.backgroundColor`, which React Native
 * applies after the className's styles. It is the same value the class resolves
 * to whenever the class does paint, so web and native cannot disagree.
 *
 * The reader's palette is passed in rather than read here so this stays a pure
 * function; callers get it from `useTheme().active`.
 */
export const userBubbleFill = (
	palette: Pick<ThemeEntry, "colors">,
): { backgroundColor: string } => ({
	backgroundColor: palette.colors["user-bubble"],
});
