import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CameraReadiness } from "@/features/session/attach-rule";
import { t } from "@/i18n";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { CONTROL, SURFACE } from "@/ui/a11y";

/*
 * The add-image sheet's behaviour, rendered: which rows exist, what a press on
 * each does, and the camera's permission outcomes (`ready` closes and launches,
 * `denied` keeps the sheet open with Open Settings, `unavailable` says so). The
 * native primitives are thin stand-ins that record each control's `onPress` by
 * testID, because the decision under test is this component's, not the
 * renderer's; the rendered pixels are the PR's web-export frames.
 */

const host = vi.hoisted(() => ({
	os: "ios",
	presses: new Map<string, () => void>(),
	openSettings: vi.fn(async () => {}),
	announced: [] as string[],
}));

vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return host.os;
		},
	},
	Linking: { openSettings: () => host.openSettings() },
	AccessibilityInfo: {
		announceForAccessibility: (message: string) => {
			host.announced.push(message);
		},
	},
	View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
	ActivityIndicator: () => <span>busy</span>,
	Pressable: ({
		children,
		onPress,
		testID,
		accessibilityLabel,
	}: {
		children?: ReactNode;
		onPress: () => void;
		testID: string;
		accessibilityLabel: string;
	}) => {
		host.presses.set(testID, onPress);
		return <div data-label={accessibilityLabel}>{children}</div>;
	},
}));
vi.mock("lucide-react-native", () => {
	const Glyph = () => <span />;
	return {
		Camera: Glyph,
		ClipboardPaste: Glyph,
		FolderOpen: Glyph,
		Images: Glyph,
	};
});
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "#000" }));
vi.mock("@/features/session/attach", () => ({
	prepareCamera: async () => "ready",
}));
vi.mock("@/ui/components", () => ({
	Sheet: ({
		visible,
		title,
		children,
	}: {
		visible: boolean;
		title: string;
		children?: ReactNode;
	}) =>
		visible ? (
			<section>
				<h2>{title}</h2>
				{children}
			</section>
		) : null,
	Banner: ({
		message,
		action,
		testID,
	}: {
		message: string;
		action?: { label: string; onPress: () => void; testID: string };
		testID: string;
	}) => {
		if (action) host.presses.set(action.testID, action.onPress);
		return (
			<div data-testid={testID}>
				{message}
				{action ? <span>{action.label}</span> : null}
			</div>
		);
	},
}));

import { AttachSheet } from "./attach-sheet";

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
const textOf = (node: Node): string => {
	const children = Array.from(node.childNodes ?? []);
	return children.length
		? children.map(textOf).join(" ")
		: (node.textContent ?? "");
};
const shown = () => textOf(dom.container as unknown as Node);

