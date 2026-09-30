import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";

import { Skeleton } from "@/ui/components";

/**
 * An image the reader sent or the relay attached, rendered inline in its turn.
 *
 * `docs/design/components.md` § 14 is explicit that this is part of the turn and
 * not a `[image attached]` note, and § 14's second rule is why the component owns
 * its own loading and failure states: a flaky fetch must never show a broken glyph
 * or reflow the bubble. So the frame is reserved at the thumbnail's size before
 * the bytes arrive, and a failure renders a labelled placeholder of the SAME size
 * — a placeholder that changed the geometry would move the text below it, which is
 * exactly the reflow the rule forbids.
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
	/** The MIME type the wire reported, used as the decoder hint. */
	mimeType: string;
	/** Resolves the image's bytes as a data URI, or `null` when the relay no longer
	 *  has them. Injected so this component never holds a client. */
	load: (entryId: string, index: number) => Promise<string | null>;
	testID?: string;
};

/** The thumbnail's reserved box. 64 pt is the kit's attachment thumbnail
 *  (`components.md` § 12) and it is fixed so the reservation below is honest. */
const THUMB_PX = 64;

export const TranscriptImage = ({
	entryId,
	index,
	load,
	testID = "transcript-image",
}: TranscriptImageProps) => {
	const [uri, setUri] = useState<string | null>(null);
	const [state, setState] = useState<"loading" | "ready" | "missing">(
		"loading",
	);

	useEffect(() => {
		let cancelled = false;
		setState("loading");
		setUri(null);
		load(entryId, index)
			.then((dataUri) => {
				if (cancelled) return;
				if (dataUri === null) {
					setState("missing");
					return;
				}
				setUri(dataUri);
				setState("ready");
			})
			.catch(() => {
				// A transport failure is the same reading for the reader as a missing
				// image: the attachment is not showable. Distinguishing them on screen
				// would ask the reader to care about a difference they cannot act on.
				if (!cancelled) setState("missing");
			});
		return () => {
			cancelled = true;
		};
	}, [entryId, index, load]);

	return (
		<View
			className="overflow-hidden rounded-sm border border-hairline"
			style={{ width: THUMB_PX, height: THUMB_PX }}
			testID={testID}
		>
			{state === "ready" && uri !== null ? (
				<Image
					source={{ uri }}
					// `resizeMode` in the STYLE rather than as a prop: the prop form is
					// deprecated in RN 0.86 and warns per render, and this row can be mounted
					// dozens of times in one window.
					style={{ width: THUMB_PX, height: THUMB_PX, resizeMode: "cover" }}
					accessibilityLabel="Attached image"
				/>
			) : state === "loading" ? (
				<Skeleton lines={1} />
			) : (
				<View className="flex-1 items-center justify-center px-1">
					<Text
						className="text-center text-meta text-ink-dim"
						numberOfLines={3}
					>
						Image no longer available.
					</Text>
				</View>
			)}
		</View>
	);
};
