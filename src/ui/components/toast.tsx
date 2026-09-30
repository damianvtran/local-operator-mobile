import { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { type ToastTone, useUiStore } from "@/state/ui-store";
import { CONTROL } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { DURATIONS, Z_LEVELS } from "@/ui/tokens.gen";
import { TOAST_EXIT_MS, TOAST_MIN_MS, toastClasses } from "@/ui/variants";

/**
 * A toast: transient confirmation for something that already happened and has no
 * place else to appear ("Copied", "Approval sent"). docs/design/components.md § 10.
 *
 * Three rules the component enforces rather than documents:
 *
 *   - **One at a time.** A second replaces the first, because a queue on a phone
 *     is a stack of things nobody reads. That is the store's rule, and this host
 *     renders whatever the store holds.
 *   - **Never for a failure.** A failure the reader must act on is an Alert or the
 *     pending card; a toast that disappears cannot carry an action. `tone` here
 *     colours the leading glyph and nothing else — the copy carries the meaning.
 *   - **Exit is a fade, never a slide.** A slide reads as a sheet, and a reader who
 *     thinks a sheet is closing looks for what it covered.
 */
const GLYPH: Record<ToastTone, string> = {
	neutral: "·",
	success: "✓",
	danger: "✗",
};

const GLYPH_ROLE: Record<ToastTone, "ink-muted" | "success" | "danger"> = {
	neutral: "ink-muted",
	success: "success",
	danger: "danger",
};

export const Toast = ({
	message,
	tone = "neutral",
	testID,
}: {
	message: string;
	tone?: ToastTone;
	testID?: string;
}) => {
	const glyphColour = useTokenColor(GLYPH_ROLE[tone]);
	return (
		<View className={toastClasses} testID={testID} accessibilityRole="alert">
			<Text className="text-mono" style={{ color: glyphColour }} aria-hidden>
				{GLYPH[tone]}
			</Text>
			<Text className="flex-1 text-body-sm text-ink">{message}</Text>
		</View>
	);
};

/**
 * Renders the store's current toast and retires it.
 *
 * The timer lives here rather than in the store on purpose: a store that owns
 * timers cannot be tested without fake clocks, and the replacement rule — the
 * part with a rule to get wrong — is pure state.
 */
export const ToastHost = () => {
	const toast = useUiStore((state) => state.toast);
	const dismiss = useUiStore((state) => state.dismissToast);
	const reduceMotion = useReducedMotion();
	const fade = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		if (!toast) return;
		// Appear, hold for the readable minimum, then leave. Under reduced motion
		// the fade is skipped entirely: it appears, stays for the same time, and
		// disappears — the timing is a reading budget, not decoration.
		fade.setValue(reduceMotion ? 1 : 0);
		if (!reduceMotion) {
			Animated.timing(fade, {
				toValue: 1,
				duration: DURATIONS.fast,
				useNativeDriver: true,
			}).start();
		}
		const timer = setTimeout(() => {
			if (reduceMotion) {
				dismiss();
				return;
			}
			Animated.timing(fade, {
				toValue: 0,
				duration: TOAST_EXIT_MS,
				useNativeDriver: true,
			}).start(({ finished }) => {
				if (finished) dismiss();
			});
		}, TOAST_MIN_MS);
		return () => clearTimeout(timer);
	}, [toast, dismiss, fade, reduceMotion]);

	if (!toast) return null;

	return (
		<View
			className="absolute inset-x-4 bottom-4 items-center"
			// Above the composer in the token's z ladder, inside the safe area. The
			// screen owns the bottom padding, because the keyboard offset is decided
			// where the composer is.
			style={{ zIndex: Z_LEVELS.toast }}
		>
			<Animated.View style={{ opacity: fade }} className="w-full">
				<Toast
					message={toast.message}
					tone={toast.tone}
					testID={CONTROL.toast}
				/>
			</Animated.View>
		</View>
	);
};
