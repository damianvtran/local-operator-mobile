import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

const host = vi.hoisted(() => ({
	presses: new Map<string, () => void>(),
	labels: new Map<string, string | undefined>(),
	texts: [] as string[],
	save: vi.fn(async () => true),
}));
vi.mock("react-native", () => ({
	Platform: { OS: "web" },
	View: ({ children }: { children: import("react").ReactNode }) => children,
	Text: ({ children }: { children: string }) => {
		host.texts.push(children);
		return children;
	},
}));
vi.mock("@/ui/components/button", () => ({
	Button: ({
		label,
		onPress,
		testID,
		accessibilityLabel,
	}: {
		label: string;
		onPress: () => void;
		testID: string;
		accessibilityLabel?: string;
	}) => {
		host.presses.set(testID, onPress);
		host.labels.set(testID, accessibilityLabel);
		return label;
	},
}));
vi.mock("../retained-file", async (original) => ({
	...(await original<typeof import("../retained-file")>()),
	saveRetainedFile: host.save,
}));
const { TranscriptFiles, fileSaveError } = await import("./transcript-files");
const { RelayError } = await import("@/relay");
const { RemoteFeatureNotice } = await import("./remote-feature-notice");
let dom: DomShim;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	dom = installDomShim();
	root = createRoot(dom.container as never);
	host.presses.clear();
	host.texts = [];
	host.save.mockReset().mockResolvedValue(true);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("retained file affordance", () => {
	it("honestly explains missing remote Highlights/generated previews and leaves local UI unchanged", async () => {
		await act(async () =>
			root.render(createElement(RemoteFeatureNotice, { remote: true })),
		);
		/* D5/U5: reader words, not protocol vocabulary. */
		expect(host.texts.join(" ")).toContain(
			"can’t be previewed in remote conversations yet",
		);
		expect(host.texts.join(" ")).not.toContain("retained document");
		host.texts = [];
		await act(async () =>
			root.render(createElement(RemoteFeatureNotice, { remote: false })),
		);
		expect(host.texts).toEqual([]);
	});
	it("renders a sparse document and downloads authenticated bytes only on explicit Save", async () => {
		const bytes = new TextEncoder().encode("retained proof");
		const load = vi.fn(async () => ({ bytes, mimeType: "text/plain" }));
		await act(async () =>
			root.render(
				createElement(TranscriptFiles, {
					entryId: "historical-row",
					files: [
						{
							index: 3,
							filename: "notes.txt",
							mime_type: "text/plain",
							bytes: bytes.length,
						},
					],
					load,
				}),
			),
		);
		expect(host.texts).toContain("notes.txt");
		expect(load).not.toHaveBeenCalled();
		await act(async () => {
			host.presses.get("transcript-file-save-historical-row-3")?.();
		});
		expect(load).toHaveBeenCalledExactlyOnceWith("historical-row", 3);
		/* D4/U6: the accessible name carries the file, so several cards never
		 *  read "Save, Save, Save". */
		expect(host.labels.get("transcript-file-save-historical-row-3")).toBe(
			"Save notes.txt",
		);
		expect(host.save).toHaveBeenCalledExactlyOnceWith(
			bytes,
			"notes.txt",
			"text/plain",
			"web",
		);
	});
	it("never echoes the relay's raw sign-in string on the card (QA Q1)", () => {
		const unauthorized = new RelayError(
			"relay-unauthorized",
			"authentication required",
			{ status: 401 },
		);
		expect(fileSaveError(unauthorized)).toBe(
			"Could not save this file. Try again.",
		);
		expect(fileSaveError(new Error("synthetic"))).toBe(
			"Could not save this file. Try again.",
		);
	});
});
