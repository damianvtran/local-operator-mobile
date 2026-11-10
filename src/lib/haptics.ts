import { Platform } from "react-native";

/**
 * Light tactile feedback, behind ONE helper.
 *
 * WHY (perf audit P16). `expo-haptics` has shipped in the binary since the
 * first build and nothing called it: a send, a sheet arriving and a
 * destructive confirm all felt the same as a missed tap. Three moments get a
 * tick now, and only three — haptics that fire on every press stop meaning
 * anything:
 *
 *  - `light`     an action was taken (send);
 *  - `selection` a surface arrived or left (a sheet opening or closing);
 *  - `warning`   a destructive choice was confirmed.
 *
 * CONSTRAINTS, each of which is why this is a helper and not three imports:
 *
 *  - WEB IS A NO-OP, decided before the module is touched. A browser has no
 *    haptic engine worth driving (`navigator.vibrate` is a buzz, not a tick),
 *    and the unit suite runs in Node through react-native-web, where importing
 *    a native module is at best dead weight.
 *  - LAZY, via `import()`: the same idiom `connection/storage.ts` uses for
 *    `expo-secure-store`, so a build without the native module loses the tick
 *    rather than the screen.
 *  - NEVER THROWS, NEVER AWAITED. A haptic is decoration on an action that has
 *    already happened; a rejected promise (Low Power Mode, no Taptic Engine, a
 *    simulator) must not surface as an unhandled rejection or delay the action.
 *  - The OS owns the user's preference: iOS "System Haptics" and Android's
 *    touch-feedback setting silence these calls themselves, so there is no
 *    in-app switch to drift from the system one.
 */
export type HapticKind = "light" | "selection" | "warning";

type HapticsModule = {
	impactAsync: (style?: never) => Promise<void>;
	selectionAsync: () => Promise<void>;
	notificationAsync: (type?: never) => Promise<void>;
	ImpactFeedbackStyle: { Light: unknown };
	NotificationFeedbackType: { Warning: unknown };
};

/**
 * The decision and the dispatch, with the platform and the loader injected so
 * the unit test can drive every branch without a device (`haptics.test.ts`).
 */
export const createHaptic = (deps: {
	os: () => string;
	load: () => Promise<HapticsModule>;
}) => {
	let loading: Promise<HapticsModule | null> | null = null;
	return (kind: HapticKind): void => {
		if (deps.os() === "web") return;
		try {
			if (loading === null) loading = deps.load().catch(() => null);
			void loading
				.then((module) => {
					if (module === null) return undefined;
					if (kind === "selection") return module.selectionAsync();
					if (kind === "warning")
						return module.notificationAsync(
							module.NotificationFeedbackType.Warning as never,
						);
					return module.impactAsync(module.ImpactFeedbackStyle.Light as never);
				})
				.catch(() => undefined);
		} catch {
			/* A loader that throws synchronously is the same "no haptics here". */
		}
	};
};

export const haptic = createHaptic({
	os: () => Platform.OS,
	load: async () => (await import("expo-haptics")) as unknown as HapticsModule,
});
