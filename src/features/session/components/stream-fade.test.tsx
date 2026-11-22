import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

const driver = vi.hoisted(() => ({
	timing: vi.fn(),
	start: vi.fn(),
	stop: vi.fn(),
	setValue: vi.fn(),
}));

vi.mock("react-native", async () => {
	const { createElement } = await import("react");
	return {
		Platform: { OS: "ios" },
		Animated: {
			Value: class {
				setValue = driver.setValue;
			},
			View: ({ children }: { children: string }) =>
				createElement("div", null, children),
			timing: driver.timing.mockReturnValue({
				start: driver.start,
				stop: driver.stop,
			}),
		},
		Easing: { bezier: () => "fixed curve" },
	};
});

import { StreamBlock } from "@/features/session/components/stream-fade";

it("uses the native non-interaction driver once and finishes immediately on settle", async () => {
	const dom: DomShim = installDomShim();
	const container = dom.container as Element;
	const root = createRoot(container);
	const birth = {};
	const draw = async (
		created: object | null,
		motion: object | null,
		children: string,
	) => {
		await act(async () =>
			root.render(
				createElement(StreamBlock, { birth: created, motion, children }),
			),
		);
	};
	try {
		await draw(birth, birth, "Fresh block");
		expect(driver.timing).toHaveBeenCalledExactlyOnceWith(
			expect.anything(),
			expect.objectContaining({
				useNativeDriver: true,
				toValue: 1,
				isInteraction: false,
			}),
		);
		expect(driver.start).toHaveBeenCalledTimes(1);
		const host = container.firstChild;
		await draw(null, birth, "Appended text");
		expect(driver.start).toHaveBeenCalledTimes(1);
		await draw(null, null, "Final text");
		expect(driver.stop).toHaveBeenCalledTimes(1);
		expect(driver.setValue).toHaveBeenCalledExactlyOnceWith(1);
		expect(container.firstChild).toBe(host);
		await draw(null, {}, "Reconnect snapshot");
		expect(driver.start).toHaveBeenCalledTimes(1);
	} finally {
		await act(async () => root.unmount());
		dom.dispose();
	}
});
