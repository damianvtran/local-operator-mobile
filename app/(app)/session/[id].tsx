import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Composer } from "@/features/session/components/composer";
import { ConnectionBanner } from "@/features/session/components/connection-banner";
import {
	EffortSheet,
	ModelSheet,
} from "@/features/session/components/model-sheet";
import { PendingCard } from "@/features/session/components/pending-card";
import { SlashSheet } from "@/features/session/components/slash-sheet";
import { SubagentsPanel } from "@/features/session/components/subagents-panel";
import { TodosPanel } from "@/features/session/components/todos-panel";
import { TranscriptList } from "@/features/session/components/transcript-list";
import { WorkingLine } from "@/features/session/components/working-line";
import { panelRail } from "@/features/session/panel-rail";
import { pendingView } from "@/features/session/pending";
import {
	middleTruncate,
	projectSubagents,
	projectTodos,
	workingLine,
} from "@/features/session/projection";
import { draftSlashQuery, useComposer } from "@/features/session/use-composer";
import { useSessionRuntime } from "@/features/session/use-session";
import { SCREEN } from "@/ui/a11y";
import {
	Chip,
	EmptyState,
	IconButton,
	ReadableColumn,
	Screen,
	Skeleton,
} from "@/ui/components";
/* The adaptive vocabulary, from the single place D1 owns: `useLayout` decides the
 * size class and the measure, `SPLIT_PANE_WIDTH` the pane. This screen adds no
 * breakpoint of its own — see `src/features/session/panel-rail.ts`. */
import { SPLIT_PANE_WIDTH, useLayout } from "@/ui/layout";

/**
 * The session view (`docs/ux/flows.md` F-6): the product's core screen.
 *
 * The column, top to bottom, is the spec's composition — header · status strip ·
 * transcript · todos · subagents · pending card · composer — and the ORDER is
 * load-bearing rather than incidental:
 *
 *  - The transcript takes the remaining space (`flex-1`) and the panels take what
 *    they need, because the transcript is the thing being read and a panel that
 *    grew would push it off screen.
 *  - The pending card sits directly above the composer and below the panels: it is
 *    the most prominent object on the screen because a question for the reader is
 *    the only thing that needs a decision, and it must be adjacent to the control
 *    that sends an answer.
 *  - The working line sits between the panels and the card, which is where the
 *    spec puts it ("a working line above the composer") and where it is legible
 *    whether or not the panels are open.
 *
 * **At most one panel is expanded**, held by one piece of state rather than by two
 * booleans: the v1 rule is that an expanded todos list AND an expanded subagent
 * roster together push the conversation off a phone screen, and two booleans can
 * express a state the rule forbids.
 */
