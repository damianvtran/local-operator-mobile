import { useSyncExternalStore } from "react";
import type { ComposerCompaction } from "@/features/session/composer-compaction";

const noSubscribe = () => () => {};
const never = () => false;

/** The compaction signal's one boolean, as React state. Absent signal (Home, a
 *  host with no transcript to scroll) is "never shrunk". The signal fires only on
 *  a flip, so this re-renders the Composer twice per gesture and nothing else. */
export function useComposerShrunk(
	compaction: ComposerCompaction | undefined,
): boolean {
	return useSyncExternalStore(
		compaction ? compaction.subscribe : noSubscribe,
		compaction ? compaction.readShrunk : never,
		never,
	);
}
