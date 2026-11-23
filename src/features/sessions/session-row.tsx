import { memo } from "react";
import { Text } from "react-native";
import type { SessionSummary } from "@/contracts";
import { avatarRefOf } from "@/features/agent-avatar/agent-avatar";
import { AgentListRow } from "@/features/agent-avatar/agent-avatar-view";
import { useLocaleFrame } from "@/features/auth/connection-provider";
import { useOutboxPhase } from "@/features/session/outbox";
import {
	attentionWord,
	isRemoteRow,
	relativeTimeFor,
	remoteAttention,
	remoteDeviceLabel,
} from "@/features/sessions/session-projection";
import type { SidebarBasis } from "@/features/sessions/sidebar-view";
import { SessionTagLine } from "@/features/sessions/tag-line";
import { tagAnnouncement } from "@/features/sessions/tags";
import { t } from "@/i18n";
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
	/** The clock the row's time reads — the drawer's own `basis`, so the label
	 *  and the section it sits in are readings of one clock. Defaults to the
	 *  desktop's default, `active`. */
	basis?: SidebarBasis;
	/** Some row in this list has a picture; see `AgentListRow.reserveLeading`. */
	reserveLeading: boolean;
	surfaceClassName?: string;
	homeDirectory?: string | null;
	tagsAssignable: boolean;
	/** STABLE across renders (the pane hands out ref-backed callbacks): an
	 *  inline closure here would defeat the memo this component exists for. */
	onActivate: (session: SessionSummary) => void;
	/** Absent where the row has no menu to open (the home's work list: the
	 *  drawer's menu is state of the pane, which Home does not own). The row then
	 *  neither handles nor announces a long press. */
	onLongPress?: (session: SessionSummary) => void;
	/** Title lines (default 1). Only the home's work list passes 2 at large
	 *  text; the drawer passes nothing, so its rows are unchanged. */
	titleLines?: 1 | 2;
	/** Leave the folder line out (default shown). Only the home's work list
	 *  passes false, at the largest text; the row's approval word stays. */
	showFolder?: boolean;
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
	basis = "active",
	reserveLeading,
	surfaceClassName,
	homeDirectory,
	tagsAssignable,
	onActivate,
	onLongPress,
	titleLines,
	showFolder = true,
}: SessionRowProps) {
	/* A late backend language frame must repaint this row's keyed copy (PR #302
	 *  R1/Q2): the "new" marker, the count chips and their accessible names, and
	 *  the tag announcement all come from `t()`, which reads the locale at call
	 *  time but cannot re-render a mounted row. The `memo` above bails on every
	 *  pane render whose props did not move, so without this subscription the old
	 *  language stayed until the pane's minute tick changed `now` (up to 60 s).
	 *  Subscribing HERE, not in the pane, keeps the memo intact for every other
	 *  reason a frame arrives: only a language change re-renders the rows. The
	 *  value is unused on purpose — the subscription IS the fix (`useLocaleFrame`,
	 *  connection-provider.tsx; proved by `session-row-locale-frame.test.tsx`). */
	useLocaleFrame();
	const remote = isRemoteRow(session);
	const tagged = (session.tags?.length ?? 0) > 0;
	/* The outbox indicator (`outbox.ts`): a send this phone is still delivering
	 *  to this conversation, so leaving it never hides that the message has not
	 *  landed yet. A primitive subscription, so only THIS row re-renders when
	 *  its phase moves — the memo above still holds for every other row. */
	const outboxPhase = useOutboxPhase(session.session_id);
	/* `discarding`: the reader already dismissed it; no list line. */
	const outboxWords =
		outboxPhase === null || outboxPhase === "discarding"
			? undefined
			: outboxPhase === "failed"
				? t("mobile.sidebar.outbox_failed")
				: t("mobile.sidebar.outbox_sending");
	const outboxLine =
		outboxWords === undefined ? undefined : (
			<Text
				className={
					outboxPhase === "failed"
						? "text-meta text-danger"
						: "text-meta text-ink-dim"
				}
				numberOfLines={1}
				/* Folded into the row's one label below, like the tags. */
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
			>
				{outboxWords}
			</Text>
		);
	const tags = tagged ? tagAnnouncement(session.tags ?? []) : undefined;
	return (
		<AgentListRow
			selected={selected}
			selectedIndicator
			avatarRef={avatarRefOf(session)}
			avatarTestID={sessionRowAvatarId(session.session_id)}
			reserveLeading={reserveLeading}
			surfaceClassName={surfaceClassName}
			title={session.conversation_name.trim() || "untitled"}
			titleLines={titleLines}
			cwd={
				remote || !showFolder
					? undefined
					: homeDirectory
						? homeShortened(session.cwd, homeDirectory)
						: session.cwd
			}
			time={
				section === "running"
					? undefined
					: (relativeTimeFor(session, now, basis) ?? undefined)
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
			onLongPress={onLongPress ? () => onLongPress(session) : undefined}
			longPressAccessibilityHint={
				onLongPress === undefined
					? undefined
					: remote
						? t("mobile.remote_sessions.row_long_press_hint")
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
				tagged || outboxLine ? (
					<>
						{outboxLine}
						{tagged ? (
							<SessionTagLine
								tags={session.tags ?? []}
								testID={sessionTagLineId(session.session_id)}
								/* The ROW announces its tags as one label; the line itself
								 *  must not be a second stop (D4/Q2). */
								announce={false}
							/>
						) : null}
					</>
				) : undefined
			}
			tagAnnouncement={
				[outboxWords, tags].filter(Boolean).join(", ") || undefined
			}
			testID={sessionRowId(session.session_id)}
		/>
	);
});
