import { memo, useRef } from "react";
import { Pressable, Text, View } from "react-native";

import { TranscriptImage } from "@/features/session/components/transcript-image";
import { UserMessageClamp } from "@/features/session/components/user-message-clamp";
import type { ImageLoader } from "@/features/session/image-cache";
import {
	LOCAL_ECHO_IMAGES,
	type PendingEcho,
	pendingEchoBoxClass,
	pendingEchoCaption,
	seedPendingEchoImages,
} from "@/features/session/pending-echo";
import { userBubbleFill } from "@/features/session/user-bubble";
import { t } from "@/i18n";
import {
	pendingEchoId,
	ROLE,
	transcriptImageId,
	userMessageMoreId,
} from "@/ui/a11y";
import { useTheme } from "@/ui/appearance";
import { cx } from "@/ui/variants";

/**
 * The row for one instruction that is in flight — what the user just sent —
 * ported from the relay's `PendingEchoRow` (`components/transcript.tsx`).
 *
 * It takes the box of the row its OP settles into — the user bubble, for a
 * prompt and a steer alike (`transcript-row.tsx`'s `user`/`steer` arm) — so
 * reconciliation is the caption leaving rather than a row changing register. The two deliberate departures from a settled row are
 * the pending signal itself, as on the relay: no accent leading edge on a prompt
 * (the accent means "this is what the turn is on", and an unadmitted message is
 * not that yet) and dimmer ink.
 *
 * NO spinner, no shimmer: the pinned working line is the session's one
 * in-progress animation, and a second per row is the competing-patterns defect
 * that rule exists for. The pending state is said in words and ink.
 *
 * A row KEPT after a failed send (`echo.failure`) keeps the same box and says
 * so in `danger` ink on the caption alone — the message itself is unchanged,
 * only its fate is. A `refused` row is the whole row as one button that puts
 * the text back in the composer (`putBackPendingEcho`); its name is the visible
 * text plus caption, so what a screen reader announces is what is on screen.
 */
