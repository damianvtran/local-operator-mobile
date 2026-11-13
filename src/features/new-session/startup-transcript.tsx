import { useRouter } from "expo-router";
import { memo, useEffect, useMemo } from "react";
import { ScrollView, Text, View, type ViewStyle } from "react-native";
import type { TranscriptEntry } from "@/contracts";
import { PendingEchoRows } from "@/features/session/components/pending-echo-row";
import type { SupplementClient } from "@/features/session/components/supplement-block";
import { TranscriptList } from "@/features/session/components/transcript-list";
import { WorkingLine } from "@/features/session/components/working-line";
import type { ImageLoader } from "@/features/session/image-cache";
import {
	owedPendingEchoes,
	type PendingEcho,
	projectedCommandIds,
} from "@/features/session/pending-echo";
import { turnRunning } from "@/features/session/projection";
import { TRANSCRIPT_FADE_PT } from "@/features/session/transcript-presence";
import { useSessionRuntime } from "@/features/session/use-session";
import { t } from "@/i18n";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { Button } from "@/ui/components/button";

/**
 * The tail of a just-started conversation: the reader's optimistic rows
 * (`startup-echoes.ts`) and, under them, the working line.
 *
 * THE WORKING LINE SHOWS FROM THE SEND, not from the stream's first frame
 * (operator, TestFlight 906: "the thinking state, etc are resolved immediately
 * so that things feel responsive"). While any row is still live (no failure)
 * the turn is, for the reader, already underway; a failed row is the honest
 * state instead, so the line is withheld beside it rather than spinning over a
 * message that did not go. Once the projection is live it names the activity
 * itself. The label falls back to the relay's own "Working" (`working_plain`),
 * which is also `WorkingLine`'s own fallback — no new copy.
 */
export const StartupPendingTail = memo(function StartupPendingTail({
	echoes,
	running,
	activity,
	startedS,
	onPutBack,
	loadImage,
}: {
	echoes: readonly PendingEcho[];
	/** The projection says a turn is alive. */
	running: boolean;
	activity: string;
	startedS: number | null;
	onPutBack?: (commandId: string) => void;
	loadImage?: ImageLoader;
}) {
	const live = echoes.some((echo) => echo.failure === undefined);
	const working = running || live;
	if (echoes.length === 0 && !working) return null;
	return (
		<View testID={SURFACE.startupPendingTail}>
			<PendingEchoRows
				echoes={echoes}
				streaming={running}
				onPutBack={onPutBack}
				loadImage={loadImage}
			/>
			{working ? (
				<View className="px-2 py-1">
					<WorkingLine
						activity={
							running && activity.length > 0
								? activity
								: t("relay.chrome.session.subtitle.working_plain")
						}
						startedS={running ? startedS : null}
						testID={SURFACE.startupWorkingLine}
					/>
				</View>
			) : null}
		</View>
	);
});

/** The transcript list's own bottom padding (`transcript-list.tsx`'s
 *  `CONTENT_CONTAINER_STYLE`: fade + 16 pt), so the pre-session rows sit
 *  exactly where the adopted transcript's footer will put them. */
const PREVIEW_CONTENT_STYLE: ViewStyle = {
	paddingBottom: TRANSCRIPT_FADE_PT + 16,
};

/**
 * The conversation before it has an id: the reader's message and the working
 * line, painted from the coordinator's outbox while `POST /api/sessions/start`
 * is still out. Same rows, same order and the same top edge as the adopted
 * transcript's footer (an empty `TranscriptList` has a zero-height header), so
 * the swap to `StartupTranscript` moves nothing on screen.
 */
export function StartupPreview({
	echoes,
	onPutBack,
}: {
	echoes: readonly PendingEcho[];
	onPutBack?: (commandId: string) => void;
}) {
	return (
		<ScrollView
			className="min-h-0 flex-1"
			contentContainerStyle={PREVIEW_CONTENT_STYLE}
			keyboardShouldPersistTaps="handled"
			testID={SURFACE.startupPreview}
		>
			<StartupPendingTail
				echoes={echoes}
				running={false}
				activity=""
				startedS={null}
				onPutBack={onPutBack}
			/>
		</ScrollView>
	);
}

const NO_ECHOES: readonly PendingEcho[] = [];

/** Adopt the actual session above the existing editor, not in place of it.
 * The same transcript renderer retains tool condensing and supplement semantics.
 * Full session controls are a named destination; urgent pending input is explicit
 * here rather than hidden in a generic overflow icon. */
