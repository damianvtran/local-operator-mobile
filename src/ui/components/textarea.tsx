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
	/** The most lines a WRAPPED placeholder may add to the field's resting height.
	 *  Unset keeps the shipped growth (design round D20: the box grows so a wrapped
	 *  placeholder is not cut mid-word). The composer passes `1` instead — its resting
	 *  height must stay stable (§2.5 D1), because on the 320 pt phone the placeholder
	 *  grew past the field at 150/200 % text and pushed the last transcript row past
	 *  the scroller (design round 1, D1/D2). At `1` the empty and the one-line states
	 *  are equal by construction, whichever way the placeholder wraps. */
	placeholderMaxLines?: number;
	onSubmitEditing?: () => void;
	autoFocus?: boolean;
	/** A handle to the platform field, for the one caller that must FOCUS it —
	 *  the home's New chat row, which closes the drawer and puts the caret where
	 *  the reader is about to type. Optional: every other caller leaves it out
	 *  and the internal ref is used as before. */
	fieldRef?: React.RefObject<TextInput | null>;
	testID: string;
};

/** The CAP's line, from the type ramp: `mono-code` is 13pt at 1.6, rounded up to the
 * shipped client's 22px. It sizes the six-line ceiling (`maxLines * line`, itself
 * capped at `TEXTAREA_MAX_PX`) — the box's growth step is `BODY_LINE_PX`, which is
 * what a filled line actually measures. Both are MULTIPLIED by the reader's
 * effective scale at the call site, because the box's geometry has to grow with the
 * text that fills it. Without that, the constants cap the box at ~1.4 lines of
 * 200 % text while the placeholder needs ~2.5, and the frame cuts it mid-word
 * (design round D20; the arithmetic was the defect, not the measurement path). */
const LINE_PX = 22;

/** The line box of the field's OWN type: `text-body` is 16 pt at 1.5 → 24 pt, and
 *  a FILLED field reports exactly this from `contentSize` for its first line.
 *
 *  It is a second constant, and not `LINE_PX`, because the two were conflated as
 *  the EMPTY field's floor and only there do they disagree: `LINE_PX` is the
 *  ramp's 13 pt `mono-code` line the six-line CAP was measured with, so an empty
 *  field rested at `22 × scale` while the first typed character reported
 *  `24 × scale`. The field then settled 4 pt taller at 150 % text and 16 pt at
 *  200 %, moving the whole composer and the transcript above it on the first
 *  keystroke — masked at 100 % only by `minHeight` being 48 there (design round 2,
 *  D1: measured 48→52 and 48→64 on the field and the composer). Deriving the
 *  empty floor from THIS constant is what makes the two states equal at every
 *  scale rather than equal-by-accident at one. */
const BODY_LINE_PX = 24;

