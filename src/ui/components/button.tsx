import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { ROLE, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import {
	BUTTON_VISUAL_HEIGHT,
	type ButtonSize,
	type ButtonVariant,
	buttonClasses,
	slopToFloor,
} from "@/ui/variants";

/**
 * The one action affordance. Anything that NAVIGATES is a link, not a button
 * (docs/design/components.md § 2, anti-pattern 11).
 *
 * Icons arrive as a render prop taking `{ color, size }` rather than as an
 * element. That is deliberate: a vector icon needs a colour VALUE, not a class
 * name, so an element-shaped API would force every call site to reach for a hex —
 * the one thing the design system forbids. Here the component resolves the token
 * and the caller cannot spell the colour at all.
 */
export type ButtonProps = {
	label: string;
	onPress: () => void;
	variant?: ButtonVariant;
	size?: ButtonSize;
	/** Leading icon slot: `size.controls.*.icon`, `pointer-events: none`. */
	leadingIcon?: (props: { color: string; size: number }) => ReactNode;
	loading?: boolean;
	disabled?: boolean;
	accessibilityHint?: string;
	/** Required: a control with no identifier cannot be reached by an E2E flow,
	 * and a shared default would put the same one on every button of a screen. */
	testID: string;
};

const ICON_SIZE: Record<ButtonSize, number> = {
	sm: 14,
	md: 16,
	lg: 18,
	icon: 20,
	fab: 24,
};

export const Button = ({
	label,
	onPress,
	variant = "primary",
	size = "md",
	leadingIcon,
	loading = false,
	disabled = false,
	accessibilityHint,
	testID,
}: ButtonProps) => {
	const iconColor = useTokenColor(
		disabled ? "ink-disabled" : variant === "primary" ? "on-accent" : "ink",
	);
	const spinnerColor = useTokenColor(
		variant === "primary" ? "on-accent" : "ink-muted",
	);
	const visualHeight = BUTTON_VISUAL_HEIGHT[size];

	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={label}
			accessibilityHint={accessibilityHint}
			accessibilityState={state({ disabled, busy: loading })}
			// `sm` is the one size under the 44pt floor; it gets hit slop rather
			// than a smaller target (components.md § 0.1). Hit areas must not
			// overlap, so this is only for controls with clear space around them.
			hitSlop={visualHeight < 44 ? slopToFloor(visualHeight) : undefined}
			testID={testID}
			disabled={disabled}
			onPress={() => {
				// A busy control keeps its own colour instead of taking the disabled
				// binding: it is not disabled, it is in flight, and a control that
				// greys out mid-press reads as a failure.
				if (loading || disabled) return;
				onPress();
			}}
		>
			{({ pressed }) => (
				<View className={buttonClasses(variant, size, { pressed, disabled })}>
					{loading ? (
						<ActivityIndicator
							size="small"
							color={spinnerColor}
							// A spinner is not content; the label is what a reader needs,
							// and it stays visible (components.md § 0, `loading`).
							accessibilityElementsHidden
							importantForAccessibility="no"
						/>
					) : leadingIcon ? (
						<View pointerEvents="none">
							{leadingIcon({ color: iconColor, size: ICON_SIZE[size] })}
						</View>
					) : null}
					{size === "icon" || size === "fab" ? null : (
						<Text className={buttonLabelClasses(size, disabled, variant)}>
							{label}
						</Text>
					)}
				</View>
			)}
		</Pressable>
	);
};

/** The label's own colour comes from the variant, so it is expressed as a role
 * rather than inherited — React Native does not inherit text colour from a View. */
const buttonLabelClasses = (
	size: ButtonSize,
	disabled: boolean,
	variant: ButtonVariant,
): string => {
	const ink = disabled
		? "text-ink-disabled"
		: variant === "primary"
			? "text-on-accent"
			: variant === "danger"
				? "text-danger"
				: variant === "quiet"
					? "text-ink-muted"
					: "text-ink";
	const type = size === "sm" ? "text-meta" : "text-label";
	return `${type} ${ink}`;
};
