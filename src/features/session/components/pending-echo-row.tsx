import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import {
	type PendingEcho,
	pendingEchoBoxClass,
	pendingEchoCaption,
} from "@/features/session/pending-echo";
import { t } from "@/i18n";
import { pendingEchoId } from "@/ui/a11y";
import { cx } from "@/ui/variants";

/**
 * The row for one instruction that is in flight — what the user just sent —
 * ported from the relay's `PendingEchoRow` (`components/transcript.tsx`).
 *
 * It takes the box of the row its OP settles into — the user bubble for a
 * prompt, the quieter steer block for a steer (`transcript-row.tsx`'s
 * `user`/`steer` arm) — so reconciliation is the caption leaving rather than a
 * row changing register. The two deliberate departures from a settled row are
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
}: {
	echo: PendingEcho;
	streaming: boolean;
	onPutBack?: (commandId: string) => void;
}) => {
	const caption = pendingEchoCaption(echo, streaming);
	const body = (
		<View className={pendingEchoBoxClass(echo.op)}>
			{/* Attachments ride as a count: the composer owns the image bytes,
			 *  and the real row shows them once the transcript carries it. */}
			{echo.imageCount > 0 ? (
				<Text className="text-meta text-ink-dim">
					{t("mobile.session.pending_echo.images", {
						count: echo.imageCount,
					})}
				</Text>
			) : null}
			{echo.text.length > 0 ? (
				<Text className="text-body-read text-ink-muted">{echo.text}</Text>
			) : null}
			<Text
				className={cx(
					"text-meta",
					echo.failure === undefined ? "text-ink-dim" : "text-danger",
				)}
				accessibilityLiveRegion="polite"
			>
				{caption}
			</Text>
		</View>
	);
	if (echo.failure === "refused" && onPutBack) {
		return (
			<Pressable
				className="items-end px-4 py-1"
				testID={pendingEchoId(echo.commandId)}
				accessibilityRole="button"
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
}: {
	echoes: readonly PendingEcho[];
	streaming: boolean;
	/** The composer's put-back for a refused row; must be stable (the rows are
	 *  memoised on it). */
	onPutBack?: (commandId: string) => void;
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
				/>
			))}
		</>
	);
});
