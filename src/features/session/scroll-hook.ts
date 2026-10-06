/**
 * The web-target harness hook for the transcript's scroll ANCHOR — the
 * `lo-scroll` query value a capture cell may set.
 *
 * WHY IT EXISTS. A session cell's settled frame lands at the TAIL: the list
 * follows new content while the reader is at the bottom, which is the reader's
 * behaviour and the one a fresh navigation ends in. But a long conversation's
 * SHAPE — what conversation condensing looks like, the summary bars themselves —
 * lives at its TOP, and the tail of such a conversation is the ACTIVE turn, the
 * one turn the collapse never touches. The harness drives no scroll gestures
 * (the gap `S5/scroll` was retired under: "a scroll position is a viewport
 * interaction the wire cannot declare"), so the app exposes the one position a
 * still needs and nothing else: `top` renders the list at its first row and
 * never follows the tail. No gestures, no synthetic input — and an installed
 * build reads nothing, because `location` there is not a web page.
 *
 * Same convention as `lo-recorder`/`lo-dictation` (`stt/recorder.ts`,
 * `stt/dictation-hook.ts`): a URL may steer the harness's PAGE and never the
 * installed app. The explicit platform guard is theirs too: resting "inert on a
 * device" on `location` being undefined is an implicit rule where this file's
 * siblings state one.
 */

import { Platform } from "react-native";

/** The anchors a cell may pin. `top` is the state a settled frame cannot show. */
export type ScrollAnchor = "top";

/** The anchor a `lo-scroll` value names, or `null` for absent or unknown. */
export function scrollAnchorFromValue(
	value: string | null,
): ScrollAnchor | null {
	return value === "top" ? "top" : null;
}

/** The anchor this page carries, or `null` when it is not a web page. */
export function scrollAnchorFromHook(): ScrollAnchor | null {
	if (Platform.OS !== "web") return null;
	if (typeof location === "undefined") return null;
	return scrollAnchorFromValue(
		new URLSearchParams(location.search).get("lo-scroll"),
	);
}
