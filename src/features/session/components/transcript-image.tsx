import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import {
	aspectRatioOf,
	type CachedImage,
	imageFrameSize,
	transcriptImages,
} from "@/features/session/image-cache";
import { Skeleton } from "@/ui/components";

/**
 * An image the reader sent or the relay attached, rendered inline in its turn.
 *
 * `docs/design/components.md` § 14 is explicit that this is part of the turn and
 * not a `[image attached]` note, and § 14's second rule is why the component owns
 * its own loading and failure states: a flaky fetch must never show a broken glyph
 * or reflow the bubble. So the frame is reserved at the image's HEIGHT before the
 * bytes arrive, and a failure renders a labelled placeholder of the same height
 * — a placeholder that changed the height would move the text below it, which is
 * exactly the reflow the rule forbids.
 *
 * THE RELAY'S SIZE, NOT A THUMBNAIL (visual audit D10). The frame is 160 pt tall
 * with the image's own aspect ratio, painted with `contain` — the relay's
 * `h-40 max-w-full object-contain`. It was a 64 pt square cropped with `cover`,
 * which showed the middle of a screenshot and none of what was in it. Only the
 * WIDTH can change when the bytes arrive (square placeholder → the image's own
 * ratio), and it changes once per image for the life of the app: the ratio is
 * remembered with the source, so a remount reserves the final frame.
 *
 * NO REFETCH, NO SECOND SKELETON (performance audit P1). The transcript is a
 * virtualised list, so this component mounts again every time its row re-enters
 * the window. The source lives in `transcriptImages` (`session/image-cache.ts`),
 * which answers a settled image synchronously: the initial state below IS the
 * cached image, so a remount's first frame is the picture. The view is
 * `expo-image`, which decodes and downsamples off the JS thread and keeps the
 * decoded bitmap in its own memory cache.
 *
 * The bytes come from `GET /api/sessions/{id}/image?entry=&i=`, which requires a
 * LIVE generation: a previous conversation's attachment answers `404 no such
 * image`. That is a normal outcome for an old transcript, so it renders as a
 * named "no longer available" rather than as an error.
 */
export type TranscriptImageProps = {
	/** The entry this image belongs to. */
	entryId: string;
	/** The image-block index within that entry. */
	index: number;
	/** The MIME type the wire reported. */
	mimeType: string;
	/** Resolves the image as a source the view opens (a cache file on native, a
	 *  Blob object URL on web), or `null` when the relay no longer has it.
	 *  Injected so this component never holds a client. Its IDENTITY is the
	 *  cache's scope (see `image-cache.ts`), so pass the runtime's stable
	 *  callback, never an inline arrow. */
	load: (entryId: string, index: number) => Promise<string | null>;
	/** REQUIRED, like every other primitive's: the frame is one image of one entry,
	 *  and a generic default (`"transcript-image"`) was a second spelling of an id
	 *  the contract does not carry — the identifier check in `a11y.e2e.test.ts`
	 *  reads a literal default as exactly that. The only caller passes
	 *  `transcriptImageId(entryId, index)`, so nothing is lost by requiring it. */
	testID: string;
	/** The frame sits inside the reader's `user-bubble` fill. There `hairline`
	 *  all but vanishes in the light themes (1.006-1.02:1 against the bubble in
	 *  `localOperatorLight`, `tokyoNightDay`, `gruvboxLight`…; agent review
	 *  round 1, m1), so the frame steps up to `hairline-strong`. Everywhere
	 *  else (an assistant image, an image card) it stays on canvas/surface and
	 *  keeps the quieter `hairline`. */
	onBubble?: boolean;
};

/** The frame's edge class for where it sits (see `onBubble`). Exported so a
 *  Node source test can pin it without rendering. */
export const imageFrameBorderClass = (onBubble: boolean): string =>
	onBubble ? "border-hairline-strong" : "border-hairline";

/** What the frame shows. `failed` is a transport failure — the same reading for
 *  the reader as a missing image, but NOT remembered, so the next mount retries. */
