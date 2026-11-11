import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
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
import { pasteOfferComposing, readClipboardImage } from "./attach-rule";

let offer: { visible: boolean; consume?: () => void };
let root: ReturnType<typeof createRoot>;
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

/* The composer's own rule over its own state: focus, the draft and the
 *  attachment strip, with a paste appending to the strip as `useComposer`'s
 *  `attach("paste", …)` does (`[...current, image]`, pinned through the real
 *  hook in use-composer-echo.test.ts). */
let composerState: {
	setFocused: (focused: boolean) => void;
	paste: () => void;
	images: string[];
};
function ComposingHost() {
	const [focused, setFocused] = useState(true);
	const [images, setImages] = useState<string[]>([]);
	offer = useClipboardImageOffer(
		pasteOfferComposing({ focused, draft: "", attachments: images.length }),
	);
	composerState = {
		setFocused,
		paste: () =>
			setImages((current) => [...current, `image-${current.length}`]),
		images,
	};
	return null;
}

describe("a second image after the keyboard is put away (TestFlight 753)", () => {
	it("keeps Paste image offered after one paste and a blur, and a second paste appends", async () => {
		native.os = "ios";
		await act(async () => root.render(createElement(ComposingHost)));
		expect(offer.visible).toBe(true);
		await act(async () => composerState.paste());
		/* The reader puts the keyboard away to reach Send: the field blurs. */
		await act(async () => composerState.setFocused(false));
		expect(offer.visible).toBe(true);
		await act(async () => composerState.paste());
		expect(composerState.images).toEqual(["image-0", "image-1"]);
		expect(offer.visible).toBe(true);
	});
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
