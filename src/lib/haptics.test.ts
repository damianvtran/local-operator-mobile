import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

const { createHaptic, haptic } = await import("@/lib/haptics");

const fakeModule = () => ({
	impactAsync: vi.fn(async () => undefined),
	selectionAsync: vi.fn(async () => undefined),
	notificationAsync: vi.fn(async () => undefined),
	ImpactFeedbackStyle: { Light: "light" },
	NotificationFeedbackType: { Warning: "warning" },
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("haptic", () => {
	it("is a no-op on web and never loads the native module", async () => {
		const load = vi.fn(async () => fakeModule());
		const tick = createHaptic({ os: () => "web", load });
		tick("light");
		tick("selection");
		tick("warning");
		await settle();
		expect(load).not.toHaveBeenCalled();
		// The shipped binding, on the platform the unit suite runs as.
		expect(() => haptic("light")).not.toThrow();
	});

	it("maps each kind to its own native call, loading the module once", async () => {
		const module = fakeModule();
		const load = vi.fn(async () => module);
		const tick = createHaptic({ os: () => "ios", load });
		tick("light");
		tick("selection");
		tick("warning");
		await settle();
		expect(load).toHaveBeenCalledTimes(1);
		expect(module.impactAsync).toHaveBeenCalledExactlyOnceWith("light");
		expect(module.selectionAsync).toHaveBeenCalledTimes(1);
		expect(module.notificationAsync).toHaveBeenCalledExactlyOnceWith("warning");
	});

	it("swallows a missing module, a rejected call and a throwing loader", async () => {
		const unhandled = vi.fn();
		process.on("unhandledRejection", unhandled);
		try {
			const missing = createHaptic({
				os: () => "android",
				load: async () => {
					throw new Error("native module not linked");
				},
			});
			expect(() => missing("light")).not.toThrow();

			const module = fakeModule();
			module.impactAsync.mockRejectedValue(new Error("no taptic engine"));
			const rejecting = createHaptic({
				os: () => "ios",
				load: async () => module,
			});
			expect(() => rejecting("light")).not.toThrow();

			const throwing = createHaptic({
				os: () => "ios",
				load: () => {
					throw new Error("sync");
				},
			});
			expect(() => throwing("selection")).not.toThrow();
			await settle();
			await settle();
			expect(unhandled).not.toHaveBeenCalled();
		} finally {
			process.off("unhandledRejection", unhandled);
		}
	});
});