type Shown = { image: CachedImage | undefined; failed: boolean };

/** The loading bar's height class. `h-40` is 40 × the 4 px spacing unit = 160,
 *  i.e. `IMAGE_FRAME_HEIGHT_PT`; `transcript-image.test.ts` holds the two
 *  together, since a class string cannot be computed from the constant. */
const LOADING_BAR_CLASS = "h-40";

export const TranscriptImage = ({
	entryId,
	index,
	load,
	testID,
	onBubble = false,
}: TranscriptImageProps) => {
	/* The lazy initialiser reads the cache, so a remount starts settled. */
	const [view, setView] = useState<Shown>(() => ({
		image: transcriptImages.peek(load, entryId, index),
		failed: false,
	}));

	useEffect(() => {
		let cancelled = false;
		const known = transcriptImages.peek(load, entryId, index);
		/* Functional updates that return the SAME object when nothing changed:
		 * on the ordinary remount the cache already answered in the initialiser,
		 * and a fresh object here would re-render a row that is already right. */
		setView((current) =>
			current.image === known && !current.failed
				? current
				: { image: known, failed: false },
		);
		if (known !== undefined) return;
		transcriptImages
			.load(load, entryId, index)
			.then((image) => {
				if (!cancelled) setView({ image, failed: false });
			})
			.catch(() => {
				// A transport failure is the same reading for the reader as a missing
				// image: the attachment is not showable. Distinguishing them on screen
				// would ask the reader to care about a difference they cannot act on.
				if (!cancelled) setView({ image: undefined, failed: true });
			});
		return () => {
			cancelled = true;
		};
	}, [entryId, index, load]);

	const uri = view.image?.uri ?? null;
	const missing =
		view.failed || (view.image !== undefined && view.image.uri === null);
	const frame = imageFrameSize(view.image?.aspectRatio ?? null);

	return (
		<View
			className={`overflow-hidden rounded-sm border ${imageFrameBorderClass(onBubble)}`}
			/* `maxWidth` is the column's cap: a wide image is letterboxed inside
			 * the frame (`contain`) instead of pushing the bubble past the edge. */
			style={{ width: frame.width, height: frame.height, maxWidth: "100%" }}
			testID={testID}
		>
			{uri !== null && !view.failed ? (
				<Image
					source={{ uri }}
					style={{ width: "100%", height: "100%" }}
					contentFit="contain"
					/* The source is already local (a cache file or a Blob URL), so a
					 * disk cache would only copy it; `memory` keeps the decoded,
					 * downsampled bitmap so a remount paints without a decode. */
					cachePolicy="memory"
					/* A recycled native view must not show the previous row's image
					 * while this one decodes. */
					recyclingKey={`${entryId}:${index}`}
					/* No cross-fade: a remount's first frame must be the picture, and
					 * a fade from empty reads as the flash this component removed. */
					transition={null}
					accessibilityLabel="Attached image"
					onLoad={(event) => {
						const ratio = aspectRatioOf(
							event.source.width,
							event.source.height,
						);
						if (ratio === null) return;
						transcriptImages.noteAspectRatio(load, entryId, index, ratio);
						setView((current) =>
							current.image === undefined || current.image.aspectRatio === ratio
								? current
								: {
										...current,
										image: { ...current.image, aspectRatio: ratio },
									},
						);
					}}
					onError={() => setView({ image: undefined, failed: true })}
				/>
			) : missing ? (
				<View className="flex-1 items-center justify-center px-2">
					<Text
						className="text-center text-meta text-ink-dim"
						numberOfLines={3}
					>
						Image no longer available.
					</Text>
				</View>
			) : (
				/* One bar the size of the frame — the relay's filled loading frame —
				 * rather than a text-line bar at the top of a 160 pt box. */
				<Skeleton lines={1} barClassName={LOADING_BAR_CLASS} />
			)}
		</View>
	);
};
