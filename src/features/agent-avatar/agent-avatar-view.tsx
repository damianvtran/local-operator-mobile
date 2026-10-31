/**
 * The agent picture's renderers: the hook that resolves a row's picture
 * through the relay, the session header's mark, and the list row's leading slot.
 *
 * Read-only on the phone (see `agent-avatar.ts` for the contract and why). The
 * desktop owns editing; the header mark therefore answers a press with a hint
 * pointing there instead of opening anything (`mobile.agent_avatar.edit_hint`).
 */

import { type ComponentProps, useEffect, useId, useState } from "react";
import { Image, Platform, Pressable, Text } from "react-native";
import {
	type AgentAvatarRef,
	createAvatarCache,
	paintedPicture,
} from "@/features/agent-avatar/agent-avatar";
import { useConnection } from "@/features/auth/connection-provider";
import { HEADER_AVATAR_PT } from "@/features/session/header";
import { toBase64 } from "@/features/session/runtime";
import { t } from "@/i18n";
import { useUiStore } from "@/state/ui-store";
import { ROLE } from "@/ui/a11y";
import { ListRow } from "@/ui/components/list-row";
import { TOUCH_FLOOR } from "@/ui/layout";

/** One cache for the process: every row and the header share it, so the list
 *  and the open conversation never fetch the same digest twice. */
const avatarCache = createAvatarCache();

/**
 * The picture's URI for a row, or `null` while there is none to draw.
 *
 * `null` covers loading, absence and failure alike, and every one of them draws
 * the existing glyph: a spinner where a decorative picture would go is noise,
 * and a failed picture is not something a reader can act on. A settled digest
 * paints on the first render (`peek`), so scrolling a recycled row back into
 * view never flashes the glyph.
 */
export const useAgentAvatarUri = (
	ref: AgentAvatarRef | null,
): string | null => {
	const { relay } = useConnection();
	const agentId = ref?.agentId ?? null;
	const sha256 = ref?.sha256 ?? null;
	const [uri, setUri] = useState<string | null>(() =>
		paintedPicture(avatarCache, ref),
	);

	useEffect(() => {
		if (agentId === null || sha256 === null) {
			setUri(null);
			return;
		}
		const key = { agentId, sha256 };
		const settled = avatarCache.peek(key);
		/* A REF CHANGE CANNOT KEEP THE OLD PICTURE. `uri` is state and survives the
		 *  key change, while the new digest's bytes are a round trip away — so the
		 *  previous ref's face painted under the new name in the meantime (review
		 *  round 1, R1; reachable in place, because a picture edited on the desktop
		 *  only changes `avatar_sha256` on the row that is already mounted). Re-ask
		 *  what THIS ref paints, exactly as a fresh mount would: the settled picture,
		 *  or the glyph. */
		setUri(paintedPicture(avatarCache, key));
		if (settled !== undefined) return;
		const client = relay();
		/* No usable route (signed out, switching computers): keep the glyph and
		 *  let the next frame — which re-renders this row — try again. */
		if (client === null) {
			setUri(null);
			return;
		}
		let cancelled = false;
		avatarCache
			.get(key, async (target) => {
				const { bytes, mimeType } = await client.agentAvatar(
					target.agentId,
					target.sha256,
				);
				/* The contract stores PNG, or JPEG over the size cap; the header is
				 *  the authority, PNG the fallback for a relay that sent none. */
				return `data:${mimeType ?? "image/png"};base64,${toBase64(bytes)}`;
			})
			.then((value) => {
				if (!cancelled) setUri(value);
			})
			.catch(() => {
				/* Transport failure: glyph now, retried on the next render (the cache
				 *  does not remember a failure — see `createAvatarCache`). */
				if (!cancelled) setUri(null);
			});
		return () => {
			cancelled = true;
		};
	}, [agentId, sha256, relay]);

	return uri;
};

/** A round picture. Decorative: every place it appears names the agent or the
 *  conversation in text, so a second announcement would only repeat it. */
export const AgentAvatarImage = ({
	uri,
	size,
	testID,
}: {
	uri: string;
	size: number;
	testID?: string;
}) => (
	<Image
		source={{ uri }}
		testID={testID}
		accessible={false}
		accessibilityElementsHidden
		importantForAccessibility="no-hide-descendants"
		// `resizeMode` in the style: the prop form is deprecated in RN 0.86
		// (the same note `transcript-image.tsx` carries).
		style={{
			width: size,
			height: size,
			borderRadius: size / 2,
			resizeMode: "cover",
		}}
	/>
);

