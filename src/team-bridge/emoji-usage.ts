/**
 * Per-account emoji usage behind the quick-reaction row (`frequentEmoji`).
 *
 * WHY PER ACCOUNT. Two people sharing a phone, or one person with two Radient
 * accounts, must not see each other's habits; the desktop partitions the same
 * way (`useReactionPreferences`, keyed by account).
 *
 * WHAT IT HOLDS. Emoji keys and decayed scores only — never message ids,
 * labels or bodies — recorded only after the hub confirmed an ADD.
 *
 * LIFECYCLE (mirrors `thread-drafts.ts` and `last-target.ts`, deliberately):
 * in memory, wiped synchronously by the store's `retire()` and `reset()`, so
 * nothing crosses an authentication boundary. A cold launch therefore starts
 * from the quick set again. Cross-launch memory is a follow-up that needs its
 * own account-scoped erase path (the reason `last-target.ts` gives); the spec
 * asked for "persisted", and this is recorded as a deviation in PR b.
 */
import {
	type EmojiUsage,
	frequentEmoji,
	recordEmojiUsage,
} from "@/team-bridge/reactions";

const usage = new Map<string, EmojiUsage>();

export function recordTeamBridgeEmoji(
	accountId: string | null,
	emoji: string,
	now: number,
): void {
	if (!accountId) return;
	usage.set(
		accountId,
		recordEmojiUsage(usage.get(accountId) ?? {}, emoji, now),
	);
}

/** The quick row for this account: ranked usage topped up from the quick set.
 *  Read when the sheet renders, so a confirmed add shows on the next open. */
export function teamBridgeFrequentEmoji(
	accountId: string | null,
	now: number,
): string[] {
	return frequentEmoji((accountId && usage.get(accountId)) || {}, now);
}

export function clearTeamBridgeEmoji(): void {
	usage.clear();
}
