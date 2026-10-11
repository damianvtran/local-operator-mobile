import { useLocalSearchParams, useRouter } from "expo-router";
import {
	type StatusChangeEventPayload,
	useVideoPlayer,
	VideoView,
} from "expo-video";
import { ArrowLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";

import { useSessionRuntime } from "@/features/session/use-session";
import { CONTROL, SCREEN, SURFACE } from "@/ui/a11y";
import { IconButton, Screen, Skeleton } from "@/ui/components";

/**
 * The full-screen video player — the flow the surfaces design froze as
 * "receipt row → tap → player screen" (§3.4, with the manager's 2026-10-10
 * playback ruling behind it).
 *
 * **Why a route and not an inline player.** The transcript is a `FlatList` and
 * recycles rows: an inline player would be destroyed and restarted by a scroll
 * that recycles the row it sits in (the card's own documented remount caveat,
 * F3's neighbourhood). As a pushed route the player owns its own lifetime, and
 * the frame left behind in the list is stateless — nothing to lose on a
 * remount. This is also the manager's ruling made concrete: playback is the
 * completion rendering for the primary artifact.
 *
 * **Why `expo-video`.** The dependency decision the design flagged for the
 * repo owner; the ruling (2026-10-10) took it as in-scope and bounded. The
 * repository rule for new dependencies is that the reason is recorded — it is,
 * here and in the pull request — and the dependency is removable the same way
 * it arrived: this route and the one frame component are its only consumers.
 *
 * **The readings, and why one sentence covers three of them.** The bytes are
 * resolved by `loadVideoSource` (a cache file on native, a Blob object URL on
 * web). While resolving, the box is reserved with a skeleton; once ready, the
 * player mounts. A relay that no longer has the artifact resolves `null`, a
 * transport failure throws, and a fetch that lands undecodable bytes reports
 * through the player's own error status (UX round 1, U3) — and all three
 * render the SAME sentence, "Video no longer available." (surfaces design §4,
 * delta V7), because distinguishing them would ask the reader to care about a
 * difference they cannot act on. That is `TranscriptImage`'s own recorded rule
 * for the image path, kept identical here rather than rewritten as a second
 * opinion; the undecodable case carries its own state id so a probe can still
 * tell which reading it measured.
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
		| { kind: "loading" }
		| { kind: "ready"; uri: string }
		| { kind: "missing" }
		| { kind: "unplayable" }
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
			/* Native starts from here: it constructs the player WITH the source, so
			 * the call lands. WEB cannot — this callback runs before `VideoView`
			 * mounts, and the web element drops a `play()` on an unmounted element,
			 * so web opened paused and the reader paid an extra tap (UX round 1,
			 * U2). Web plays from the readiness event below instead; whether native
			 * really starts is not verifiable on this host (no simulator) and is
			 * flagged for the native check in CI. */
			if (Platform.OS !== "web") created.play();
		},
	);

	/* The player's own status, for the two things this surface owes the web:
	 * the deferred play (U2) and the undecodable-bytes reading (U3). Keyed on
	 * the player instance — `useVideoPlayer` recreates the player when the
	 * source changes, so every new source gets its own listeners, and the
	 * `status` read covers the race where the player is already ready before
	 * the subscription exists. */
	useEffect(() => {
		if (Platform.OS === "web" && player.status === "readyToPlay") {
			player.play();
		}
		const subscription = player.addListener(
			"statusChange",
			({ status }: StatusChangeEventPayload) => {
				if (status === "readyToPlay" && Platform.OS === "web") {
					player.play();
				}
				if (status === "error") {
					/* The bytes arrived and cannot be decoded: the single sentence,
					 * under its own id (see the docblock). */
					setState((current) =>
						current.kind === "ready" ? { kind: "unplayable" } : current,
					);
				}
			},
		);
		return () => subscription.remove();
	}, [player]);

	/** The parent's own name, from the projection this route shares with its
	 *  parent (`agent/[jobId].tsx`'s own crumb rule). */
	const parentName = runtime.projection?.conversation_name ?? "session";

	/** The row's own one-line summary (e.g. "the 8s loop, 16:9"), so the screen
	 *  says WHICH artifact is open when a session holds several (UX round 1,
	 *  U4). The design froze no header copy here, so the row's own words are
	 *  used; "Video" is the fallback while the transcript is not held yet (a
	 *  deep link lands before the stream does). */
	const row = runtime.entries.find((candidate) => candidate.id === entryId);
	const title = row !== undefined && row.summary !== "" ? row.summary : "Video";

	return (
		<Screen
			title={title}
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
				/* A STRETCH wrapper — no `items-center`. The bars are `w-full` against
				 * this container, and a content-sized (centre-aligned) one resolves
				 * them to 0 px: the exact failure the Skeleton's `widthClassName`
				 * docblock records (design round 2 D13 / QA round 4 Q1), reproduced
				 * here as QA round 1 Q1 (bars 0×16, invisible on the dark ground).
				 * `justify-center` centres the block vertically without touching the
				 * cross axis. */
				<View className="flex-1 justify-center px-4">
					<Skeleton lines={2} testID={SURFACE.videoPlayerLoading} />
				</View>
			) : state.kind === "missing" || state.kind === "unplayable" ? (
				<View
					className="flex-1 items-center justify-center px-6"
					testID={
						state.kind === "unplayable"
							? SURFACE.videoPlayerUnplayable
							: SURFACE.videoPlayerMissing
					}
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
