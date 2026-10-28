import { useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import type { SupplementClient } from "@/features/session/components/supplement-block";
import { TranscriptList } from "@/features/session/components/transcript-list";
import { useSessionRuntime } from "@/features/session/use-session";
import { t } from "@/i18n";
import { CONTROL, SURFACE } from "@/ui/a11y";
import { Button } from "@/ui/components/button";

/** Adopt the actual session above the existing editor, not in place of it.
 * The same transcript renderer retains tool condensing and supplement semantics.
 * Full session controls are a named destination; urgent pending input is explicit
 * here rather than hidden in a generic overflow icon. */
export function StartupTranscript({
	sessionId,
	onStreaming,
}: {
	sessionId: string;
	onStreaming: (running: boolean) => void;
}) {
	const runtime = useSessionRuntime(sessionId);
	const router = useRouter();
	useEffect(() => {
		onStreaming(runtime.streaming);
		return () => onStreaming(false);
	}, [runtime.streaming, onStreaming]);
	const supplementClient = useMemo<SupplementClient>(
		() => ({
			loadDocument: runtime.loadSupplementDocument,
			loadFile: runtime.loadSupplementFile,
			command: runtime.supplementCommand,
		}),
		[
			runtime.loadSupplementDocument,
			runtime.loadSupplementFile,
			runtime.supplementCommand,
		],
	);
	return (
		<View className="min-h-0 flex-1">
			<View className="flex-row flex-wrap items-center justify-between gap-2 px-4 py-2">
				<Text className="text-body-sm text-ink-muted">
					{runtime.projection?.pending
						? "This conversation needs your answer."
						: "Conversation started"}
				</Text>
				<Button
					label={
						runtime.projection?.pending
							? t("mobile.notifications.detail.answer_in_conversation")
							: "Conversation details"
					}
					variant="quiet"
					size="sm"
					testID={CONTROL.startupOpenConversation}
					onPress={() => router.push(`/session/${sessionId}`)}
				/>
			</View>
			<TranscriptList
				sessionId={sessionId}
				entries={runtime.entries}
				streamingRowId={runtime.streamingRowId}
				loadImage={runtime.loadImage}
				onOpenAgent={(jobId) =>
					router.push(`/session/${sessionId}/agent/${jobId}`)
				}
				supplements={runtime.supplements}
				projectionPid={runtime.projectionPid}
				supplementClient={supplementClient}
				testID={SURFACE.startupTranscript}
				empty={
					<Text className="px-4 py-3 text-body-sm text-ink-muted">
						{t("mobile.home.transcript.waiting")}
					</Text>
				}
			/>
		</View>
	);
}
