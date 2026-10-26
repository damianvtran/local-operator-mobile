import { Image, Text, View } from "react-native";

import { AVATAR_SIZES, type AvatarSize, avatarClasses } from "@/ui/variants";

/**
 * A circular identity mark: the account, a peer.
 *
 * `radius.full` — a circle is what the avatar IS, and `full` is the kit's token
 * for that (tokens.json § radius.assignment).
 *
 * A photo when the caller has one, initials otherwise. The primitive never
 * fetches: `imageUri` is an already-resolved local URI (Team Bridge hands it
 * the `data:` URI of bytes read with the bearer, `src/team-bridge/avatars.ts`),
 * because a remote URL here would be fetched without auth. Initials stay
 * painted UNDER the photo, so a slow decode shows the initials rather than an
 * empty circle, and a decode failure (`onImageError`) leaves exactly what
 * there was before. No placeholder image is ever drawn: a generic silhouette
 * would be a lie about what the account provides.
 *
 * Both renderings are decorative (the surrounding row names the account), so
 * the mark is hidden from the accessibility tree and the accessible name comes
 * from the caller's label.
 */
export type AvatarProps = {
	/** One or two characters. Derived from the account label by the caller. */
	initials: string;
	size?: AvatarSize;
	/** A local (`data:`/`file:`) URI to show over the initials. Never a remote URL. */
	imageUri?: string | null;
	/** The decoder refused `imageUri`; the caller drops it so initials remain. */
	onImageError?: () => void;
	accessibilityLabel?: string;
	testID?: string;
};

const NAME_SEPARATOR = /[\s@._-]+/;

/** Does this label carry a letter at all? Top-level so the check is compiled once,
 *  which is also the lint rule this module and `biome` share. */
const HAS_LETTER = /[A-Za-z]/;

/** Take the initials of a display name. Pure, so it is unit-tested rather than
 * trusted: an empty label must not produce a blank circle with no explanation. */
export const initialsOf = (label: string): string => {
	const parts = label
		.split(NAME_SEPARATOR)
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) return "?";
	/* A label that yields no LETTER is not a name: a host label ("127.0.0.1:22501")
	 * put "10" in an identity circle in the Settings row and in the list, which reads
	 * as a count rather than as a mark (D11). The caller prefers a real name where it
	 * has one; this is the floor. */
	if (!HAS_LETTER.test(label)) return "?";
	if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
	return (
		(parts[0] as string).charAt(0) + (parts[1] as string).charAt(0)
	).toUpperCase();
};

export const Avatar = ({
	initials,
	size = "md",
	imageUri,
	onImageError,
	accessibilityLabel,
	testID,
}: AvatarProps) => (
	<View
		className={avatarClasses(size)}
		accessible={accessibilityLabel !== undefined}
		accessibilityRole={accessibilityLabel ? "image" : undefined}
		accessibilityLabel={accessibilityLabel}
		testID={testID}
	>
		<Text
			className={`${AVATAR_SIZES[size].text} font-semibold text-accent-active dark:text-accent-hover`}
			// The initials are a rendering of the label, not a second name for it.
			accessibilityElementsHidden
			importantForAccessibility="no"
		>
			{initials}
		</Text>
		{imageUri ? (
			<Image
				source={{ uri: imageUri }}
				// Laid over the initials at the circle's own size; `avatarClasses`
				// clips it. `resizeMode` in the style: the prop form is deprecated in
				// RN 0.86 and warns per render (`transcript-image.tsx`, same reason).
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: AVATAR_SIZES[size].px,
					height: AVATAR_SIZES[size].px,
					resizeMode: "cover",
				}}
				accessibilityElementsHidden
				importantForAccessibility="no"
				onError={onImageError}
			/>
		) : null}
	</View>
);
