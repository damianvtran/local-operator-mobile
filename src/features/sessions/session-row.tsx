import { memo } from "react";
import type { SessionSummary } from "@/contracts";
import { avatarRefOf } from "@/features/agent-avatar/agent-avatar";
import { AgentListRow } from "@/features/agent-avatar/agent-avatar-view";
import {
	attentionWord,
	isRemoteRow,
	relativeTimeFor,
	remoteAttention,
	remoteDeviceLabel,
} from "@/features/sessions/session-projection";
import { SessionTagLine } from "@/features/sessions/tag-line";
import { tagAnnouncement } from "@/features/sessions/tags";
import { homeShortened } from "@/lib/format";
import {
	remoteSessionRowId,
	sessionRowAvatarId,
	sessionRowId,
	sessionTagLineId,
} from "@/ui/a11y";

export type SessionRowProps = {
	session: SessionSummary;
	/** The sidebar section the row sits in (`buildItems`): a Running row shows
	 *  no relative time, because "running" already is its time. */
	section: string;
	selected: boolean;
	/** The pane's minute clock, so relative times age without a frame. */
	now: number;
	/** Some row in this list has a picture; see `AgentListRow.reserveLeading`. */
	reserveLeading: boolean;
	surfaceClassName?: string;
	homeDirectory?: string | null;
	tagsAssignable: boolean;
	/** STABLE across renders (the pane hands out ref-backed callbacks): an
	 *  inline closure here would defeat the memo this component exists for. */
	onActivate: (session: SessionSummary) => void;
	onLongPress: (session: SessionSummary) => void;
};

/**
 * One conversation row of the sidebar, memoised on the SESSION's identity.
 *
 * WHY THIS IS A COMPONENT AND NOT THE PANE'S INLINE `renderItem` (perf audit
 * P11). The relay re-sends the whole sessions list on every list frame, and the
 * pane re-renders for reasons no row cares about (search text, a sheet opening,
 * the minute clock, the inbox count). Inline, each of those re-rendered every
 * mounted row — avatar hook, tag line and status glyph included. Two things now
 * hold a frame to the rows that changed:
 *
 *  1. the list store keeps an unchanged session's OBJECT across frames
 *     (`reuseSessions`, `state/list-store.ts`), so `session` is identical;
 *  2. every other prop is a primitive or a stable callback, so `memo`'s default
 *     shallow compare bails.
 *
 * `session-row-renders.test.ts` counts renders behind this memo and fails if
 * either half is removed.
 *
 * A remote row (a session on a paired device, PR-C3) is NOT a `SessionSummary`
 * with defaults: read through the list schema it looks like an idle local one,
 * which is why every live field below is branched on the row's kind rather than
 * read through the default.
 *
 * The model id is deliberately NOT passed to the row any more (visual audit
 * D11): "anthropic/claude-opus-5" on every line was the widest, least
 * distinguishing thing in the list. The folder stays — it is what tells two
 * similarly named conversations apart.
 */
export const SessionRow = memo(function SessionRow({
	session,
	section,
	selected,
	now,
	reserveLeading,
	surfaceClassName,
	homeDirectory,
	tagsAssignable,
	onActivate,
	onLongPress,
}: SessionRowProps) {
	const remote = isRemoteRow(session);
	const tagged = (session.tags?.length ?? 0) > 0;
	return (
		<AgentListRow
			selected={selected}
			selectedIndicator
			avatarRef={avatarRefOf(session)}
			avatarTestID={sessionRowAvatarId(session.session_id)}
			reserveLeading={reserveLeading}
			surfaceClassName={surfaceClassName}
			title={session.conversation_name.trim() || "untitled"}
			cwd={
				remote
					? undefined
					: homeDirectory
						? homeShortened(session.cwd, homeDirectory)
						: session.cwd
			}
			time={
				section === "running"
					? undefined
					: (relativeTimeFor(session, now) ?? undefined)
			}
			pending={
				remote ? remoteAttention(session) !== null : session.needs_attention
			}
			attentionWord={attentionWord(session)}
			streaming={remote ? session.live_state === "busy" : session.streaming}
			unread={session.unseen}
			ended={session.ended === true}
			degraded={
				remote ? session.live_state === "wedged" : session.degraded === true
			}
			subagentCount={session.subagents_running ?? 0}
			remote={
				remote
					? {
							device: remoteDeviceLabel(session),
							reachable: session.reachable !== false,
							indicatorTestID: remoteSessionRowId(session.session_id),
						}
					: undefined
			}
			onPress={() => onActivate(session)}
			onLongPress={() => onLongPress(session)}
			longPressAccessibilityHint={
				remote
					? "Move or copy"
					: tagsAssignable
						? "Pin, tag, or open"
						: "Pin or open"
			}
			/* Read-only on a remote row: its tags live in the other device's
			 *  store, and this phone has no route to write them. Today the relay
			 *  sends `[]` for one, so the line is absent — the branch exists so a
			 *  future relay that projects them renders them rather than silently
			 *  dropping a fact. */
			tagLine={
				tagged ? (
					<SessionTagLine
						tags={session.tags ?? []}
						testID={sessionTagLineId(session.session_id)}
						/* The ROW announces its tags as one label; the line itself
						 *  must not be a second stop (D4/Q2). */
						announce={false}
					/>
				) : undefined
			}
			tagAnnouncement={tagged ? tagAnnouncement(session.tags ?? []) : undefined}
			testID={sessionRowId(session.session_id)}
		/>
	);
});
