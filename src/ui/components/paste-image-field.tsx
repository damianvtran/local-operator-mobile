import { TextInputWrapper } from "expo-paste-input";
import type { ReactElement } from "react";
import { Platform } from "react-native";

import {
	type FieldPastePayload,
	pastedImageUris,
} from "@/features/session/attach-rule";

/**
 * Lets the message field take a pasted IMAGE (long-press → Paste, or a keyboard
 * that inserts images).
 *
 * A React Native `TextInput` never hands a pasted image to JavaScript: the system
 * menu's Paste inserts text or nothing (TestFlight 578, "I can't paste images
 * into the composer"), which is why the composer grew a clipboard chip. This
 * wraps the field in `expo-paste-input`'s native wrapper, which intercepts the
 * paste, writes the image to a file and reports its URI; a TEXT paste is left to
 * the field untouched. Native only: the web build gets the image from the
 * browser's own paste event (`composer.tsx`), so there it renders the field
 * as it is. With no `onPasteImages` the field is rendered as it was before.
 */
export const PasteImageField = ({
	onPasteImages,
	children,
}: {
	onPasteImages?: (uris: string[]) => void;
	children: ReactElement;
}): ReactElement => {
	if (onPasteImages === undefined || Platform.OS === "web") return children;
	return (
		<TextInputWrapper
			onPaste={(payload: FieldPastePayload) => {
				const uris = pastedImageUris(payload);
				if (uris.length > 0) onPasteImages(uris);
			}}
		>
			{children}
		</TextInputWrapper>
	);
};
