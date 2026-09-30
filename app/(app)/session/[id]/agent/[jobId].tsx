import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import type { SubagentDetail } from "@/contracts";
import { TodosPanel } from "@/features/session/components/todos-panel";
import { TranscriptList } from "@/features/session/components/transcript-list";
import { middleTruncate, projectTodos } from "@/features/session/projection";
import { useSessionRuntime } from "@/features/session/use-session";
import { elapsedLabel } from "@/lib/format";
import { SCREEN } from "@/ui/a11y";
import {
	Badge,
	EmptyState,
	IconButton,
	Screen,
	Skeleton,
} from "@/ui/components";

/**
 * A subagent's own view (`docs/ux/flows.md` F-7).
 *
 * **The detail is FETCHED, not read off the roster.** The aggregate projection
 * strips every child's `prompt`, `result_text`, `transcript` and `todos` — they are
 * always empty there — so a screen that rendered the roster's row would draw a
 * plausible, empty child. `GET /api/sessions/{id}/agents/{job}` is what carries
 * them, and the assertion in the drill-down flow is on content only that route has.
 *
 * The crumb names the parent and the child's short job id because the reader arrived
 * by tapping a row in the parent's transcript: "Back" alone would leave them
 * unsure which of several children they are in, and a job id is the only stable
 * name a child has.
 */
export default function Subagent() {
	const { id, jobId } = useLocalSearchParams<{ id: string; jobId: string }>();
	const sessionId = typeof id === "string" ? id : "";
	const childId = typeof jobId === "string" ? jobId : "";
	const router = useRouter();
	const runtime = useSessionRuntime(sessionId);

	const [detail, setDetail] = useState<SubagentDetail | null>(null);
	const [missing, setMissing] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setMissing(false);
		runtime
			.loadAgent(childId)
			.then((loaded) => {
				if (cancelled) return;
				setDetail(loaded);
				// A `null` detail is either a transport failure or a child the daemon no
				// longer has; both read the same to the reader, and inventing a difference
				// they cannot act on would be noise.
				setMissing(loaded === null);
			})
			.catch(() => {
				if (!cancelled) setMissing(true);
			});
		return () => {
			cancelled = true;
		};
	}, [runtime.loadAgent, childId]);

	/** The parent's own name, from the projection this route shares with its parent. */
	const parentName = runtime.projection?.conversation_name ?? "session";
	const todos = useMemo(
		() => projectTodos(detail?.todos ?? []),
		[detail?.todos],
	);

	/** The child's state, as a word AND a tone: colour alone would be an audit
	 *  failure (`U-03`), so every state carries its own text. */
	const statusTone =
		detail?.status === "failed"
			? "danger"
			: detail?.status === "completed"
				? "success"
				: detail?.status === "running" || detail?.status === "queued"
					? "info"
					: "neutral";

	return (
		<Screen
			title="Subagent"
			testID={SCREEN.subagent}
			// The transcript owns its own scrolling, the same as the parent screen.
			scroll={false}
			headerLeading={
				<IconButton
					accessibilityLabel={`Back to ${parentName}`}
					onPress={() => router.back()}
					icon={({ color, size }) => <ArrowLeft color={color} size={size} />}
				/>
			}
		>
			<View className="flex-1">
				{/* The crumb: parent name, then the child's short id. Truncated in the
				    MIDDLE, so both ends survive at 200 % text — the two ends are what
				    distinguish one child from another. */}
				<View
					className="border-b border-hairline px-4 pb-1"
					testID="subagent-detail-crumb"
				>
					<Text className="text-meta text-ink-dim" numberOfLines={1}>
						{middleTruncate(parentName, 24)} › {middleTruncate(childId, 12)}
					</Text>
					<View className="flex-row items-center gap-2 pb-1">
						<Text
							className="min-w-0 flex-1 text-body font-medium text-ink"
							numberOfLines={1}
						>
							{detail?.label ?? childId}
						</Text>
						<Badge
							label={detail?.status ?? "loading"}
							tone={statusTone}
							testID={
								detail?.status === "running"
									? "subagent-status-running"
									: "subagent-detail-status"
							}
						/>
						{detail?.elapsed_s !== null && detail?.elapsed_s !== undefined ? (
							<Text className="shrink-0 text-mono-sm text-ink-dim tabular-nums">
								{elapsedLabel(detail.elapsed_s)}
							</Text>
						) : null}
					</View>
					{/* The child's own metadata line: which agent it is, at which effort, on
					    which model. A roster row can only carry the first two. */}
					{detail !== null ? (
						<Text className="pb-1 text-meta text-ink-dim" numberOfLines={1}>
							{[detail.agent, detail.effort, detail.model_label]
								.filter((part) => part.length > 0)
								.join(" · ")}
						</Text>
					) : null}
				</View>

				{/* Failure is stated above the transcript, not only in the parent's count
				    (F-7): a reader who drilled into a failed child must not have to go back
				    to learn why it failed. */}
				{detail?.error_text ? (
					<View
						className="border-b border-hairline px-4 py-2"
						testID="subagent-detail-error"
					>
						<Text className="text-body-sm text-danger">
							{detail.error_text}
						</Text>
					</View>
				) : null}

				{/* The child's prompt, which the roster strips. */}
				{detail !== null && detail.prompt.length > 0 ? (
					<View
						className="border-b border-hairline px-4 py-2"
						testID="subagent-detail-prompt"
					>
						<Text className="pb-0.5 text-meta text-ink-dim">prompt</Text>
						<Text className="text-body-sm text-ink-muted">{detail.prompt}</Text>
					</View>
				) : null}

				{missing && detail === null ? (
					<EmptyState
						headline="This subagent is no longer available."
						next="Its transcript was not kept, or the computer is not answering."
						testID="subagent-detail-missing"
					/>
				) : detail === null ? (
					<View className="px-4 py-3">
						<Skeleton lines={3} testID="subagent-detail-loading" />
					</View>
				) : (
					<TranscriptList
						sessionId={`${sessionId}:${childId}`}
						entries={detail.transcript}
						streamingRowId={null}
						testID="subagent-detail-transcript"
						header={
							detail.result_text.length > 0 ? (
								<View className="px-4 py-2">
									<Text className="pb-0.5 text-meta text-ink-dim">result</Text>
									<Text className="text-body-sm text-ink">
										{detail.result_text}
									</Text>
								</View>
							) : null
						}
						empty={
							<View className="px-4 py-3">
								<Text className="text-body-sm text-ink-dim">
									This subagent has no transcript rows of its own.
								</Text>
							</View>
						}
					/>
				)}

				<TodosPanel
					todos={todos}
					// Expanded by default HERE, unlike on the parent: this screen exists to
					// show one child's work, and there is no conversation beneath it to
					// protect from a list that opens.
					open
					onToggle={() => undefined}
					heldShut={false}
					testID="subagent-detail-todos"
				/>
			</View>
		</Screen>
	);
}