const PendingEchoRowImpl = ({
	echo,
	streaming,
	onPutBack,
	loadImage,
}: {
	echo: PendingEcho;
	streaming: boolean;
	onPutBack?: (commandId: string) => void;
	/** The session's image loader, when there is a session. The echo's images
	 *  are seeded under it so the settled row paints them on its first frame. */
	loadImage?: ImageLoader;
}) => {
	const caption = pendingEchoCaption(echo, streaming);
	/* Seeded DURING render, before `TranscriptImage`'s lazy initialiser peeks:
	 *  an effect would run after that first frame and show the skeleton once.
	 *  `seed` is idempotent and never overwrites, so a re-render costs a map
	 *  lookup. With no session yet the row paints under `LOCAL_ECHO_IMAGES`;
	 *  the session's own loader is seeded too, once it exists, for handover. */
	const imageLoader = loadImage ?? LOCAL_ECHO_IMAGES;
	if (echo.images?.length) {
		seedPendingEchoImages(imageLoader, echo);
		if (imageLoader !== LOCAL_ECHO_IMAGES)
			seedPendingEchoImages(LOCAL_ECHO_IMAGES, echo);
	}
	const { active } = useTheme();
	// The bubble `Show less` keeps in view inside the list's footer (D2).
	const bubble = useRef<View | null>(null);
	const body = (
		<>
			<View
				ref={bubble}
				className={pendingEchoBoxClass(echo.op)}
				/* The settled bubble's fill as an explicit style too
				 *  (`userBubbleFill`: the native fill did not paint from the class
				 *  alone on the operator's build; design round 1, D1). A steer is
				 *  filled like a prompt, as its settled row is. */
				style={userBubbleFill(active)}
			>
				{/* The SAME clamp as the settled row's `user`/`steer` arm: every
				 *  message, steer or prompt, clips to eight lines with `Show more`.
				 *  Without it a long send painted at full height
				 *  in flight and then shrank to the clamp at handover — the jump the
				 *  one-box rule in `user-bubble.ts` exists to prevent (agent review
				 *  PR #235 round 1, R1-M1). Uncontrolled: an echo is not in the list's
				 *  row-open map, and a reader who opens it mid-flight sees it re-clamp
				 *  when the settled row takes over, which is the settled default. */}
				{echo.text.length === 0 ? null : (
					<UserMessageClamp
						anchorRef={bubble}
						testID={userMessageMoreId(pendingEchoId(echo.commandId))}
					>
						<Text className="text-body-read text-ink-muted">{echo.text}</Text>
					</UserMessageClamp>
				)}
				{/* The reader's own images, painted from the bytes the phone holds
				 *  (operator, TestFlight 906: the image "can look like the image didn't
				 *  send until it loads a few seconds later"). The SAME component, frame
				 *  and spacing as the settled user row's (`transcript-row.tsx`, the
				 *  `user`/`steer` arm), keyed by the id that row will carry, so
				 *  handover moves nothing. A count could only promise the image. */}
				{echo.images?.length ? (
					<View className="flex-row flex-wrap gap-1.5 pt-1.5">
						{echo.images.map((image, index) => (
							<TranscriptImage
								// biome-ignore lint/suspicious/noArrayIndexKey: an envelope's images are immutable and their position IS their identity (the relay's image index).
								key={index}
								entryId={echo.commandId}
								index={index}
								mimeType={image.mime_type}
								load={imageLoader}
								onBubble
								testID={transcriptImageId(pendingEchoId(echo.commandId), index)}
							/>
						))}
					</View>
				) : echo.imageCount > 0 ? (
					<Text className="text-meta text-ink-muted">
						{t("mobile.session.pending_echo.images", {
							count: echo.imageCount,
						})}
					</Text>
				) : null}
			</View>
			{/* The caption sits BELOW the box, on canvas (design round 1, D2):
			 *  `ink-dim` and `danger` are contracted on canvas, and on `user-bubble`
			 *  they miss 4.5:1 in most light themes (min 4.12 / 3.70). Its own
			 *  85 % cap and `px-1` keep it under the box's end edge. */}
			<Text
				className={cx(
					"max-w-[85%] px-1 pt-0.5 text-meta",
					echo.failure === undefined ? "text-ink-dim" : "text-danger",
				)}
				accessibilityLiveRegion="polite"
			>
				{caption}
			</Text>
		</>
	);
	if (echo.failure === "refused" && onPutBack) {
		return (
			<Pressable
				className="items-end px-4 py-1"
				testID={pendingEchoId(echo.commandId)}
				accessibilityRole={ROLE.button}
				onPress={() => onPutBack(echo.commandId)}
			>
				{body}
			</Pressable>
		);
	}
	return (
		<View
			className="items-end px-4 py-1"
			testID={pendingEchoId(echo.commandId)}
		>
			{body}
		</View>
	);
};

/** Memoised: the list footer that hosts these re-renders only when the echo set
 *  or the streaming flag changes, never per streamed transcript frame. */
export const PendingEchoRow = memo(PendingEchoRowImpl);

/** Every echo the session still owes, in send order, at the transcript's edge. */
export const PendingEchoRows = memo(function PendingEchoRows({
	echoes,
	streaming,
	onPutBack,
	loadImage,
}: {
	echoes: readonly PendingEcho[];
	streaming: boolean;
	/** The composer's put-back for a refused row; must be stable (the rows are
	 *  memoised on it). */
	onPutBack?: (commandId: string) => void;
	/** The session's image loader (see `PendingEchoRow`); must be stable. */
	loadImage?: ImageLoader;
}) {
	if (echoes.length === 0) return null;
	return (
		<>
			{echoes.map((echo) => (
				<PendingEchoRow
					key={echo.commandId}
					echo={echo}
					streaming={streaming}
					onPutBack={onPutBack}
					loadImage={loadImage}
				/>
			))}
		</>
	);
});
