import { Play } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { useTokenColor } from "@/ui/appearance";

/**
 * A generated video's affordance on a transcript row — the sibling of
 * `TranscriptImage`, and the design's "receipt row → tap → player screen"
 * made concrete (surfaces design §3.4).
 *
 * **Why a static frame and no poster.** No surface has a store-fed video
 * thumbnail (the desktop's canvas thumbnails are local files only), and a
 * poster frame would need a bounded extraction step the phase names as a
 * follow-up — so the frame draws the one thing the wire does tell us: an
 * artifact exists. It fetches NOTHING itself, which is also how the FlatList
 * remount caveat stays handled: there is nothing inline to re-resolve, and the
 * bytes are fetched once on the player route (recycled rows just redraw a
 * frame). The 64 pt box is the kit's attachment-thumbnail height
 * (`components.md` § 12) — the same reservation `TranscriptImage` makes — and
 * is itself the hit target (64 pt ≥ the 44 pt floor).
 *
 * The glyph is the affordance and the accessible name carries the action
 * ("Play video" — the product's own vocabulary for playback; the missing-bytes
 * sentence, "Video no longer available.", belongs to the PLAYER's state, never
 * to this affordance).
 */
export type TranscriptVideoProps = {
	/** Opens the full-screen player for this artifact. */
	onOpen: () => void;
	/** REQUIRED, like every other primitive's: the frame is one video of one
	 *  entry, and a caller passes `transcriptVideoId(entryId, index)` so a
	 *  flow can address the exact row it means. */
	testID: string;
};

/** The frame's fixed side, in points — the kit's attachment thumbnail. */
const FRAME_PX = 64;

export const TranscriptVideo = ({ onOpen, testID }: TranscriptVideoProps) => {
	const glyphInk = useTokenColor("accent");
	return (
		<Pressable
			onPress={onOpen}
			accessibilityRole="button"
			accessibilityLabel="Play video"
			accessibilityHint="Opens the full-screen player."
			testID={testID}
		>
			<View
				className="items-center justify-center overflow-hidden rounded-sm border border-hairline bg-sunken"
				style={{ width: FRAME_PX, height: FRAME_PX }}
			>
				<Play color={glyphInk} size={24} />
			</View>
		</Pressable>
	);
};
