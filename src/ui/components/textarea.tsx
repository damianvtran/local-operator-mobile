import { useCallback, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { ROLE, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { TOUCH_FLOOR } from "@/ui/layout";
import { type FieldState, fieldClasses, TEXTAREA_MAX_PX } from "@/ui/variants";

/**
 * A multi-line field that grows to six lines and then scrolls.
 *
 * The cap is the point: a field that grows without bound pushes everything above
 * it off the top of the screen, and on a phone the thing above it is the
 * transcript the reader was reading (docs/design/components.md § 4,
 * `MAX_TEXTAREA_PX = 6 * 22` in the shipped client).
 *
 * Sending is NOT this component's job. On a hardware keyboard Enter sends and
 * Shift+Enter inserts a newline, but on a touch keyboard the send control is the
 * only way to send — there is no way to type a newline otherwise. That means the
 * key handling belongs where the send action lives, so this component advertises
 * what the keyboard should offer (`enterKeyHint`/`returnKeyType`) and leaves the
 * decision to the composer.
 */
export type TextareaProps = {
	/** The field's accessible name. Required — a placeholder is not one. */
	label: string;
	value: string;
	onChangeText: (value: string) => void;
	placeholder?: string;
	invalid?: boolean;
	disabled?: boolean;
	/** Six lines by default; the composer may raise it, never remove it. */
	maxLines?: number;
	onSubmitEditing?: () => void;
	autoFocus?: boolean;
	testID: string;
};

/** One line's height, from the type ramp: `mono-code` is 13pt at 1.6, rounded up
 * to the shipped client's 22px. Kept as one constant so the cap and the growth
 * step cannot disagree. */
const LINE_PX = 22;

export const Textarea = ({
	label,
	value,
	onChangeText,
	placeholder,
	invalid = false,
	disabled = false,
	maxLines = 6,
	onSubmitEditing,
	autoFocus,
	testID,
}: TextareaProps) => {
	const [contentHeight, setContentHeight] = useState(LINE_PX);
	const cap = Math.min(maxLines * LINE_PX, TEXTAREA_MAX_PX);
	const fieldState: FieldState = disabled
		? "disabled"
		: invalid
			? "invalid"
			: "rest";
	const inputRef = useRef<TextInput>(null);
	// React Native takes the placeholder as a colour VALUE, not a class.
	const placeholderColour = useTokenColor("ink-muted");

	const handleContentSize = useCallback(
		(event: { nativeEvent: { contentSize: { height: number } } }) => {
			setContentHeight(event.nativeEvent.contentSize.height);
		},
		[],
	);

	return (
		<View className="gap-1.5">
			<Text className="text-body-sm text-ink-muted">{label}</Text>
			<TextInput
				ref={inputRef}
				className={fieldClasses(fieldState)}
				/* One `style`, because a textarea's box IS its visual: the growing height
				 *  and the platform floor (48 wherever `Platform.OS` is not iOS — the
				 *  web/audit profile) have to be resolved together (D6). */
				style={{
					height: Math.min(Math.max(contentHeight, LINE_PX), cap),
					minHeight: TOUCH_FLOOR,
				}}
				multiline
				// The transcript scrolls, not the page: the field clips its own
				// overflow once it hits the cap.
				scrollEnabled={contentHeight > cap}
				onContentSizeChange={handleContentSize}
				accessibilityRole={ROLE.text}
				accessibilityLabel={label}
				accessibilityState={state({ disabled })}
				value={value}
				onChangeText={onChangeText}
				placeholder={placeholder}
				placeholderTextColor={placeholderColour}
				editable={!disabled}
				onSubmitEditing={onSubmitEditing}
				// A hardware keyboard offers Send; Shift+Enter still inserts a newline
				// and is handled by the composer, which owns the send action.
				returnKeyType="send"
				inputMode="text"
				autoFocus={autoFocus}
				testID={testID}
			/>
		</View>
	);
};