beforeEach(() => {
	dom = installDomShim();
	root = createRoot(dom.container as unknown as HTMLElement);
	host.os = "ios";
	host.presses.clear();
	host.openSettings.mockClear();
	host.announced = [];
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

const renderSheet = async (
	checkCamera: () => Promise<CameraReadiness>,
	visible = true,
	extra: Partial<ComponentProps<typeof AttachSheet>> = {},
) => {
	const onChoose = vi.fn();
	await act(async () =>
		root.render(
			<AttachSheet
				visible={visible}
				onClose={() => {}}
				onDismiss={() => {}}
				onChoose={onChoose}
				checkCamera={checkCamera}
				{...extra}
			/>,
		),
	);
	return onChoose;
};
const press = (testID: string) =>
	act(async () => {
		const onPress = host.presses.get(testID);
		if (!onPress) throw new Error(`no control ${testID}`);
		onPress();
	});

describe("the add-image sheet", () => {
	it("lists Photo Library, Take Photo, Files and Paste Image on native, in that order", async () => {
		await renderSheet(async () => "ready");
		const text = shown();
		const order = [
			t("mobile.composer_input.attach.title"),
			t("mobile.composer_input.attach.library"),
			t("mobile.composer_input.attach.camera"),
			t("mobile.composer_input.attach.files"),
			t("mobile.composer_input.attach.paste"),
		].map((label) => text.indexOf(label));
		expect(order.every((index) => index >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	it("offers no camera on the web build", async () => {
		host.os = "web";
		await renderSheet(async () => "ready");
		expect(shown()).not.toContain(t("mobile.composer_input.attach.camera"));
		expect(shown()).toContain(t("mobile.composer_input.attach.choose_image"));
	});

	it("hands a non-camera source straight to the composer", async () => {
		const check = vi.fn(async (): Promise<CameraReadiness> => "ready");
		const onChoose = await renderSheet(check);
		await press("attach-option-library");
		expect(onChoose).toHaveBeenCalledWith("library");
		expect(check).not.toHaveBeenCalled();
	});

	it("checks the camera first, then hands it over when it is ready", async () => {
		const onChoose = await renderSheet(async () => "ready");
		await press("attach-option-camera");
		expect(onChoose).toHaveBeenCalledWith("camera");
		expect(shown()).not.toContain(
			t("mobile.composer_input.attach.camera_denied"),
		);
	});

	it("stays open on a refusal and offers Open Settings, which opens the app's settings", async () => {
		const onChoose = await renderSheet(async () => "denied");
		await press("attach-option-camera");
		expect(onChoose).not.toHaveBeenCalled();
		expect(shown()).toContain(t("mobile.composer_input.attach.camera_denied"));
		expect(shown()).toContain(t("mobile.composer_input.attach.open_settings"));
		await press(CONTROL.attachCameraSettings);
		expect(host.openSettings).toHaveBeenCalledOnce();
	});

	it("says there is no camera, with no Settings action, when none is available", async () => {
		const onChoose = await renderSheet(async () => "unavailable");
		await press("attach-option-camera");
		expect(onChoose).not.toHaveBeenCalled();
		expect(shown()).toContain(
			t("mobile.composer_input.attach.camera_unavailable"),
		);
		expect(host.presses.has(CONTROL.attachCameraSettings)).toBe(false);
		expect(SURFACE.attachCameraNotice).toBe("attach-camera-notice");
	});

	it("drops a camera answer that arrives after the sheet was closed and reopened", async () => {
		let answer: (value: CameraReadiness) => void = () => {};
		const check = () =>
			new Promise<CameraReadiness>((resolve) => {
				answer = resolve;
			});
		const onChoose = await renderSheet(check);
		await press("attach-option-camera");
		await renderSheet(check, false);
		const reopened = await renderSheet(check, true);
		await act(async () => answer("ready"));
		expect(onChoose).not.toHaveBeenCalled();
		expect(reopened).not.toHaveBeenCalled();
	});

	/* PR #278 round 1, R2/U3/Q2: a refusal the OS will ask about again. */
	it("says only that access wasn't allowed when the OS can still ask, and the next press asks again", async () => {
		const check = vi.fn(async (): Promise<CameraReadiness> => "refused");
		const onChoose = await renderSheet(check);
		await press("attach-option-camera");
		expect(onChoose).not.toHaveBeenCalled();
		expect(shown()).toContain(t("mobile.composer_input.attach.camera_refused"));
		expect(shown()).not.toContain(
			t("mobile.composer_input.attach.open_settings"),
		);
		expect(host.presses.has(CONTROL.attachCameraSettings)).toBe(false);
		await press("attach-option-camera");
		expect(check).toHaveBeenCalledTimes(2);
	});

	/* U2: iOS VoiceOver ignores live regions, so the notice is posted. */
	it("announces the camera notice to VoiceOver on iOS, and leaves Android to the live region", async () => {
		await renderSheet(async () => "denied");
		await press("attach-option-camera");
		expect(host.announced).toEqual([
			t("mobile.composer_input.attach.camera_denied"),
		]);
		await act(async () => root.unmount());
		root = createRoot(dom.container as unknown as HTMLElement);
		host.os = "android";
		host.announced = [];
		await renderSheet(async () => "denied");
		await press("attach-option-camera");
		expect(host.announced).toEqual([]);
	});

	/* U4: the epoch moves on close and on another row, not only on reopen. */
	it("drops a camera answer that arrives after the sheet was closed (no reopen)", async () => {
		let answer: (value: CameraReadiness) => void = () => {};
		const check = () =>
			new Promise<CameraReadiness>((resolve) => {
				answer = resolve;
			});
		const onChoose = await renderSheet(check);
		await press("attach-option-camera");
		const closed = await renderSheet(check, false);
		await act(async () => answer("ready"));
		expect(onChoose).not.toHaveBeenCalled();
		expect(closed).not.toHaveBeenCalled();
	});

	it("drops a late camera answer once the reader picked another row, so only that row launches", async () => {
		let answer: (value: CameraReadiness) => void = () => {};
		const onChoose = await renderSheet(
			() =>
				new Promise<CameraReadiness>((resolve) => {
					answer = resolve;
				}),
		);
		await press("attach-option-camera");
		await press("attach-option-files");
		await act(async () => answer("ready"));
		expect(onChoose.mock.calls).toEqual([["files"]]);
	});

	/* U5/D1: Team Bridge renders this sheet with its own rows and test IDs. */
	it("renders only a host's sources, under the host's test IDs", async () => {
		const onChoose = await renderSheet(async () => "ready", true, {
			sources: ["library", "camera", "paste"],
			optionId: (source) => `team-bridge-attach-source-${source}`,
		});
		expect(shown()).not.toContain(t("mobile.composer_input.attach.files"));
		expect(host.presses.has("team-bridge-attach-source-files")).toBe(false);
		await press("team-bridge-attach-source-camera");
		expect(onChoose).toHaveBeenCalledWith("camera");
	});
});
