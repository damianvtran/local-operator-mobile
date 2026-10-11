import { useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { ArrowLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { useSessionRuntime } from "@/features/session/use-session";
import { CONTROL, SCREEN, SURFACE } from "@/ui/a11y";
import { IconButton, Screen, Skeleton } from "@/ui/components";

/**
 * The full-screen video player (`docs/ux/flows.md`: the generation row's frame
 * pushes this route).
 *
 * **Why a route and not an inline player.** The transcript is a `FlatList` and
 * recycles rows: an inline player would be destroyed and restarted by a scroll
 * that recycles the row it sits in (the card's own documented remount caveat,
 * F3's neighbourhood). As a pushed route the player owns its own lifetime, and
 * the frame left behind in the list is stateless — nothing to lose on a
 * remount. This is also the manager's ruling made concrete: playback is the
 * completion rendering for the primary artifact, and the design's flow is
 * "receipt row → tap → player screen" (surfaces design §3.4).
 *
 * **Why `expo-video`.** The dependency decision the design flagged for the
 * repo owner; the ruling (2026-10-10) took it as in-scope and bounded. The
 * repository rule for new dependencies is that the reason is recorded — it is,
 * here and in the pull request — and the dependency is removable the same way
 * it arrived: this route and the one frame component are its only consumers.
 *
 * **The three states, and why two of them share one sentence.** The bytes are
 * resolved by `loadVideoSource` (a cache file on native, a Blob object URL on
 * web). While resolving, the box is reserved with a skeleton; once ready, the
 * player mounts. A relay that no longer has the artifact resolves `null` and a
 * transport failure throws — and both render the SAME sentence, "Video no
 * longer available." (surfaces design §4, delta V7), because distinguishing
 * them would ask the reader to care about a difference they cannot act on.
 * That is `TranscriptImage`'s own recorded rule for the image path, kept
 * identical here rather than rewritten as a second opinion.
 */
export default function VideoPlayer() {
	const { id, entry, i } = useLocalSearchParams<{
		id: string;
		entry: string;
		i: string;
	}>();
	const sessionId = typeof id === "string" ? id : "";
	const entryId = typeof entry === "string" ? entry : "";
	const index = Number.parseInt(typeof i === "string" ? i : "", 10);
	const router = useRouter();
	const runtime = useSessionRuntime(sessionId);

	const [state, setState] = useState<
		{ kind: "loading" } | { kind: "ready"; uri: string } | { kind: "missing" }
	>({ kind: "loading" });

	useEffect(() => {
		let cancelled = false;
		if (entryId === "" || !Number.isInteger(index) || index < 0) {
			/* A route without an addressable artifact is the missing reading
			 * without a request: there is nothing to ask the relay for. */
			setState({ kind: "missing" });
			return () => {
				cancelled = true;
			};
		}
		setState({ kind: "loading" });
		runtime
			.loadVideo(entryId, index)
			.then((uri) => {
				if (cancelled) return;
				setState(uri === null ? { kind: "missing" } : { kind: "ready", uri });
			})
			.catch(() => {
				// See the docblock: one sentence for "gone" and "unreachable" alike.
				if (!cancelled) setState({ kind: "missing" });
			});
		return () => {
			cancelled = true;
		};
	}, [runtime.loadVideo, entryId, index]);

	/* The web object URL belongs to this screen: revoked when the screen lets
	 * go of it or unmounts (a `file://` URI is ignored by the check — the
	 * native cache file is the OS cache directory's to reclaim). */
	useEffect(() => {
		if (state.kind !== "ready") return;
		const uri = state.uri;
		return () => {
			if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
		};
	}, [state]);

	const player = useVideoPlayer(
		state.kind === "ready" ? state.uri : null,
		(created) => {
			// A clip, not a loop: playback starts once because the reader asked for
			// the video by opening this screen.
			created.loop = false;
			created.play();
		},
	);

	/** The parent's own name, from the projection this route shares with its
	 *  parent (`agent/[jobId].tsx`'s own crumb rule). */
	const parentName = runtime.projection?.conversation_name ?? "session";

	return (
		<Screen
			title="Video"
			testID={SCREEN.video}
			// The player owns its own box; nothing scrolls behind it.
			scroll={false}
			headerLeading={
				<IconButton
					accessibilityLabel={`Back to ${parentName}`}
					testID={CONTROL.videoBack}
					onPress={() => router.back()}
					icon={({ color, size }) => <ArrowLeft color={color} size={size} />}
				/>
			}
		>
			{state.kind === "loading" ? (
				<View className="flex-1 items-center justify-center px-6">
					<Skeleton lines={2} testID={SURFACE.videoPlayerLoading} />
				</View>
			) : state.kind === "missing" ? (
				<View
					className="flex-1 items-center justify-center px-6"
					testID={SURFACE.videoPlayerMissing}
				>
					<Text
						className="text-center text-meta text-ink-dim"
						numberOfLines={3}
					>
						Video no longer available.
					</Text>
				</View>
			) : (
				<View className="flex-1 bg-sunken" testID={SURFACE.videoPlayer}>
					<VideoView player={player} style={{ flex: 1 }} contentFit="contain" />
				</View>
			)}
		</Screen>
	);
}
