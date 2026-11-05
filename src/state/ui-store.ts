import { create } from "zustand";

import {
	DEFAULT_SELECTION,
	type ThemeMode,
	type ThemeSelection,
} from "@/state/theme-preference";

/**
 * The shell's UI state: appearance, and the one transient message slot.
 *
 * Deliberately free of React Native imports. Two consequences, both wanted:
 * the store is testable in Node like any other pure module, and a component that
 * needs appearance state gets it from here rather than reading `Appearance`
 * itself — so "which theme is active" has exactly one answer in the app.
 *
 * Not here yet, and deliberately: the connection stores (`connection-store`,
 * `list-store`, `projection-store`) belong to the protocol streams, and the sheet
 * slot for the model/effort pickers arrives with the screens that open them. A
 * field nothing reads is worse than a missing field, because it looks wired.
 */

/** A transient message. `tone` picks the leading glyph's colour role only —
 * the copy carries the meaning. */
export type ToastTone = "neutral" | "success" | "danger";

export type Toast = {
	/** Monotonic, so a re-render of the same message restarts its timer rather
	 * than being swallowed as a duplicate. */
	id: number;
	message: string;
	tone: ToastTone;
};

export type UiState = {
	/** What the reader chose in Settings: a mode, and a theme for each side.
	 *  `system` follows the OS appearance (`theme-preference.ts`). */
	themeSelection: ThemeSelection;
	setThemeSelection: (selection: ThemeSelection) => void;
	/** Only the mode, for the controls that predate the theme slots. */
	setThemeMode: (mode: ThemeMode) => void;
	/** Whether the stored selection has been read. Until it has, the provider
	 *  must not WRITE: the default it holds would overwrite the reader's choice. */
	themeHydrated: boolean;
	hydrateThemeSelection: (selection: ThemeSelection) => void;

	/** **One at a time.** A second toast replaces the first: a queue on a phone
	 * is a stack of things nobody reads (docs/design/components.md § 10). */
	toast: Toast | null;
	showToast: (message: string, tone?: ToastTone) => void;
	dismissToast: () => void;
};

export const useUiStore = create<UiState>((set) => {
	// The id counter lives in the closure rather than in state: it is not
	// renderable, and putting it in state would make every toast a state shape
	// consumers could accidentally depend on.
	let nextToastId = 0;
	return {
		themeSelection: DEFAULT_SELECTION,
		setThemeSelection: (selection) => set({ themeSelection: selection }),
		setThemeMode: (mode) =>
			set((state) => ({ themeSelection: { ...state.themeSelection, mode } })),
		themeHydrated: false,
		// A choice the reader made before the stored one was read wins: hydration
		// only fills the default, it never undoes a tap.
		hydrateThemeSelection: (selection) =>
			set((state) =>
				state.themeHydrated
					? {}
					: {
							themeHydrated: true,
							themeSelection:
								state.themeSelection === DEFAULT_SELECTION
									? selection
									: state.themeSelection,
						},
			),

		toast: null,
		showToast: (message, tone = "neutral") =>
			set({ toast: { id: ++nextToastId, message, tone } }),
		dismissToast: () => set({ toast: null }),
	};
});