export function StartupTranscript({
	sessionId,
	onStreaming,
	echoes = NO_ECHOES,
	onWitness,
	onPutBack,
}: {
	sessionId: string;
	onStreaming: (running: boolean) => void;
	/** The optimistic rows (`startupEchoes`); filtered here against the
	 *  transcript so a row and its real entry are never both on screen. */
	echoes?: readonly PendingEcho[];
	/** Reports the command ids the transcript now carries, so the coordinator
	 *  can drop the delivered stand-ins (`StartupCoordinator.witness`). */
	onWitness?: (ids: ReadonlySet<string>) => void;
	onPutBack?: (commandId: string) => void;
}) {
	const runtime = useSessionRuntime(sessionId);
	const router = useRouter();
	const entries: readonly TranscriptEntry[] = runtime.entries;
	/* Filtered in the SAME render that receives the entries, so the frame that
	 *  first carries the real row never also carries its echo (the session
	 *  screen's `usePendingEchoes` rule). */
	const owed = useMemo(
		() => owedPendingEchoes(echoes, entries),
		[echoes, entries],
	);
	useEffect(() => {
		onWitness?.(projectedCommandIds(entries));
	}, [entries, onWitness]);
	const running =
		runtime.projection !== null && turnRunning(runtime.projection);
	const pending = (
		<StartupPendingTail
			echoes={owed}
			running={running}
			activity={runtime.projection?.activity ?? ""}
			startedS={runtime.projection?.activity_started_s ?? null}
			onPutBack={onPutBack}
			loadImage={runtime.loadImage}
		/>
	);
	useEffect(() => {
		onStreaming(runtime.streaming);
		return () => onStreaming(false);
	}, [runtime.streaming, onStreaming]);
	const supplementClient = useMemo<SupplementClient>(
		() => ({
			loadDocument: runtime.loadSupplementDocument,
			loadFile: runtime.loadSupplementFile,
			loadSound: runtime.loadSupplementSound,
			command: runtime.supplementCommand,
		}),
		[
			runtime.loadSupplementDocument,
			runtime.loadSupplementFile,
			runtime.loadSupplementSound,
			runtime.supplementCommand,
		],
	);
	return (
		<View className="min-h-0 flex-1">
			{/* ONLY THE URGENT CASE GETS A ROW (operator, TestFlight 906: the idle
			 *  "Conversation started" + "Conversation details" row "doesn't make a
			 *  lot of sense and takes a lot of space"). The idle row said nothing the
			 *  transcript below does not already show, and the full session screen
			 *  stays one tap away from the drawer's conversation row. A pending
			 *  question is different: the answer surface (the decision card) lives
			 *  on the session screen, not here, so without this line the reader
			 *  would see a stalled turn and no way to unblock it. Kept to one
			 *  compact line (`py-1`, small quiet button). */}
			{runtime.projection?.pending ? (
				<View
					className="flex-row items-center justify-between gap-2 px-4 py-1"
					testID={SURFACE.startupNeedsAnswer}
				>
					<Text
						className="min-w-0 shrink text-body-sm text-ink-muted"
						numberOfLines={1}
						accessibilityLiveRegion="polite"
					>
						{t("mobile.home.transcript.needs_answer")}
					</Text>
					<Button
						label={t("mobile.notifications.detail.answer_in_conversation")}
						variant="quiet"
						size="sm"
						testID={CONTROL.startupOpenConversation}
						onPress={() => router.push(`/session/${sessionId}`)}
					/>
				</View>
			) : null}
			<TranscriptList
				sessionId={sessionId}
				entries={runtime.entries}
				streamingRowId={runtime.streamingRowId}
				// This screen threads no turn interrupt, so the list cannot read
				// "running" off `onCancelTurn`: between streamed rows a first turn
				// would look idle and condense mid-run. The projection says.
				turnLive={
					runtime.projection === null ? true : turnRunning(runtime.projection)
				}
				loadImage={runtime.loadImage}
				onOpenAgent={(jobId) =>
					router.push(`/session/${sessionId}/agent/${jobId}`)
				}
				supplements={runtime.supplements}
				projectionPid={runtime.projectionPid}
				supplementClient={supplementClient}
				testID={SURFACE.startupTranscript}
				pending={pending}
				/* The waiting line stands for "nothing yet"; with the reader's own
				 *  message and the working line on screen it would sit ABOVE them
				 *  and say something false. */
				empty={
					owed.length > 0 ? null : (
						<Text className="px-4 py-3 text-body-sm text-ink-muted">
							{t("mobile.home.transcript.waiting")}
						</Text>
					)
				}
			/>
		</View>
	);
}