export const Textarea = ({
	label,
	value,
	onChangeText,
	placeholder,
	invalid = false,
	disabled = false,
	maxLines = 6,
	placeholderMaxLines,
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
	/* The one-line box a FILLED field rests at, and therefore the floor an EMPTY one
	 * must take (see `BODY_LINE_PX`). Both the empty floors below and the minimum
	 * term in the height come from it, so the two states are equal by construction
	 * at every scale — the invariant design §2.5 D1 asks for. */
	const bodyLine = BODY_LINE_PX * effectiveScale;
	const cap = Math.min(maxLines * line, TEXTAREA_MAX_PX * effectiveScale);
	const [contentHeight, setContentHeight] = useState(line);
	/* The placeholder is not part of `contentSize`, so the floor has to come from its
	 * own render: same typography, same width, measured in place inside a zero-height
	 * wrapper so it costs no layout. An estimate (a line count times a line height)
	 * would be a guess at exactly the thing being fixed. */
	const [placeholderHeight, setPlaceholderHeight] = useState(0);
	/* What the placeholder may claim of the resting height: all of it by default,
	 * clamped to the caller's line budget when one is given (see
	 * `placeholderMaxLines`). */
	const placeholderFloor =
		placeholderMaxLines === undefined
			? placeholderHeight
			: Math.min(placeholderHeight, bodyLine * placeholderMaxLines);
	/* The capped placeholder is drawn by US, not by the platform. A `<textarea>`'s
	 * `::placeholder` cannot be told to stop wrapping, and one that wraps paints its
	 * second line straight through the field's box (measured on the 320 pt phone once
	 * the box was held to one line: “Operator…” bled over the receipt row). The offset
	 * is the field's own border + padding — `fieldClasses`: `border px-3 py-2` — which
	 * is also where the platform paints its placeholder, so the two agree. */
	const clampedPlaceholder =
		placeholder !== undefined &&
		value === "" &&
		placeholderMaxLines !== undefined;
	/* Why `contentHeight` is floored too, and only here: on web an EMPTY field's
	 * `scrollHeight` includes the placeholder, so the content report carries the
	 * placeholder's own wrapped height into the box and would defeat the cap by
	 * exactly the growth it exists to stop (measured: the composer's field sat at
	 * 64 pt at 100 % and 160 pt at 200 % with `placeholderMaxLines={1}` set and the
	 * content report still in play). With a cap, an empty field rests at one line
	 * and a filled one is unaffected — `value !== ""` keeps the growth for typed
	 * text, which is what the box is for. */
	const contentFloor =
		placeholderMaxLines !== undefined && value === ""
			? bodyLine
			: contentHeight;
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
			 *  lays out and reports its own height without moving anything — which is why
			 *  it lives INSIDE the field's own wrapper: as a child of the root's `gap-1.5`
			 *  column it contributed a 6 pt gap in the empty state and none once a
			 *  character was typed, so the resting composer was 6 pt taller empty than
			 *  one-line on the 320 pt phone (measured 80.3 vs 74.3 pt on the field's root;
			 *  design §2.5 D1 requires the two to be equal).
			 *
			 *  WHY a second rendering exists: a placeholder is not part of the field's
			 *  `contentSize`, so nothing else can tell the box how tall the WRAPPED
			 *  placeholder is — and it needs to know, because at 200 % text the placeholder
			 *  takes ~2.5 lines and the box would otherwise cut it mid-word (design round
			 *  D20). This copy is a height measurement, not a colour one: the placeholder's
			 *  own colour IS readable from the DOM (`getComputedStyle(el, "::placeholder")`),
			 *  so nothing about its legibility depends on this element.
			 *
			 *  What the copy must not do is disagree with the field about the thing it stands
			 *  in for, and it stands in for the placeholder — so it takes the placeholder's
			 *  ink from the same `placeholderColour` the field hands to
			 *  `placeholderTextColor`: one value, two renderings of the same string. Left to
			 *  inherit, it took the platform default, black, which on the dark canvas is
			 *  1.29:1 and outside every ink this palette owns (`ink-disabled`, the dimmest,
			 *  is 2.37:1 there).
			 *
			 *  One consequence worth naming: this copy is a real text node while the
			 *  placeholder is a pseudo-element, so the frame audit's U-02 reads THIS element
			 *  when it asks about a placeholder. That is proxy coverage — the pair is pinned
			 *  directly in design/tokens/contrast-contract.mjs (`input/placeholder`), and
			 *  src/ui/components/textarea.test.ts fails if the two are ever given
			 *  different inks. */}
			<View className="relative">
				{placeholder !== undefined && value === "" ? (
					<View className="h-0 overflow-hidden" aria-hidden>
						<Text
							className="text-body"
							style={{ color: placeholderColour }}
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
							Math.max(contentFloor, bodyLine, placeholderFloor),
							cap,
						),
						minHeight: TOUCH_FLOOR,
					}}
					multiline
					// The transcript scrolls, not the page: the field clips its own
					// overflow once it hits the cap.
					scrollEnabled={Math.max(contentFloor, placeholderFloor) > cap}
					onContentSizeChange={handleContentSize}
					accessibilityRole={ROLE.text}
					accessibilityLabel={label}
					accessibilityState={state({ disabled })}
					value={value}
					onChangeText={onChangeText}
					placeholder={clampedPlaceholder ? undefined : placeholder}
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
				{/* Painted AFTER the field, because the field's own fill is opaque: an
				 *  overlay underneath it would never be seen. `pointerEvents="none"` so every
				 *  tap still reaches the field, and `aria-hidden` because the field's `label`
				 *  is already its accessible name. */}
				{clampedPlaceholder ? (
					<Text
						className="text-body"
						style={{
							position: "absolute",
							left: 13,
							right: 13,
							top: 9,
							color: placeholderColour,
						}}
						numberOfLines={1}
						ellipsizeMode="tail"
						pointerEvents="none"
						aria-hidden
					>
						{placeholder}
					</Text>
				) : null}
			</View>
		</View>
	);
};
