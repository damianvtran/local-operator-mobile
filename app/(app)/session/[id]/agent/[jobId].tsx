import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
	type LayoutChangeEvent,
	Text,
	useWindowDimensions,
	View,
} from "react-native";

import { backToParentLabel } from "@/features/session/back-label";
import { TodosPanel } from "@/features/session/components/todos-panel";
import { TranscriptList } from "@/features/session/components/transcript-list";
import { UserMessageClamp } from "@/features/session/components/user-message-clamp";
import { middleTruncate, projectTodos } from "@/features/session/projection";
import { subagentPromptLayout } from "@/features/session/subagent-prompt";
import { subagentBadge } from "@/features/session/subagent-status";
import { useSessionRuntime } from "@/features/session/use-session";
import {
	type SubagentTranscriptSource,
	useSubagentTranscript,
} from "@/features/session/use-subagent-transcript";
import { BridgeThreadTitle } from "@/features/team-bridge/thread-chrome";
import { t } from "@/i18n";
import { elapsedLabel } from "@/lib/format";
import { CONTROL, EMPTY, SCREEN, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import {
	Badge,
	Button,
	EmptyState,
	IconButton,
	Screen,
	Skeleton,
} from "@/ui/components";
import { BackIcon } from "@/ui/components/back-icon";
import { TOUCH_FLOOR, useCompactChrome } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";

/**
 * A subagent's own view (`docs/ux/flows.md` F-7).
 *
 * **The detail is FETCHED, not read off the roster.** The aggregate projection
 * strips every child's `prompt`, `result_text`, `transcript` and `todos` — they are
 * always empty there — so a screen that rendered the roster's row would draw a
 * plausible, empty child. `GET /api/sessions/{id}/agents/{job}` is what carries
 * them, and the assertion in the drill-down flow is on content only that route has.
 *
 * **The transcript is FETCHED too, and drawn by the main view's list.** A current
 * Core never inlines a child's rows on the detail (Core `mobile/projection.py`:
 * "transcript is intentionally left empty here"); they come from the
 * lineage-checked `GET …/agents/{job}/history`, paged and kept fresh by
 * `useSubagentTranscript` with the main view's own `HistoryWindow`, and drawn by
 * the same `TranscriptList` with the same paging props — so rows, grouping,
 * collapsing, markdown and tool traces are the conversation's, not a copy.
 * Drawing only `detail.transcript` left a 24-minute running child saying it had
 * "no transcript rows of its own" (TestFlight report).
 *
 * **The header is the conversation header's size.** The child's label is the
 * title in `sessionHeaderTitle`'s style (via `BridgeThreadTitle`, the shared
 * drawing of it), with the crumb as its one muted line — the operator called the
 * 28 pt "Subagent" display title "way too large". The crumb names the parent and
 * the child's short job id because the reader arrived by tapping a row in the
 * parent's transcript: "Back" alone would leave them unsure which of several
 * children they are in, and a job id is the only stable name a child has.
 */
export default function Subagent() {
	const { id, jobId } = useLocalSearchParams<{ id: string; jobId: string }>();
	const sessionId = typeof id === "string" ? id : "";
	const childId = typeof jobId === "string" ? jobId : "";
	const router = useRouter();
	const focused = useIsFocused();
	const runtime = useSessionRuntime(sessionId, focused);
	const compact = useCompactChrome();
	const canvas = useTokenColor("canvas");
	const { height: windowHeight } = useWindowDimensions();
	const { effectiveScale } = useTextScale();
	/** The height the pinned prompt and the transcript share, measured, so the
	 *  open prompt can be bounded to leave the transcript its share of the
	 *  window (`subagent-prompt.ts`, D1). Null until the first layout. */
	const [regionHeight, setRegionHeight] = useState<number | null>(null);
	const onRegionLayout = useCallback((event: LayoutChangeEvent) => {
		setRegionHeight(event.nativeEvent.layout.height);
	}, []);
	const promptLayout = subagentPromptLayout({
		windowHeight,
		regionHeight,
		scale: effectiveScale,
		touchFloor: TOUCH_FLOOR,
	});

	const { loadAgent, loadAgentHistory } = runtime;
	/** `null` until the relay endpoints exist (`loadAgentHistory`'s contract), so
	 *  nothing is read — or declared missing — before there is a link. */
	const source = useMemo<SubagentTranscriptSource | null>(
		() =>
			loadAgentHistory === null
				? null
				: {
						loadDetail: () => loadAgent(childId),
						loadPage: (before) => loadAgentHistory(childId, before),
					},
		[loadAgent, loadAgentHistory, childId],
	);
	const view = useSubagentTranscript(`${sessionId}:${childId}`, source);
	const { detail, missing } = view;

	const openAgent = useCallback(
		(job: string) => {
			router.push(`/session/${sessionId}/agent/${job}`);
		},
		[router, sessionId],
	);

	/** The parent's own name, from the projection this route shares with its parent. */
	const parentName =
		runtime.projection?.conversation_name ?? t("mobile.session.fallback_name");
	const todos = useMemo(
		() => projectTodos(detail?.todos ?? []),
		[detail?.todos],
	);

	/** The child's state, as a word AND a tone (`subagent-status.ts`): the badge
	 *  says `unavailable` when the body does, never `loading` (audit D6). */
	const badge = subagentBadge(detail, missing);

	const title =
		detail !== null && detail.label.length > 0
			? detail.label
			: t("mobile.session.subagent.screen_title");
	/* The crumb: parent name, then the child's short id. Truncated in the
	   MIDDLE, so both ends survive at 200 % text — the two ends are what
	   distinguish one child from another. */
	const crumb = `${middleTruncate(parentName, 24)} › ${middleTruncate(childId, 12)}`;

	/* What the list shows with no rows. Only a SUCCESSFUL empty read may say the
	   child has no rows; a 404 with nothing inline says the transcript is not
	   kept; a dropped link offers a retry; a read in flight is a skeleton. A
	   QUEUED child still waiting on its rows says it has not started instead: it
	   can wait for minutes, and a skeleton that long reads as "something is slow"
	   when the truth is "nothing has run yet" (D2). */
	const queuedWait =
		detail?.status === "queued" &&
		(view.state === "loading" || view.state === "unavailable");
	const empty = queuedWait ? (
		<View className="px-4 py-3">
			<Text className="text-body-sm text-ink-dim">
				{t("mobile.session.subagent.queued_next")}
			</Text>
		</View>
	) : view.state === "empty" ? (
		<View className="px-4 py-3">
			<Text className="text-body-sm text-ink-dim">
				{t("mobile.session.subagent.no_rows")}
			</Text>
		</View>
	) : view.state === "unavailable" ? (
		<View className="px-4 py-3">
			<Text className="text-body-sm text-ink-dim">
				{t("mobile.session.subagent.not_kept")}
			</Text>
		</View>
	) : view.state === "failed" ? (
		<View className="gap-2 px-4 py-3">
			<Text
				accessibilityLiveRegion="polite"
				className="text-body-sm text-ink-muted"
			>
				{t("mobile.session.subagent.load_failed")}
			</Text>
			<Button
				label={t("mobile.common.try_again")}
				onPress={view.retry}
				variant="outline"
				testID={CONTROL.subagentRetry}
			/>
		</View>
	) : (
		<View className="px-4 py-3">
			<Skeleton lines={3} testID={SURFACE.subagentLoading} />
		</View>
	);

	/* The child's final answer. At the END of a settled transcript, after the
	   newest row, as in the main view (D3): a reader lands at the newest edge,
	   and as the list's header the answer sat above the OLDEST row, reachable
	   only by paging through everything. It stays the header while there are no
	   rows (not kept, retry), where it is the only thing to read, and while the
	   child still runs. Memoised: the list compares header and footer by
	   identity (`transcript-list.tsx`), so a fresh element per poll would tell
	   it they changed on every tick. */
	const resultText = detail?.result_text ?? "";
	const resultAtEnd = view.state === "rows" && !view.live;
	const result = useMemo(
		() =>
			resultText.length > 0 ? (
				<View
					className={
						resultAtEnd ? "border-t border-hairline px-4 py-2" : "px-4 py-2"
					}
				>
					<Text className="pb-1 text-meta text-ink-dim">
						{t("mobile.session.subagent.result_label")}
					</Text>
					<Text className="text-body-sm text-ink">{resultText}</Text>
				</View>
			) : null,
		[resultText, resultAtEnd],
	);

	return (
		<Screen
			title={title}
			titleNode={<BridgeThreadTitle title={title} subtitle={crumb} />}
			compact={compact}
			testID={SCREEN.subagent}
			// The transcript owns its own scrolling, the same as the parent screen.
			scroll={false}
			headerLeading={
				<IconButton
					accessibilityLabel={backToParentLabel(
						runtime.projection?.conversation_name,
					)}
					testID={CONTROL.subagentBack}
					onPress={() => router.back()}
					icon={({ color, size }) => <BackIcon color={color} size={size} />}
				/>
			}
		>
			<View className="flex-1">
				{/* The status strip under the header (it carried the crumb before the
				    crumb moved into the header's subtitle; the id stays with the
				    strip so the flows that address it still find the child's facts). */}
				<View
					className="border-b border-hairline px-4 pb-1"
					testID={SURFACE.subagentCrumb}
				>
					<View className="flex-row items-center gap-2 pb-1">
						<Badge
							label={badge.label}
							tone={badge.tone}
							testID={SURFACE.subagentStatus}
						/>
						{/* The running marker is a SIBLING of the badge, not the badge's own id, so
						    "this child is running" has ONE name (`SURFACE.subagentRunning`) wherever
						    it is shown — the roster renders it the same way (`subagents-panel.tsx`). */}
						{detail?.status === "running" ? (
							<View testID={SURFACE.subagentRunning} aria-hidden />
						) : null}
						{detail?.elapsed_s !== null && detail?.elapsed_s !== undefined ? (
							<Text className="shrink-0 text-mono-sm text-ink-dim tabular-nums">
								{elapsedLabel(detail.elapsed_s)}
							</Text>
						) : null}
						{/* The child's own metadata: which agent it is, at which effort, on
						    which model. A roster row can only carry the first two. */}
						{detail !== null ? (
							<Text
								className="min-w-0 flex-1 text-meta text-ink-dim"
								numberOfLines={1}
							>
								{[detail.agent, detail.effort, detail.model_label]
									.filter((part) => part.length > 0)
									.join(" · ")}
							</Text>
						) : null}
					</View>
				</View>

				{/* Failure is stated above the transcript, not only in the parent's count
				    (F-7): a reader who drilled into a failed child must not have to go back
				    to learn why it failed. */}
				{detail?.error_text ? (
					<View
						className="border-b border-hairline px-4 py-2"
						testID={SURFACE.subagentError}
					>
						<Text className="text-body-sm text-danger">
							{detail.error_text}
						</Text>
					</View>
				) : null}

				{/* The prompt and the transcript share this region; measuring it is
				    what lets the open prompt leave the transcript its share (D1). */}
				<View className="min-h-0 flex-1" onLayout={onRegionLayout}>
					{/* The child's prompt, which the roster strips. Clamped with the
				    transcript's own Show more / Show less (`UserMessageClamp`), but
				    to three lines and, open, inside a bounded scroller with Show less
				    below it: pinned chrome on a screen that does not scroll, so a
				    long brief must never push the transcript off it
				    (`subagent-prompt.ts`, D1). */}
					{detail !== null && detail.prompt.length > 0 ? (
						<View
							className="border-b border-hairline px-4 py-2"
							testID={SURFACE.subagentPrompt}
						>
							<Text className="pb-1 text-meta text-ink-dim">
								{t("mobile.session.subagent.prompt_label")}
							</Text>
							<UserMessageClamp
								fadeColor={canvas}
								lines={promptLayout.collapsedLines}
								expandedMaxHeight={promptLayout.expandedMaxHeight}
							>
								<Text className="text-body-sm text-ink-muted">
									{detail.prompt}
								</Text>
							</UserMessageClamp>
						</View>
					) : null}

					{missing && detail === null ? (
						<EmptyState
							headline={t("mobile.session.subagent.unavailable_headline")}
							next={t("mobile.session.subagent.unavailable_next")}
							testID={EMPTY.subagent}
						/>
					) : detail === null ? (
						<View className="px-4 py-3">
							<Skeleton lines={3} testID={SURFACE.subagentLoading} />
						</View>
					) : (
						<TranscriptList
							sessionId={`${sessionId}:${childId}`}
							entries={view.entries}
							// The main view's paging props, from the main view's reader
							// (`HistoryWindow`): older pages load on scroll to the top, and a
							// failed newest refresh is retried at the newest edge. Absent while
							// the rows are an older Core's inline fallback, which has no
							// journal behind it to page.
							loadOlder={view.paging?.loadOlder}
							hasOlder={view.paging?.hasOlder}
							loadingOlder={view.paging?.loadingOlder}
							historyError={view.paging?.historyError ?? null}
							historyErrorScope={view.paging?.historyErrorScope ?? null}
							retryHistory={view.paging?.retryHistory}
							healHistory={view.paging?.healHistory}
							historyGap={view.paging?.historyGap}
							historyGapBefore={view.paging?.historyGapBefore ?? null}
							streamingRowId={null}
							onOpenAgent={openAgent}
							// A child's run state is its status, not a stream: a running or
							// queued child keeps its turn open; a settled one condenses.
							turnLive={view.live}
							testID={SURFACE.subagentTranscript}
							header={resultAtEnd ? null : result}
							footer={resultAtEnd ? result : null}
							empty={empty}
						/>
					)}
				</View>

				<TodosPanel
					todos={todos}
					// Expanded by default HERE, unlike on the parent: this screen exists to
					// show one child's work, and there is no conversation beneath it to
					// protect from a list that opens.
					open
					onToggle={() => undefined}
					heldShut={false}
					testID={SURFACE.subagentTodos}
				/>
			</View>
		</Screen>
	);
}
