/**
 * The one fence rule, where a module without a renderer can read it.
 *
 * `markdown.tsx` is the renderer and imports `react-native`, so anything that has
 * to ask "does this text contain a fenced block" from OUTSIDE a component — the
 * session view's state marker (`state-marker.ts`), and the rig that boots the mock
 * relay per scenario and checks which markers a frame would carry — cannot import
 * it without dragging a renderer in. Splitting the rule out is what keeps one
 * definition rather than a second spelling of the fence in the derivation.
 *
 * The pattern is the renderer's own, moved verbatim: `parseMarkdown` uses it both
 * to open a block and to find a paragraph's end, so a fence this does not match is
 * a fence the transcript does not draw either.
 */
export const FENCE = /^\s*```\s*([A-Za-z0-9_+-]*)\s*$/;

/** Whether a document carries a fenced block, which is what "a rich row" means:
 *  the rows that own the copy control (`docs/e2e/README.md` § the audit). A tool
 *  row or an image is a different kind of row and a different claim. */
export const hasFencedBlock = (text: string): boolean =>
	text.split("\n").some((line) => FENCE.test(line));
