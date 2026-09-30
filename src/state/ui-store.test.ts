import { beforeEach, describe, expect, it } from "vitest";

import { useUiStore } from "@/state/ui-store";

const reset = () =>
	useUiStore.setState({ themePreference: "system", toast: null });

describe("ui-store", () => {
	beforeEach(reset);

	it("follows the device until the reader chooses otherwise", () => {
		expect(useUiStore.getState().themePreference).toBe("system");
	});

	it("records a manual override and lets the reader return to the device", () => {
		useUiStore.getState().setThemePreference("dark");
		expect(useUiStore.getState().themePreference).toBe("dark");
		useUiStore.getState().setThemePreference("system");
		expect(useUiStore.getState().themePreference).toBe("system");
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