export default function Session() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const sessionId = typeof id === "string" ? id : "";
	const router = useRouter();

	const runtime = useSessionRuntime(sessionId);
	const composer = useComposer({
		sessionId,
		source: runtime.source,
		streaming: runtime.streaming,
		ended: runtime.projection?.ended === true,
	});

	/** `null`, `"todos"` or `"subagents"`: one open panel at most. */
	const [openPanel, setOpenPanel] = useState<null | "todos" | "subagents">(
		null,
	);

	/* The layout, from D1's hook in `src/ui/layout.ts`. Read once here so the rail,
	 * the column and the composer all answer to one decision: the rail needs room
	 * AND content, since an empty rail on a tablet is 360 pt of nothing beside the
	 * conversation. */
	const layout = useLayout();

	const [modelsOpen, setModelsOpen] = useState(false);
	const [effortOpen, setEffortOpen] = useState(false);

	const projection = runtime.projection;
	const todos = useMemo(
		() => projectTodos(projection?.todos ?? []),
		[projection?.todos],
	);
	const subagents = useMemo(
		() => projectSubagents(projection?.subagents ?? []),
		[projection?.subagents],
	);
	// `null` in, `null` out: the working line exists only while the runtime names an
	// activity, and a placeholder projection would be this screen inventing one.
	const working = projection === null ? null : workingLine(projection);

	const pending = projection?.pending ?? null;
	const pendingViewProps = useMemo(
		() =>
			pending === null
				? null
				: pendingView({
						pending,
						sessionKind: projection?.kind ?? "",
						pendingCount: projection?.pending_count ?? 1,
						// The computer's name is not known on this route (the route profile is
						// the connection layer's, and a hostname is not a name a reader uses), so
						// the risk sentence falls back to the working directory, which is the
						// more useful of the two for "where will this run".
						computerLabel: "",
						cwd: projection?.cwd ?? "",
					}),
		[pending, projection?.kind, projection?.pending_count, projection?.cwd],
	);

	const slash = draftSlashQuery(composer.draft);

	const openAgent = useCallback(
		(jobId: string) => {
			router.push(`/session/${sessionId}/agent/${jobId}`);
		},
		[router, sessionId],
	);

	const title = projection?.conversation_name ?? "";
	/* The header name is MIDDLE-truncated with a floor, because the shipped web
	 * client collapsed it to a single glyph at 200 % text (`R14`) — the two ends of
	 * a session name are what distinguish it, so a truncation has to keep both. */
	const headerTitle = title.length > 0 ? middleTruncate(title, 40) : "session";

	/* One decision, read once, for the rail, the column and the composer alike: the
	 * rail needs ROOM (D1's split rule plus a full measure beside the pane, in
	 * `panel-rail.ts`) AND CONTENT, because an empty rail on a tablet is 360 pt of
	 * nothing beside the conversation. */
	const showRail = panelRail(layout) && (!todos.empty || !subagents.empty);

	/* The panels, in one place because they render in one of two places: a rail beside
	 * the transcript on a wide viewport, or beneath it on a phone. Writing them twice
	 * is how the two layouts come to disagree about the same list. */
	const panels = (
		<>
			<TodosPanel
				todos={todos}
				// A rail has room for both panels, so the phone's one-at-a-time rule — which
				// exists to keep the conversation on screen — is not applied there.
				open={showRail || openPanel === "todos"}
				onToggle={() => setOpenPanel(openPanel === "todos" ? null : "todos")}
				heldShut={pending !== null}
			/>
			<SubagentsPanel
				subagents={subagents}
				open={showRail || openPanel === "subagents"}
				onToggle={() =>
					setOpenPanel(openPanel === "subagents" ? null : "subagents")
				}
				onOpenAgent={openAgent}
			/>
		</>
	);

	const transcript =
		runtime.source.reason === "no-route" ? (
			<EmptyState
				headline="This session is not connected yet."
				next="Open it from the session list once a computer is connected."
				testID={`session-not-connected-${sessionId}`}
			/>
		) : runtime.entries.length === 0 && runtime.loading ? (
			// Loading is a skeleton, never a spinner over a blank column: the three bars
			// reserve the shape the transcript will take.
			<View className="px-4 pt-3">
				<Skeleton lines={3} testID="session-loading" />
			</View>
		) : (
			<TranscriptList
				sessionId={sessionId}
				entries={runtime.entries}
				streamingRowId={runtime.streamingRowId}
				loadImage={runtime.loadImage}
				onOpenAgent={openAgent}
				empty={
					<EmptyState
						headline="Nothing here yet."
						next="Send the first message below."
						testID="session-transcript-empty"
					/>
				}
			/>
		);

	return (
		<Screen
			title={headerTitle}
			// The transcript owns its own scrolling, so the screen must not add a
			// second scroller around it.
			scroll={false}
			testID={SCREEN.session}
			headerLeading={
				<IconButton
					accessibilityLabel="Back to sessions"
					onPress={() => router.back()}
					icon={({ color, size }) => <ArrowLeft color={color} size={size} />}
				/>
			}
			headerAction={
				subagents.total > 0 ? (
					<Chip
						// Names the unit it counts, in the panel's own words, so the chip
						// and the panel header cannot disagree: "1/6 agents" read as a
						// fraction of something the reader could not see.
						label={`${subagents.running} of ${subagents.total} running`}
						onPress={() =>
							setOpenPanel(openPanel === "subagents" ? null : "subagents")
						}
						accessibilityHint="Show the subagents"
						// A literal rather than a `CONTROL` entry: this id is a contract with the
						// drill-down flow, and the same flow addresses every other anchor on this
						// screen by the literal string. Those names belong in `ui/a11y.ts`'s
						// `CONTROL` — that file is another stream's this wave, so the move is
						// recorded for the manager rather than made here.
						testID="session-subagents-chip"
					/>
				) : null
			}
		>
			{/* The status strip. Only rendered when the wire reports a number: a strip
			    that showed `—` for unknown would be a row of noise on every session. */}
			{projection?.context_tokens != null &&
			projection?.context_window != null ? (
				<View className="flex-row items-center gap-2 border-b border-hairline px-4 py-1">
					<Text
						className="text-mono-sm text-ink-dim"
						testID="session-context-strip"
					>
						{Math.round(
							(projection.context_tokens / projection.context_window) * 100,
						)}
						% context
						{projection.context_is_estimate === true ? " (est.)" : ""}
					</Text>
					{projection.cumulative_parent_cost != null ? (
						<Text className="text-mono-sm text-ink-dim">
							${projection.cumulative_parent_cost.toFixed(2)}
						</Text>
					) : null}
				</View>
			) : null}

			{/* The transcript and the panels, side by side when there is room for a second
			    column and stacked when there is not. The main column is MEASURE-CAPPED and
			    centred: a 1366 pt tablet showing a paragraph 1366 px wide is unreadable, and
			    the fix is a constrained measure rather than a stretched one. */}
			<View className={showRail ? "flex-1 flex-row" : "flex-1"}>
				{showRail ? (
					<ScrollView
						className="border-r border-hairline"
						// `flexGrow: 0` is load-bearing: react-native-web gives every
						// ScrollView `flexGrow: 1`, so a width alone is only a flex BASIS
						// and the rail split the free space with the column (measured in
						// the 1366 pt frame: an 832 pt rail beside a 533 pt transcript).
						// The pane width is D1's constant, not a number of this screen's.
						style={{ width: SPLIT_PANE_WIDTH, flexGrow: 0, flexShrink: 0 }}
						testID="session-panel-rail"
					>
						{panels}
					</ScrollView>
				) : null}
				{/* D1's primitive: centred, capped at the layout's own measure, and no
				    margin at all on a phone (where the measure IS the screen). */}
				<ReadableColumn testID="session-column">
					{transcript}
					{showRail ? null : panels}
					{working !== null ? (
						<WorkingLine
							activity={working.activity}
							startedS={working.startedS}
							testID="session-working-line"
						/>
					) : null}
					{pendingViewProps !== null ? (
						<View className="px-3 pb-1">
							<PendingCard
								view={pendingViewProps}
								busy={composer.sending}
								error={composer.error}
								onApprove={(remember) =>
									composer.answerApproval(
										pendingViewProps.requestId,
										true,
										remember,
									)
								}
								onDeny={(remember) =>
									composer.answerApproval(
										pendingViewProps.requestId,
										false,
										remember,
									)
								}
								onAnswer={(value) =>
									composer.answerAsk(
										pendingViewProps.requestId,
										value,
										projection?.pending?.question_index ?? 0,
									)
								}
							/>
						</View>
					) : null}
					{/* The banner and the composer live INSIDE the measure, not across the
					    full width: on a tablet a composer 1366 pt wide sits under a 720 pt
					    transcript and reads as a different surface (QA round 2, Q10). On a
					    phone the measure is the screen, so nothing moves. */}
					<ConnectionBanner
						view={runtime.connection}
						onAction={(action) => {
							if (action.kind === "retry") runtime.reload();
							// A sign-in and a console link are the route screens' work; this
							// screen has nowhere to put a credential field, so it sends the
							// reader to the screen that owns it rather than failing silently.
							if (action.kind === "sign-in") router.push("/welcome");
							if (action.kind === "console") router.push("/tunnels");
						}}
					/>

					<Composer
						controls={composer.controls}
						draft={composer.draft}
						onDraftChange={composer.setDraft}
						images={composer.images}
						onRemoveImage={composer.removeImage}
						onAttach={composer.attach}
						attaching={composer.attaching}
						onSend={composer.send}
						onStop={composer.stop}
						retainedMessage={
							composer.retained !== null ? COMPOSER_RETAINED : null
						}
						notice={composer.notice}
						onRetry={composer.retry}
						showResume={
							projection?.stop_reason === "aborted" && !runtime.streaming
						}
						onResume={composer.send}
						error={pending === null ? composer.error : null}
						queuedCount={projection?.queued_count ?? 0}
						modelLabel={chipModelLabel(projection?.model_label ?? "")}
						effortLabel={
							projection?.effort.length ? projection.effort : "effort"
						}
						onOpenModels={() => setModelsOpen(true)}
						onOpenEffort={() => setEffortOpen(true)}
						slashQuery={slash}
						slashSheet={
							<SlashSheet
								visible={slash !== null}
								onClose={() => undefined}
								commands={runtime.commands}
								query={slash ?? ""}
								onPick={composer.slash}
							/>
						}
					/>
				</ReadableColumn>
			</View>

			<ModelSheet
				visible={modelsOpen}
				onClose={() => setModelsOpen(false)}
				models={runtime.models}
				selected={projection?.model_selector ?? ""}
				onPick={(model) => {
					void runtime.source.endpoints?.command(sessionId, {
						op: "set_model",
						provider: model.provider,
						model_id: model.model_id,
					});
				}}
			/>

			<EffortSheet
				visible={effortOpen}
				onClose={() => setEffortOpen(false)}
				ladder={projection?.effort_ladder ?? []}
				selected={projection?.effort ?? ""}
				onPick={(effort) => {
					void runtime.source.endpoints?.command(sessionId, {
						op: "set_effort",
						effort,
					});
				}}
			/>
		</Screen>
	);
}

/**
 * The model chip's label: the model, without its provider prefix.
 *
 * The relay's `model_label` is often the raw `provider/model_id` selector
 * (`anthropic/claude-opus-5`), and at 390 pt that string alone pushed the effort
 * chip against the screen edge. The provider is the model SHEET's grouping, where
 * there is room to read it; the chip only has to say which model is on. Empty (a
 * session that has not reported one) reads as the word the reader taps to choose.
 */
const chipModelLabel = (label: string): string => {
	if (label.length === 0) return "model";
	const slash = label.lastIndexOf("/");
	return slash >= 0 && slash < label.length - 1
		? label.slice(slash + 1)
		: label;
};

/** The composer's own sentence for a retained instruction, kept beside the screen
 *  rather than in `composer.ts` because it is passed in as a prop. */
const COMPOSER_RETAINED =
	"An earlier instruction may have been delivered. Retry that earlier instruction before sending your current draft.";
