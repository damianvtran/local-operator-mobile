import {
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Animated, Easing, Platform, View } from "react-native";
import { parseCubicBezier } from "@/ui/motion";
import { DURATIONS, EASINGS } from "@/ui/tokens.gen";

const INITIAL_OPACITY = 0.55;
// The smaller, dimmer language label is the limiting pair on a light code
// card. This floor keeps it readable over the canvas without delaying paint.
export const CODE_CARD_INITIAL_OPACITY = 0.96;
const CURVE = EASINGS["out-quart"];

/** RN Web doesn't have the native Animated driver. WAAPI paints opacity without
 * sending per-frame values through React, and starts from a readable first paint. */
export function useWebStreamFade(
	ref: RefObject<unknown>,
	motion: object | string | null,
	initialOpacity = INITIAL_OPACITY,
) {
	useLayoutEffect(() => {
		if (Platform.OS !== "web" || motion === null) return;
		const node = ref.current as HTMLElement | null;
		if (typeof node?.animate !== "function") return;
		// Skip even before RN Web's asynchronous preference read has returned.
		if (
			node.ownerDocument.defaultView?.matchMedia?.(
				"(prefers-reduced-motion: reduce)",
			).matches
		)
			return;
		const selection = node.ownerDocument.getSelection();
		if (selection && !selection.isCollapsed) return;
		const animation = node.animate(
			[{ opacity: initialOpacity }, { opacity: 1 }],
			{
				duration: DURATIONS.fast,
				easing: CURVE,
			},
		);
		animation.id = "transcript-arrival";
		return () => animation.cancel();
	}, [initialOpacity, motion, ref]);
}

function NativeFade({
	active,
	children,
	initialOpacity,
}: {
	active: boolean;
	children: ReactNode;
	initialOpacity: number;
}) {
	const [opacity] = useState(() => new Animated.Value(initialOpacity));
	useLayoutEffect(() => {
		if (!active) {
			opacity.setValue(1);
			return;
		}
		const animation = Animated.timing(opacity, {
			toValue: 1,
			duration: DURATIONS.fast,
			easing: Easing.bezier(...parseCubicBezier(CURVE)),
			useNativeDriver: true,
			// A paint-only fade must not block mounting more virtualized cells.
			isInteraction: false,
		});
		animation.start();
		return () => animation.stop();
	}, [active, opacity]);
	return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

function WebFade({
	active,
	children,
	initialOpacity,
}: {
	active: object | null;
	children: ReactNode;
	initialOpacity: number;
}) {
	const ref = useRef<View>(null);
	useWebStreamFade(ref, active, initialOpacity);
	return <View ref={ref}>{children}</View>;
}

/** Only a newly mounted block gets a wrapper. Keep its type after settling:
 * removing the wrapper would remount the copy/link/diagram state inside it.
 * Native nested Text is virtual, so only this physical View is animated there. */
export function StreamBlock({
	birth,
	motion,
	children,
	initialOpacity = INITIAL_OPACITY,
}: {
	birth: object | null;
	motion: object | null;
	children: ReactNode;
	initialOpacity?: number;
}) {
	// The birth carries paint parameters as well as identity. Reinterpreting an
	// open fence into another block type later must not restart its animation.
	const [born] = useState(() => ({ motion: birth, initialOpacity }));
	if (born.motion === null) return children;
	const active = born.motion === motion ? born.motion : null;
	return Platform.OS === "web" ? (
		<WebFade active={active} initialOpacity={born.initialOpacity}>
			{children}
		</WebFade>
	) : (
		<NativeFade active={active !== null} initialOpacity={born.initialOpacity}>
			{children}
		</NativeFade>
	);
}
