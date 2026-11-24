/**
 * The full emoji picker, as the phone's own emoji keyboard (spec §4.4).
 *
 * WHY NO BUNDLED PICKER. The desktop ships a 3,963-entry corpus with search,
 * categories and skin tones; on a phone the system emoji keyboard already is
 * all of that, in the reader's language, with their recents — and it costs no
 * dependency and no bytes. So the quick row's `+` focuses this visually hidden
 * field and the first single emoji typed into it becomes the reaction.
 *
 * CONSTRAINTS:
 *  - Stock React Native cannot force the iOS keyboard onto its emoji plane,
 *    so the field opens the last-used keyboard and one line above it says
 *    "Pick an emoji from your keyboard". Android's Gboard is one tap away.
 *  - Anything that is not one emoji (a letter, a space, two emoji pasted) is
 *    cleared and the hint stays; the first emoji grapheme wins (`firstEmoji`).
 *  - Leaving the field (keyboard dismissed) cancels; nothing is sent.
 * If a rendered frame shows this is clumsy, the spec's fallback is an in-app
 * grid of the quick + frequent emoji in a follow-up PR, not here.
 */
import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useKeyboardFrame } from "@/features/session/keyboard-frame";
import { t } from "@/i18n";
import { firstEmoji } from "@/team-bridge/reactions";
import { SURFACE } from "@/ui/a11y";

export function EmojiCapture({
	active,
	onPick,
	onCancel,
}: {
	/** Focus the field now (the sheet has finished dismissing). */
	active: boolean;
	onPick: (emoji: string) => void;
	onCancel: () => void;
}) {
	const input = useRef<TextInput>(null);
	const settled = useRef(false);
	const [value, setValue] = useState("");
	const keyboard = useKeyboardFrame();
	useEffect(() => {
		if (!active) return;
		settled.current = false;
		setValue("");
		input.current?.focus();
	}, [active]);
	if (!active) return null;
	return (
		<View
			pointerEvents="box-none"
			className="absolute start-0 end-0"
			style={{ bottom: keyboard.overlap }}
		>
			<TextInput
				ref={input}
				testID={SURFACE.teamBridgeEmojiCapture}
				accessibilityLabel={t("mobile.team_bridge.reactions.add")}
				accessibilityHint={t("mobile.team_bridge.reactions.keyboard_hint")}
				value={value}
				autoCorrect={false}
				autoCapitalize="none"
				spellCheck={false}
				/* Kept tiny and transparent rather than `display: none`: a field
				 *  that is not laid out cannot take focus or raise a keyboard. */
				style={HIDDEN_FIELD}
				onChangeText={(text) => {
					const emoji = firstEmoji(text);
					if (!emoji) {
						setValue("");
						return;
					}
					if (settled.current) return;
					// Blur can dispatch synchronously. Mark completion first so its
					// cancellation path cannot restore focus or finish a second time.
					settled.current = true;
					setValue("");
					input.current?.blur();
					onPick(emoji);
				}}
				onBlur={() => {
					if (settled.current) return;
					settled.current = true;
					onCancel();
				}}
			/>
			<View className="border-t border-hairline bg-elevated px-4 py-2">
				<Text className="text-meta text-ink-muted">
					{t("mobile.team_bridge.reactions.keyboard_hint")}
				</Text>
			</View>
		</View>
	);
}

const HIDDEN_FIELD = {
	position: "absolute",
	width: 1,
	height: 1,
	opacity: 0,
} as const;