/**
 * The session header's picture, LEFT of the conversation name.
 *
 * Rendered only when a picture resolved; otherwise nothing, so a conversation
 * without one keeps today's header exactly (the title budget charges the slot
 * only when `header.ts` is told `avatar: true`, which the screen derives from
 * the same row reference).
 *
 * WHERE IT SITS. Inline it is the last mark of the leading cluster, immediately
 * before the title; stacked (large text or a narrow phone) it leads the TITLE row
 * instead, via `Screen`'s `stackedTitleLeading` — the screen passes the same
 * element to one or the other. Left in the chrome cluster, the stacked header put a
 * 28 pt disc between the back control and search and the health dot at the far
 * left of the line below, which read as an unowned avatar rather than as this
 * conversation's agent (design review round 1, D1).
 *
 * THE PRESS. The phone has no picture editor in this scope, so a tap or a long
 * press shows where the editor IS — "Change this picture in the desktop app" —
 * as a toast. It is a real button (a reader can reach and activate it), with
 * the hint as its accessibility hint too, so the fact is spoken before the press
 * rather than only after it. The box keeps the 28 pt visual size and reaches the
 * touch floor through padding-free `hitSlop` on native; the navigation mark and
 * back control beside it leave the clear space that requires.
 *
 * SCOPED TO THE HEADER ON PURPOSE (agent review round 1, R7). The requirement is
 * "wherever a reader would expect an editor", and on this client that is the open
 * conversation's agent mark — the one control that names the agent. A list row's
 * picture is inside the row's single control, whose tap opens the conversation and
 * whose long press opens the row menu; a third answer to the same two gestures is
 * the row lying about what it does, and a picture is not an editor. So rows show
 * the picture and say nothing, and the header says where the editor is.
 */
export const HeaderAgentAvatar = ({
	avatarRef,
	testID,
}: {
	avatarRef: AgentAvatarRef | null;
	testID?: string;
}) => {
	const uri = useAgentAvatarUri(avatarRef);
	const showToast = useUiStore((state) => state.showToast);
	/* One id per mounted control: react-native-web's `createDOMProps` maps
	 *  `aria-describedby` to the DOM and has NO mapping for `accessibilityHint`, so
	 *  without a described-by node the rendered button carried
	 *  `aria-label="Agent picture"` and no description at all while the source
	 *  promised the hint was spoken (QA round 1, Q1). `useId` rather than a literal
	 *  so two headers can never share one id. */
	const hintId = useId();
	if (uri === null) return null;
	const slop = Math.max(0, (TOUCH_FLOOR - HEADER_AVATAR_PT) / 2);
	const hint = t("mobile.agent_avatar.edit_hint");
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={t("mobile.agent_avatar.label")}
			accessibilityHint={hint}
			{...Platform.select({ web: { "aria-describedby": hintId }, default: {} })}
			hitSlop={slop}
			testID={testID}
			onPress={() => showToast(hint)}
			onLongPress={() => showToast(hint)}
		>
			<AgentAvatarImage uri={uri} size={HEADER_AVATAR_PT} />
			{Platform.OS === "web" ? (
				/* Visually hidden, not hidden: the text is the button's description, so
				 *  it has to exist in the accessibility tree — a `display: none` or
				 *  `aria-hidden` node would leave the button undescribed again. */
				<Text
					nativeID={hintId}
					style={{
						position: "absolute",
						width: 1,
						height: 1,
						overflow: "hidden",
						opacity: 0,
					}}
				>
					{hint}
				</Text>
			) : null}
		</Pressable>
	);
};

/** The list row's picture size: large enough to read as a face, small enough
 *  that the row does not grow, with room for the corner badge. Every row in a list
 *  that carries pictures reserves this width for its title, pictured or not, so
 *  the list has one text edge (`ListRow`'s `leadingSlotPt`). */
export const ROW_AVATAR_PT = 24;

/**
 * A conversation row that resolves its agent's picture.
 *
 * A wrapper rather than a hook call in the list's `renderItem` (a render
 * callback, where hooks may not run). With a resolved picture the row gets it
 * as `leading` and `ListRow` seats the status on the picture's corner; with
 * none — no agent, no digest, an older relay, a remote row, a 404, still
 * loading — `leading` stays undefined and the row is exactly today's, glyph
 * slot and all. The status is therefore never hidden behind the picture.
 */
export const AgentListRow = ({
	avatarRef,
	avatarTestID,
	reserveLeading = false,
	...props
}: ComponentProps<typeof ListRow> & {
	avatarRef: AgentAvatarRef | null;
	/** `sessionRowAvatarId(id)`, built by the caller that owns the id. */
	avatarTestID: string;
	/**
	 * Some row in THIS list has a picture (`avatarRefOf` on the wire, before any
	 * bytes are fetched), so this row reserves the picture's width even without
	 * one: a mixed list keeps ONE title column instead of two (design review round
	 * 1, D4 / agent review round 1, R2). The pane owns the fact because only it sees
	 * every row; the feature owns the width, because the picture's own size is here.
	 */
	reserveLeading?: boolean;
}) => {
	const uri = useAgentAvatarUri(avatarRef);
	return (
		<ListRow
			{...props}
			leadingSlotPt={reserveLeading ? ROW_AVATAR_PT : undefined}
			leading={
				uri === null ? undefined : (
					<AgentAvatarImage
						uri={uri}
						size={ROW_AVATAR_PT}
						testID={avatarTestID}
					/>
				)
			}
		/>
	);
};
