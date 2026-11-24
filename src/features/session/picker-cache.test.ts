import { afterEach, describe, expect, it, vi } from "vitest";

/* `clearNativePickerCache` chains every sweep on the previous one, so a drain
 *  that never returns hangs every later sweep and, through
 *  `prepareOrdinaryPrivateStorage`, every native startup admission (PR #327,
 *  review M1). The filesystem is a virtual ImagePicker directory, never host FS. */
const fs = vi.hoisted(() => ({ exists: true, deletes: 0 }));
vi.mock("expo-file-system", () => ({
	Paths: { cache: "memory://cache" },
	Directory: class {
		info() {
			return { exists: fs.exists };
		}
		delete() {
			fs.deletes++;
			fs.exists = false;
		}
	},
	File: class {},
}));

import { clearNativePickerCache } from "./picker-cache";
import { PICKER_DRAIN_BOUND_MS, pickerPrivacy } from "./picker-privacy";

afterEach(() => {
	vi.useRealTimers();
});

describe("native picker cache sweep", () => {
	it("sweeps after a bounded wait on a never-settling picker, and does not hold later sweeps behind it", async () => {
		vi.useFakeTimers();
		void pickerPrivacy.run(() => new Promise<never>(() => {}));
		let swept = false;
		const first = clearNativePickerCache().then(() => {
			swept = true;
		});
		await vi.advanceTimersByTimeAsync(PICKER_DRAIN_BOUND_MS - 1);
		expect(swept).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await first;
		expect(fs.deletes).toBe(1);
		// The next admission's sweep: chained on the first, not on the picker.
		fs.exists = true;
		let again = false;
		const second = clearNativePickerCache().then(() => {
			again = true;
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(again).toBe(true);
		await second;
		expect(fs.deletes).toBe(2);
	});
});
