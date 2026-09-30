import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";
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
import { headerTitleChars } from "@/features/session/header";
import { pendingView } from "@/features/session/pending";
import {
	middleTruncate,
	projectSubagents,
	projectTodos,
	workingLine,
} from "@/features/session/projection";
import { draftSlashQuery, useComposer } from "@/features/session/use-composer";
import { useSessionRuntime } from "@/features/session/use-session";
import { CONTROL, EMPTY, SCREEN, SURFACE } from "@/ui/a11y";
import {
	Chip,
	EmptyState,
	IconButton,
	Screen,
	Skeleton,
} from "@/ui/components";

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

	const [modelsOpen, setModelsOpen] = useState(false);
	const [effortOpen, setEffortOpen] = useState(false);

	const projection = runtime.projection;

	/* The effort ladder, read once: the chip's availability and the sheet's rows are
	 * the same fact, and an empty ladder means the selected model has no effort
	 * control — a sheet with no rows and nothing to press is the dead-end modal the
	 * QA round found (Q3). */
	const effortLadder = useMemo(
		() => projection?.effort_ladder ?? [],
		[projection?.effort_ladder],
	);

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

	/* The strip exists when it has something true to say: a context read, or a
	 * roster. Not before — an empty band on every session is noise, and a band
	 * showing `—` for an unknown number is worse than the noise. */
	const hasStatus =
		(projection?.context_tokens != null &&
			projection?.context_window != null) ||
		subagents.total > 0;

	const pending = projection?.pending ?? null;
	const pendingViewProps = useMemo(
		() =>
			pending === null
				? null
				: pendingView({
						pending,
						sessionKind: projection?.kind ?? "",
						ended: projection?.ended === true,
						pendingCount: projection?.pending_count ?? 1,
						// The computer's name is not known on this route (the route profile is
						// the connection layer's, and a hostname is not a name a reader uses), so
						// the risk sentence falls back to the working directory, which is the
						// more useful of the two for "where will this run".
						computerLabel: "",
						cwd: projection?.cwd ?? "",
					}),
		[
			pending,
			projection?.kind,
			projection?.ended,
			projection?.pending_count,
			projection?.cwd,
		],
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
	 * a session name are what distinguish it, so a truncation has to keep both.
	 *
	 * The budget is the ROW's width, not a fixed 40 characters: at a fixed 40 the
	 * truncation never ran for a real name, so a 25-character name reached the
	 * layout whole and the platform clipped its tail (`Refactor th…` at 390,
	 * `Refact…` at 320 — design round 1, D2). `headerTitleChars` derives it from
	 * the viewport and the same column cap this screen renders inside, and the
	 * header no longer carries a status chip for the name to compete with. */
	const { width: viewportWidth, height: viewportHeight } =
		useWindowDimensions();
	const headerTitle =
		title.length > 0
			? middleTruncate(
					title,
					headerTitleChars({ width: viewportWidth, height: viewportHeight }),
				)
			: "session";

	/* The panels, in one place: they sit between the transcript and the composer.
	 * One panel at a time, because a phone's column has room for one and a tablet's is
	 * still one column (`src/ui/column.ts`). */
	const panels = (
		<>
			<TodosPanel
				testID={SURFACE.todosPanel}
				todos={todos}
				open={openPanel === "todos"}
				onToggle={() => setOpenPanel(openPanel === "todos" ? null : "todos")}
				heldShut={pending !== null}
			/>
			<SubagentsPanel
				testID={SURFACE.subagentsPanel}
				subagents={subagents}
				open={openPanel === "subagents"}
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
				testID={EMPTY.session}
			/>
		) : runtime.entries.length === 0 && runtime.loading ? (
			// Loading is a skeleton, never a spinner over a blank column: the three bars
			// reserve the shape the transcript will take.
			<View className="px-4 pt-3">
				<Skeleton lines={3} testID={SURFACE.sessionLoading} />
			</View>
		) : (
			<TranscriptList
				testID={SURFACE.sessionTranscript}
				sessionId={sessionId}
				entries={runtime.entries}
				streamingRowId={runtime.streamingRowId}
				loadImage={runtime.loadImage}
				onOpenAgent={openAgent}
				empty={
					<EmptyState
						headline="Nothing here yet."
						next="Send the first message below."
						testID={SURFACE.sessionTranscriptEmpty}
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
					testID={CONTROL.sessionBack}
					onPress={() => router.back()}
					icon={({ color, size }) => <ArrowLeft color={color} size={size} />}
				/>
			}
			/* NO header action, deliberately. The subagents chip used to sit here and
			   took 127 of a 390 pt row — measured — which is why the name was clipped at
			   every phone width. The chip is status, the context strip is status, and
			   the strip has room for both (design round 1, D2 and D8). */
		>
			{/* The status strip: every number the reader needs while reading, in one
			    band. Only rendered when the wire reports something — a strip that showed
			    `—` for unknown would be a row of noise on every session. `min-h-11` is
			    the chip's own touch floor, so moving the chip in here costs no target
			    size and the band is one row instead of two. */}
			{hasStatus ? (
				<View className="min-h-11 flex-row items-center gap-2 border-b border-hairline px-4">
					{projection?.context_tokens != null &&
					projection?.context_window != null ? (
						<>
							<Text
								className="text-mono-sm text-ink-dim"
								testID={SURFACE.sessionContext}
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
						</>
					) : null}
					<View className="flex-1" />
					{subagents.total > 0 ? (
						<Chip
							// Names the unit it counts, in the panel's own words, so the chip
							// and the panel header cannot disagree: "1/6 agents" read as a
							// fraction of something the reader could not see.
							label={`${subagents.running} of ${subagents.total} running`}
							onPress={() =>
								setOpenPanel(openPanel === "subagents" ? null : "subagents")
							}
							accessibilityHint="Show the subagents"
							// The panel lever. Its id is the contract's
							// (`CONTROL.sessionSubagents`), like every other anchor on this
							// screen: the drill-down flow addresses them by name, so a name
							// that lives in the contract cannot drift from the flow.
							testID={CONTROL.sessionSubagents}
						/>
					) : null}
				</View>
			) : null}

			{/* The transcript, the panels and the composer, in one measure-capped
			    column. `Screen` applies the cap (`src/ui/column.ts`): a 1366 pt tablet
			    showing a paragraph 1366 px wide is unreadable, and the fix is a
			    constrained measure rather than a stretched one. The panels therefore
			    STACK inside the measure instead of taking a rail beside it — at 640 pt
			    a rail would leave ~280 pt of transcript, which is the squeezed column
			    the cap exists to prevent. */}
			<View className="flex-1">
				<View className="flex-1" testID={SURFACE.sessionColumn}>
					{transcript}
					{panels}
					{working !== null ? (
						<WorkingLine
							activity={working.activity}
							startedS={working.startedS}
							testID={SURFACE.sessionWorkingLine}
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
						testID={SURFACE.sessionComposer}
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
						effortAvailable={effortLadder.length > 0}
						/* `null` means UNKNOWN, and only an absent projection is unknown. A
						   present projection that reports no model (or a model with no effort
						   ladder) is a KNOWN state and says so: making that `null` put a spinner
						   that never resolves on screen for every model without an effort
						   control — this PR's own Q3 probe caught it. */
						modelLabel={
							projection === null
								? null
								: (chipModelLabel(projection.model_label) ?? "n/a")
						}
						effortLabel={
							projection === null
								? null
								: projection.effort.length > 0
									? projection.effort
									: "n/a"
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
								busy={composer.sending}
								onPick={composer.slash}
							/>
						}
					/>
				</View>
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
				visible={effortOpen && effortLadder.length > 0}
				onClose={() => setEffortOpen(false)}
				ladder={effortLadder}
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
const chipModelLabel = (label: string): string | null => {
	// `null`, never the noun: before the first projection the chip would otherwise
	// read literally "model" — a control that names nothing reads as broken rather
	// than as loading (design round 1, D6). The composer renders the loading shape.
	if (label.length === 0) return null;
	const slash = label.lastIndexOf("/");
	return slash >= 0 && slash < label.length - 1
		? label.slice(slash + 1)
		: label;
};

/** The composer's own sentence for a retained instruction, kept beside the screen
 *  rather than in `composer.ts` because it is passed in as a prop. */
const COMPOSER_RETAINED =
	"An earlier instruction may have been delivered. Retry that earlier instruction before sending your current draft.";
