import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

const native = vi.hoisted(() => ({
	os: "ios",
	image: true,
	clipboard: null as null | ((event: { contentTypes: string[] }) => void),
	app: null as null | ((state: string) => void),
}));
vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return native.os;
		},
	},
	AppState: {
		addEventListener: (_: string, listener: (state: string) => void) => {
			native.app = listener;
			return {
				remove: () => {
					native.app = null;
				},
			};
		},
	},
}));
vi.mock("expo-clipboard", () => ({
	ContentType: { IMAGE: "image" },
	hasImageAsync: async () => native.image,
	addClipboardListener: (
		listener: (event: { contentTypes: string[] }) => void,
	) => {
		native.clipboard = listener;
		return {
			remove: () => {
				native.clipboard = null;
			},
		};
	},
}));

import { useClipboardImageOffer } from "./attach-clipboard";
import { readClipboardImage } from "./attach-rule";

let offer: { visible: boolean; consume?: () => void };
let root: Root;
let dom: DomShim;
function Host() {
	offer = useClipboardImageOffer(true);
	return null;
}
beforeEach(() => {
	native.image = true;
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("mounted native paste availability", () => {
	it.each(["ios", "android"])(
		"keeps the visible door after denial and a second image on %s",
		async (os) => {
			native.os = os;
			await act(async () => root.render(createElement(Host)));
			expect(offer.visible).toBe(true);
			await act(async () => {
				offer.consume?.(); // Same action the old chip took BEFORE reading.
				expect(
					await readClipboardImage({ getImageAsync: async () => null }),
				).toBeNull();
			});
			expect(offer.visible).toBe(true);
			await act(async () => {
				offer.consume?.();
				await readClipboardImage({
					getImageAsync: async () => ({
						data: "data:image/png;base64,iVBORw0KGgo=",
					}),
				});
			});
			// No focus/remount/clipboard notification is required for the next paste.
			expect(offer.visible).toBe(true);
			await act(async () => native.clipboard?.({ contentTypes: [] }));
			expect(offer.visible).toBe(false);
			await act(async () => native.clipboard?.({ contentTypes: ["image"] }));
			expect(offer.visible).toBe(true);
		},
	);
});
