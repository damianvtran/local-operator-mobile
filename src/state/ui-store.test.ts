import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SELECTION } from "@/state/theme-preference";
import { useUiStore } from "@/state/ui-store";

const reset = () =>
	useUiStore.setState({
		themeSelection: DEFAULT_SELECTION,
		themeHydrated: false,
		toast: null,
	});

describe("ui-store", () => {
	beforeEach(reset);

	it("follows the device until the reader chooses otherwise", () => {
		expect(useUiStore.getState().themeSelection.mode).toBe("system");
	});

	it("records a manual override and lets the reader return to the device", () => {
		useUiStore.getState().setThemeMode("dark");
		expect(useUiStore.getState().themeSelection.mode).toBe("dark");
		useUiStore.getState().setThemeMode("system");
		expect(useUiStore.getState().themeSelection.mode).toBe("system");
	});

	it("keeps the slots when only the mode changes", () => {
		useUiStore.getState().setThemeSelection({
			mode: "system",
			lightTheme: "paper",
			darkTheme: "dracula",
		});
		useUiStore.getState().setThemeMode("light");
		expect(useUiStore.getState().themeSelection).toEqual({
			mode: "light",
			lightTheme: "paper",
			darkTheme: "dracula",
		});
	});

	it("hydrates the stored selection once, and never over a choice made first", () => {
		const stored = {
			mode: "dark",
			lightTheme: "paper",
			darkTheme: "nord",
		} as const;
		useUiStore.getState().hydrateThemeSelection(stored);
		expect(useUiStore.getState().themeSelection).toEqual(stored);
		// A second hydration (a remount re-reading the store) is ignored.
		useUiStore.getState().hydrateThemeSelection(DEFAULT_SELECTION);
		expect(useUiStore.getState().themeSelection).toEqual(stored);

		reset();
		// A tap that lands before the read wins over the stored value.
		useUiStore.getState().setThemeMode("light");
		useUiStore.getState().hydrateThemeSelection(stored);
		expect(useUiStore.getState().themeSelection.mode).toBe("light");
		expect(useUiStore.getState().themeHydrated).toBe(true);
	});

	it("holds ONE toast, replacing rather than queueing", () => {
		// A queue on a phone is a stack of things nobody reads
		// (docs/design/components.md § 10).
		useUiStore.getState().showToast("Copied");
		useUiStore.getState().showToast("Approval sent");
		expect(useUiStore.getState().toast?.message).toBe("Approval sent");
	});

	it("gives each toast a new id, so a repeated message restarts its timer", () => {
		useUiStore.getState().showToast("Copied");
		const first = useUiStore.getState().toast?.id;
		useUiStore.getState().showToast("Copied");
		expect(useUiStore.getState().toast?.id).not.toBe(first);
	});

	it("defaults a toast to the neutral tone and dismisses to empty", () => {
		useUiStore.getState().showToast("Saved");
		expect(useUiStore.getState().toast?.tone).toBe("neutral");
		useUiStore.getState().dismissToast();
		expect(useUiStore.getState().toast).toBeNull();
	});
});
