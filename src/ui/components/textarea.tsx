import { useCallback, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { ROLE, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";
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
	/** A handle to the platform field, for the one caller that must FOCUS it —
	 *  the home's New chat row, which closes the drawer and puts the caret where
	 *  the reader is about to type. Optional: every other caller leaves it out
	 *  and the internal ref is used as before. */
	fieldRef?: React.RefObject<TextInput | null>;
	testID: string;
};

/** One line's height, from the type ramp: `mono-code` is 13pt at 1.6, rounded up
 * to the shipped client's 22px. Kept as one constant so the cap and the growth
 * step cannot disagree — and MULTIPLIED by the reader's effective scale at the call
 * site, because the box's geometry has to grow with the text that fills it. Without
 * that, the constants cap the box at ~1.4 lines of 200 % text while the placeholder
 * needs ~2.5, and the frame cuts it mid-word (design round D20; the arithmetic was
 * the defect, not the measurement path). */
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
	fieldRef,
	testID,
}: TextareaProps) => {
	const { effectiveScale } = useTextScale();
	/* One line's height and the cap, both at the reader's scale. At the default scale
	 * these are exactly the old constants — 22 and `maxLines * 22` capped at
	 * `TEXTAREA_MAX_PX` — so the 100 % geometry is unchanged by construction. */
	const line = LINE_PX * effectiveScale;
	const cap = Math.min(maxLines * line, TEXTAREA_MAX_PX * effectiveScale);
	const [contentHeight, setContentHeight] = useState(line);
	/* The placeholder is not part of `contentSize`, so the floor has to come from its
	 * own render: same typography, same width, measured in place inside a zero-height
	 * wrapper so it costs no layout. An estimate (a line count times a line height)
	 * would be a guess at exactly the thing being fixed. */
	const [placeholderHeight, setPlaceholderHeight] = useState(0);
	const fieldState: FieldState = disabled
		? "disabled"
		: invalid
			? "invalid"
			: "rest";
	const inputRef = useRef<TextInput | null>(null);
	/* The caller's handle wins: it exists so the home can focus the field, and
	 *  the internal one is never read — only forwarded to the element. */
	const resolvedRef = fieldRef ?? inputRef;
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
			{/* Only while it is the thing on screen: any value hides it, so it can never
			 *  need room the content is already taking. Zero height and clipped, so it
			 *  lays out and reports its own height without moving anything.
			 *
			 *  `text-ink-muted` — the SAME ink the real placeholder renders with — is
			 *  load-bearing rather than cosmetic: the audit measures text nodes in the
			 *  DOM and does not know this one is invisible, so an unset ink was read as
			 *  the browser default (black, 1.29:1 on the dark canvas) and reported as a
			 *  placeholder contrast failure (R-5). Mirroring the visible placeholder's
			 *  ink makes the measurement describe the placeholder the reader sees. */}
			{placeholder !== undefined && value === "" ? (
				<View className="h-0 overflow-hidden" aria-hidden>
					<Text
						className="text-body text-ink-muted"
						onLayout={(event) =>
							setPlaceholderHeight(event.nativeEvent.layout.height)
						}
						pointerEvents="none"
					>
						{placeholder}
					</Text>
				</View>
			) : null}
			<TextInput
				ref={resolvedRef}
				className={fieldClasses(fieldState)}
				/* One `style`, because a textarea's box IS its visual: the growing height
				 *  and the platform floor (48 wherever `Platform.OS` is not iOS — the
				 *  web/audit profile) have to be resolved together (D6). */
				style={{
					height: Math.min(
						Math.max(contentHeight, line, placeholderHeight),
						cap,
					),
					minHeight: TOUCH_FLOOR,
				}}
				multiline
				// The transcript scrolls, not the page: the field clips its own
				// overflow once it hits the cap.
				scrollEnabled={Math.max(contentHeight, placeholderHeight) > cap}
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
